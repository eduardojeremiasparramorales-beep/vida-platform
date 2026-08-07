#!/usr/bin/env node
// ==============================================================
// release-apk.js — Publica el APK release en el canal de auto-actualización.
//
// Uso:  npm run release:apk -- "• Cambio 1\n• Cambio 2" [--obligatoria]
//
// 1. Lee versionCode/versionName de mobile-app/android/app/build.gradle
// 2. Copia el APK release firmado a public/descargas/leons-group.apk
// 3. Escribe public/descargas/version.json (fuente de verdad del updater)
//
// Después: git add public/descargas mobile-app && git commit && git push
// → deploy en la VM → los teléfonos ven la actualización al abrir la app.
// ==============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const GRADLE = path.join(ROOT, 'mobile-app', 'android', 'app', 'build.gradle');
const APK_SRC = path.join(ROOT, 'mobile-app', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const DEST_DIR = path.join(ROOT, 'public', 'descargas');
const APK_DEST = path.join(DEST_DIR, 'leons-group.apk');
const VERSION_JSON = path.join(DEST_DIR, 'version.json');

function fail(msg) { console.error('✗ ' + msg); process.exit(1); }

// --- 1. Versión desde build.gradle (fuente única) ---
if (!fs.existsSync(GRADLE)) fail('No se encontró build.gradle en ' + GRADLE);
const gradle = fs.readFileSync(GRADLE, 'utf8');
const mCode = gradle.match(/versionCode\s+(\d+)/);
const mName = gradle.match(/versionName\s+"([^"]+)"/);
if (!mCode || !mName) fail('No pude leer versionCode/versionName de build.gradle');
const versionCode = Number(mCode[1]);
const versionName = mName[1];

// --- 2. APK release firmado ---
if (!fs.existsSync(APK_SRC)) {
  fail('No existe el APK release: ' + APK_SRC +
    '\n  Compílalo primero:  cd mobile-app && npx cap sync android && cd android && .\\gradlew assembleRelease' +
    '\n  (NUNCA publiques el APK debug: firma distinta = a los teléfonos les tocaría desinstalar)');
}
const apkBuf = fs.readFileSync(APK_SRC);
// Verificación de firma: V1 deja META-INF/*.RSA|.EC|.DSA dentro del zip; la firma
// moderna V2/V3 (la que produce gradle hoy) NO — deja el "APK Signing Block" cuyo
// magic es la cadena literal "APK Sig Block 42" antes del central directory.
const firmadoV1 = apkBuf.includes(Buffer.from('META-INF/')) &&
  (apkBuf.includes(Buffer.from('.RSA')) || apkBuf.includes(Buffer.from('.EC')) || apkBuf.includes(Buffer.from('.DSA')));
const firmadoV2 = apkBuf.includes(Buffer.from('APK Sig Block 42'));
if (!firmadoV1 && !firmadoV2) {
  console.warn('⚠ No detecté firma en el APK (¿falta key.properties?). Si no está firmado con release.keystore, la auto-actualización FALLARÁ en los teléfonos.');
}

// --- 3. Notas y flags ---
const args = process.argv.slice(2);
const obligatoria = args.includes('--obligatoria');
const notas = args.filter(a => a !== '--obligatoria').join(' ').replace(/\\n/g, '\n') ||
  ('Versión ' + versionName);

// --- 4. Copiar + version.json ---
fs.mkdirSync(DEST_DIR, { recursive: true });
fs.copyFileSync(APK_SRC, APK_DEST);
const sha256 = crypto.createHash('sha256').update(apkBuf).digest('hex');
const meta = {
  versionCode,
  versionName,
  apkUrl: '/descargas/leons-group.apk',
  size: apkBuf.length,
  sha256,
  notas,
  obligatoria,
  fecha: new Date().toISOString().slice(0, 10),
};
fs.writeFileSync(VERSION_JSON, JSON.stringify(meta, null, 2) + '\n');

console.log('✓ APK publicado en public/descargas/leons-group.apk (' + (apkBuf.length / 1048576).toFixed(1) + ' MB)');
console.log('✓ version.json → versionCode ' + versionCode + ' · v' + versionName + (obligatoria ? ' · OBLIGATORIA' : ''));
console.log('\nSiguiente paso:');
console.log('  git add public/descargas mobile-app/android/app/build.gradle');
console.log('  git commit -m "release: app v' + versionName + ' (código ' + versionCode + ')" && git push');
console.log('  → deploy en la VM y los teléfonos se actualizan al abrir la app');
