// SP Feed en Tiempo Real — servicio emisor de actividad.
//
// Un punto único para registrar eventos operativos del negocio como publicaciones
// del feed del Supervisor Center (y del admin). Cada log():
//   1. Persiste el evento en feed_events (historial reconstruible al recargar)
//   2. Emite SSE `actividad` al canal 0 (admins + supervisores) para que el feed
//      se actualice en tiempo real sin recargar la página
//
// Uso desde cualquier capa:  const activity = require('./services/activity');
// activity.logLeadAsignado({...})  — helpers semánticos por tipo de evento.

const store = require('../db/store');
const { emitToAdmins } = require('./events');

// Labels legibles para etapas del pipeline (claves crudas → texto de la tarjeta).
const ETIQUETA_LABEL = {
  sin_clasificar: 'Sin clasificar', interesado: 'Interesado', negociacion: 'Negociación',
  cita: 'Cita agendada', vendido: 'Vendido', no_interesado: 'No interesado',
  remar_keting: 'Remarketing',
};
function labelEtiqueta(k) { return ETIQUETA_LABEL[String(k || '')] || String(k || '').replace(/_/g, ' '); }

// Núcleo: persiste + emite SSE. Devuelve el evento creado (o null si falla).
function log({ tipo, categoria = 'operaciones', actorId = null, actorNombre = '', leadId = null, conversationId = null, entidadTipo = '', entidadId = null, titulo, descripcion = '', payload = {} }) {
  try {
    const ev = store.createFeedEvent({
      tipo, categoria, actorId, actorNombre, leadId, conversationId,
      entidadTipo, entidadId, titulo, descripcion, payload,
    });
    if (ev) {
      emitToAdmins('actividad', {
        id: ev.id, tipo: ev.tipo, categoria: ev.categoria,
        actorId: ev.actor_id, actorNombre: ev.actor_nombre,
        leadId: ev.lead_id, conversationId: ev.conversation_id,
        entidadTipo: ev.entidad_tipo, entidadId: ev.entidad_id,
        titulo: ev.titulo, descripcion: ev.descripcion,
        payload: (() => { try { return JSON.parse(ev.payload || '{}'); } catch (e) { return {}; } })(),
        createdAt: ev.created_at, ts: Date.now(),
      });
    }
    return ev;
  } catch (e) {
    console.error('[ACTIVITY] log error:', e.message);
    return null;
  }
}

// --- Helpers semánticos -----------------------------------------------------

// Nuevo lead asignado a un asesor (asignación inicial, round-robin).
function logLeadAsignado({ leadId, vendedor, customerName, origen = '' }) {
  const nombre = (vendedor && vendedor.nombre) || 'Sistema';
  return log({
    tipo: 'lead_asignado', categoria: 'leads',
    actorId: vendedor && vendedor.id, actorNombre: nombre,
    leadId, entidadTipo: 'lead', entidadId: leadId,
    titulo: 'Nuevo lead asignado',
    descripcion: `${customerName || 'Cliente nuevo'} fue asignado a ${nombre}${origen ? ' (' + origen + ')' : ''}.`,
    payload: { customerName: customerName || 'Cliente nuevo', origen },
  });
}

// Un asesor respondió a un cliente (desde su WhatsApp o desde el panel).
function logRespuesta({ leadId, conversationId, vendedorId, vendedorNombre, customerName }) {
  return log({
    tipo: 'asesor_respondio', categoria: 'operaciones',
    actorId: vendedorId, actorNombre: vendedorNombre || 'Asesor',
    leadId, conversationId, entidadTipo: 'lead', entidadId: leadId,
    titulo: 'Asesor respondió',
    descripcion: `${vendedorNombre || 'Un asesor'} respondió a ${customerName || 'un cliente'}.`,
    payload: { customerName: customerName || 'Cliente' },
  });
}

// Cliente cambió de etapa en el embudo. Si la etapa final es 'vendido', se
// registra además como venta (categoria ventas) para el filtro de Ventas.
function logEtapa({ leadId, customerName, de, a, actorId = null, actorNombre = '' }) {
  const por = actorNombre ? ` por ${actorNombre}` : '';
  if (a === 'vendido') {
    log({
      tipo: 'venta', categoria: 'ventas',
      actorId, actorNombre,
      leadId, entidadTipo: 'lead', entidadId: leadId,
      titulo: 'Venta realizada',
      descripcion: `${customerName || 'El cliente'} cerró${por}. ¡Felicidades al equipo!`,
      payload: { customerName: customerName || 'Cliente', de, a },
    });
  }
  return log({
    tipo: 'etapa_cambio', categoria: 'leads',
    actorId, actorNombre,
    leadId, entidadTipo: 'lead', entidadId: leadId,
    titulo: 'Cambio de etapa',
    descripcion: `${customerName || 'El cliente'} pasó de «${labelEtiqueta(de)}» a «${labelEtiqueta(a)}»${por}.`,
    payload: { customerName: customerName || 'Cliente', de, a },
  });
}

// Reasignación de un lead (manual por admin/supervisor o automática por escalado).
function logReasignacion({ leadId, customerName, de, a, actorNombre = '', automatica = false }) {
  return log({
    tipo: automatica ? 'reasignacion_auto' : 'reasignacion',
    categoria: 'alertas',
    actorId: null, actorNombre,
    leadId, entidadTipo: 'lead', entidadId: leadId,
    titulo: automatica ? 'Reasignación automática' : 'Lead reasignado',
    descripcion: automatica
      ? `${customerName || 'El cliente'} pasó de ${de || 'un asesor'} a ${a} por falta de respuesta.`
      : `${customerName || 'El cliente'} pasó de ${de || 'un asesor'} a ${a}${actorNombre ? ' (' + actorNombre + ')' : ''}.`,
    payload: { customerName: customerName || 'Cliente', de, a, automatica },
  });
}

// Tiempo de respuesta fuera del objetivo (escalado 15/30/60 min).
function logTiempoObjetivo({ leadId, customerName, minutos, tipo = 'escalamiento' }) {
  const label = tipo === 'sin_vendedores' ? 'Sin asesores disponibles'
    : tipo === 'admin' ? `Sin respuesta ${minutos} min`
    : `Alerta ${minutos} min sin respuesta`;
  return log({
    tipo: 'tiempo_objetivo', categoria: 'alertas',
    leadId, entidadTipo: 'lead', entidadId: leadId,
    titulo: 'Respuesta fuera del objetivo',
    descripcion: `${customerName || 'Un cliente'} lleva ${minutos} min sin respuesta. ${label}.`,
    payload: { customerName: customerName || 'Cliente', minutos, tipo },
  });
}

// Nuevo asesor se registró en el sistema.
function logAsesorConectado({ vendedorId, nombre, rol = 'asesor' }) {
  return log({
    tipo: 'asesor_conectado', categoria: 'equipo',
    actorId: vendedorId, actorNombre: nombre,
    entidadTipo: 'vendedor', entidadId: vendedorId,
    titulo: 'Nuevo asesor en el equipo',
    descripcion: `${nombre} se registró como ${rol === 'supervisor' ? 'supervisor' : rol === 'jefe' ? 'jefe' : 'asesor'} y espera aprobación.`,
    payload: { rol },
  });
}

// Publicación manual de capacitación o anuncio interno (admin/supervisor).
function logPost({ actorId, actorNombre, titulo, descripcion = '', categoria = 'capacitacion' }) {
  return log({
    tipo: categoria === 'anuncio' ? 'anuncio' : 'capacitacion',
    categoria: 'capacitacion',
    actorId, actorNombre,
    titulo,
    descripcion,
    payload: { categoria: categoria === 'anuncio' ? 'anuncio' : 'capacitacion' },
  });
}

module.exports = {
  log, logLeadAsignado, logRespuesta, logEtapa, logReasignacion,
  logTiempoObjetivo, logAsesorConectado, logPost,
};
