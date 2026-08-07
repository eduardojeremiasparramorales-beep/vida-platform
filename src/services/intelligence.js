// SP Intelligence — Motor Predictivo
// Analiza continuamente la operación y genera insights accionables.
// No es un chatbot simple — es un sistema que observa datos, detecta patrones
// y propone acciones concretas para el admin/supervisor.

const store = require('../db/store');
const nlp = require('./nlp');
const leadScoring = require('./lead-scoring');
const log = require('../utils/logger');

const SYSTEM_PROMPT = `Eres SP Intelligence, el motor de inteligencia artificial de SP Leons Group — una inmobiliaria colombiana que vende lotes a nivel nacional.

Tu función es analizar los datos de la operación y generar insights ACCIONABLES. No des respuestas genéricas. Sé específico, da números, y recomienda acciones concretas.

Responde SIEMPRE en JSON con esta estructura:
{
  "insights": [
    {
      "tipo": "oportunidad" | "alerta" | "tendencia" | "recomendacion",
      "prioridad": "critica" | "alta" | "media" | "baja",
      "titulo": "string corto (max 60 chars)",
      "descripcion": "string detallado (max 200 chars)",
      "accion": "string con la acción sugerida",
      "impacto": "alto" | "medio" | "bajo",
      "datos": {}
    }
  ],
  "resumen": "string (max 150 chars — resumen ejecutivo del día)"
}`;

function getDatosOperacion() {
  const leads = store.all(`SELECT id, customer_name, etiqueta, status, assigned_to_id, created_at, updated_at FROM leads WHERE status != 'cerrado'`);
  const vendedores = store.all(`SELECT id, nombre, estado FROM vendedores WHERE estado = 'activo'`);
  const messages = store.all(`SELECT lead_id, direction, timestamp FROM messages WHERE timestamp >= datetime('now', '-24 hours')`);

  // Leads por etapa
  const porEtapa = {};
  leads.forEach(l => { const e = l.etiqueta || 'sin_clasificar'; porEtapa[e] = (porEtapa[e] || 0) + 1; });

  // Leads sin respuesta en 24h
  const sinRespuesta = leads.filter(l => {
    const last = l.updated_at ? new Date(l.updated_at) : new Date(l.created_at);
    return (Date.now() - last.getTime()) > 24 * 3600000 && l.etiqueta !== 'vendido';
  });

  // Mensajes últimas 24h
  const msgsEntrante = messages.filter(m => m.direction === 'incoming').length;
  const msgsSaliente = messages.filter(m => m.direction === 'outgoing').length;

  // Leads nuevos hoy
  const hoy = new Date().toISOString().slice(0, 10);
  const nuevosHoy = leads.filter(l => l.created_at && l.created_at.startsWith(hoy)).length;

  // Leads fríos (>7 días sin actividad)
  const frios = leads.filter(l => {
    const last = l.updated_at ? new Date(l.updated_at) : new Date(l.created_at);
    return (Date.now() - last.getTime()) > 7 * 86400000 && l.etiqueta !== 'vendido';
  });

  return {
    totalLeads: leads.length,
    porEtapa,
    sinRespuestaCount: sinRespuesta.length,
    sinRespuestaLeads: sinRespuesta.slice(0, 10).map(l => ({ id: l.id, nombre: l.customer_name, dias: Math.floor((Date.now() - new Date(l.updated_at || l.created_at).getTime()) / 86400000) })),
    mensajesEntrantes24h: msgsEntrante,
    mensajesSalientes24h: msgsSaliente,
    nuevosHoy,
    leadsFriosCount: frios.length,
    leadsFrios: frios.slice(0, 5).map(l => ({ id: l.id, nombre: l.customer_name, etapa: l.etiqueta })),
    vendedoresActivos: vendedores.length,
    ratioRespuesta: msgsSaliente > 0 ? (msgsEntrante / msgsSaliente).toFixed(2) : 'N/A',
  };
}

function getDatosVendedores() {
  const vendedores = store.all(`SELECT id, nombre FROM vendedores WHERE estado = 'activo'`);
  return vendedores.map(v => {
    const leads = store.all(`SELECT id, etiqueta, updated_at FROM leads WHERE assigned_to_id = ? AND status != 'cerrado'`, [v.id]);
    const vendidos = leads.filter(l => l.etiqueta === 'vendido').length;
    const sinRespuesta = leads.filter(l => {
      const last = l.updated_at ? new Date(l.updated_at) : new Date();
      return (Date.now() - last.getTime()) > 4 * 3600000 && l.etiqueta !== 'vendido';
    }).length;
    return {
      id: v.id,
      nombre: v.nombre,
      totalLeads: leads.length,
      vendidos,
      sinRespuesta,
      conversion: leads.length > 0 ? ((vendidos / leads.length) * 100).toFixed(1) : '0',
    };
  });
}

function getDatosCampañas() {
  try {
    const campanas = store.all(`SELECT id, name, status, assets_result FROM campanas_sp_projects ORDER BY created_at DESC LIMIT 5`);
    return campanas.map(c => {
      let metrics = {};
      try { metrics = JSON.parse(c.assets_result || '{}'); } catch (e) {}
      return { id: c.id, nombre: c.name, estado: c.status, metricas };
    });
  } catch (e) { return []; }
}

async function generarInsights() {
  const datos = getDatosOperacion();
  const vendedores = getDatosVendedores();
  const campañas = getDatosCampañas();

  const userPrompt = `Analiza estos datos de la operación inmobiliaria de SP Leons Group y genera insights accionables:

RESUMEN DEL DÍA:
- Total leads activos: ${datos.totalLeads}
- Leads por etapa: ${JSON.stringify(datos.porEtapa)}
- Leads sin respuesta >24h: ${datos.sinRespuestaCount}
- Mensajes entrantes 24h: ${datos.mensajesEntrantes24h}
- Mensajes salientes 24h: ${datos.mensajesSalientes24h}
- Leads nuevos hoy: ${datos.nuevosHoy}
- Leads fríos >7 días: ${datos.leadsFriosCount}
- Vendedores activos: ${datos.vendedoresActivos}

RENDEMIENTO POR VENDEDOR:
${vendedores.map(v => `- ${v.nombre}: ${v.totalLeads} leads, ${v.vendidos} vendidos (${v.conversion}%), ${v.sinRespuesta} sin respuesta`).join('\n')}

CAMPANAS ACTIVAS:
${campañas.map(c => `- ${c.nombre}: ${c.estado}`).join('\n')}

Genera entre 3 y 6 insights prioritarios. Enfócate en:
1. Leads calientes que necesitan atención URGENTE
2. Vendedores con bajo rendimiento o leads sin responder
3. Oportunidades de venta que se están perdiendo
4. Tendencias del pipeline (estancamiento, avance)`;

  try {
    const result = await nlp.chatText(SYSTEM_PROMPT, userPrompt, 30000);
    const parsed = JSON.parse(result.text);
    return { ok: true, insights: parsed.insights || [], resumen: parsed.resumen || '', modelo: result.model };
  } catch (e) {
    log.error('INTEL', 'Error generando insights', e.message);
    // Fallback: generar insights estáticos basados en datos
    return { ok: true, insights: generarInsightsEstaticos(datos, vendedores), resumen: 'Insights generados con análisis estático', modelo: 'static' };
  }
}

function generarInsightsEstaticos(datos, vendedores) {
  const insights = [];

  if (datos.sinRespuestaCount > 5) {
    insights.push({
      tipo: 'alerta', prioridad: 'critica',
      titulo: `${datos.sinRespuestaCount} leads sin respuesta`,
      descripcion: `Hay ${datos.sinRespuestaCount} leads esperando respuesta hace más de 24 horas. Cada hora sin responder reduce la probabilidad de venta.`,
      accion: 'Revisar inbox y asignar respuestas urgentes',
      impacto: 'alto',
    });
  }

  const mejorVendedor = vendedores.sort((a, b) => Number(b.conversion) - Number(a.conversion))[0];
  if (mejorVendedor && Number(mejorVendedor.conversion) > 20) {
    insights.push({
      tipo: 'tendencia', prioridad: 'media',
      titulo: `${mejorVendedor.nombre} lidera con ${mejorVendedor.conversion}% conversión`,
      descripcion: `${mejorVendedor.nombre} tiene el mejor ratio de conversión del equipo este mes.`,
      accion: 'Evaluar estrategia replicable del top performer',
      impacto: 'medio',
    });
  }

  if (datos.leadsFriosCount > 10) {
    insights.push({
      tipo: 'oportunidad', prioridad: 'alta',
      titulo: `${datos.leadsFriosCount} leads fríos reactivables`,
      descripcion: `${datos.leadsFriosCount} leads llevan más de 7 días sin interacción. Muchos pueden reactivarse con un mensaje personalizado.`,
      accion: 'Enviar campaña de reactivación a leads fríos',
      impacto: 'alto',
    });
  }

  if ((datos.porEtapa.negociacion || 0) > (datos.porEtapa.vendido || 0) * 3) {
    insights.push({
      tipo: 'alerta', prioridad: 'alta',
      titulo: 'Pipeline estancado en negociación',
      descripcion: `Hay ${datos.porEtapa.negociacion || 0} leads en negociación pero solo ${datos.porEtapa.vendido || 0} vendidos. El embudo tiene un cuello de botella.`,
      accion: 'Revisar objeciones comunes y ajustar propuesta de valor',
      impacto: 'alto',
    });
  }

  if (datos.mensajesEntrantes24h > datos.mensajesSalientes24h * 2) {
    insights.push({
      tipo: 'recomendacion', prioridad: 'media',
      titulo: 'Alta demanda sin atención suficiente',
      descripcion: `${datos.mensajesEntrantes24h} mensajes entrantes vs ${datos.mensajesSalientes24h} salientes en 24h. Los clientes escriben más de lo que el equipo responde.`,
      accion: 'Aumentar capacidad de respuesta o activar respuestas automáticas',
      impacto: 'medio',
    });
  }

  return insights;
}

// Cache de insights (no regenerar cada 5 min)
let _cache = null;
let _cacheAt = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function obtenerInsights() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL) return _cache;
  _cache = await generarInsights();
  _cacheAt = Date.now();
  return _cache;
}

module.exports = { obtenerInsights, generarInsights, getDatosOperacion, getDatosVendedores };
