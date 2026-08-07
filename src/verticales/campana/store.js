// Vid.a â€” Vertical CAMPAÃ‘A: lÃ³gica de dominio (store) sobre las tablas base.
// Reutiliza adapter.js (resuelve la conexiÃ³n del tenant activo) â€” todas las funciones
// corren DENTRO del context del tenant ya resuelto por el middleware de index.js.
const adapter = require('../../db/adapter');
const store = require('../../db/store');
const { ESTADOS_VOTO_DEF, ROLES_EQUIPO } = require('./schema');

const all = (sql, p = []) => adapter.all(sql, p);
const one = (sql, p = []) => adapter.one(sql, p);
const run = (sql, p = []) => adapter.run(sql, p);

// ---------- Config de la vertical (tabla `config` del tenant) ----------
function getConfig(configKey, fallback) {
  try {
    const v = adapter.one('SELECT value FROM config WHERE key = ?', [configKey]);
    if (v && v.value) { try { return JSON.parse(v.value); } catch (e) { return v.value; } }
  } catch (e) {}
  return fallback;
}
function setConfig(configKey, value) {
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  try {
    adapter.run('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [configKey, v]);
  } catch (e) {
    adapter.run('UPDATE config SET value = ? WHERE key = ?', [v, configKey]);
  }
}
function getEstadosVoto() { return Array.isArray(getConfig('vertical.campana.estados_voto', null)) ? getConfig('vertical.campana.estados_voto') : JSON.parse(JSON.stringify(ESTADOS_VOTO_DEF)); }
function setEstadosVoto(lista) { setConfig('vertical.campana.estados_voto', lista); }
function getInfoCampana() {
  return getConfig('vertical.campana.info', { nombre: '', cargo: 'Concejal Municipal', eslogan: '', foto: '', zonas: [] });
}
function setInfoCampana(info) { setConfig('vertical.campana.info', info); }

// ---------- Votantes (sobre leads) ----------
function buildWhere(f) {
  const w = [];
  if (f.q) w.push('(l.customer_name LIKE ? OR l.customer_phone LIKE ? OR l.cedula LIKE ?)');
  if (f.zona) w.push('l.zona = ?');
  if (f.barrio) w.push('l.barrio = ?');
  if (f.estado_voto) w.push('l.estado_voto = ?');
  if (f.ocupacion) w.push('l.ocupacion = ?');
  if (f.vendedor) w.push('l.assigned_to_id = ?');
  if (f.referido_de) w.push('l.referido_por = ?');
  if (f.soloActivos !== false) w.push("(l.status IS NULL OR l.status != 'cerrado')");
  return w.length ? ' WHERE ' + w.join(' AND ') : '';
}
function buildParams(f) {
  const p = [];
  if (f.q) { const like = `%${f.q}%`; p.push(like, like, like); }
  if (f.zona) p.push(f.zona);
  if (f.barrio) p.push(f.barrio);
  if (f.estado_voto) p.push(f.estado_voto);
  if (f.ocupacion) p.push(f.ocupacion);
  if (f.vendedor) p.push(Number(f.vendedor));
  if (f.referido_de) p.push(Number(f.referido_de));
  return p;
}

function listVotantes(f = {}) {
  let sql = `SELECT l.*, (SELECT COUNT(*) FROM votantes_referidos r WHERE r.votante_id = l.id) AS n_referidos
    FROM leads l${buildWhere(f)} ORDER BY l.created_at DESC`;
  if (f.limite) sql += ` LIMIT ${Number(f.limite)} OFFSET ${Number(f.offset || 0)}`;
  return all(sql, buildParams(f));
}

function countVotantes(f = {}) {
  const { limite, offset, ...rest } = f;
  const row = one(`SELECT COUNT(*) AS c FROM leads l${buildWhere(rest)}`, buildParams(rest));
  return row ? row.c : 0;
}

function getVotante(id) {
  return one(`SELECT l.*, (SELECT COUNT(*) FROM votantes_referidos r WHERE r.votante_id = l.id) AS n_referidos
    FROM leads l WHERE l.id = ?`, [Number(id)]);
}

function crearVotante(data) {
  const nombre = data.nombre || data.customer_name || 'Votantes';
  const telefono = String(data.telefono || data.customer_phone || '').replace(/[\s-]/g, '');
  const res = run(`INSERT INTO leads (customer_name, customer_phone, assigned_to_id, estado_voto, zona, barrio, ocupacion, fecha_nacimiento, cedula, referido_por, compromiso_nota, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))`,
    [nombre, telefono || null,
      data.assigned_to_id != null ? Number(data.assigned_to_id) : null,
      data.estado_voto || 'lista',
      data.zona || '', data.barrio || '',
      data.ocupacion || '', data.fecha_nacimiento || '',
      data.cedula || '', data.referido_por != null ? Number(data.referido_por) : null,
      data.compromiso_nota || '']);
  const id = getLastInsertId(res);
  return id ? getVotante(id) : null;
}

function getLastInsertId(res) {
  // better-sqlite3 expone lastInsertRowid; sql.js hay que leer manualmente
  if (res && res.lastInsertRowid != null) return res.lastInsertRowid;
  try { const row = one('SELECT last_insert_rowid() AS id'); return row ? row.id : null; } catch (e) { return null; }
}

function updateVotante(id, data) {
  const campos = [];
  const params = [];
  const mapa = { nombre: 'nombre', estado: 'estado', estado_voto: 'estado_voto', zona: 'zona', barrio: 'barrio', ocupacion: 'ocupacion', fecha_nacimiento: 'fecha_nacimiento', cedula: 'cedula', compromiso_nota: 'compromiso_nota', resultado: 'resultado', referido_por: 'referido_por' };
  for (const [k, col] of Object.entries(mapa)) {
    if (data[k] !== undefined) { campos.push(`${col} = ?`); params.push(data[k]); }
  }
  if (data.estado_voto && ['comprometido', 'votara'].includes(data.estado_voto)) {
    campos.push("fecha_compromiso = COALESCE(fecha_compromiso, datetime('now','localtime'))");
  }
  if (!campos.length) return getVotante(id);
  campos.push("updated_at = datetime('now','localtime')");
  params.push(Number(id));
  run(`UPDATE leads SET ${campos.join(', ')} WHERE id = ?`, params);
  return getVotante(id);
}

function setEstadoVoto(id, estado, nota) {
  return updateVotante(id, { estado_voto: estado, compromiso_nota: nota !== undefined ? nota : undefined });
}

// ---------- SegmentaciÃ³n: valores Ãºnicos existentes para poblar filtros ----------
function getOpcionesSegmento() {
  const q = (col) => all(`SELECT DISTINCT ${col} AS v FROM leads WHERE ${col} IS NOT NULL AND ${col} != '' ORDER BY ${col} LIMIT 500`).map(r => r.v);
  return { zonas: q('zona'), barrios: q('barrio'), ocupaciones: q('ocupacion'), estados_voto: getEstadosVoto() };
}

// ---------- EstadÃ­sticas ----------
function getStats() {
  const porEstado = all(`SELECT estado_voto, COUNT(*) AS n FROM leads GROUP BY estado_voto`);
  const porZona = all(`SELECT zona, COUNT(*) AS n FROM leads WHERE zona IS NOT NULL AND zona != '' GROUP BY zona ORDER BY n DESC`);
  const total = one(`SELECT COUNT(*) AS c FROM leads`) || { c: 0 };
  const totalRef = one(`SELECT COUNT(*) AS c FROM votantes_referidos`) || { c: 0 };
  const estadoMap = {};
  (porEstado || []).forEach(r => { estadoMap[r.estado_voto] = r.n; });
  const estadosVoto = getEstadosVoto().map(e => ({ estado: e.id, label: e.label, color: e.color, count: estadoMap[e.id] || 0 }));
  return { total: total.c, por_estado: estadosVoto, por_zona: porZona || [], total_referidos: totalRef.c };
}

// ---------- Referidos ----------
function getReferidos(votanteId) {
  return all('SELECT * FROM votantes_referidos WHERE votante_id = ? ORDER BY created_at DESC', [Number(votanteId)]);
}
function addReferido(votanteId, data) {
  const res = run('INSERT INTO votantes_referidos (votante_id, ref_nombre, ref_telefono, ref_zona, estado) VALUES (?, ?, ?, ?, ?)',
    [Number(votanteId), data.ref_nombre || '', data.ref_telefono || '', data.ref_zona || '', data.estado || 'registrado']);
  // Si vienen los datos del votante referido (nombre/telefono), se crea como lead con referido_por
  if (data.crear_lead && (data.nombre || data.telefono)) {
    const nuevo = crearVotante({ ...data, referido_por: Number(votanteId) });
    return { referido: getLastInsertId2(res), lead_creado: nuevo && nuevo.id ? nuevo.id : null };
  }
  return { referido: getLastInsertId2(res), lead_creado: null };
}
function getLastInsertId2(res) {
  if (res && res.lastInsertRowid != null) return res.lastInsertRowid;
  try { const row = one('SELECT last_insert_rowid() AS id'); return row ? row.id : null; } catch (e) { return null; }
}
function setReferidoEstado(id, estado) { run('UPDATE votantes_referidos SET estado = ? WHERE id = ?', [estado, Number(id)]); }

// ---------- Equipo (vendedores con rol de campaÃ±a) ----------
function getEquipo() {
  const rows = all(`SELECT id, nombre, telefono, email, rol, estado, foto, total_leads FROM vendedores ORDER BY CASE rol
    WHEN 'gerente' THEN 0 WHEN 'secretario' THEN 1 WHEN 'conductor' THEN 2
    WHEN 'comunicaciones' THEN 3 WHEN 'voluntariado' THEN 4 ELSE 9 END, id`);
  const conVoto = all(`SELECT assigned_to_id, estado_voto, COUNT(*) AS c FROM leads GROUP BY assigned_to_id, estado_voto`);
  const conTotal = all(`SELECT assigned_to_id, COUNT(*) AS c FROM leads GROUP BY assigned_to_id`);
  const tmap = {}, dmap = {};
  conVoto.forEach(r => { dmap[r.assigned_to_id] = dmap[r.assigned_to_id] || {}; dmap[r.assigned_to_id][r.estado_voto] = r.c; });
  conTotal.forEach(r => { tmap[r.assigned_to_id] = r.c; });
  return rows.map(v => {
    const dist = dmap[v.id] || {};
    return { ...v, dist, total_leads: tmap[v.id] || 0, total_relacionados: tmap[v.id] || 0, total_votara: dist['votara'] || 0 };
  });
}

function crearMiembroEquipo(data) {
  const telefono = String(data.telefono || '').replace(/[\s-]/g, '');
  if (!data.nombre || !telefono) throw new Error('nombre_y_telefono_requeridos');
  const vId = adapter.run('INSERT INTO vendedores (nombre, telefono, rol) VALUES (?, ?, ?)', [data.nombre, telefono, data.rol || 'voluntariado']);
  const id = getLastInsertId2(vId);
  if (data.pin) {
    const auth = require('../../services/auth');
    adapter.run('UPDATE vendedores SET pin = ? WHERE id = ?', [auth.hashPassword(String(data.pin)), id]);
  }
  return getMiembroEquipo(id);
}
function getMiembroEquipo(id) {
  const rows = all('SELECT id, nombre, telefono, email, rol, estado, foto FROM vendedores WHERE id = ?', [Number(id)]);
  return rows[0] || null;
}
function setRolEquipo(id, rol) { run('UPDATE vendedores SET rol = ? WHERE id = ?', [rol, Number(id)]); }

module.exports = {
  getEstadosVoto, setEstadosVoto, getInfoCampana, setInfoCampana,
  listVotantes, countVotantes, getVotante, crearVotante, updateVotante, setEstadoVoto,
  getOpcionesSegmento, getStats, getReferidos, addReferido, setReferidoEstado,
  getEquipo, crearMiembroEquipo, getMiembroEquipo, setRolEquipo,
  ESTADOS_VOTO_DEF, ROLES_EQUIPO,
};
