// Servicio unificado de notificaciones — TODO evento del sistema pasa por aquí.
// Fan-out en 3 capas: persistir (tabla notifications) → tiempo real (SSE) → push
// al celular (Web Push / FCM, con el panel cerrado). vendedorId = 0 → admins.
const store = require('../db/store');
const events = require('./events');

/**
 * notify({ vendedorId, tipo, titulo, cuerpo, leadId, push })
 * - vendedorId: 0 = admins, >0 = vendedor específico
 * - tipo: slug del evento ('mensaje_cliente', 'lead_asignado', 'escalamiento', ...)
 * - push: true para mandar también notificación push al celular
 */
async function notify({ vendedorId = 0, tipo = 'info', titulo, cuerpo = '', leadId = null, push = false }) {
  let notif = null;
  try {
    notif = store.createNotification({ vendedorId, tipo, titulo, cuerpo, leadId });
  } catch (e) {
    console.error('[NOTIFY] persistir:', e.message);
  }

  try {
    const data = {
      id: notif ? notif.id : null,
      tipo, titulo, cuerpo, leadId,
      ts: notif ? notif.created_at : Date.now(),
    };
    if (Number(vendedorId) === 0) events.emitToAdmins('notificacion', data);
    else events.emitToVendedor(vendedorId, 'notificacion', data);
  } catch (e) {
    console.error('[NOTIFY] SSE:', e.message);
  }

  if (push) {
    // Las suscripciones push de los admins se guardan bajo vendedor_id = 0,
    // igual que su canal SSE — un solo camino para ambos roles.
    try {
      const pushSvc = require('./push');
      await pushSvc.sendToVendedor(Number(vendedorId) || 0, { title: titulo, body: cuerpo, leadId: leadId || '', tag: 'notif-' + tipo }).catch(() => {});
    } catch (e) {
      console.error('[NOTIFY] push:', e.message);
    }
  }

  return notif;
}

// Notifica al vendedor Y deja registro para los admins (sin duplicar push a admins)
async function notifyVendedorYAdmins(opts) {
  const r = await notify(opts);
  if (Number(opts.vendedorId) !== 0) {
    await notify({ ...opts, vendedorId: 0, push: false });
  }
  return r;
}

module.exports = { notify, notifyVendedorYAdmins };
