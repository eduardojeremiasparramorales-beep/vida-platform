// Cifrado de tokens de canal (Vid.a V2) — AES-256-GCM con VIDA_MASTER_KEY del .env.
// Si alguien copia el archivo .db de un negocio, no se lleva los tokens en claro.
const crypto = require('crypto');

function getMasterKey() {
  const raw = process.env.VIDA_MASTER_KEY;
  if (!raw) throw new Error('VIDA_MASTER_KEY no configurada en .env — generar con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) throw new Error('VIDA_MASTER_KEY debe ser 32 bytes en hex (64 caracteres)');
  return key;
}

// Formato guardado: "iv:authTag:ciphertext", todo hex, en una sola columna TEXT.
function encrypt(plaintext) {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12); // 12 bytes es lo recomendado para GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
}

function decrypt(stored) {
  const key = getMasterKey();
  const parts = String(stored || '').split(':');
  if (parts.length !== 3) throw new Error('formato de token cifrado inválido');
  const [ivHex, authTagHex, dataHex] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

module.exports = { encrypt, decrypt };
