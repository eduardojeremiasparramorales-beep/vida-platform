// Centro Documental
// Almacena y organiza documentos por proyecto, lead o vendedor.
// Soporta: PDFs, escrituras, contratos, renders, planos, licencias, fotos, videos.

const store = require('../db/store');
const log = require('../utils/logger');
const path = require('path');
const fs = require('fs');

const DOCS_DIR = path.join(__dirname, '../../data/documentos');

function ensureDirs() {
  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
}

function ensureTable() {
  const db = store.getDB();
  db.exec(`
    CREATE TABLE IF NOT EXISTS documentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL,
      descripcion TEXT DEFAULT '',
      tipo TEXT NOT NULL DEFAULT 'otro' CHECK (tipo IN (
        'escritura', 'contrato', 'render', 'plano', 'licencia',
        'foto', 'video', 'pdf', 'link', 'otro'
      )),
      categoria TEXT DEFAULT 'general' CHECK (categoria IN (
        'general', 'legal', 'ventas', 'marketing', 'financiero', 'proyecto', 'lead'
      )),
      archivo_nombre TEXT DEFAULT '',
      archivo_path TEXT DEFAULT '',
      archivo_mime TEXT DEFAULT '',
      archivo_size INTEGER DEFAULT 0,
      url_externa TEXT DEFAULT '',
      proyecto_id INTEGER,
      lead_id INTEGER,
      vendedor_id INTEGER,
      tags TEXT DEFAULT '[]',
      visible INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (proyecto_id) REFERENCES proyectos(id),
      FOREIGN KEY (lead_id) REFERENCES leads(id),
      FOREIGN KEY (vendedor_id) REFERENCES vendedores(id)
    );
    CREATE INDEX IF NOT EXISTS idx_docs_tipo ON documentos(tipo);
    CREATE INDEX IF NOT EXISTS idx_docs_categoria ON documentos(categoria);
    CREATE INDEX IF NOT EXISTS idx_docs_proyecto ON documentos(proyecto_id);
    CREATE INDEX IF NOT EXISTS idx_docs_lead ON documentos(lead_id);
  `);
  ensureDirs();
}

function crearDocumento(data) {
  ensureTable();
  const { titulo, descripcion, tipo, categoria, archivoNombre, archivoPath, archivoMime, archivoSize, urlExterna, proyectoId, leadId, vendedorId, tags } = data;
  const result = store.run(
    `INSERT INTO documentos (titulo, descripcion, tipo, categoria, archivo_nombre, archivo_path, archivo_mime, archivo_size, url_externa, proyecto_id, lead_id, vendedor_id, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [titulo, descripcion || '', tipo || 'otro', categoria || 'general', archivoNombre || '', archivoPath || '', archivoMime || '', archivoSize || 0, urlExterna || '', proyectoId || null, leadId || null, vendedorId || null, JSON.stringify(tags || [])]
  );
  log.info('DOCS', `Documento creado: ${titulo} (ID ${result.lastInsertRowid})`);
  return { ok: true, id: result.lastInsertRowid };
}

function listarDocumentos(filtros = {}) {
  ensureTable();
  let where = [];
  let params = [];
  if (filtros.tipo) { where.push('tipo = ?'); params.push(filtros.tipo); }
  if (filtros.categoria) { where.push('categoria = ?'); params.push(filtros.categoria); }
  if (filtros.proyectoId) { where.push('proyecto_id = ?'); params.push(filtros.proyectoId); }
  if (filtros.leadId) { where.push('lead_id = ?'); params.push(filtros.leadId); }
  if (filtros.busqueda) { where.push("(titulo LIKE ? OR descripcion LIKE ? OR tags LIKE ?)"); const b = `%${filtros.busqueda}%`; params.push(b, b, b); }
  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return store.all(
    `SELECT d.*, p.nombre as proyecto_nombre, l.customer_name as lead_nombre, v.nombre as vendedor_nombre
     FROM documentos d
     LEFT JOIN proyectos p ON d.proyecto_id = p.id
     LEFT JOIN leads l ON d.lead_id = l.id
     LEFT JOIN vendedores v ON d.vendedor_id = v.id
     ${whereStr}
     ORDER BY d.created_at DESC
     LIMIT ?`,
    [...params, filtros.limite || 200]
  );
}

function obtenerDocumento(id) {
  ensureTable();
  return store.one(`SELECT * FROM documentos WHERE id = ?`, [id]);
}

function actualizarDocumento(id, data) {
  ensureTable();
  const campos = [];
  const params = [];
  for (const [k, v] of Object.entries(data)) {
    if (['titulo', 'descripcion', 'tipo', 'categoria', 'url_externa', 'tags', 'visible'].includes(k)) {
      campos.push(`${k} = ?`);
      params.push(k === 'tags' ? JSON.stringify(v) : v);
    }
  }
  if (!campos.length) return { ok: false };
  campos.push("updated_at = datetime('now','localtime')");
  params.push(id);
  store.run(`UPDATE documentos SET ${campos.join(', ')} WHERE id = ?`, params);
  return { ok: true };
}

function eliminarDocumento(id) {
  ensureTable();
  const doc = store.one(`SELECT archivo_path FROM documentos WHERE id = ?`, [id]);
  if (doc && doc.archivo_path) {
    try { fs.unlinkSync(doc.archivo_path); } catch (e) {}
  }
  store.run(`DELETE FROM documentos WHERE id = ?`, [id]);
  return { ok: true };
}

function buscarDocumentos(query) {
  ensureTable();
  const b = `%${query}%`;
  return store.all(
    `SELECT * FROM documentos WHERE titulo LIKE ? OR descripcion LIKE ? OR tags LIKE ? ORDER BY created_at DESC LIMIT 50`,
    [b, b, b]
  );
}

module.exports = {
  ensureTable,
  crearDocumento,
  listarDocumentos,
  obtenerDocumento,
  actualizarDocumento,
  eliminarDocumento,
  buscarDocumentos,
};
