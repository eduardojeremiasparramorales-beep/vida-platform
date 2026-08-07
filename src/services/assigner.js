const { getVendedoresActivos, assignLeadToVendedor, saveMessage, getLeadById, updateLeadStatus, setFirstResponse, getConfig, updateCustomerMessageTimestamp } = require('../db/store');
const { emitToVendedor, emitToAdmins } = require('./events');

const WELCOME_DEFAULT = 'Hola, somos *Sp Leons Group*. ¡Mucho gusto! *{{asesor}}* será tu asesor comercial.';

function getWelcomeMsg() {
  return getConfig('welcome_message') || WELCOME_DEFAULT;
}

// Distribución inteligente: además de repartir por menor carga (ya lo hace
// getVendedoresActivos con ORDER BY leads_activos ASC), entre los vendedores casi
// empatados en carga se prefiere al que YA atiende leads del mismo proyecto/ciudad/
// campaña de origen — un especialista cierra mejor que un reparto perfectamente parejo.
// `activos` debe venir ya ordenado por leads_activos ASC (getVendedoresActivos lo hace).
function pickVendedorInteligente(activos, hints) {
  if (!activos || !activos.length) return null;
  if (activos.length === 1) return activos[0];
  const { ciudad, proyecto, origen } = hints || {};
  if (!ciudad && !proyecto && !origen) return activos[0];

  const TOLERANCIA_CARGA = 2; // leads de diferencia que se toleran a cambio de especialización
  const minCarga = activos[0].leads_activos ?? 0;
  const candidatos = activos.filter(v => (v.leads_activos ?? 0) - minCarga <= TOLERANCIA_CARGA);
  if (candidatos.length <= 1) return activos[0];

  const store = require('../db/store');
  let mejor = activos[0], mejorScore = 0;
  for (const v of candidatos) {
    const leadsDelVendedor = store.getLeadsByVendedorId(v.id);
    let score = 0;
    for (const l of leadsDelVendedor) {
      if (proyecto && l.proyecto === proyecto) score += 3;
      if (ciudad && l.ciudad === ciudad) score += 2;
      if (origen && l.origen === origen) score += 1;
    }
    if (score > mejorScore) { mejorScore = score; mejor = v; }
  }
  return mejor;
}

// Espeja el movimiento del lead legacy en el inbox multicanal (conversations/timeline)
function syncMulticanal(leadId, data) {
  try {
    const store = require('../db/store');
    const lead = store.getLeadById(leadId);
    if (lead) store.syncLeadToConversation(lead, data);
  } catch (e) { console.error('syncMulticanal:', e.message); }
}

// Dispara el WorkflowEngine para el lead. El motor de automatizaciones (equipo →
// Automatizaciones) ya existía y funcionaba, pero solo se conectaba desde el canal
// multicanal (Messenger/Instagram) — el canal dominante, WhatsApp vía assigner.js,
// nunca lo llamaba, así que ningún flujo IF/THEN se ejecutaba nunca en la práctica.
function triggerWorkflow(triggerEvent, leadId, messageBody) {
  try {
    const store = require('../db/store');
    const conversation = store.getOrCreateConversationForLead(leadId);
    if (!conversation) return;
    const customer = conversation.customer_id ? store.getCustomerById(conversation.customer_id) : null;
    require('./workflow').evaluate(triggerEvent, { conversation, message: { body: messageBody }, customer })
      .catch(e => console.error('WorkflowEngine.evaluate error:', e.message));
  } catch (e) { /* workflow engine opcional */ }
}

// Notifica al panel del vendedor (y a admins) que hubo movimiento en un lead.
// El evento SSE 'nuevo_mensaje' refresca la UI; el centro de notificaciones y el
// push al celular pasan por el servicio unificado notify().
function notificarPanel(vendedorId, leadId, tipo) {
  const data = { leadId, tipo, ts: Date.now() };
  if (vendedorId) emitToVendedor(vendedorId, 'nuevo_mensaje', data);
  emitToAdmins('nuevo_mensaje', data);

  if (vendedorId && tipo === 'mensaje_cliente') {
    try {
      const { notify } = require('./notify');
      const store = require('../db/store');
      const lead = store.getLeadById(leadId);
      notify({
        vendedorId, tipo: 'mensaje_cliente', leadId, push: true,
        titulo: '💬 ' + ((lead && lead.customer_name) || 'Nuevo mensaje'),
        cuerpo: lead ? String(lead.last_message || 'Tienes un nuevo mensaje.').slice(0, 120) : 'Tienes un nuevo mensaje de un cliente.',
      }).catch(e => console.error('Error notify mensaje_cliente:', e.message));
    } catch (e) { /* notify opcional */ }
  }
  if (tipo === 'respuesta_vendedor') {
    try {
      const { notify } = require('./notify');
      notify({ vendedorId: 0, tipo: 'respuesta_vendedor', leadId, push: true,
        titulo: '📤 Vendedor respondió', cuerpo: 'Un vendedor respondió a un lead.',
      }).catch(e => console.error('Error notify respuesta_vendedor:', e.message));
    } catch (e) { /* notify opcional */ }
  }
}

function assignLead(customerPhone, customerName, messageBody) {
  const { saveLead } = require('../db/store');
  const result = saveLead(customerPhone, customerName, messageBody);

  const activos = getVendedoresActivos();
  if (activos.length === 0) {
    return { leadId: result.leadId, vendedor: null, isNew: result.isNew, error: 'no_hay_vendedores' };
  }

  const vendedor = activos[0];
  assignLeadToVendedor(result.leadId, vendedor);
  saveMessage(result.leadId, customerPhone, vendedor.telefono, messageBody, 'incoming');

  return { leadId: result.leadId, vendedor, isNew: result.isNew };
}

function routeReply(fromPhone, messageBody, customerName, wamid, callback) {
  // customerName y wamid son opcionales
  if (typeof customerName === 'function') { callback = customerName; customerName = undefined; wamid = null; }
  if (typeof wamid === 'function') { callback = wamid; wamid = null; }
  const { getLeadByCustomerPhone, getVendedores, saveLead, assignLeadToVendedor, getLeadById } = require('../db/store');

  const vendedores = getVendedores();
  const vendedor = vendedores.find(v => v.telefono === fromPhone);

  if (vendedor) {
    const leads = require('../db/store').getLeads();
    const activeLead = leads.find(l => l.assigned_to_id === vendedor.id && l.status !== 'cerrado');

    if (activeLead) {
      saveMessage(activeLead.id, fromPhone, activeLead.customer_phone, messageBody, 'outgoing');
      setFirstResponse(activeLead.id);
      updateLeadStatus(activeLead.id, 'contactado');
      syncMulticanal(activeLead.id, { direction: 'outgoing', body: messageBody, fromNumber: fromPhone, toNumber: activeLead.customer_phone });
      notificarPanel(vendedor.id, activeLead.id, 'respuesta_vendedor');
      try {
        require('./activity').logRespuesta({
          leadId: activeLead.id, vendedorId: vendedor.id, vendedorNombre: vendedor.nombre,
          customerName: activeLead.customer_name,
        });
      } catch (e) { /* feed opcional */ }
      triggerWorkflow('message:outgoing', activeLead.id, messageBody);

      const { sendMessage } = require('./whatsapp');
      sendMessage(activeLead.customer_phone, messageBody)
        .then(() => callback(null, { forwarded: true, to: activeLead.customer_phone }))
        .catch(callback);
      return;
    }
  }

  const lead = getLeadByCustomerPhone(fromPhone);
  if (lead) {
    console.log(`[routeReply] Lead existente #${lead.id} de ${fromPhone} — ${lead.customer_name}`);
    const activos = getVendedoresActivos();
    if (activos.length === 0) {
      callback(null, { message: 'cliente_espera' });
      return;
    }
    // Verificar que el vendedor asignado siga activo; si no, reasignar al primero disponible
    let v = lead.assigned_to_id
      ? vendedores.find(vd => vd.id === lead.assigned_to_id && vd.estado === 'activo')
      : null;
    if (!v) v = activos[0];

    saveMessage(lead.id, fromPhone, v.telefono, messageBody, 'incoming', null, null, wamid || null);
    updateCustomerMessageTimestamp(lead.id);
    syncMulticanal(lead.id, { direction: 'incoming', body: messageBody, fromNumber: fromPhone, toNumber: v.telefono });
    notificarPanel(v.id, lead.id, 'mensaje_cliente');
    triggerWorkflow('message:incoming', lead.id, messageBody);
    try { require('./progress').evaluateFromMessage(lead.id, messageBody, {}).catch(e=>console.error('[ASSIGNER] progress eval async:', e.message)); } catch(e){ console.error('[ASSIGNER] progress eval:', e.message); };

    const { sendMessage } = require('./whatsapp');
    const prefix = lead.messages_count <= 1
      ? `🆕 Nuevo lead\nCliente: ${lead.customer_name}\nTel: ${fromPhone}\n\n`
      : `↩️ Respuesta de ${lead.customer_name}\n\n`;

    sendMessage(v.telefono, prefix + messageBody)
      .then(() => callback(null, { forwarded: true, to: v.telefono }))
      .catch(callback);
    return;
  }

  const { saveLead: saveL } = require('../db/store');
  const r = saveL(fromPhone, customerName || 'Cliente', messageBody);
  const a = getVendedoresActivos();
  const { sendMessageSmart, sendMessage } = require('./whatsapp');

  if (a.length > 0) {
    const vendedorAsignado = a[0];
    try {
      assignLeadToVendedor(r.leadId, vendedorAsignado);
    } catch (e) {
      console.error('Error asignando lead:', e.message);
    }

    // Enviar mensaje de bienvenida personalizado con nombre del asesor
    const welcome = getWelcomeMsg().replace(/\{\{asesor\}\}/gi, vendedorAsignado.nombre);
    sendMessageSmart(fromPhone, welcome, r.leadId)
      .then(() => saveMessage(r.leadId, 'sistema', fromPhone, welcome, 'outgoing'))
      .catch(e => console.error('Error enviando bienvenida:', e.message));

    saveMessage(r.leadId, fromPhone, vendedorAsignado.telefono, messageBody, 'incoming', null, null, wamid || null);
    updateCustomerMessageTimestamp(r.leadId);
    syncMulticanal(r.leadId, { direction: 'incoming', body: messageBody, fromNumber: fromPhone, toNumber: vendedorAsignado.telefono });
    notificarPanel(vendedorAsignado.id, r.leadId, 'mensaje_cliente');
    triggerWorkflow('message:incoming', r.leadId, messageBody);
    try { require('./progress').evaluateFromMessage(r.leadId, messageBody, {}).catch(e=>console.error('[ASSIGNER] progress eval async:', e.message)); } catch(e){ console.error('[ASSIGNER] progress eval:', e.message); };
    sendMessage(vendedorAsignado.telefono, `🆕 Nuevo lead\nCliente: ${customerName || 'Cliente'}\nTel: ${fromPhone}\n\n${messageBody}`)
      .then(() => callback(null, { forwarded: true, to: vendedorAsignado.telefono }))
      .catch(callback);
  } else {
    syncMulticanal(r.leadId, { direction: 'incoming', body: messageBody, fromNumber: fromPhone });
    callback(null, { message: 'no_hay_vendedores' });
  }
}

// Enruta un mensaje multimedia entrante de un cliente: guarda el lead/mensaje con
// la referencia del archivo, avisa al panel y notifica al vendedor asignado.
function routeIncomingMedia(fromPhone, customerName, mediaData, wamid, callback) {
  if (typeof wamid === 'function') { callback = wamid; wamid = null; }
  const store = require('../db/store');
  const { sendMessage } = require('./whatsapp');

  const etiquetas = { image: 'una imagen', audio: 'un audio', video: 'un video', document: 'un archivo', sticker: 'un sticker', voice: 'una nota de voz', location: 'una ubicación' };
  const label = etiquetas[mediaData.media_type] || 'un archivo';
  const body = mediaData.caption || `[${mediaData.media_type}]`;

  // Buscar lead activo del cliente o crear uno nuevo
  let lead = store.getLeadByCustomerPhone(fromPhone);
  let vendedor;
  const activos = store.getVendedoresActivos();

  if (lead && lead.assigned_to_id) {
    const vendedores = store.getVendedores();
    vendedor = vendedores.find(v => v.id === lead.assigned_to_id) || activos[0];
  } else {
    const r = store.saveLead(fromPhone, customerName || 'Cliente', body);
    lead = store.getLeadById(r.leadId);
    if (activos.length === 0) { callback(null, { message: 'no_hay_vendedores' }); return; }
    vendedor = activos[0];
    try { store.assignLeadToVendedor(lead.id, vendedor); } catch (e) { console.error('Error asignando lead media:', e.message); }
  }

  store.saveMessage(lead.id, fromPhone, vendedor ? vendedor.telefono : '', body, 'incoming', mediaData, null, wamid || null);
  updateCustomerMessageTimestamp(lead.id);
  syncMulticanal(lead.id, { direction: 'incoming', body, media: mediaData, fromNumber: fromPhone, toNumber: vendedor ? vendedor.telefono : '' });
  notificarPanel(vendedor ? vendedor.id : null, lead.id, 'mensaje_cliente');
  triggerWorkflow('message:incoming', lead.id, body);
  try { require('./progress').evaluateFromMessage(lead.id, body, { hasMedia: true }).catch(e=>console.error('[ASSIGNER] progress eval async:', e.message)); } catch(e){ console.error('[ASSIGNER] progress eval:', e.message); };

  if (vendedor) {
    sendMessage(vendedor.telefono, `📎 ${customerName || 'Cliente'} te envió ${label}. Ábrelo en tu panel.`)
      .then(() => callback(null, { forwarded: true, to: vendedor.telefono }))
      .catch(() => callback(null, { forwarded: false }));
  } else {
    callback(null, { forwarded: false });
  }
}

function routeIncomingLocation(fromPhone, customerName, locationData, wamid, callback) {
  if (typeof wamid === 'function') { callback = wamid; wamid = null; }
  const store = require('../db/store');
  const { sendMessage } = require('./whatsapp');

  const locBody = JSON.stringify(locationData);
  const displayBody = `📍 [Ubicación]${locationData.name ? ' ' + locationData.name : ''}${locationData.address ? ' - ' + locationData.address : ''}`;

  let lead = store.getLeadByCustomerPhone(fromPhone);
  let vendedor;
  const activos = store.getVendedoresActivos();

  if (lead && lead.assigned_to_id) {
    const vendedores = store.getVendedores();
    vendedor = vendedores.find(v => v.id === lead.assigned_to_id) || activos[0];
  } else {
    const r = store.saveLead(fromPhone, customerName || 'Cliente', displayBody);
    lead = store.getLeadById(r.leadId);
    if (activos.length === 0) { callback(null, { message: 'no_hay_vendedores' }); return; }
    vendedor = activos[0];
    try { store.assignLeadToVendedor(lead.id, vendedor); } catch (e) { console.error('Error asignando lead location:', e.message); }
  }

  store.saveMessage(lead.id, fromPhone, vendedor ? vendedor.telefono : '', locBody, 'incoming', {
    media_type: 'location', media_id: null, media_mime: null, media_filename: null,
  }, null, wamid || null);
  updateCustomerMessageTimestamp(lead.id);
  syncMulticanal(lead.id, {
    direction: 'incoming', body: displayBody, fromNumber: fromPhone, toNumber: vendedor ? vendedor.telefono : '',
    media: { media_type: 'location' },
  });
  notificarPanel(vendedor ? vendedor.id : null, lead.id, 'mensaje_cliente');
  triggerWorkflow('message:incoming', lead.id, displayBody);
  try { require('./progress').evaluateFromMessage(lead.id, displayBody, { sentLocation: true }).catch(e=>console.error('[ASSIGNER] progress eval async:', e.message)); } catch(e){ console.error('[ASSIGNER] progress eval:', e.message); };

  if (vendedor) {
    const locName = locationData.name ? ` (${locationData.name})` : '';
    sendMessage(vendedor.telefono, `📍 ${customerName || 'Cliente'} te compartió una ubicación${locName}. Ábrelo en tu panel.`)
      .then(() => callback(null, { forwarded: true, to: vendedor.telefono }))
      .catch(() => callback(null, { forwarded: false }));
  } else {
    callback(null, { forwarded: false });
  }
}

function getLeadCount() {
  return require('../db/store').getLeadCount();
}

function getLeads() {
  return require('../db/store').getLeads();
}

module.exports = { assignLead, routeReply, routeIncomingMedia, routeIncomingLocation, getLeadCount, getLeads, pickVendedorInteligente };
