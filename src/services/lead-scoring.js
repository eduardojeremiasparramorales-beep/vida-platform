// Lead Scoring Inteligente
// Calcula un score de 0-100 para cada lead basado en comportamiento real.
//
// Factores del score:
// - Frecuencia de mensajes (más mensajes = más interés)
// - Tiempo de respuesta del asesor (más rápido = mejor score)
// - Etapa del pipeline (Negociación > Interesado > Nuevo)
// - Antigüedad (leads recientes con actividad > leads viejos sin actividad)
// - Cantidad de interacciones recientes (últimos 7 días)
//
// El score se recalcula cuando:
// - Llega un mensaje nuevo del cliente
// - Cambia la etapa del lead
// - Se consulta explícitamente

const store = require('../db/store');
const log = require('../utils/logger');

function ensureTable() {
  const db = store.getDB();
  db.exec(`
    CREATE TABLE IF NOT EXISTS lead_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL UNIQUE,
      score INTEGER DEFAULT 0,
      factors TEXT DEFAULT '{}',
      calculated_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (lead_id) REFERENCES leads(id)
    );
    CREATE INDEX IF NOT EXISTS idx_lead_scores_lead ON lead_scores(lead_id);
    CREATE INDEX IF NOT EXISTS idx_lead_scores_score ON lead_scores(score DESC);
  `);
}

// Pesos de cada factor
const PESOS = {
  mensajes_cliente: 20,     // Máx 20 pts — más mensajes = más interés
  tiempo_respuesta: 15,     // Máx 15 pts — respuestas rápidas del asesor
  etapa_pipeline: 20,       // Máx 20 pts — avanzar etapa = mayor probabilidad
  interacciones_recientes: 25, // Máx 25 pts — actividad en últimos 7 días
  antiguedad: 10,           // Máx 10 pts — leads nuevos con actividad > viejos
  canal_organico: 10,       // Máx 10 pts — WhatsApp orgánico > paid
};

function calcularScore(leadId) {
  ensureTable();
  const lead = store.one(`SELECT * FROM leads WHERE id = ?`, [leadId]);
  if (!lead) return null;

  const factors = {};

  // 1. Frecuencia de mensajes del cliente (máx 20 pts)
  const msgCount = store.one(
    `SELECT COUNT(*) as total FROM messages WHERE lead_id = ? AND direction = 'incoming'`,
    [leadId]
  );
  const totalMsgs = msgCount ? msgCount.total : 0;
  // 1 msg = 5pts, 3 msgs = 10pts, 5+ msgs = 20pts
  factors.mensajes_cliente = Math.min(PESOS.mensajes_cliente, Math.round(
    totalMsgs <= 1 ? 5 :
    totalMsgs <= 3 ? 10 :
    totalMsgs <= 5 ? 15 :
    20
  ));

  // 2. Tiempo de respuesta del asesor (máx 15 pts)
  const leadData = store.one(
    `SELECT first_response_at, created_at FROM leads WHERE id = ?`,
    [leadId]
  );
  if (leadData && leadData.first_response_at && leadData.created_at) {
    const created = new Date(leadData.created_at);
    const responded = new Date(leadData.first_response_at);
    const diffMin = (responded - created) / 60000;
    // < 1 min = 15pts, < 5 min = 12pts, < 15 min = 8pts, < 60 min = 4pts, > 60 = 1pt
    factors.tiempo_respuesta = Math.round(
      diffMin <= 1 ? 15 :
      diffMin <= 5 ? 12 :
      diffMin <= 15 ? 8 :
      diffMin <= 60 ? 4 :
      1
    );
  } else {
    factors.tiempo_respuesta = 0;
  }

  // 3. Etapa del pipeline (máx 20 pts)
  const ETAPAS = {
    sin_clasificar: 2,
    interesado: 8,
    negociacion: 14,
    cita: 17,
    vendido: 20,
    no_interesado: 0,
  };
  factors.etapa_pipeline = ETAPAS[lead.status] || 2;

  // 4. Interacciones en últimos 7 días (máx 25 pts)
  const recientes = store.one(
    `SELECT COUNT(*) as total FROM messages
     WHERE lead_id = ? AND direction = 'incoming'
     AND timestamp >= datetime('now', '-7 days')`,
    [leadId]
  );
  const totalRecientes = recientes ? recientes.total : 0;
  factors.interacciones_recientes = Math.min(PESOS.interacciones_recientes, Math.round(
    totalRecientes <= 1 ? 5 :
    totalRecientes <= 3 ? 12 :
    totalRecientes <= 5 ? 18 :
    totalRecientes <= 10 ? 22 :
    25
  ));

  // 5. Antigüedad (máx 10 pts — leads recientes con actividad ganan)
  const created = new Date(lead.created_at);
  const diasDesdeCreacion = (Date.now() - created.getTime()) / 86400000;
  if (diasDesdeCreacion <= 1) factors.antiguedad = 10;       // hoy
  else if (diasDesdeCreacion <= 3) factors.antiguedad = 8;   // 1-3 días
  else if (diasDesdeCreacion <= 7) factors.antiguedad = 6;   // 3-7 días
  else if (diasDesdeCreacion <= 30) factors.antiguedad = 4;  // 1-4 semanas
  else factors.antiguedad = 2;                                // viejo

  // 6. Canal orgánico vs paid (máx 10 pts) — simplificado
  factors.canal_organico = 5; // default medio, se puede refinar con UTM data

  const score = Object.values(factors).reduce((a, b) => a + b, 0);

  // Persistir
  store.run(
    `INSERT INTO lead_scores (lead_id, score, factors, calculated_at)
     VALUES (?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(lead_id) DO UPDATE SET score = ?, factors = ?, calculated_at = datetime('now','localtime')`,
    [leadId, score, JSON.stringify(factors), score, JSON.stringify(factors)]
  );

  return { score, factors, lead_id: leadId };
}

function obtenerScore(leadId) {
  ensureTable();
  const r = store.one(
    `SELECT * FROM lead_scores WHERE lead_id = ? ORDER BY calculated_at DESC LIMIT 1`,
    [leadId]
  );
  if (r) {
    r.factors = JSON.parse(r.factors || '{}');
    return r;
  }
  // Si no existe, calcular
  return calcularScore(leadId);
}

function leadsCalientes(limite = 20) {
  ensureTable();
  return store.all(
    `SELECT ls.*, l.customer_name, l.customer_phone, l.status, l.assigned_to_id
     FROM lead_scores ls
     JOIN leads l ON ls.lead_id = l.id
     WHERE l.status != 'cerrado' AND l.status != 'vendido'
     ORDER BY ls.score DESC
     LIMIT ?`,
    [limite]
  );
}

function recalcularTodos() {
  ensureTable();
  const leads = store.all(`SELECT id FROM leads WHERE status != 'cerrado'`);
  let count = 0;
  for (const l of leads) {
    try { calcularScore(l.id); count++; }
    catch (e) { /* skip */ }
  }
  log.info('SCORING', `${count} lead scores recalculados`);
  return count;
}

module.exports = {
  calcularScore,
  obtenerScore,
  leadsCalientes,
  recalcularTodos,
  ensureTable,
};
