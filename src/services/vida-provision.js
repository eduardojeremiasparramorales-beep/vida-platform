// Vid.a V2 — Aprovisionar un negocio nuevo: fila en el control plane, carpeta de
// medios propia, y su base de datos con el schema completo (store.createSchema(),
// la misma función que usa la empresa #1 — "correr initSchema tal cual sobre BD
// vacía", nada nuevo que mantener en paralelo).
const path = require('path');
const fs = require('fs');
const platform = require('../db/platform');
const adapter = require('../db/adapter');
const store = require('../db/store');
const auth = require('./auth');

function slugify(nombre) {
  return String(nombre || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'negocio-' + Date.now();
}

function getEmpresaDbPath(slug) {
  return path.join(platform.DATA_DIR, 'empresas', `${slug}.db`);
}
function getEmpresaMediaDir(slug) {
  return path.join(platform.DATA_DIR, 'media', slug);
}

// admin: { nombre, telefono, pin, rol } — el primer usuario del tenant nuevo, con la
// misma mecánica de phone+PIN del resto del sistema (nunca email+password para esto).
// vertical: 'crm' (por defecto, retrocompatible) | 'campaña' — decide qué schema extra
// se aplica al aprovisionar. La empresa #1 (SP Leons Group) es 'fundador': su BD vive
// fuera del control plane (adapter.DEFAULT_DB_PATH, data/sp-leads.db) y se siembra vía
// seedEmpresaUno en platform.js — este flow NO se usa para ella, solo para clientes.
async function provisionEmpresa(nombre, adminData, vertical, slugDeseado) {
  let slug = slugDeseado ? slugify(slugDeseado) : slugify(nombre);
  let base = slug, n = 1;
  while (platform.getEmpresaBySlug(slug)) { slug = `${base}-${++n}`; } // slug único para cada tenant

  const dbPath = getEmpresaDbPath(slug);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(getEmpresaMediaDir(slug), { recursive: true });

  const empresa = platform.createEmpresa(nombre, slug, dbPath, vertical);

  // Todo lo que sigue corre DENTRO del contexto de tenant de la empresa nueva — la
  // primera consulta abre el la conexión sola (ver adapter.js), no hace falta "crearla" antes.
  await adapter.tenantContext.run({ empresaId: empresa.id, dbPath }, () => {
    store.createSchema();
    // Vertical campaña: schema extra de votantes / segmentos / estados de voto.
    if ((vertical || '').toLowerCase() === 'campaña') {
      try { require('../verticales/campana').campanaSchema(); } catch (e) { console.error('[PROVISION] campanaSchema:', e.message); }
    }
    const vId = store.addVendedor(adminData.nombre || 'Administrador', adminData.telefono);
    store.setVendedorPin(vId, auth.hashPassword(adminData.pin));
    store.createUsuario(`admin@${slug}.vida`, auth.hashPassword(crypto_randomPassword()), adminData.nombre || 'Administrador', 'admin', vId);
  });

  return empresa;
}

function crypto_randomPassword() {
  return require('crypto').randomBytes(16).toString('hex'); // nunca se usa para iniciar sesión (login es phone+PIN) — solo llena la columna NOT NULL de usuarios
}

module.exports = { provisionEmpresa, slugify, getEmpresaDbPath, getEmpresaMediaDir };
