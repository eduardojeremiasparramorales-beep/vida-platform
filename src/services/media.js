// Almacenamiento de archivos multimedia en disco (data/media/).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MEDIA_DIR = path.join(__dirname, '..', '..', 'data', 'media');

// Vid.a V3 — carpeta de media del tenant activo: empresa #1 usa data/media/ (histórico);
// un negocio cliente usa data/media/{slug}/ (la carpeta que provisionEmpresa crea).
function getMediaDir() {
  try {
    const adapter = require('../db/adapter');
    const ctx = adapter.tenantContext.getStore();
    const empresaId = (ctx && ctx.empresaId != null) ? Number(ctx.empresaId) : adapter.DEFAULT_EMPRESA_ID;
    if (empresaId === adapter.DEFAULT_EMPRESA_ID) return MEDIA_DIR;
    const platform = require('../db/platform');
    const vidaProvision = require('./vida-provision');
    const emp = platform.getEmpresaById(empresaId);
    return emp ? vidaProvision.getEmpresaMediaDir(emp.slug) : MEDIA_DIR;
  } catch (e) {
    return MEDIA_DIR;
  }
}

function ensureDir() {
  const dir = getMediaDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Extensión a partir del mime (fallback .bin)
const MIME_EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/amr': 'amr', 'audio/aac': 'aac',
  'audio/webm': 'webm', 'audio/3gpp': '3gp', 'audio/x-m4a': 'm4a',
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/webm': 'webm',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
};

function extFor(mime, originalFilename) {
  if (originalFilename && originalFilename.includes('.')) return originalFilename.split('.').pop().toLowerCase();
  const base = (mime || '').split(';')[0].trim();
  return MIME_EXT[base] || 'bin';
}

// Guarda el buffer y devuelve el nombre de archivo almacenado
function saveMessageMedia(mediaId, buffer, mime, originalFilename) {
  ensureDir();
  const ext = extFor(mime, originalFilename);
  const filename = `${mediaId}.${ext}`;
  fs.writeFileSync(path.join(getMediaDir(), filename), buffer);
  return filename;
}

// Guarda un buffer ya subido por el vendedor (genera nombre único)
function saveOutgoingMedia(buffer, mime, originalFilename) {
  ensureDir();
  const ext = extFor(mime, originalFilename);
  const filename = `out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  fs.writeFileSync(path.join(getMediaDir(), filename), buffer);
  return filename;
}

// Foto de catálogo (pública y permanente): prefijo cat_ para poder servirla sin
// token sin exponer los medios privados de los chats. Se guarda en data/media/
// (gitignored, sobrevive al git clean -fd del deploy).
function saveCatalogMedia(buffer, mime, originalFilename) {
  ensureDir();
  const ext = extFor(mime, originalFilename);
  const filename = `cat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  fs.writeFileSync(path.join(getMediaDir(), filename), buffer);
  return filename;
}
// ¿Es un archivo de catálogo (público)? Solo estos se sirven sin sesión.
function isCatalogFile(filename) {
  return /^cat_[A-Za-z0-9_.]+$/.test(path.basename(String(filename || '')));
}

function getMediaPath(filename) {
  // Evita path traversal: solo el basename
  const safe = path.basename(String(filename || ''));
  return path.join(getMediaDir(), safe);
}

// --- Token firmado para exponer temporalmente un archivo a canales externos (Meta) ---
// El filename por sí solo no es un secreto suficiente: sin esto, /api/public/media
// serviría cualquier archivo a quien adivine/filtre el nombre. El token expira y está
// atado al filename exacto, así que no sirve para listar ni acceder a otros archivos.
function getSigningSecret() {
  const store = require('../db/store');
  let secret = store.getConfig('media_signing_secret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    store.setConfig('media_signing_secret', secret);
  }
  return secret;
}

function signMediaToken(filename, ttlMs = 24 * 60 * 60 * 1000) {
  const expiresAt = Date.now() + ttlMs;
  const sig = crypto.createHmac('sha256', getSigningSecret()).update(`${filename}.${expiresAt}`).digest('hex');
  return `${expiresAt}.${sig}`;
}

function verifyMediaToken(filename, token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [expiresAtStr, sig] = token.split('.');
  const expiresAt = Number(expiresAtStr);
  if (!expiresAt || !sig || Date.now() > expiresAt) return false;
  const expected = crypto.createHmac('sha256', getSigningSecret()).update(`${filename}.${expiresAt}`).digest('hex');
  const a = Buffer.from(sig, 'hex'), b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { saveMessageMedia, saveOutgoingMedia, saveCatalogMedia, isCatalogFile, getMediaPath, MEDIA_DIR, getMediaDir, signMediaToken, verifyMediaToken };
