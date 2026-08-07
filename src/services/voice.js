// Servicio de llamadas VoIP con Twilio (click-to-call)

const store = require('../db/store');

function getClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) throw new Error('Faltan TWILIO_ACCOUNT_SID o TWILIO_AUTH_TOKEN');
  const twilio = require('twilio');
  return twilio(accountSid, authToken);
}

function getBaseUrl() {
  return process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
}

async function initiateCall(conversationId, vendedorPhone, customerPhone) {
  // 1. Validar que la conversación exista
  const conversation = store.getConversationById(conversationId);
  if (!conversation) throw new Error(`Conversation ${conversationId} no existe`);

  const twilioNumber = process.env.TWILIO_NUMBER;
  if (!twilioNumber) throw new Error('Falta TWILIO_NUMBER');

  const client = getClient();

  // 2. Crear entrada en timeline: call:initiated
  store.addTimelineEvent(conversationId, 'call:initiated', {
    channel: conversation.channel,
    body: `Llamada iniciada de ${vendedorPhone} a ${customerPhone}`,
    direction: 'outgoing',
    from_number: vendedorPhone,
    to_number: customerPhone,
    metadata: { vendedorPhone, customerPhone },
  });

  // 3. Llamar Twilio API
  const call = await client.calls.create({
    twiml: `<Response><Dial>${vendedorPhone}</Dial></Response>`,
    to: customerPhone,
    from: twilioNumber,
    statusCallback: `${getBaseUrl()}/webhook/twilio/status`,
    statusCallbackEvent: ['completed', 'answered'],
  });

  // 4. Emitir SSE al vendedor
  try {
    if (conversation.assigned_to_id) {
      require('./events').emitToVendedor(conversation.assigned_to_id, 'call:incoming', {
        conversationId, callSid: call.sid, customerPhone, ts: Date.now(),
      });
    }
  } catch (e) { /* sse no disponible */ }

  return call;
}

async function handleStatusWebhook(req) {
  const { CallDuration, CallStatus, RecordingUrl, From, To } = req.body || {};

  // Buscar conversation por teléfono del cliente (customer_channels channel='whatsapp' usa phone como channel_user_id)
  const customer = store.findCustomerByChannel('whatsapp', To) || store.findCustomerByChannel('whatsapp', From);
  let conversation = null;
  if (customer) {
    conversation = store.getConversationByChannelUser('whatsapp', To) || store.getConversationByChannelUser('whatsapp', From);
  }

  if (conversation) {
    store.addTimelineEvent(conversation.id, 'call:completed', {
      channel: conversation.channel,
      body: `Llamada finalizada (${CallStatus || 'desconocido'})`,
      direction: 'system',
      from_number: From || '',
      to_number: To || '',
      metadata: {
        duration: CallDuration || null,
        status: CallStatus || null,
        recordingUrl: RecordingUrl || null,
      },
    });
  }

  return { conversation };
}

async function getCallLogs(conversationId) {
  const timeline = store.getTimelineByConversation(conversationId);
  return timeline.filter(t => t.event_type && t.event_type.startsWith('call:'));
}

module.exports = { initiateCall, handleStatusWebhook, getCallLogs };
