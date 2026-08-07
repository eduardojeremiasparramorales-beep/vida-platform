// Insignias del asesor — gamificación honesta: cada una se otorga/retira SOLO a partir
// de métricas reales de la base de datos. Un job diario (scheduler) llama a recomputeAll().
const store = require('../db/store');

// Catálogo público (emoji + etiqueta + descripción de cómo se gana).
const CATALOGO = {
  bienvenida:        { emoji: '👋', label: 'Bienvenido', desc: 'Tu primer lead asignado.' },
  primer_cierre:     { emoji: '🎯', label: 'Primer cierre', desc: 'Cerraste tu primera venta.' },
  vendedor_estrella: { emoji: '⭐', label: 'Vendedor estrella', desc: '5 o más ventas en total.' },
  top_mes:           { emoji: '🏆', label: 'Top del mes', desc: 'Más ventas del equipo este mes.' },
  respuesta_rapida:  { emoji: '⚡', label: 'Respuesta rápida', desc: 'Respondiste al 90% de tus leads.' },
  al_dia:            { emoji: '🔥', label: 'Al día', desc: 'Sin leads pendientes por responder.' },
};

// Reglas evaluadas por asesor. Devuelve el set de códigos que le corresponden HOY.
function codigosPara(stat, topMesVendedorId) {
  const set = new Set();
  const activos = Number(stat.activos) || 0;
  const pendientes = Number(stat.pendientes) || 0;
  const respondidos = Number(stat.respondidos) || 0;
  const vendidos = Number(stat.vendidos) || 0;
  const vendidosMes = Number(stat.vendidos_mes) || 0;

  if (activos > 0 || vendidos > 0) set.add('bienvenida');
  if (vendidos >= 1) set.add('primer_cierre');
  if (vendidos >= 5) set.add('vendedor_estrella');
  // Respuesta rápida: respondió al menos al 90% de los leads que alguna vez tuvo activos.
  const universo = activos + vendidos;
  if (universo >= 3 && respondidos / universo >= 0.9) set.add('respuesta_rapida');
  // Al día: tiene leads activos y ninguno pendiente de responder.
  if (activos >= 3 && pendientes === 0) set.add('al_dia');
  // Top del mes: el asesor con más ventas del mes (y al menos 1).
  if (topMesVendedorId != null && Number(stat.vendedor_id) === Number(topMesVendedorId) && vendidosMes >= 1) set.add('top_mes');

  return set;
}

// Recalcula insignias de todos los asesores activos: otorga las nuevas, retira las que
// ya no correspondan (excepto hitos permanentes, que nunca se quitan una vez ganados).
const PERMANENTES = new Set(['bienvenida', 'primer_cierre', 'vendedor_estrella']);

function recomputeAll() {
  let stats;
  try { stats = store.getInsigniaStats(); }
  catch (e) { console.error('[INSIGNIAS] no se pudieron leer stats:', e.message); return { ok: false }; }
  if (!stats || !stats.length) return { ok: true, vendedores: 0 };

  // Ganador del mes (más ventas del mes; desempate: el primero)
  let topMes = null, maxMes = 0;
  for (const s of stats) {
    if (Number(s.vendidos_mes) > maxMes) { maxMes = Number(s.vendidos_mes); topMes = s.vendedor_id; }
  }

  const yaTiene = store.getInsigniasAll(); // { vendedorId: [codigos] }
  let otorgadas = 0, retiradas = 0;
  for (const s of stats) {
    const deben = codigosPara(s, topMes);
    const tiene = new Set(yaTiene[s.vendedor_id] || []);
    for (const cod of deben) if (!tiene.has(cod)) { store.awardInsignia(s.vendedor_id, cod); otorgadas++; }
    for (const cod of tiene) if (!deben.has(cod) && !PERMANENTES.has(cod)) { store.revokeInsignia(s.vendedor_id, cod); retiradas++; }
  }
  return { ok: true, vendedores: stats.length, otorgadas, retiradas, topMes };
}

module.exports = { CATALOGO, recomputeAll, codigosPara };
