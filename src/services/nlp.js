const store = require('../db/store');
const CFG = require('../config');

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'google/gemini-2.0-flash-001';

// Modelos válidos por proveedor — usado para detectar y corregir IDs de provider
// que se guardaron como "modelo" (ej: "deepseek" en vez de "deepseek/deepseek-chat").
const DEFAULT_MODELS = {
  openrouter: 'google/gemini-2.0-flash-001',
  openai: 'gpt-4o-mini',
  deepseek: 'deepseek/deepseek-chat',
  groq: 'meta-llama/llama-3.1-8b-instant',
};

const cache = new Map();

function getFromCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key, value) {
  // Tope de 500 entradas con evicción FIFO — evita crecimiento sin límite en RAM
  if (cache.size >= 500 && !cache.has(key)) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { value, expiresAt: Date.now() + CFG.NLP_CACHE_TTL });
}

function getConfig(key, fallback = '') {
  return store.getConfig(key) || process.env[`OPENROUTER_${key}`] || process.env[`OPENAI_${key}`] || fallback;
}

function getApiKey() {
  return store.getConfig('openrouter_api_key') || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '';
}

function getModel() {
  const raw = store.getConfig('openrouter_model') || process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  // Si el modelo guardado parece ser solo un ID de provider (sin "/"), resolverlo
  if (raw && !raw.includes('/') && DEFAULT_MODELS[raw]) return DEFAULT_MODELS[raw];
  return raw;
}

function getSiteUrl() {
  return store.getConfig('openrouter_site_url') || process.env.OPENROUTER_SITE_URL || 'https://spcrm.duckdns.org';
}

function getAppName() {
  return store.getConfig('openrouter_app_name') || process.env.OPENROUTER_APP_NAME || 'Leons Group';
}

// ─────────────────────────────────────────────────────────────────────────
// Proveedores de IA: multi-proveedor, cada uno con su base URL + su API key.
// Se guardan como JSON en config('ai_providers'). Todos deben ser compatibles
// con la API de OpenAI (OpenRouter, OpenAI, DeepSeek, Groq, Together, etc.).
// ─────────────────────────────────────────────────────────────────────────

// Presets rápidos para que el admin solo pegue su API key.
const PRESET_PROVIDERS = {
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  groq: { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
};

function getProviders() {
  let list = [];
  try { list = JSON.parse(store.getConfig('ai_providers') || '[]'); } catch (e) { list = []; }
  if (!Array.isArray(list)) list = [];
  // Compatibilidad: si no hay proveedores configurados, sintetizar uno de
  // OpenRouter a partir de la config antigua (openrouter_api_key).
  if (list.length === 0) {
    list = [{
      id: 'openrouter',
      name: 'OpenRouter',
      baseUrl: OPENROUTER_BASE,
      apiKey: getApiKey(),
      models: [],
    }];
  }
  return list;
}

function getDefaultProviderId() {
  const saved = store.getConfig('ai_default_provider');
  const list = getProviders();
  if (saved && list.some(p => p.id === saved)) return saved;
  return list[0] ? list[0].id : 'openrouter';
}

function getProviderById(id) {
  const list = getProviders();
  return list.find(p => p.id === id) || list.find(p => p.id === getDefaultProviderId()) || list[0] || null;
}

function saveProviders(list, defaultId) {
  const clean = Array.isArray(list) ? list : [];
  store.setConfig('ai_providers', JSON.stringify(clean));
  if (defaultId) store.setConfig('ai_default_provider', String(defaultId));
  // Mantener sincronizada la config antigua con el proveedor por defecto
  // para que las funciones internas del Copiloto (analizar lead, etc.) sigan funcionando.
  const def = clean.find(p => p.id === (defaultId || getDefaultProviderId())) || clean[0];
  if (def) {
    store.setConfig('openrouter_api_key', def.apiKey || '');
    if (def.models && def.models.length) {
      store.setConfig('openrouter_model', def.models[0]);
    }
    // Si el modelo guardado parece ser solo un ID de provider, resolverlo
    const saved = store.getConfig('openrouter_model');
    if (saved && !saved.includes('/') && DEFAULT_MODELS[saved]) {
      store.setConfig('openrouter_model', DEFAULT_MODELS[saved]);
    }
  }
}

function isAIEnabled() {
  const enabled = store.getConfig('ai_enabled');
  if (enabled === 'false' || enabled === '0') return false;
  return getProviders().some(p => p.apiKey);
}

function buildClient(baseUrl, apiKey) {
  if (!apiKey) throw new Error('No hay API key configurada para este proveedor. Ve al panel de Chat IA → Proveedores.');
  const OpenAI = require('openai');
  return new OpenAI({
    baseURL: baseUrl || OPENROUTER_BASE,
    apiKey,
    // maxRetries: 0 → NO esperar el Retry-After (~16s) de un 429; nuestro respaldo
    // salta de inmediato a otro modelo gratis, mucho más rápido para el chat.
    maxRetries: 0,
    defaultHeaders: {
      'HTTP-Referer': getSiteUrl(),
      'X-Title': getAppName(),
    },
  });
}

// Cliente del proveedor por defecto (usado por las funciones internas del Copiloto).
function getClient() {
  const p = getProviderById(getDefaultProviderId());
  return buildClient(p && p.baseUrl, (p && p.apiKey) || getApiKey());
}

// Cliente + modelo resueltos para un proveedor/modelo específico (chat interactivo).
function resolveClientAndModel(opts = {}) {
  const provider = opts.providerId ? getProviderById(opts.providerId) : getProviderById(getDefaultProviderId());
  const client = buildClient(provider && provider.baseUrl, (provider && provider.apiKey) || getApiKey());
  const model = opts.model || (provider && provider.models && provider.models[0]) || getModel();
  return { client, model };
}

// Lista los modelos de un proveedor con su bandera de "gratis".
// Devuelve [{ id, free }]. Usa el endpoint /models (compatible OpenAI) que en
// OpenRouter incluye pricing; free = prompt y completion en "0".
async function fetchModels(providerId) {
  const p = getProviderById(providerId);
  if (!p || !p.apiKey) return [];
  try {
    const base = String(p.baseUrl || OPENROUTER_BASE).replace(/\/$/, '');
    const r = await fetch(base + '/models', {
      headers: { Authorization: 'Bearer ' + p.apiKey, 'HTTP-Referer': getSiteUrl(), 'X-Title': getAppName() },
    });
    if (!r.ok) return [];
    const j = await r.json();
    const data = j.data || [];
    return data.map(m => ({
      id: m.id,
      free: !!(m.pricing && String(m.pricing.prompt) === '0' && String(m.pricing.completion) === '0'),
    })).filter(m => m.id).sort((a, b) => a.id.localeCompare(b.id));
  } catch (e) {
    console.error('[NLP] fetchModels error:', e.message);
    return [];
  }
}

// Cache de modelos gratis de OpenRouter (para el respaldo automático).
let _freeCache = { at: 0, ids: [] };
async function getFreeModels(providerId) {
  if (_freeCache.ids.length && Date.now() - _freeCache.at < CFG.NLP_CACHE_TTL) return _freeCache.ids;
  const list = await fetchModels(providerId);
  _freeCache = { at: Date.now(), ids: list.filter(m => m.free).map(m => m.id) };
  return _freeCache.ids;
}

// ¿El error del modelo es recuperable probando con otro modelo gratis?
function isRetriableModelError(e) {
  const status = e && (e.status || e.statusCode || (e.response && e.response.status));
  const msg = String((e && e.message) || '').toLowerCase();
  return status === 429 || status === 404 ||
    msg.includes('rate-limit') || msg.includes('rate limit') || msg.includes('temporarily') ||
    msg.includes('unavailable for free') || msg.includes('no endpoints');
}

async function chatJSON(systemPrompt, userText, timeoutMs) {
  const client = getClient();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || CFG.NLP_TIMEOUT_DEFAULT);
  try {
    const completion = await client.chat.completions.create({
      model: getModel(),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
      response_format: { type: 'json_object' },
    }, { signal: controller.signal });
    clearTimeout(timer);
    const content = completion.choices[0].message.content;
    if (!content) throw new Error('Respuesta vacía del modelo');
    try { store.bumpUsage('generaciones_ia'); } catch (e) {}
    return JSON.parse(content);
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// Chat interactivo con respaldo automático: si es OpenRouter y el modelo elegido
// está saturado (429) o descontinuado (404), reintenta con otros modelos GRATIS
// vigentes hasta obtener respuesta. Devuelve { text, model } (el modelo que respondió).
async function chatText(systemPrompt, userText, timeoutMs, opts = {}) {
  const provider = opts.providerId ? getProviderById(opts.providerId) : getProviderById(getDefaultProviderId());
  const client = buildClient(provider && provider.baseUrl, (provider && provider.apiKey) || getApiKey());
  const isOpenRouter = provider && String(provider.baseUrl || '').includes('openrouter.ai');
  let primary = opts.model || (provider && provider.models && provider.models[0]) || getModel();
  // Corregir IDs de provider que se guardaron como modelo (ej: "deepseek" → "deepseek/deepseek-chat")
  if (primary && !primary.includes('/') && DEFAULT_MODELS[primary]) {
    primary = DEFAULT_MODELS[primary];
  }

  // Lista de intentos: el modelo pedido + (si es OpenRouter) modelos gratis de respaldo.
  const candidates = [primary];
  if (isOpenRouter && opts.fallback !== false) {
    try {
      const free = await getFreeModels(provider.id);
      for (const m of free) if (!candidates.includes(m)) candidates.push(m);
    } catch (e) { /* seguimos con el primario */ }
  }

  let lastErr;
  for (const model of candidates.slice(0, 6)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || CFG.NLP_TIMEOUT_DEFAULT);
    try {
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText },
        ],
      }, { signal: controller.signal });
      clearTimeout(timer);
      const text = (completion.choices[0] && completion.choices[0].message.content) || '';
      try { store.bumpUsage('generaciones_ia'); } catch (e) {}
      return { text, model };
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      // Solo probamos otro modelo si el error es de saturación/modelo no disponible.
      if (!isRetriableModelError(e)) break;
    }
  }
  throw lastErr || new Error('No se pudo obtener respuesta del modelo');
}

async function analyzeSentiment(text) {
  const cacheKey = `sentiment:${text}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  try {
    const result = await chatJSON(
      "Analiza el sentimiento de este mensaje de un cliente inmobiliario. Responde SOLO con JSON: { score: -1..1, label: 'positivo'|'neutral'|'negativo', keywords: [] }",
      text, 10000
    );
    setCache(cacheKey, result);
    return result;
  } catch (e) {
    console.error('analyzeSentiment error:', e.message);
    return { score: 0, label: 'neutral', keywords: [] };
  }
}

async function classifyIntent(text) {
  const cacheKey = `intent:${text}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  try {
    const result = await chatJSON(
      'Clasifica la intención de este mensaje inmobiliario. Opciones: precio, ubicacion, visita, queja, info_general. Responde JSON: { intent, confidence: 0-1 }',
      text, 8000
    );
    setCache(cacheKey, result);
    return result;
  } catch (e) {
    console.error('classifyIntent error:', e.message);
    return { intent: 'info_general', confidence: 0 };
  }
}

async function suggestResponse(conversationHistory, customerName) {
  try {
    const historyText = (conversationHistory || []).slice(-6).map(m => `${m.role === 'customer' ? 'Cliente' : 'Vendedor'}: ${m.text}`).join('\n');
    const result = await chatJSON(
      'Eres asesor inmobiliario de Leons Group, una firma colombiana de lotes de inversión. Genera 3 respuestas profesionales y persuasivas para responder al cliente. Cada respuesta debe ser natural, no sonar a robot. Responde SOLO JSON: { suggestions: [string, string, string] }',
      `Cliente: ${customerName || 'Cliente'}\n\nHistorial:\n${historyText || 'Sin historial previo. Es el primer mensaje.'}`,
      15000
    );
    return result.suggestions || [];
  } catch (e) {
    console.error('suggestResponse error:', e.message);
    return [];
  }
}

async function analyzeLead(conversationHistory, customerName, leadStage) {
  try {
    const historyText = (conversationHistory || []).slice(-10).map(m => `${m.role === 'customer' ? 'Cliente' : 'Vendedor'}: ${m.text}`).join('\n');
    const result = await chatJSON(
      `Eres un analista inmobiliario experto. Analiza este lead de Leons Group (venta de lotes en Colombia).
      Responde SOLO JSON con esta estructura exacta:
      {
        "summary": "resumen de 1-2 líneas del lead",
        "sentiment": "positivo|neutral|negativo",
        "sentimentScore": número entre -1 y 1,
        "intent": "precio|ubicacion|visita|queja|info_general",
        "objections": ["objeción 1", "objeción 2"],
        "closeProbability": número entre 0 y 100,
        "nextAction": "recomendación de siguiente acción",
        "suggestedResponse": "respuesta sugerida para el vendedor"
      }`,
      `Cliente: ${customerName || 'Cliente'}\nEtapa actual: ${leadStage || 'nuevo'}\n\nHistorial:\n${historyText || 'Sin historial todavía'}`,
      20000
    );
    return result;
  } catch (e) {
    console.error('analyzeLead error:', e.message);
    return {
      summary: 'No se pudo analizar el lead',
      sentiment: 'neutral',
      sentimentScore: 0,
      intent: 'info_general',
      objections: [],
      closeProbability: 50,
      nextAction: 'Contactar al cliente',
      suggestedResponse: ''
    };
  }
}

// Resume una conversación para que el asesor se ponga al día rápido ("Ponme al día").
async function summarizeConversation(conversationHistory, customerName) {
  try {
    const historyText = (conversationHistory || []).slice(-25).map(m => `${m.role === 'customer' ? 'Cliente' : 'Vendedor'}: ${m.text}`).join('\n');
    if (!historyText) return { resumen: 'Aún no hay mensajes en esta conversación.', pendiente: '', puntos: [] };
    const result = await chatJSON(
      `Eres asistente de un asesor inmobiliario de Leons Group. Resume esta conversación con un cliente de forma breve y útil para retomarla.
      Responde SOLO JSON:
      {
        "resumen": "2-3 líneas de qué ha pasado y qué quiere el cliente",
        "puntos": ["dato clave 1", "dato clave 2"],
        "pendiente": "qué debe hacer el asesor ahora"
      }`,
      `Cliente: ${customerName || 'Cliente'}\n\nConversación:\n${historyText}`,
      15000
    );
    return result;
  } catch (e) {
    console.error('summarizeConversation error:', e.message);
    return { resumen: 'No se pudo generar el resumen.', pendiente: '', puntos: [] };
  }
}

async function extractEntities(text) {
  const cacheKey = `entities:${text}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  try {
    const result = await chatJSON(
      'Extrae entidades de este mensaje inmobiliario. Responde JSON: { locations: [], prices: [], propertyTypes: [] }',
      text, 8000
    );
    setCache(cacheKey, result);
    return result;
  } catch (e) {
    console.error('extractEntities error:', e.message);
    return { locations: [], prices: [], propertyTypes: [] };
  }
}

async function shouldAutoRespond(text) {
  try {
    const { intent, confidence } = await classifyIntent(text);
    const contieneQueja = /queja|reclamo|molesto|problema|malo/i.test(text);
    if (intent === 'info_general' && confidence > 0.9 && !contieneQueja) return true;
    return false;
  } catch (e) {
    return false;
  }
}

async function dailyBriefing(vendedor, stats) {
  try {
    const result = await chatJSON(
      `Eres un coach de ventas inmobiliarias. Genera un briefing diario para un vendedor.
      Responde SOLO JSON:
      {
        "tip": "consejo de venta personalizado de 1 línea",
        "priorityAction": "qué debería hacer ahora mismo",
        "fraseDelDia": "frase motivacional corta"
      }`,
      `Vendedor: ${vendedor.nombre || 'Vendedor'}\nLeads activos: ${stats.activos || 0}\nSin responder: ${stats.sinResponder || 0}\nVentas: ${stats.ventas || 0}`,
      12000
    );
    return result;
  } catch (e) {
    return {
      tip: 'Prioriza los leads sin responder — la velocidad de respuesta define la venta.',
      priorityAction: 'Revisa tus leads pendientes',
      fraseDelDia: 'El éxito es la suma de pequeños esfuerzos repetidos día tras día.'
    };
  }
}

module.exports = {
  analyzeSentiment, classifyIntent, suggestResponse, extractEntities, shouldAutoRespond,
  analyzeLead, summarizeConversation, dailyBriefing, chatText, chatJSON, isAIEnabled, getModel, getApiKey,
  getProviders, getProviderById, getDefaultProviderId, saveProviders, fetchModels, PRESET_PROVIDERS,
};
