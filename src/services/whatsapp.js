const axios = require('axios');

const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v22.0';
const WINDOW_CLOSED_CODE = 131047;
const TOKEN_INVALID_CODE = 190;

// Vid.a V3 — credenciales del canal SEGÚN el tenant activo:
//   · Empresa #1 (SP Leons Group, legacy): WHATSAPP_TOKEN / PHONE_NUMBER_ID de .env.
//   · Negocios clientes: canal registrado en el control plane (token cifrado con
//     AES-256-GCM, ver db/platform.js + services/crypto-vault.js) — canal_id = phone_number_id.
// Devuelve { token, phoneNumberId, empresaId }.
function getAuth() {
  const adapter = require('../db/adapter');
  const ctx = adapter.tenantContext.getStore();
  const empresaId = (ctx && ctx.empresaId != null) ? Number(ctx.empresaId) : adapter.DEFAULT_EMPRESA_ID;

  if (empresaId === adapter.DEFAULT_EMPRESA_ID) {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.PHONE_NUMBER_ID;
    if (!token || !phoneNumberId) throw new Error('Faltan WHATSAPP_TOKEN o PHONE_NUMBER_ID');
    return { token, phoneNumberId, empresaId };
  }

  const platform = require('../db/platform');
  const vault = require('./crypto-vault');
  const canal = (platform.getCanalesByEmpresa(empresaId) || []).find(c => c.canal === 'whatsapp');
  if (!canal) throw new Error(`Empresa #${empresaId}: canal WhatsApp no conectado en el control plane`);
  const token = vault.decrypt(platform.getCanalToken(canal.canal_id));
  return { token, phoneNumberId: canal.canal_id, empresaId };
}

function getApiConfig() {
  const { token, phoneNumberId, empresaId } = getAuth();
  return {
    url: `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    empresaId,
  };
}

// Con un token expirado/revocado (código 190), TODOS los envíos fallan pero el CRM
// aparenta funcionar (los errores solo quedaban en console.error). Se detecta y se
// alerta al admin, con un debounce para no inundar de notificaciones idénticas.
let lastTokenAlertAt = 0;
function reportGraphError(err) {
  const errData = err.response && err.response.data && err.response.data.error;
  if (errData && errData.code === TOKEN_INVALID_CODE) {
    const now = Date.now();
    if (now - lastTokenAlertAt > 10 * 60 * 1000) {
      lastTokenAlertAt = now;
      const ctxEmpresa = (() => { try { const c = require('../db/adapter').tenantContext.getStore(); return c && c.empresaId != null ? c.empresaId : 1; } catch (e) { return 1; } })();
      console.error(`[WhatsApp] TOKEN INVÁLIDO O EXPIRADO (error 190) — todos los envíos de la empresa #${ctxEmpresa} están fallando. Renueva el token del canal.`);
      try {
        require('./events').emitToAdmins('sistema_alerta', {
          tipo: 'token_expirado',
          empresaId: ctxEmpresa,
          mensaje: `El token de WhatsApp expiró o es inválido (empresa #${ctxEmpresa}). Los mensajes NO se están enviando. Renueva el token del canal.`,
          ts: now,
        });
      } catch (e) { /* events no disponible en este contexto */ }
    }
  }
  return err;
}

async function sendMessage(to, text) {
  const { url, headers } = getApiConfig();
  try {
    const res = await axios.post(url, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: text },
    }, { headers });
    return res.data;
  } catch (err) { throw reportGraphError(err); }
}

// Envío inteligente: si la ventana de 24h está cerrada, envía template automáticamente
async function sendMessageSmart(to, text, leadId) {
  try {
    const result = await sendMessage(to, text);
    try { require('../db/store').bumpUsage('mensajes_enviados'); } catch (e) {}
    return { data: result, templateSent: false, reopenedWindow: false };
  } catch (err) {
    const errData = err.response && err.response.data && err.response.data.error;
    const errCode = errData && (errData.code || errData.error_subcode);
    const isWindowClosed = errCode === WINDOW_CLOSED_CODE ||
      (errData && errData.message && errData.message.includes('free-form'));

    if (!isWindowClosed) throw err;

    // Ventana cerrada: buscar template de reactivación configurado
    let store;
    try { store = require('../db/store'); } catch (e) { throw err; }
    const templateName = store.getConfig('reengagement_template');
    if (!templateName) {
      const e2 = new Error('Ventana de 24h cerrada. Configura un template de reactivación en Configuración.');
      e2.windowClosed = true;
      throw e2;
    }

    console.log(`[WhatsApp] Ventana cerrada para ${to} — enviando template "${templateName}" y encolando el mensaje`);
    const tplResult = await sendTemplate(to, templateName);

    // Un template ENTREGADO no reabre la ventana de 24h — solo lo hace una respuesta del
    // cliente. Reintentar el free-form aquí siempre fallaba con el mismo 131047 y el mensaje
    // original se perdía. En vez de eso, se encola y se envía cuando el webhook detecte
    // la respuesta del cliente (ver flushPendingOutbound en webhook/messages.js).
    store.queuePendingOutbound(leadId || null, to, text);
    return { data: tplResult, templateSent: true, reopenedWindow: false, queued: true };
  }
}

// `params` acepta dos formas:
// - array de strings: retrocompatible, se arma un único componente 'body' posicional.
// - array de componentes ya armados (Graph API shape, ver wa-templates.js buildTemplateComponents):
//   permite header (texto o media) y botones además del body, con variables nombradas.
async function sendTemplate(to, templateName, params, languageCode) {
  const { url, headers } = getApiConfig();
  let components = [];
  if (Array.isArray(params) && params.length && typeof params[0] === 'object' && params[0] !== null && params[0].type) {
    components = params;
  } else if (Array.isArray(params) && params.length) {
    components = [{ type: 'body', parameters: params.map(p => ({ type: 'text', text: String(p) })) }];
  }
  try {
    const res = await axios.post(url, {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: templateName, language: { code: languageCode || 'es' }, components },
    }, { headers });
    return res.data;
  } catch (err) { throw reportGraphError(err); }
}

async function markAsRead(messageId) {
  const { url, headers } = getApiConfig();
  const res = await axios.post(url, {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  }, { headers });
  return res.data;
}

// Marca leído Y muestra "escribiendo…" en el WhatsApp del cliente (dura 25s o hasta responder)
async function sendTyping(messageId) {
  const { url, headers } = getApiConfig();
  const res = await axios.post(url, {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
    typing_indicator: { type: 'text' },
  }, { headers });
  return res.data;
}

// Envía (emoji) o quita (emoji='') una reacción sobre un mensaje del cliente
async function sendReaction(to, wamid, emoji) {
  const { url, headers } = getApiConfig();
  const res = await axios.post(url, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'reaction',
    reaction: { message_id: wamid, emoji: emoji || '' },
  }, { headers });
  return res.data;
}

const GRAPH = `https://graph.facebook.com/${API_VERSION}`;

// Calidad y tier de mensajería del número — determina cuántos destinatarios únicos
// se pueden alcanzar por día en campañas (250 → 1k → 10k... sube con volumen+calidad).
async function getPhoneQuality() {
  const { token, phoneNumberId } = getAuth();
  const res = await axios.get(`${GRAPH}/${phoneNumberId}`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { fields: 'quality_rating,messaging_limit_tier,verified_name,display_phone_number' },
  });
  return res.data;
}

// Devuelve la URL temporal y el mime de un media entrante (por su id)
async function getMediaUrl(mediaId) {
  const { token } = getAuth();
  const res = await axios.get(`${GRAPH}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data; // { url, mime_type, sha256, file_size, id }
}

// Descarga el binario de un media entrante. Devuelve { buffer, mime }
async function downloadMedia(mediaId) {
  const { token } = getAuth();
  const meta = await getMediaUrl(mediaId);
  const res = await axios.get(meta.url, {
    headers: { Authorization: `Bearer ${token}` },
    responseType: 'arraybuffer',
  });
  return { buffer: Buffer.from(res.data), mime: meta.mime_type || 'application/octet-stream' };
}

// Sube un archivo a WhatsApp y devuelve el media id para reenviarlo
async function uploadMedia(buffer, mime, filename) {
  const { token, phoneNumberId } = getAuth();

  // WhatsApp exige el MIME base en 'type' (p. ej. "audio/ogg"), SIN parámetros como "; codecs=opus".
  // Un type mal formado deja el media inaccesible para el cliente en iOS ("Este audio ya no está disponible").
  const baseMime = String(mime || 'application/octet-stream').split(';')[0].trim();

  const FormData = require('form-data');
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', baseMime);
  form.append('file', buffer, { filename: filename || 'archivo', contentType: baseMime });

  try {
    const res = await axios.post(`${GRAPH}/${phoneNumberId}/media`, form, {
      headers: { Authorization: `Bearer ${token}`, ...form.getHeaders() },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    return res.data.id;
  } catch (err) { throw reportGraphError(err); }
}

// Envía un media (por id) al cliente. type: image|audio|video|document|sticker
async function sendMedia(to, mediaId, type, caption, filename) {
  const { url, headers } = getApiConfig();
  const media = { id: mediaId };
  // audio y sticker no admiten caption
  if (caption && type !== 'audio' && type !== 'sticker') media.caption = caption;
  if (type === 'document' && filename) media.filename = filename;
  try {
    const res = await axios.post(url, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type,
      [type]: media,
    }, { headers });
    return res.data;
  } catch (err) { throw reportGraphError(err); }
}

// Envía una ubicación al cliente. latitude/longitude requeridos, name/address opcionales.
async function sendLocation(to, latitude, longitude, name, address) {
  const { url, headers } = getApiConfig();
  const location = { longitude, latitude };
  if (name) location.name = String(name);
  if (address) location.address = String(address);
  try {
    const res = await axios.post(url, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'location',
      location,
    }, { headers });
    return res.data;
  } catch (err) { throw reportGraphError(err); }
}

// WhatsApp Business API no expone edición ni revocación directa.
// editMessage: marca como editado en nuestro DB y opcionalmente envía un nuevo mensaje con la corrección.
async function editMessage(to, wamid, newText) {
  try {
    // Envía un nuevo mensaje indicando que es una corrección
    const msg = `✏️ *Editado:* ${newText}`;
    return await sendMessage(to, msg);
  } catch (e) {
    throw e;
  }
}

// revokeMessage: no podemos borrar de WhatsApp real, pero eliminamos del DB.
async function revokeMessage(to, wamid) {
  try {
    // Opcional: enviar un mensaje indicando eliminación
    // await sendMessage(to, '🚫 Este mensaje fue eliminado');
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { sendMessage, sendMessageSmart, sendTemplate, markAsRead, sendTyping, sendReaction, getMediaUrl, downloadMedia, uploadMedia, sendMedia, sendLocation, editMessage, revokeMessage, getPhoneQuality, getApiConfig, getAuth };
