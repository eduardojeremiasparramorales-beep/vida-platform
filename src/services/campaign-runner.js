// Motor de envío de campañas masivas: procesa destinatarios uno a uno respetando un
// rate limit configurable y el tier diario de mensajería de Meta (compartido entre
// todas las campañas del negocio), con reintentos ante errores transitorios (429/500)
// y trazabilidad completa por destinatario para conciliar con los statuses del webhook.

const store = require('../db/store');

const DEFAULT_MPS = 5; // mensajes por segundo — conservador por defecto, configurable
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;

// Evita que dos ejecuciones concurrentes de la misma campaña se pisen (p. ej. doble
// clic en "Iniciar" o un reinicio del proceso mientras ya estaba corriendo).
const runningCampaigns = new Set();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getMps() {
  const cfg = Number(store.getConfig('campaign_mps'));
  return cfg > 0 ? cfg : DEFAULT_MPS;
}

function getDailyLimit() {
  const cfg = Number(store.getConfig('campaign_daily_limit'));
  // 250 = el tier inicial de Meta; el admin lo sube en Configuración a medida que
  // WhatsApp aumenta el límite del número por volumen + calidad + verificación.
  return cfg > 0 ? cfg : 250;
}

// Cuenta destinatarios únicos alcanzados HOY por cualquier campaña — el tier diario
// de Meta es compartido por todo el número, no por campaña individual.
function sentToday() {
  const adapter = require('../db/adapter');
  const r = adapter.one(`SELECT COUNT(DISTINCT phone) as c FROM campaign_recipients
    WHERE estado IN ('sent','delivered','read','failed') AND date(sent_at) = date('now')`);
  return (r && r.c) || 0;
}

async function sendOneWithRetry(to, tpl, lead, vendedor, overrides) {
  const { sendResolvedTemplate } = require('./wa-templates');
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const r = await sendResolvedTemplate(to, tpl, lead, vendedor, overrides);
      try { store.bumpUsage('campanas_enviadas'); } catch (e) {}
      return r;
    } catch (err) {
      lastErr = err;
      const status = err.response && err.response.status;
      const retryable = status === 429 || (status >= 500 && status < 600);
      if (!retryable || attempt === MAX_RETRIES) throw err;
      await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt)); // backoff exponencial
    }
  }
  throw lastErr;
}

// Procesa la cola de una campaña. Se lanza en segundo plano (no se espera desde el
// endpoint HTTP) — puede tardar minutos/horas según el tamaño y el rate limit.
async function runCampaign(campaignId) {
  if (runningCampaigns.has(campaignId)) return;
  runningCampaigns.add(campaignId);
  try {
    const campaign = store.getCampaignById(campaignId);
    if (!campaign) return;
    const tpl = store.getWATemplateById(campaign.template_id);
    if (!tpl) { store.updateCampaignEstado(campaignId, 'failed'); return; }

    let baseOverrides = {};
    try { baseOverrides = JSON.parse(campaign.overrides || '{}'); } catch (e) {}

    store.updateCampaignEstado(campaignId, 'running');
    const mps = getMps();
    const dailyLimit = getDailyLimit();

    const pendientes = store.getCampaignRecipients(campaignId, 'queued');
    for (const rec of pendientes) {
      // Se relee el estado en cada vuelta: si el admin pausó la campaña desde el
      // panel mientras corría, se detiene ANTES del siguiente envío, no después.
      const fresh = store.getCampaignById(campaignId);
      if (!fresh || fresh.estado !== 'running') break;

      if (store.isOptedOut(rec.phone)) {
        store.updateCampaignRecipient(rec.id, { estado: 'failed', errorDetail: 'opt_out' });
        continue;
      }
      if (sentToday() >= dailyLimit) {
        console.log(`[Campaign ${campaignId}] Límite diario de mensajería alcanzado (${dailyLimit}) — pausando campaña, continúa mañana.`);
        store.updateCampaignEstado(campaignId, 'paused');
        break;
      }

      const lead = rec.lead_id ? store.getLeadById(rec.lead_id) : null;
      const vendedor = lead && lead.assigned_to_id ? store.getVendedorById(lead.assigned_to_id) : null;
      let recipientVars = {};
      try { recipientVars = JSON.parse(rec.variables || '{}'); } catch (e) {}
      const overrides = { ...baseOverrides, ...recipientVars };

      try {
        const result = await sendOneWithRetry(rec.phone, tpl, lead, vendedor, overrides);
        const wamid = result && result.messages && result.messages[0] && result.messages[0].id;
        store.updateCampaignRecipient(rec.id, { estado: 'sent', wamid: wamid || null });
        // Se guarda con el mismo wamid que en campaign_recipients: así el status que
        // llegue por webhook (delivered/read/failed) actualiza AMBOS lugares —la
        // conversación del lead en el CRM y el dashboard de la campaña— con un solo evento.
        if (lead) store.saveMessage(lead.id, 'sistema', rec.phone, `[Campaña: ${tpl.nombre}]`, 'outgoing', null, null, wamid || null, 'sent');
      } catch (err) {
        store.updateCampaignRecipient(rec.id, { estado: 'failed', errorDetail: err.message });
      }
      store.recalcCampaignStats(campaignId);
      await sleep(1000 / mps);
    }

    const finalState = store.getCampaignById(campaignId);
    if (finalState && finalState.estado === 'running') {
      const remaining = store.getCampaignRecipients(campaignId, 'queued');
      store.updateCampaignEstado(campaignId, remaining.length ? 'paused' : 'done');
    }
    store.recalcCampaignStats(campaignId);
  } catch (e) {
    console.error(`[Campaign ${campaignId}] Error inesperado:`, e.message);
    store.updateCampaignEstado(campaignId, 'paused');
  } finally {
    runningCampaigns.delete(campaignId);
  }
}

function isCampaignRunning(campaignId) { return runningCampaigns.has(campaignId); }

module.exports = { runCampaign, isCampaignRunning, sentToday, getDailyLimit, getMps };
