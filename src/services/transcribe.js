// Transcripción IA de notas de voz entrantes (Whisper vía Groq u OpenAI).
// Cola EN SERIE (la VM e2-micro tiene 700MB): un audio a la vez, timeout 60s,
// 1 reintento. Si no hay proveedor compatible configurado, es un no-op.
const fs = require('fs');
const path = require('path');
const store = require('../db/store');
const events = require('./events');

const MEDIA_DIR = path.join(__dirname, '..', '..', 'data', 'media');
const TIMEOUT_MS = 60000;

const _cola = [];
let _procesando = false;

// Proveedor: config transcribe_provider (id) o el primero con baseUrl groq/openai
function getProveedor() {
  try {
    const nlp = require('./nlp');
    if (!nlp.isAIEnabled()) return null;
    const providers = nlp.getProviders().filter(p => p.apiKey);
    const prefId = store.getConfig('transcribe_provider');
    let prov = prefId ? providers.find(p => p.id === prefId) : null;
    if (!prov) prov = providers.find(p => /api\.groq\.com|api\.openai\.com/.test(p.baseUrl || ''));
    if (!prov) return null;
    const esGroq = /api\.groq\.com/.test(prov.baseUrl || '');
    const model = store.getConfig('transcribe_model') || (esGroq ? 'whisper-large-v3' : 'whisper-1');
    return { baseUrl: prov.baseUrl, apiKey: prov.apiKey, model };
  } catch (e) {
    return null;
  }
}

// Encolar transcripción de un audio entrante (fire-and-forget desde el webhook)
function enqueue(job) {
  if (!getProveedor()) return; // sin proveedor → no acumular trabajo inútil
  _cola.push({ ...job, intentos: 0 });
  procesar();
}

async function procesar() {
  if (_procesando) return;
  _procesando = true;
  while (_cola.length) {
    const job = _cola.shift();
    try {
      await transcribirUno(job);
    } catch (e) {
      if (job.intentos < 1) {
        job.intentos++;
        setTimeout(() => { _cola.push(job); procesar(); }, 30000);
      } else {
        console.error('[TRANSCRIBE] Falló definitivamente', job.wamid, e.message);
      }
    }
  }
  _procesando = false;
}

async function transcribirUno(job) {
  const prov = getProveedor();
  if (!prov) return;
  const msg = store.getMessageByWamid(job.wamid);
  if (!msg || msg.transcript) return;

  let filePath = path.join(MEDIA_DIR, String(job.filename || msg.media_filename || ''));
  if (!fs.existsSync(filePath)) return;

  let texto;
  try {
    texto = await llamarWhisper(prov, filePath, job.mime || msg.media_mime);
  } catch (e) {
    // Algunos providers rechazan ciertos contenedores → reintentar con el m4a cacheado
    try {
      const { getPlayableAudioPath } = require('./audio');
      const p = await getPlayableAudioPath(filePath, job.mime || msg.media_mime);
      if (p.path !== filePath) {
        texto = await llamarWhisper(prov, p.path, p.mime);
      } else {
        throw e;
      }
    } catch (e2) {
      throw e2;
    }
  }

  texto = String(texto || '').trim();
  if (!texto) return;
  store.setTranscript(msg.id, texto);
  const lead = store.getLeadById(msg.lead_id);
  if (lead) {
    const payload = { leadId: lead.id, messageId: msg.id, transcript: texto, ts: Date.now() };
    events.emitToVendedor(lead.assigned_to_id, 'transcripcion', payload);
    events.emitToAdmins('transcripcion', payload);
  }
  console.log(`[TRANSCRIBE] Nota de voz ${msg.id} transcrita (${texto.length} chars)`);
}

async function llamarWhisper(prov, filePath, mime) {
  const OpenAI = require('openai');
  const client = new OpenAI({ baseURL: prov.baseUrl, apiKey: prov.apiKey, timeout: TIMEOUT_MS, maxRetries: 0 });
  const r = await client.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: prov.model,
    language: 'es',
  });
  return r && r.text;
}

module.exports = { enqueue, isEnabled: () => !!getProveedor() };
