const PROGRESS_MAP = { sin_clasificar: 5, interesado: 30, negociacion: 60, cita: 85, vendido: 100, no_interesado: 5 };

const KEYWORD_RULES = [
  // La regla de negación va PRIMERO: sin esto, "no quiero cuotas" matchea la palabra
  // "cuota" de la regla 'interesado' antes de llegar a la de 'no_interesado', y el lead
  // avanza en el embudo cuando el cliente en realidad está rechazando.
  { keywords: ['no me interesa', 'no gracias', 'gracias pero no', 'ya compré', 'no quiero', 'ya no', 'no vuelvas a escribir', 'no molestar', 'no estoy interesado'], etiqueta: 'no_interesado', minConfidence: 1 },
  { keywords: ['visita', 'agendar', 'cita', 'conocer', 'ir a ver', 'recorrer', 'mostrar', 'ver el lote', 'visitar'], etiqueta: 'cita', minConfidence: 1 },
  { keywords: ['precio', 'cuánto', 'cuesta', 'valor', 'financiación', 'cuota inicial', 'crédito', 'mensualidad', 'cuota', 'cuotas', 'abono', 'separar'], etiqueta: 'interesado', minConfidence: 1 },
  { keywords: ['negociar', 'descuento', 'oferta', 'propuesta', 'mejor precio', 'regatear', 'rebaja'], etiqueta: 'negociacion', minConfidence: 1 },
];

const ORDER = ['sin_clasificar', 'interesado', 'negociacion', 'cita', 'vendido'];

function detectKeywordEtiqueta(body) {
  const t = (body || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some(kw => t.includes(kw))) return rule.etiqueta;
  }
  return null;
}

function calcActivityBonus(lead, flags) {
  let bonus = 0;
  if (lead.first_response_at) bonus += 10;
  if ((lead.messages_count || 0) >= 8) bonus += 10;
  else if ((lead.messages_count || 0) >= 4) bonus += 5;
  if (flags.hasMedia) bonus += 10;
  if (flags.sentLocation) bonus += 15;
  if (flags.wasRead) bonus += 5;
  if (lead.messages_count >= 2 && lead.first_response_at) bonus += 5;
  return Math.min(bonus, 30);
}

function shouldUpgrade(currentEtq, newEtq) {
  // Vendido es un estado final: solo el vendedor lo cambia manualmente, nunca el NLP.
  if (currentEtq === 'vendido') return false;
  // Una cita ya agendada no se cancela automáticamente por una palabra suelta del NLP;
  // cancelar una cita es una decisión que requiere acción explícita del vendedor.
  if (currentEtq === 'cita' && newEtq === 'no_interesado') return false;
  if (newEtq === 'no_interesado') return true;
  if (currentEtq === 'no_interesado' && newEtq !== 'no_interesado') return true;
  const ci = ORDER.indexOf(currentEtq);
  const ni = ORDER.indexOf(newEtq);
  return ni > ci;
}

async function evaluateFromMessage(leadId, messageBody, flags) {
  const store = require('../db/store');
  const lead = store.getLeadById(leadId);
  if (!lead) return;

  const currentEtq = lead.etiqueta || 'sin_clasificar';
  const currentPct = lead.progress_pct || PROGRESS_MAP.sin_clasificar;

  let kwEtq = detectKeywordEtiqueta(messageBody);
  let nlpEtq = null;

  // Try NLP only if no keyword matched or if confidence check needed
  if (!kwEtq) {
    try {
      const nlp = require('./nlp');
      const { intent, confidence } = await nlp.classifyIntent(messageBody);
      if (confidence >= 0.6) {
        const intentMap = { visita: 'cita', precio: 'interesado', ubicacion: 'interesado', queja: 'no_interesado' };
        nlpEtq = intentMap[intent] || null;
      }
    } catch (e) { /* NLP not available */ }
  }

  const targetEtq = kwEtq || nlpEtq || null;

  if (targetEtq && shouldUpgrade(currentEtq, targetEtq)) {
    store.setLeadEtiqueta(leadId, targetEtq);
    return;
  }

  const bonus = calcActivityBonus(lead, flags || {});
  if (bonus > 0) {
    const base = PROGRESS_MAP[currentEtq] || 5;
    const pct = Math.min(base + bonus, 99);
    if (pct > currentPct) store.updateLeadProgress(leadId, pct);
  }
}

// Lead scoring: qué tan prometedor/urgente es un lead, independiente de en qué etapa
// del embudo esté. Se calcula EN VIVO (no se persiste) porque su factor más importante
// —la recencia— cambia con el simple paso del tiempo, no solo con eventos del lead;
// guardarlo en una columna se desactualizaría sin un cron que lo recalculara.
function computeLeadScore(lead) {
  if (!lead) return 0;
  let score = 0;
  // La etapa del embudo ya refleja compromiso comercial (5-100)
  score += PROGRESS_MAP[lead.etiqueta || 'sin_clasificar'] || 5;
  // Volumen de conversación: más ida y vuelta = más interés real
  score += Math.min((lead.messages_count || 0) * 2, 20);
  // Recencia: un lead que escribió hace una hora vale mucho más que uno frío de semanas
  if (lead.last_customer_message_at) {
    const horas = (Date.now() - new Date(String(lead.last_customer_message_at).replace(' ', 'T') + 'Z').getTime()) / 3600000;
    if (horas < 1) score += 15;
    else if (horas < 24) score += 10;
    else if (horas < 72) score += 5;
    else if (horas > 24 * 14) score -= 10;
  }
  // Ya hubo respuesta del vendedor (conversación bidireccional, no solo el cliente hablando solo)
  if (lead.first_response_at) score += 5;
  return Math.max(0, Math.min(100, Math.round(score)));
}

async function evaluateRead(leadId) {
  const store = require('../db/store');
  const lead = store.getLeadById(leadId);
  if (!lead || lead.progress_pct >= 80) return;
  store.updateLeadProgress(leadId, Math.min((lead.progress_pct || 5) + 5, 80));
}

module.exports = { evaluateFromMessage, evaluateRead, computeLeadScore, PROGRESS_MAP, KEYWORD_RULES, ORDER };
