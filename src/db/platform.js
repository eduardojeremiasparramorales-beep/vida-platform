// Vid.a V2 — Control plane: el catálogo de negocios (empresas), sus dominios y sus
// canales conectados. Es una BD SEPARADA de cada negocio (data/vida-plataforma.db) —
// no pasa por el adapter.js multi-tenant de V1 (eso es para las BD *de cada negocio*;
// esta es la única BD "meta" que sabe que existen varios negocios en primer lugar).
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const PLATFORM_DB_PATH = path.join(DATA_DIR, 'vida-plataforma.db');

let db = null;
let usingBetterSqlite3 = false;

async function initPlatformDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    const Database = require('better-sqlite3');
    db = new Database(PLATFORM_DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    usingBetterSqlite3 = true;
  } catch (e) {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    db = fs.existsSync(PLATFORM_DB_PATH) ? new SQL.Database(fs.readFileSync(PLATFORM_DB_PATH)) : new SQL.Database();
    usingBetterSqlite3 = false;
  }
  createPlatformSchema();
  seedEmpresaUno();
  console.log('[PLATAFORMA] BD de control lista:', usingBetterSqlite3 ? 'better-sqlite3' : 'sql.js', '—', PLATFORM_DB_PATH);
}

// CRÍTICO: reserva el id=1 en `empresas` para SP Leons Group explícitamente. Sin esto,
// el primer negocio creado desde el panel recibiría id=1 por autoincrement — el mismo
// DEFAULT_EMPRESA_ID que adapter.js usa para la BD principal (data/sp-leads.db).
// getConnection() busca conexiones por empresaId nada más, sin verificar el dbPath, así
// que ese negocio nuevo terminaría escribiendo sus datos DENTRO de la BD real de Leons
// Group en vez de la suya propia. Sembrar este id=1 aquí hace que AUTOINCREMENT nunca
// vuelva a asignarlo — verificado con un intento real de aprovisionar que sí colisionó
// antes de este fix.
function seedEmpresaUno() {
  if (getEmpresaById(1)) return;
  const adapter = require('./adapter');
  run('INSERT INTO empresas (id, nombre, slug, db_path, plan_status) VALUES (1, ?, ?, ?, ?)',
    ['SP Leons Group', 'sp-leons-group', adapter.DEFAULT_DB_PATH, 'fundador']);
}

function all(sql, params = []) {
  if (!db) return [];
  if (usingBetterSqlite3) return db.prepare(sql).all(...params);
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
function one(sql, params = []) {
  if (!db) return null;
  if (usingBetterSqlite3) return db.prepare(sql).get(...params) || null;
  const rows = all(sql, params);
  return rows.length ? rows[0] : null;
}
let _saveTimer = null;
function scheduleSave() {
  if (usingBetterSqlite3) return;
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try { fs.writeFileSync(PLATFORM_DB_PATH, Buffer.from(db.export())); } catch (e) { console.error('[PLATAFORMA] error guardando:', e.message); }
  }, 500);
}
function run(sql, params = []) {
  if (!db) return;
  if (usingBetterSqlite3) { db.prepare(sql).run(...params); return; }
  db.run(sql, params);
  scheduleSave();
}
function exec(sql) {
  if (!db) return;
  if (usingBetterSqlite3) db.exec(sql);
  else db.run(sql);
}

function createPlatformSchema() {
  exec(`
    CREATE TABLE IF NOT EXISTS empresas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      db_path TEXT NOT NULL,
      plan_status TEXT DEFAULT 'fundador',
      vertical TEXT DEFAULT 'crm',
      activo INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS empresa_dominios (
      hostname TEXT PRIMARY KEY,
      empresa_id INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS empresa_canales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL,
      canal TEXT NOT NULL,
      canal_id TEXT NOT NULL UNIQUE,
      token_cifrado TEXT NOT NULL,
      extra_json TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS platform_admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      nombre TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS platform_sessions (
      token TEXT PRIMARY KEY,
      admin_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  // Migración segura de columnas nuevas (el CREATE TABLE IF NOT EXISTS no altera nada).
  const cols = all('PRAGMA table_info(empresas)').map(r => r.name);
  if (!cols.includes('vertical')) exec("ALTER TABLE empresas ADD COLUMN vertical TEXT DEFAULT 'crm'");
}

// ---- empresas ----
function getEmpresas() { return all('SELECT * FROM empresas ORDER BY created_at DESC'); }
function getEmpresaById(id) { return one('SELECT * FROM empresas WHERE id = ?', [Number(id)]); }
function getEmpresaBySlug(slug) { return one('SELECT * FROM empresas WHERE slug = ?', [slug]); }
function createEmpresa(nombre, slug, dbPath, vertical) {
  run('INSERT INTO empresas (nombre, slug, db_path, vertical) VALUES (?, ?, ?, ?)', [nombre, slug, dbPath, (vertical || 'crm').toLowerCase()]);
  return getEmpresaBySlug(slug);
}
function setEmpresaActivo(id, activo) { run('UPDATE empresas SET activo = ? WHERE id = ?', [activo ? 1 : 0, Number(id)]); }
function setEmpresaPlanStatus(id, planStatus) { run('UPDATE empresas SET plan_status = ? WHERE id = ?', [planStatus, Number(id)]); }

// ---- dominios ----
function getEmpresaByHostname(hostname) {
  const row = one('SELECT empresa_id FROM empresa_dominios WHERE hostname = ?', [hostname]);
  return row ? getEmpresaById(row.empresa_id) : null;
}
function addEmpresaDominio(hostname, empresaId) { run('INSERT OR REPLACE INTO empresa_dominios (hostname, empresa_id) VALUES (?, ?)', [hostname, Number(empresaId)]); }

// ---- canales (tokens siempre cifrados antes de guardar, ver services/crypto-vault) ----
function getCanalesByEmpresa(empresaId) { return all('SELECT id, empresa_id, canal, canal_id, extra_json, created_at FROM empresa_canales WHERE empresa_id = ?', [Number(empresaId)]); }
function getEmpresaByCanalId(canalId) {
  const row = one('SELECT empresa_id FROM empresa_canales WHERE canal_id = ?', [canalId]);
  return row ? getEmpresaById(row.empresa_id) : null;
}
function addEmpresaCanal(empresaId, canal, canalId, tokenCifrado, extra) {
  run('INSERT OR REPLACE INTO empresa_canales (empresa_id, canal, canal_id, token_cifrado, extra_json) VALUES (?, ?, ?, ?, ?)',
    [Number(empresaId), canal, canalId, tokenCifrado, JSON.stringify(extra || {})]);
}
function getCanalToken(canalId) {
  const row = one('SELECT token_cifrado FROM empresa_canales WHERE canal_id = ?', [canalId]);
  return row ? row.token_cifrado : null;
}

// ---- platform_admins + sesiones propias (separadas de las de cada negocio) ----
function countPlatformAdmins() { return (one('SELECT COUNT(*) as c FROM platform_admins') || {}).c || 0; }
function createPlatformAdmin(email, passwordHash, nombre) { run('INSERT INTO platform_admins (email, password, nombre) VALUES (?, ?, ?)', [email.toLowerCase(), passwordHash, nombre || '']); }
function getPlatformAdminByEmail(email) { return one('SELECT * FROM platform_admins WHERE email = ?', [String(email).toLowerCase()]); }
function createPlatformSession(token, adminId) { run('INSERT INTO platform_sessions (token, admin_id, created_at) VALUES (?, ?, ?)', [token, adminId, Date.now()]); }
function getPlatformSession(token) { return one('SELECT * FROM platform_sessions WHERE token = ?', [token]); }
function deletePlatformSession(token) { run('DELETE FROM platform_sessions WHERE token = ?', [token]); }

module.exports = {
  initPlatformDB,
  getEmpresas, getEmpresaById, getEmpresaBySlug, createEmpresa, setEmpresaActivo, setEmpresaPlanStatus,
  getEmpresaByHostname, addEmpresaDominio,
  getCanalesByEmpresa, getEmpresaByCanalId, addEmpresaCanal, getCanalToken,
  countPlatformAdmins, createPlatformAdmin, getPlatformAdminByEmail,
  createPlatformSession, getPlatformSession, deletePlatformSession,
  DATA_DIR, PLATFORM_DB_PATH,
};
