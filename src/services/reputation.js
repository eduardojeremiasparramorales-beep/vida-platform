// Centro de Reputación — NPS + Referidos + Satisfacción
// Mide la satisfacción del cliente post-venta y gestiona un programa de referidos.

const store = require('../db/store');
const log = require('../utils/logger');

function ensureTable() {
  const db = store.getDB();
  db.exec(`
    CREATE TABLE IF NOT EXISTS encuestas_satisfaccion (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER,
      vendedor_id INTEGER,
      tipo TEXT DEFAULT 'nps' CHECK (tipo IN ('nps', 'csat', 'cierre')),
      puntuacion INTEGER DEFAULT 0,
      comentario TEXT DEFAULT '',
      enviada_at DATETIME DEFAULT (datetime('now','localtime')),
      respondida_at DATETIME,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (lead_id) REFERENCES leads(id),
      FOREIGN KEY (vendedor_id) REFERENCES vendedores(id)
    );

    CREATE TABLE IF NOT EXISTS referidos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referidor_lead_id INTEGER NOT NULL,
      referido_nombre TEXT NOT NULL,
      referido_telefono TEXT NOT NULL,
      referido_email TEXT DEFAULT '',
      estado TEXT DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'contactado', 'convertido', 'rechazado')),
      lead_creado_id INTEGER,
      vendedor_asignado_id INTEGER,
      recompensa TEXT DEFAULT '',
      notas TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (referidor_lead_id) REFERENCES leads(id),
      FOREIGN KEY (lead_creado_id) REFERENCES leads(id),
      FOREIGN KEY (vendedor_asignado_id) REFERENCES vendedores(id)
    );

    CREATE INDEX IF NOT EXISTS idx_encuestas_lead ON encuestas_satisfaccion(lead_id);
    CREATE INDEX IF NOT EXISTS idx_encuestas_tipo ON encuestas_satisfaccion(tipo);
    CREATE INDEX IF NOT EXISTS idx_referidos_estado ON referidos(estado);
    CREATE INDEX IF NOT EXISTS idx_referidos_telefono ON referidos(referido_telefono);
  `);
}

// --- Encuestas ---
function crearEncuesta(data) {
  ensureTable();
  const { leadId, vendedorId, tipo, puntuacion, comentario } = data;
  const result = store.run(
    `INSERT INTO encuestas_satisfaccion (lead_id, vendedor_id, tipo, puntuacion, comentario)
     VALUES (?, ?, ?, ?, ?)`,
    [leadId || null, vendedorId || null, tipo || 'nps', puntuacion || 0, comentario || '']
  );
  return { ok: true, id: result.lastInsertRowid };
}

function responderEncuesta(id, puntuacion, comentario) {
  ensureTable();
  store.run(
    `UPDATE encuestas_satisfaccion SET puntuacion = ?, comentario = ?, respondida_at = datetime('now','localtime') WHERE id = ?`,
    [puntuacion, comentario || '', id]
  );
  return { ok: true };
}

function calcularNPS() {
  ensureTable();
  const encuestas = store.all(
    `SELECT puntuacion FROM encuestas_satisfaccion WHERE tipo = 'nps' AND puntuacion > 0`
  );
  if (!encuestas.length) return { nps: 0, promotores: 0, pasivos: 0, detractores: 0, total: 0 };

  const promotores = encuestas.filter(e => e.puntuacion >= 9).length;
  const pasivos = encuestas.filter(e => e.puntuacion >= 7 && e.puntuacion <= 8).length;
  const detractores = encuestas.filter(e => e.puntuacion <= 6).length;
  const total = encuestas.length;
  const nps = Math.round(((promotores - detractores) / total) * 100);

  return { nps, promotores, pasivos, detractores, total };
}

function listarEncuestas(filtros = {}) {
  ensureTable();
  let where = [];
  let params = [];
  if (filtros.tipo) { where.push('tipo = ?'); params.push(filtros.tipo); }
  if (filtros.vendedorId) { where.push('vendedor_id = ?'); params.push(filtros.vendedorId); }
  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return store.all(
    `SELECT e.*, l.customer_name as lead_nombre, v.nombre as vendedor_nombre
     FROM encuestas_satisfaccion e
     LEFT JOIN leads l ON e.lead_id = l.id
     LEFT JOIN vendedores v ON e.vendedor_id = v.id
     ${whereStr}
     ORDER BY e.created_at DESC
     LIMIT ?`,
    [...params, filtros.limite || 100]
  );
}

// --- Referidos ---
function crearReferido(data) {
  ensureTable();
  const { referidorLeadId, nombre, telefono, email, notas } = data;
  // Verificar si ya existe un referido con ese teléfono
  const existente = store.one(`SELECT id FROM referidos WHERE referido_telefono = ? AND estado != 'rechazado'`, [telefono]);
  if (existente) return { ok: false, error: 'Este teléfono ya fue referido' };

  const result = store.run(
    `INSERT INTO referidos (referidor_lead_id, referido_nombre, referido_telefono, referido_email, notas)
     VALUES (?, ?, ?, ?, ?)`,
    [referidorLeadId, nombre, telefono, email || '', notas || '']
  );
  log.info('REFERIDOS', `Referido creado: ${nombre} (${telefono}) por lead #${referidorLeadId}`);
  return { ok: true, id: result.lastInsertRowid };
}

function actualizarReferido(id, data) {
  ensureTable();
  const campos = [];
  const params = [];
  for (const [k, v] of Object.entries(data)) {
    if (['estado', 'lead_creado_id', 'vendedor_asignado_id', 'recompensa', 'notas'].includes(k)) {
      campos.push(`${k} = ?`);
      params.push(v);
    }
  }
  if (!campos.length) return { ok: false };
  campos.push("updated_at = datetime('now','localtime')");
  params.push(id);
  store.run(`UPDATE referidos SET ${campos.join(', ')} WHERE id = ?`, params);
  return { ok: true };
}

function listarReferidos(filtros = {}) {
  ensureTable();
  let where = [];
  let params = [];
  if (filtros.estado) { where.push('r.estado = ?'); params.push(filtros.estado); }
  if (filtros.referidorLeadId) { where.push('r.referidor_lead_id = ?'); params.push(filtros.referidorLeadId); }
  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return store.all(
    `SELECT r.*, l.customer_name as referidor_nombre, v.nombre as vendedor_nombre
     FROM referidos r
     LEFT JOIN leads l ON r.referidor_lead_id = l.id
     LEFT JOIN vendedores v ON r.vendedor_asignado_id = v.id
     ${whereStr}
     ORDER BY r.created_at DESC
     LIMIT ?`,
    [...params, filtros.limite || 100]
  );
}

function estadisticasReferidos() {
  ensureTable();
  const total = store.one(`SELECT COUNT(*) as total FROM referidos`);
  const porEstado = store.all(`SELECT estado, COUNT(*) as total FROM referidos GROUP BY estado`);
  const convertidos = store.one(`SELECT COUNT(*) as total FROM referidos WHERE estado = 'convertido'`);
  const tasaConversion = total.total > 0 ? ((convertidos.total / total.total) * 100).toFixed(1) : '0';
  return {
    total: total.total,
    porEstado: porEstado.reduce((acc, r) => { acc[r.estado] = r.total; return acc; }, {}),
    convertidos: convertidos.total,
    tasaConversion,
  };
}

module.exports = {
  ensureTable,
  crearEncuesta,
  responderEncuesta,
  calcularNPS,
  listarEncuestas,
  crearReferido,
  actualizarReferido,
  listarReferidos,
  estadisticasReferidos,
};
