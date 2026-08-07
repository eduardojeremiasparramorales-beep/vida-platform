// Workflow Engine — Automatizaciones visuales
// Ejecuta flujos IF/THEN definidos por el admin.
// Cada workflow tiene: trigger → condiciones → acciones en cadena.
//
// Triggers disponibles:
//   lead_nuevo, lead_cambia_etapa, mensaje_recibido, reserva_vence, hora_especifica
//
// Condiciones:
//   si etapa = X, si score > Y, si vendedor = Z, si canal = W, si horas_sin_responder > N
//
// Acciones:
//   enviar_mensaje, crear_tarea, notificar, cambiar_etapa, asignar_vendedor, enviar_template

const store = require('../db/store');
const { notify } = require('./notify');
const log = require('../utils/logger');

// Registrar triggers que el workflow escucha
const TRIGGER_EVENTS = [
  'lead_nuevo',
  'lead_cambia_etapa',
  'mensaje_recibido',
  'reserva_vence',
  'hora_especifica',
];

// Evaluar una condición simple
function evaluarCondicion(cond, contexto) {
  const { campo, operador, valor } = cond;
  const actual = contexto[campo];
  if (actual === undefined || actual === null) return false;

  switch (operador) {
    case '=': case '==': return String(actual) === String(valor);
    case '!=': return String(actual) !== String(valor);
    case '>': return Number(actual) > Number(valor);
    case '<': return Number(actual) < Number(valor);
    case '>=': return Number(actual) >= Number(valor);
    case '<=': return Number(actual) <= Number(valor);
    case 'contains': return String(actual).toLowerCase().includes(String(valor).toLowerCase());
    case 'in': return Array.isArray(valor) ? valor.includes(String(actual)) : false;
    default: return false;
  }
}

// Evaluar todas las condiciones de un workflow (AND lógico)
function evaluarCondiciones(condiciones, contexto) {
  if (!condiciones || !condiciones.length) return true;
  return condiciones.every(c => evaluarCondicion(c, contexto));
}

// Ejecutar una acción del workflow
async function ejecutarAccion(accion, contexto) {
  const { tipo, parametros } = accion;
  log.info('WORKFLOW', `Ejecutando acción: ${tipo}`, parametros);

  switch (tipo) {
    case 'enviar_mensaje': {
      const { lead_id, mensaje } = parametros;
      const lid = lead_id || contexto.lead_id;
      if (!lid || !mensaje) return;
      try {
        // Usar el servicio de WhatsApp para enviar
        const whatsapp = require('./whatsapp');
        const lead = store.one(`SELECT * FROM leads WHERE id = ?`, [lid]);
        if (lead) {
          await whatsapp.sendMessage(lead.customer_phone, mensaje);
          store.run(`INSERT INTO messages (lead_id, from_number, to_number, body, direction) VALUES (?, 'bot', ?, ?, 'outgoing')`,
            [lid, lead.customer_phone, mensaje]);
          log.info('WORKFLOW', `Mensaje enviado a lead ${lid}`);
        }
      } catch (e) { log.error('WORKFLOW', 'Error enviando mensaje', e.message); }
      break;
    }
    case 'crear_tarea': {
      const { lead_id, texto, fecha_vencimiento } = parametros;
      const lid = lead_id || contexto.lead_id;
      if (!lid || !texto) return;
      store.run(
        `INSERT INTO tareas (lead_id, texto, fecha_vencimiento, vendedor_id) VALUES (?, ?, ?, ?)`,
        [lid, texto, fecha_vencimiento || '', contexto.vendedor_id || null]
      );
      log.info('WORKFLOW', `Tarea creada para lead ${lid}`);
      break;
    }
    case 'notificar': {
      const { titulo, mensaje, canal } = parametros;
      // Notificar via SSE a admins
      try {
        const { emitToAdmins } = require('./events');
        emitToAdmins('notificacion', {
          tipo: 'workflow', titulo: titulo || 'Workflow ejecutado',
          cuerpo: mensaje || '', ts: Date.now()
        });
      } catch (e) {}
      // Notificar via WhatsApp si se especifica
      if (canal === 'whatsapp' && parametros.telefono) {
        try {
          const whatsapp = require('./whatsapp');
          await whatsapp.sendMessage(parametros.telefono, mensaje);
        } catch (e) {}
      }
      break;
    }
    case 'cambiar_etapa': {
      const { lead_id, etapa } = parametros;
      const lid = lead_id || contexto.lead_id;
      if (!lid || !etapa) return;
      store.run(`UPDATE leads SET etiqueta = ?, updated_at = datetime('now','localtime') WHERE id = ?`, [etapa, lid]);
      log.info('WORKFLOW', `Lead ${lid} movido a etapa ${etapa}`);
      break;
    }
    case 'asignar_vendedor': {
      const { lead_id, vendedor_id } = parametros;
      const lid = lead_id || contexto.lead_id;
      const vid = vendedor_id || contexto.vendedor_id;
      if (!lid || !vid) return;
      store.run(`UPDATE leads SET assigned_to_id = ?, updated_at = datetime('now','localtime') WHERE id = ?`, [vid, lid]);
      log.info('WORKFLOW', `Lead ${lid} asignado a vendedor ${vid}`);
      break;
    }
    case 'enviar_template': {
      const { lead_id, template_name } = parametros;
      const lid = lead_id || contexto.lead_id;
      if (!lid || !template_name) return;
      // Buscar template y enviar
      const tmpl = store.one(`SELECT * FROM templates WHERE titulo = ?`, [template_name]);
      if (tmpl) {
        try {
          const whatsapp = require('./whatsapp');
          const lead = store.one(`SELECT * FROM leads WHERE id = ?`, [lid]);
          if (lead) await whatsapp.sendMessage(lead.customer_phone, tmpl.cuerpo);
        } catch (e) {}
      }
      break;
    }
    default:
      log.warn('WORKFLOW', `Acción desconocida: ${tipo}`);
  }
}

// Procesar un trigger: buscar workflows que matcheen y ejecutarlos
async function procesarTrigger(evento, contexto) {
  log.info('WORKFLOW', `Trigger recibido: ${evento}`, contexto.lead_id || '');

  const workflows = store.all(
    `SELECT * FROM workflows WHERE activo = 1 AND trigger_event = ?`,
    [evento]
  );

  for (const wf of workflows) {
    let condiciones = [];
    let acciones = [];
    try { condiciones = JSON.parse(wf.conditions || '[]'); } catch (e) {}
    try { acciones = JSON.parse(wf.actions || '[]'); } catch (e) {}

    if (evaluarCondiciones(condiciones, contexto)) {
      log.info('WORKFLOW', `Workflow "${wf.nombre}" (ID ${wf.id}) ejecutándose`);
      for (const accion of acciones) {
        try {
          await ejecutarAccion(accion, contexto);
        } catch (e) {
          log.error('WORKFLOW', `Error en acción ${accion.tipo}`, e.message);
        }
      }
      // Log de ejecución
      store.run(
        `INSERT INTO workflow_logs (workflow_id, conversation_id, trigger_event, result) VALUES (?, ?, ?, ?)`,
        [wf.id, contexto.lead_id || null, evento, JSON.stringify({ ok: true, timestamp: Date.now() })]
      );
    }
  }
}

// Hooks que se llaman desde los endpoints principales
function onLeadNuevo(lead) {
  procesarTrigger('lead_nuevo', {
    lead_id: lead.id,
    nombre: lead.customer_name,
    telefono: lead.customer_phone,
    vendedor_id: lead.assigned_to_id,
    canal: lead.canal || 'whatsapp',
  }).catch(e => log.error('WORKFLOW', 'Error procesando trigger lead_nuevo', e.message));
}

function onMensajeRecibido(lead, mensaje) {
  procesarTrigger('mensaje_recibido', {
    lead_id: lead.id,
    nombre: lead.customer_name,
    telefono: lead.customer_phone,
    vendedor_id: lead.assigned_to_id,
    mensaje: mensaje.body,
    canal: lead.canal || 'whatsapp',
  }).catch(e => log.error('WORKFLOW', 'Error procesando trigger mensaje_recibido', e.message));
}

function onCambiaEtapa(lead, etapaAnterior, etapaNueva) {
  procesarTrigger('lead_cambia_etapa', {
    lead_id: lead.id,
    nombre: lead.customer_name,
    telefono: lead.customer_phone,
    vendedor_id: lead.assigned_to_id,
    etapa_anterior: etapaAnterior,
    etapa_nueva: etapaNueva,
  }).catch(e => log.error('WORKFLOW', 'Error procesando trigger lead_cambia_etapa', e.message));
}

function onReservaVence(reserva) {
  procesarTrigger('reserva_vence', {
    lead_id: reserva.lead_id,
    reserva_id: reserva.id,
    horas_restantes: reserva.horas_restantes,
    vendedor_id: reserva.vendedor_id,
  }).catch(e => log.error('WORKFLOW', 'Error procesando trigger reserva_vence', e.message));
}

// Init: registrar listeners de eventos del sistema
function init() {
  log.info('WORKFLOW', 'Motor de automatizaciones inicializado');
}

module.exports = {
  init,
  onLeadNuevo,
  onMensajeRecibido,
  onCambiaEtapa,
  onReservaVence,
  procesarTrigger,
  evaluarCondicion,
  ejecutarAccion,
  TRIGGER_EVENTS,
};
