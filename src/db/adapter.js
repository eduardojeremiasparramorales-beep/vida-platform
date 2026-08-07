const path = require('path');
const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DEFAULT_EMPRESA_ID = 1; // SP Leons Group — el negocio original, el único hasta que exista V2
const DEFAULT_DB_PATH = path.join(DATA_DIR, 'sp-leads.db'); // el archivo de siempre, intacto

// Vid.a V1 — fundación multi-tenant. store.js y todo lo que llama a este módulo NO
// cambia ni una línea: siguen usando all/one/run/exec exactamente igual. Lo único que
// cambia es que esas 4 funciones ahora resuelven la conexión SQLite del "tenant activo"
// en vez de una única variable `db` global.
//
// Modo compatibilidad (V1, hoy): el middleware de index.js mete {empresaId:1, dbPath:
// DEFAULT_DB_PATH} en el contexto de CADA request — es decir, todo sigue resolviendo
// exactamente al mismo archivo de siempre. Nada cambia observablemente. Cuando código
// corre FUERA de un request (scripts, o el momento de arranque antes de que exista
// ningún request) no hay contexto activo → cae también a empresa #1. V2 es quien más
// adelante hará que el middleware resuelva empresas reales en vez de hardcodear 1.
const tenantContext = new AsyncLocalStorage();

// Caché LRU de conexiones abiertas — Map<empresaId, Connection>. Con esto la e2-micro
// aguanta decenas/cientos de negocios pequeños sin tener un archivo .db por request:
// cada conexión better-sqlite3 pesa pocos MB, se abre una vez y se reusa.
const MAX_CONNECTIONS = 80;
const _connections = new Map();

function openConnection(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');
    return { db, usingBetterSqlite3: true, dbPath, lastUsed: Date.now(), saveTimer: null };
  } catch (e) {
    // sql.js es síncrono-de-carga pero initSqlJs() en sí es async — como openConnection
    // debe poder llamarse en caliente (getConnection dentro de all/one/run, todas sync),
    // el fallback dev usa la variante sync de sql.js ya inicializada una vez al arrancar
    // (ver ensureSqlJsReady). Si por algo no está lista, se lanza — mejor un error claro
    // que silenciosamente servir datos de la conexión equivocada.
    if (!_SQL) throw new Error('sql.js no está inicializado — llamar a initDB() antes de abrir conexiones adicionales');
    const db = fs.existsSync(dbPath) ? new _SQL.Database(fs.readFileSync(dbPath)) : new _SQL.Database();
    return { db, usingBetterSqlite3: false, dbPath, lastUsed: Date.now(), saveTimer: null };
  }
}

let _SQL = null; // clase sql.js ya inicializada (solo se usa en el fallback dev)

function evictLRU() {
  let oldestKey = null, oldestTime = Infinity;
  for (const [key, conn] of _connections) {
    if (key === DEFAULT_EMPRESA_ID) continue; // nunca cerrar la conexión principal
    if (conn.lastUsed < oldestTime) { oldestTime = conn.lastUsed; oldestKey = key; }
  }
  if (oldestKey == null) return;
  const conn = _connections.get(oldestKey);
  try { saveConnectionIfNeeded(conn); if (conn.usingBetterSqlite3) conn.db.close(); } catch (e) {}
  _connections.delete(oldestKey);
}

function getConnection(empresaId, dbPath) {
  let conn = _connections.get(empresaId);
  if (!conn) {
    conn = openConnection(dbPath);
    _connections.set(empresaId, conn);
    if (_connections.size > MAX_CONNECTIONS) evictLRU();
  }
  conn.lastUsed = Date.now();
  return conn;
}

// La conexión del tenant activo — con contexto (dentro de un request envuelto por el
// middleware, o dentro de un job de fondo envuelto explícitamente) resuelve ese tenant;
// sin contexto (scripts sueltos, arranque) cae a empresa #1 — igual que hoy siempre.
function currentConnection() {
  const ctx = tenantContext.getStore();
  if (ctx && ctx.empresaId != null) return getConnection(ctx.empresaId, ctx.dbPath || DEFAULT_DB_PATH);
  return getConnection(DEFAULT_EMPRESA_ID, DEFAULT_DB_PATH);
}

// Único punto de entrada async (llamado una vez al arrancar el server, antes de
// cualquier request). Hace el intento COMPLETO con better-sqlite3 —require() Y
// new Database()— porque un require() que carga bien no garantiza que el binario
// nativo funcione: en esta máquina, por ejemplo, require('better-sqlite3') no lanza,
// pero new Database(path) sí (binding nativo incompatible). Un pre-chequeo que solo
// mirara el require() se equivocaría de rama y dejaría _SQL sin inicializar para
// cuando openConnection() lo necesite de verdad.
async function initDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  let conn;
  try {
    const Database = require('better-sqlite3');
    const db = new Database(DEFAULT_DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');
    conn = { db, usingBetterSqlite3: true, dbPath: DEFAULT_DB_PATH, lastUsed: Date.now(), saveTimer: null };
  } catch (e) {
    const initSqlJs = require('sql.js');
    _SQL = await initSqlJs();
    const db = fs.existsSync(DEFAULT_DB_PATH) ? new _SQL.Database(fs.readFileSync(DEFAULT_DB_PATH)) : new _SQL.Database();
    conn = { db, usingBetterSqlite3: false, dbPath: DEFAULT_DB_PATH, lastUsed: Date.now(), saveTimer: null };
  }
  _connections.set(DEFAULT_EMPRESA_ID, conn);
  console.log(conn.usingBetterSqlite3 ? '[DB] Usando better-sqlite3' : '[DB] Usando sql.js (development fallback)');
  return conn.db;
}

function all(sql, params = []) {
  const { db, usingBetterSqlite3 } = currentConnection();
  if (!db) return [];
  if (usingBetterSqlite3) {
    return db.prepare(sql).all(...params);
  } else {
    const stmt = db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }
}

function one(sql, params = []) {
  const conn = currentConnection();
  if (!conn.db) return null;
  if (conn.usingBetterSqlite3) {
    return conn.db.prepare(sql).get(...params) || null;
  } else {
    const rows = all(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }
}

function run(sql, params = []) {
  const conn = currentConnection();
  if (!conn.db) return;
  if (conn.usingBetterSqlite3) {
    conn.db.prepare(sql).run(...params);
  } else {
    conn.db.run(sql, params);
    scheduleSave(conn);
  }
}

function exec(sql) {
  const conn = currentConnection();
  if (!conn.db) return;
  if (conn.usingBetterSqlite3) {
    conn.db.exec(sql);
  } else {
    conn.db.run(sql);
  }
}

function saveConnectionIfNeeded(conn) {
  if (!conn || !conn.db || conn.usingBetterSqlite3) return; // better-sqlite3 persiste solo
  try {
    fs.writeFileSync(conn.dbPath, Buffer.from(conn.db.export()));
  } catch (error) {
    console.error('ERROR CRÍTICO al guardar base de datos:', conn.dbPath, error.message);
  }
}

function saveDBIfNeeded() { saveConnectionIfNeeded(currentConnection()); }

// Auto-save cada 500ms para sql.js — un timer POR conexión (cada negocio en dev guarda
// su propio archivo de forma independiente).
function scheduleSave(conn) {
  conn = conn || currentConnection();
  if (conn.usingBetterSqlite3) return;
  if (conn.saveTimer) clearTimeout(conn.saveTimer);
  conn.saveTimer = setTimeout(() => saveConnectionIfNeeded(conn), 500);
}

module.exports = {
  initDB,
  all,
  one,
  run,
  exec,
  getDB: () => currentConnection().db,
  saveDBIfNeeded,
  scheduleSave,
  isBetterSqlite3: () => currentConnection().usingBetterSqlite3,
  // Vid.a — usado por el middleware (index.js) y por los jobs de fondo (scheduler.js,
  // setInterval sueltos) para envolver su ejecución en el tenant correcto.
  tenantContext,
  DEFAULT_EMPRESA_ID,
  DEFAULT_DB_PATH,
};
