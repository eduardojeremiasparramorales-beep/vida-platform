// Servicio de analytics y reportes
const adapter = require('../db/adapter');

function dateFilter(alias, from, to) {
  const conditions = [];
  const params = [];
  if (from) { conditions.push(`${alias}.created_at >= ?`); params.push(from); }
  if (to) { conditions.push(`${alias}.created_at <= ?`); params.push(to); }
  return { conditions, params };
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return null;
  const idx = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, Math.min(idx, sortedArr.length - 1))];
}

function median(sortedArr) {
  if (sortedArr.length === 0) return null;
  const mid = Math.floor(sortedArr.length / 2);
  return sortedArr.length % 2 !== 0 ? sortedArr[mid] : (sortedArr[mid - 1] + sortedArr[mid]) / 2;
}

// --- Desempeño del equipo ---
function getTeamPerformance(from, to) {
  const { conditions, params } = dateFilter('conv', from, to);
  const whereStr = conditions.length > 0 ? 'AND ' + conditions.join(' AND ') : '';

  const vendedores = adapter.all(`SELECT id, nombre FROM vendedores`);

  return vendedores.map(v => {
    const convs = adapter.all(`
      SELECT * FROM conversations conv WHERE conv.assigned_to_id = ? ${whereStr}
    `, [v.id, ...params]);

    const total_asignadas = convs.length;
    const contactadas = convs.filter(c => c.status !== 'nuevo').length;
    const cerradas = convs.filter(c => c.status === 'cerrado').length;
    const vendidas = convs.filter(c => c.etiqueta === 'vendido').length;

    // Tiempo promedio de respuesta: primer incoming -> primer outgoing por conversación
    const tiempos = [];
    for (const c of convs) {
      const primerIn = adapter.one(
        `SELECT created_at FROM timeline WHERE conversation_id = ? AND direction = 'incoming' ORDER BY created_at ASC LIMIT 1`,
        [c.id]
      );
      const primerOut = adapter.one(
        `SELECT created_at FROM timeline WHERE conversation_id = ? AND direction = 'outgoing' ORDER BY created_at ASC LIMIT 1`,
        [c.id]
      );
      if (primerIn && primerOut) {
        const t0 = new Date(primerIn.created_at.replace(' ', 'T') + 'Z').getTime();
        const t1 = new Date(primerOut.created_at.replace(' ', 'T') + 'Z').getTime();
        if (t1 >= t0) tiempos.push((t1 - t0) / 60000);
      }
    }
    const tiempo_promedio_respuesta = tiempos.length ? tiempos.reduce((a, b) => a + b, 0) / tiempos.length : null;

    // CSAT promedio
    const csatEvents = convs.length > 0
      ? adapter.all(`
          SELECT t.* FROM timeline t
          WHERE t.event_type = 'csat' AND t.conversation_id IN (${convs.map(() => '?').join(',')})
        `, convs.map(c => c.id))
      : [];
    const csatValues = csatEvents.map(e => {
      try { return JSON.parse(e.metadata || '{}').score; } catch (err) { return null; }
    }).filter(v => v != null);
    const csat_promedio = csatValues.length ? csatValues.reduce((a, b) => a + b, 0) / csatValues.length : null;

    return {
      vendedorId: v.id,
      nombre: v.nombre,
      total_asignadas,
      contactadas,
      cerradas,
      vendidas,
      tiempo_promedio_respuesta,
      csat_promedio,
    };
  });
}

// --- Conversión de pipeline ---
function getPipelineConversion(from, to) {
  const { conditions, params } = dateFilter('conv', from, to);
  const whereStr = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const etapas = ['nuevo', 'asignado', 'contactado', 'cerrado'];
  const counts = {};
  for (const etapa of etapas) {
    const extra = whereStr ? `${whereStr} AND conv.status = ?` : 'WHERE conv.status = ?';
    const r = adapter.one(`SELECT COUNT(*) as c FROM conversations conv ${extra}`, [...params, etapa]);
    counts[etapa] = r ? r.c : 0;
  }

  const totalR = adapter.one(`SELECT COUNT(*) as c FROM conversations conv ${whereStr}`, params);
  const total = totalR ? totalR.c : 0;

  const resultado = etapas.map((etapa, i) => {
    const anterior = i > 0 ? counts[etapas[i - 1]] : total;
    const conversion_pct = anterior > 0 ? Math.round((counts[etapa] / anterior) * 100) : 0;
    return { etapa, count: counts[etapa], conversion_pct };
  });

  const tasa_conversion_general = total > 0 ? Math.round((counts['cerrado'] / total) * 100) : 0;

  return { etapas: resultado, total, tasa_conversion_general };
}

// --- Distribución por canal ---
function getChannelDistribution(from, to) {
  const { conditions, params } = dateFilter('conv', from, to);
  const whereStr = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const rows = adapter.all(`
    SELECT conv.channel, COUNT(*) as c FROM conversations conv ${whereStr} GROUP BY conv.channel
  `, params);

  const result = { whatsapp: 0, messenger: 0, instagram: 0 };
  rows.forEach(r => { result[r.channel] = r.c; });
  return result;
}

// --- Tiempos de respuesta ---
function getResponseTimes(from, to, vendedorId) {
  const { conditions, params } = dateFilter('conv', from, to);
  if (vendedorId) { conditions.push('conv.assigned_to_id = ?'); params.push(Number(vendedorId)); }
  const whereStr = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const convs = adapter.all(`SELECT id FROM conversations conv ${whereStr}`, params);

  const tiempos = [];
  for (const c of convs) {
    const primerIn = adapter.one(
      `SELECT created_at FROM timeline WHERE conversation_id = ? AND direction = 'incoming' ORDER BY created_at ASC LIMIT 1`,
      [c.id]
    );
    const primerOut = adapter.one(
      `SELECT created_at FROM timeline WHERE conversation_id = ? AND direction = 'outgoing' ORDER BY created_at ASC LIMIT 1`,
      [c.id]
    );
    if (primerIn && primerOut) {
      const t0 = new Date(primerIn.created_at.replace(' ', 'T') + 'Z').getTime();
      const t1 = new Date(primerOut.created_at.replace(' ', 'T') + 'Z').getTime();
      if (t1 >= t0) tiempos.push((t1 - t0) / 60000);
    }
  }

  tiempos.sort((a, b) => a - b);
  const promedio = tiempos.length ? tiempos.reduce((a, b) => a + b, 0) / tiempos.length : null;

  return {
    promedio,
    mediana: median(tiempos),
    p90: percentile(tiempos, 90),
    p99: percentile(tiempos, 99),
    muestras: tiempos.length,
  };
}

// --- CSAT ---
function getCSAT(from, to, vendedorId) {
  const { conditions, params } = dateFilter('t', from, to);
  conditions.push(`t.event_type = 'csat'`);
  let joinVendedor = '';
  if (vendedorId) {
    joinVendedor = 'JOIN conversations conv ON conv.id = t.conversation_id';
    conditions.push('conv.assigned_to_id = ?');
    params.push(Number(vendedorId));
  }
  const whereStr = 'WHERE ' + conditions.join(' AND ');

  const rows = adapter.all(`SELECT t.* FROM timeline t ${joinVendedor} ${whereStr}`, params);
  const values = rows.map(r => {
    try { return JSON.parse(r.metadata || '{}').score; } catch (e) { return null; }
  }).filter(v => v != null);

  const distribucion = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  values.forEach(v => { if (distribucion[v] !== undefined) distribucion[v]++; });

  return {
    promedio: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    distribucion,
    total: values.length,
  };
}

// --- Origen de leads (campañas Meta Ads) ---
// F1: la fuente principal es `leads.ad_id` (poblado por el webhook /webhook, el que
// realmente recibe tráfico de WhatsApp — ver messages.js). Antes esta función solo leía
// `timeline.metadata`, que depende del webhook multicanal /webhook/:channel y en producción
// estaba prácticamente siempre vacía para el número principal. Se suma Messenger/Instagram
// desde `timeline` (sí usan ese flujo) filtrando fuera 'whatsapp' para no contar dos veces.
function getLeadSources(from, to) {
  const { conditions, params } = dateFilter('l', from, to);
  const whereStr = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const leads = adapter.all(`SELECT ad_id, ad_name, etiqueta FROM leads l ${whereStr}`, params);

  const campanas = {}; // ad_id/nombre -> { campaign, leads, vendidos }
  let organico = 0;
  let pagado = 0;
  const bump = (key, nombre, vendido) => {
    if (!campanas[key]) campanas[key] = { campaign: nombre || 'Anuncio sin nombre', leads: 0, vendidos: 0 };
    campanas[key].leads++;
    if (vendido) campanas[key].vendidos++;
  };

  for (const l of leads) {
    if (l.ad_id) {
      pagado++;
      bump(l.ad_id, l.ad_name, l.etiqueta === 'vendido');
    } else {
      organico++;
    }
  }

  // Messenger/Instagram (flujo multicanal) — mismo criterio, sin duplicar WhatsApp.
  try {
    const { conditions: cc, params: cp } = dateFilter('conv', from, to);
    cc.push(`conv.channel != 'whatsapp'`);
    cc.push(`conv.id IN (SELECT DISTINCT conversation_id FROM timeline WHERE direction = 'incoming')`);
    const convs = adapter.all(`SELECT conv.id FROM conversations conv WHERE ${cc.join(' AND ')}`, cp);
    for (const c of convs) {
      const primerMsg = adapter.one(
        `SELECT metadata FROM timeline WHERE conversation_id = ? AND direction = 'incoming' ORDER BY created_at ASC LIMIT 1`,
        [c.id]
      );
      if (!primerMsg) continue;
      let meta = {};
      try { meta = JSON.parse(primerMsg.metadata || '{}'); } catch (e) { meta = {}; }
      if (meta.ad_id) {
        pagado++;
        bump(meta.ad_id, meta.campaign_name || meta.ad_name, false); // sin cruce de venta en este flujo aún
      } else {
        organico++;
      }
    }
  } catch (e) { /* multicanal sin datos aún — no bloquea el resto del reporte */ }

  const campanasList = Object.values(campanas).map((c) => ({
    ...c,
    conversion_pct: c.leads ? Math.round((c.vendidos / c.leads) * 100) : 0,
  })).sort((a, b) => b.leads - a.leads);

  return { campanas: campanasList, organico, pagado };
}

// --- Distribución horaria ---
function getHourlyDistribution(from, to) {
  const { conditions, params } = dateFilter('conv', from, to);
  const whereStr = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const convs = adapter.all(`SELECT created_at FROM conversations conv ${whereStr}`, params);

  const porHora = Array.from({ length: 24 }, (_, hora) => ({ hora, count: 0 }));
  convs.forEach(c => {
    if (!c.created_at) return;
    const hora = new Date(c.created_at.replace(' ', 'T')).getHours();
    porHora[hora].count++;
  });

  return porHora;
}

// --- Exportar CSV ---
function getExportCSV(from, to, filters = {}) {
  const { conditions, params } = dateFilter('conv', from, to);
  if (filters.channel) { conditions.push('conv.channel = ?'); params.push(filters.channel); }
  if (filters.vendedorId) { conditions.push('conv.assigned_to_id = ?'); params.push(Number(filters.vendedorId)); }
  const whereStr = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const rows = adapter.all(`
    SELECT conv.*, c.name AS customer_name, c.phone AS customer_phone, v.nombre AS vendedor_nombre
    FROM conversations conv
    LEFT JOIN customers c ON c.id = conv.customer_id
    LEFT JOIN vendedores v ON v.id = conv.assigned_to_id
    ${whereStr}
    ORDER BY conv.created_at DESC
  `, params);

  const csvCell = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const header = ['ID', 'Cliente', 'Teléfono', 'Canal', 'Vendedor', 'Estado', 'Etiqueta', 'Mensajes', 'Creado', 'Cerrado', 'CSAT'];

  const dataRows = rows.map(r => {
    const mensajesCount = adapter.one('SELECT COUNT(*) as c FROM timeline WHERE conversation_id = ?', [r.id]);
    const csatRow = adapter.one(
      `SELECT metadata FROM timeline WHERE conversation_id = ? AND event_type = 'csat' ORDER BY created_at DESC LIMIT 1`,
      [r.id]
    );
    let csat = '';
    if (csatRow) {
      try { csat = JSON.parse(csatRow.metadata || '{}').score || ''; } catch (e) { csat = ''; }
    }
    return [
      r.id, r.customer_name || '', r.customer_phone || '', r.channel,
      r.vendedor_nombre || 'Sin asignar', r.status, r.etiqueta || 'sin_clasificar',
      mensajesCount ? mensajesCount.c : 0, r.created_at,
      r.status === 'cerrado' ? r.updated_at : '', csat,
    ].map(csvCell).join(';');
  });

  return '﻿' + header.join(';') + '\n' + dataRows.join('\n');
}

module.exports = {
  getTeamPerformance, getPipelineConversion, getChannelDistribution,
  getResponseTimes, getCSAT, getLeadSources, getHourlyDistribution, getExportCSV,
};
