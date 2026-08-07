// Conversión de audio a OGG/Opus con ffmpeg para compatibilidad con WhatsApp Cloud API.
// Los navegadores graban en formatos distintos (Chrome: webm, Safari: mp4) y WhatsApp
// solo acepta notas de voz en audio/ogg; codecs=opus.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let _ffmpegOk = null; // cache: null = no chequeado aún

function isFfmpegAvailable() {
  if (_ffmpegOk !== null) return _ffmpegOk;
  try {
    const r = spawnSync('ffmpeg', ['-version'], { timeout: 5000 });
    _ffmpegOk = r.status === 0;
  } catch (e) {
    _ffmpegOk = false;
  }
  if (!_ffmpegOk) console.warn('[AUDIO] ffmpeg no disponible — solo se aceptarán audios OGG/Opus sin conversión');
  return _ffmpegOk;
}

function isOggOpus(mime) {
  return String(mime || '').split(';')[0].trim().toLowerCase() === 'audio/ogg';
}

// Formatos de audio que la Cloud API de WhatsApp acepta directamente (sin transcodificar).
// webm (lo que graba Chrome) NO está en la lista — ese sí exige conversión.
function isWhatsAppAcceptedAudio(mime) {
  const base = String(mime || '').split(';')[0].trim().toLowerCase();
  return ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/x-m4a', 'audio/m4a'].includes(base);
}

// Convierte cualquier audio soportado por ffmpeg a OGG/Opus (mono, 32kbps, 48kHz),
// el formato de nota de voz nativa de WhatsApp.
// Devuelve { buffer, mime, ext }. Si ya es OGG, pasa sin convertir.
async function convertToOggOpus(buffer, inputMime) {
  if (isOggOpus(inputMime)) {
    return { buffer, mime: 'audio/ogg; codecs=opus', ext: 'ogg' };
  }
  if (!isFfmpegAvailable()) {
    // Sin ffmpeg no se pierde la nota de voz si el formato ya lo acepta WhatsApp
    // (Safari graba mp4/m4a): se envía tal cual, solo sin la conversión a OGG.
    if (isWhatsAppAcceptedAudio(inputMime)) {
      const base = String(inputMime).split(';')[0].trim().toLowerCase();
      const ext = base === 'audio/mpeg' ? 'mp3' : base === 'audio/amr' ? 'amr' : base === 'audio/aac' ? 'aac' : 'm4a';
      console.warn('[AUDIO] ffmpeg no disponible — enviando audio original sin convertir:', base);
      return { buffer, mime: base, ext };
    }
    const err = new Error('ffmpeg_no_disponible: no se puede convertir ' + inputMime + ' a OGG/Opus');
    err.code = 'FFMPEG_MISSING';
    throw err;
  }

  const id = crypto.randomBytes(6).toString('hex');
  const inPath = path.join(os.tmpdir(), `sp-audio-in-${id}`);
  const outPath = path.join(os.tmpdir(), `sp-audio-out-${id}.ogg`);
  try {
    fs.writeFileSync(inPath, buffer);
    await new Promise((resolve, reject) => {
      const args = ['-y', '-i', inPath, '-vn', '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', '-f', 'ogg', outPath];
      const p = spawn('ffmpeg', args);
      let stderr = '';
      p.stderr.on('data', d => { stderr += d; if (stderr.length > 8192) stderr = stderr.slice(-8192); });
      p.on('error', reject);
      p.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error('ffmpeg salió con código ' + code + ': ' + stderr.slice(-500)));
      });
      // timeout de seguridad (60s)
      setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} }, 60000).unref();
    });
    const out = fs.readFileSync(outPath);
    if (!out || out.length === 0) throw new Error('ffmpeg produjo un archivo vacío');
    return { buffer: out, mime: 'audio/ogg; codecs=opus', ext: 'ogg' };
  } finally {
    try { fs.unlinkSync(inPath); } catch (e) {}
    try { fs.unlinkSync(outPath); } catch (e) {}
  }
}

// Formatos de audio que iOS Safari SÍ reproduce sin transcodificar
function isIosFriendly(mime) {
  const base = String(mime || '').split(';')[0].trim().toLowerCase();
  return ['audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/x-m4a', 'audio/m4a'].includes(base);
}

// Devuelve una ruta de audio reproducible en cualquier dispositivo (incl. iPhone).
// OGG/Opus/WebM no se reproducen en iOS → se transcodifican a AAC/m4a una sola vez y se cachean.
// Devuelve { path, mime }. Si ya es compatible, o ffmpeg no está / falla, devuelve el original.
async function getPlayableAudioPath(srcPath, mime) {
  if (isIosFriendly(mime)) {
    console.log('[AUDIO] iOS-friendly, sirviendo original:', srcPath, mime);
    return { path: srcPath, mime: mime };
  }
  if (!isFfmpegAvailable()) {
    console.log('[AUDIO] ffmpeg no disponible, sirviendo original:', srcPath, mime);
    return { path: srcPath, mime: mime };
  }

  const cachePath = srcPath + '.play.m4a';
  try {
    if (fs.existsSync(cachePath)) {
      const [cs, ss] = [fs.statSync(cachePath), fs.statSync(srcPath)];
      if (cs.size > 0 && cs.mtimeMs >= ss.mtimeMs) {
        console.log('[AUDIO] Sirviendo cache m4a:', cachePath);
        return { path: cachePath, mime: 'audio/mp4' };
      }
    }
    console.log('[AUDIO] Transcodificando con ffmpeg:', srcPath, '→', cachePath);
    await new Promise((resolve, reject) => {
      const args = ['-y', '-i', srcPath, '-vn', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', cachePath];
      const p = spawn('ffmpeg', args);
      let stderr = '';
      p.stderr.on('data', d => { stderr += d; if (stderr.length > 8192) stderr = stderr.slice(-8192); });
      p.on('error', reject);
      p.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg salió con código ' + code + ': ' + stderr.slice(-400))));
      setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} }, 60000).unref();
    });
    if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 0) {
      console.log('[AUDIO] Transcodificación exitosa:', cachePath);
      return { path: cachePath, mime: 'audio/mp4' };
    }
  } catch (e) {
    console.error('[AUDIO] Transcodificación a m4a falló, sirviendo original:', e.message);
  }
  return { path: srcPath, mime: mime };
}

// Convierte audio a M4A/AAC — compatible con TODOS los clientes WhatsApp (iOS, Android, Web).
// OGG/Opus tiene problemas conocidos con clientes iPhone; M4A no.
// Devuelve { buffer, mime, ext }.
async function convertToM4A(buffer, inputMime) {
  const base = String(inputMime || '').split(';')[0].trim().toLowerCase();
  if (isIosFriendly(base)) {
    const ext = base === 'audio/mpeg' ? 'mp3' : base === 'audio/aac' ? 'aac' : 'm4a';
    return { buffer, mime: base, ext };
  }
  if (!isFfmpegAvailable()) {
    if (isWhatsAppAcceptedAudio(inputMime)) {
      console.warn('[AUDIO] ffmpeg no disponible — enviando audio original:', base);
      const ext = base === 'audio/mpeg' ? 'mp3' : base === 'audio/amr' ? 'amr' : base === 'audio/aac' ? 'aac' : 'm4a';
      return { buffer, mime: base, ext };
    }
    const err = new Error('ffmpeg_no_disponible: no se puede convertir ' + inputMime + ' a M4A');
    err.code = 'FFMPEG_MISSING';
    throw err;
  }

  const id = crypto.randomBytes(6).toString('hex');
  const inPath = path.join(os.tmpdir(), `sp-audio-in-${id}`);
  const outPath = path.join(os.tmpdir(), `sp-audio-out-${id}.m4a`);
  try {
    fs.writeFileSync(inPath, buffer);
    await new Promise((resolve, reject) => {
      const args = ['-y', '-i', inPath, '-vn', '-c:a', 'aac', '-b:a', '96k', '-ar', '44100', '-ac', '1', '-movflags', '+faststart', outPath];
      const p = spawn('ffmpeg', args);
      let stderr = '';
      p.stderr.on('data', d => { stderr += d; if (stderr.length > 8192) stderr = stderr.slice(-8192); });
      p.on('error', reject);
      p.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error('ffmpeg salió con código ' + code + ': ' + stderr.slice(-500)));
      });
      setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} }, 60000).unref();
    });
    const out = fs.readFileSync(outPath);
    if (!out || out.length === 0) throw new Error('ffmpeg produjo un archivo vacío');
    return { buffer: out, mime: 'audio/mp4', ext: 'm4a' };
  } finally {
    try { fs.unlinkSync(inPath); } catch (e) {}
    try { fs.unlinkSync(outPath); } catch (e) {}
  }
}

module.exports = { convertToOggOpus, convertToM4A, isFfmpegAvailable, getPlayableAudioPath };
