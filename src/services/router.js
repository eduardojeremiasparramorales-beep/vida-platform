// MessageRouter — Reemplaza a assigner.js. Router genérico multicanal (WhatsApp, Messenger, Instagram).

const store = require('../db/store');
const { getAdapter } = require('../channels');
const events = require('./events');

// Emite por SSE (events.js). El tipo 'room' era de Socket.IO (eliminado): ningún
// frontend escuchaba rooms y los admins ya reciben el mismo evento por su canal.
function emit(channelType, target, evento, data) {
  try {
    if (channelType === 'vendedor') events.emitToVendedor(target, evento, data);
    else if (channelType === 'admins') events.emitToAdmins(evento, data);
  } catch (e) { /* noop */ }
}

// Genera un body legible para media entrante que no tiene texto (stickers, imágenes, etc.)
function mediaBody(media, options) {
  if (!media) return '[archivo]';
  const t = (options && options.type) || media.type || '';
  const map = { image: '🖼️ Imagen', video: '🎬 Video', audio: '🎙️ Audio', document: '📄 Documento', sticker: '👍' };
  return map[t] || '📎 Archivo';
}

function evaluateWorkflow(triggerEvent, ctx) {
  try {
    const WorkflowEngine = require('./workflow');
    if (WorkflowEngine && typeof WorkflowEngine.evaluate === 'function') {
      WorkflowEngine.evaluate(triggerEvent, ctx).catch(e => console.error('WorkflowEngine.evaluate error:', e.message));
    }
  } catch (e) { /* workflow engine no disponible todavía */ }
}

class MessageRouter {
  static async routeIncoming(channel, fromUserId, messageBody, options = {}) {
    const meta = options.metadata || {};

    // 1. Buscar customer por canal
    let customer = store.findCustomerByChannel(channel, fromUserId);

    // 2. Si no existe, crear customer nuevo y vincular canal
    // Foto de perfil: Meta solo la expone para Messenger/Instagram (WhatsApp Cloud
    // API no da acceso a la foto del cliente), por eso solo llega en meta.profile_pic.
    if (!customer) {
      customer = store.createCustomer(meta.name || 'Cliente', channel === 'whatsapp' ? fromUserId : '', meta.profile_pic || '');
      store.linkChannelToCustomer(customer.id, channel, fromUserId, meta.username || '');
    } else {
      // Actualizar nombre y avatar si el customer tiene nombre genérico y recibimos uno real
      const realName = meta.name || null;
      if (realName && realName !== 'Cliente' && (!customer.name || customer.name === 'Cliente')) {
        store.updateCustomer(customer.id, { name: realName });
      }
      if (meta.profile_pic) {
        store.setCustomerAvatarIfEmpty(customer.id, meta.profile_pic);
      }
    }

    // 3. Buscar conversación activa
    let conversation = store.getConversationByChannelUser(channel, fromUserId);

    // 4. Si no existe, crear conversación
    if (!conversation) {
      conversation = store.createConversation(channel, fromUserId, customer.id);
    }

    // 5. Asignar vendedor si no tiene
    let assignedVendedor = null;
    if (!conversation.assigned_to_id) {
      const activos = store.getVendedoresActivos();
      if (activos.length > 0) {
        const siguiente = activos[0];
        require('../db/adapter').run(
          'UPDATE conversations SET assigned_to_id = ?, status = ? WHERE id = ?',
          [siguiente.id, 'asignado', conversation.id]
        );
        conversation = store.getConversationById(conversation.id);
        assignedVendedor = siguiente;
      }
    } else {
      assignedVendedor = store.getVendedores().find(v => v.id === conversation.assigned_to_id) || null;
    }

    // 5b. Para canales no-WhatsApp: crear lead en tabla legacy para que el vendedor lo vea en su panel
    let leadId = conversation.lead_id || null;
    const media = options.media || null;
    // Enriquecer media con media_type si no lo tiene (los adapters no siempre lo incluyen)
    const mediaWithType = media ? { media_type: options.type || media.type || null, media_id: media.id || null, media_mime: media.mime || null, media_filename: media.filename || null } : null;
    if (channel !== 'whatsapp') {
      // Buscar si ya hay un lead vinculado a esta conversación o por teléfono del cliente
      const customerPhone = customer.phone || '';
      const existingLead = customerPhone
        ? store.getLeadByCustomerPhone(customerPhone)
        : null;
      if (existingLead) {
        leadId = existingLead.id;
        // Actualizar nombre si el lead tiene nombre genérico y recibimos uno real
        const realName = meta.name || customer.name;
        if (realName && realName !== 'Cliente' && (!existingLead.customer_name || existingLead.customer_name === 'Cliente')) {
          store.setLeadNombre(leadId, realName);
        }
        // Vincular conversación al lead si no estaba
        if (!conversation.lead_id) {
          require('../db/adapter').run('UPDATE conversations SET lead_id = ? WHERE id = ?', [leadId, conversation.id]);
        }
      } else if (assignedVendedor) {
        // Crear lead nuevo para que el vendedor lo vea
        const nombreCliente = meta.name || customer.name || 'Cliente';
        try {
          const phoneForLead = customerPhone || `${channel}_${fromUserId}`;
          const result = store.saveLead(phoneForLead, nombreCliente, messageBody || mediaBody(media, options));
          leadId = result.leadId;
          if (result.isNew) {
            store.assignLeadToVendedor(leadId, assignedVendedor);
          }
          // Actualizar nombre si el lead ya existía con nombre genérico
          if (!result.isNew && nombreCliente !== 'Cliente') {
            store.setLeadNombre(leadId, nombreCliente);
          }
          // Guardar también en tabla messages (legacy) para consistencia
          store.saveMessage(leadId, fromUserId, assignedVendedor.telefono || '', messageBody || mediaBody(media, options), 'incoming', mediaWithType);
          // Vincular conversación al lead
          require('../db/adapter').run('UPDATE conversations SET lead_id = ? WHERE id = ?', [leadId, conversation.id]);
        } catch (e) {
          console.error(`[ROUTER] Error creando lead para ${channel}:`, e.message);
        }
      }
    }

    // 6. Guardar en timeline
    // Agregar mid al metadata para vincular reacciones/estados de Messenger
    if (options.mid) meta.mid = options.mid;
    const message = store.addTimelineEvent(conversation.id, 'message', {
      channel,
      body: messageBody || '',
      direction: 'incoming',
      from_number: fromUserId,
      to_number: '',
      media_type: media ? (options.type || media.type || null) : null,
      media_id: media ? media.id : null,
      media_mime: media ? media.mime : null,
      media_filename: media ? media.filename : null,
      metadata: meta,
    });

    // Actualizar last_message / unread_count de la conversación
    require('../db/adapter').run(
      'UPDATE conversations SET last_message = ?, last_message_at = datetime(\'now\'), unread_count = COALESCE(unread_count,0) + 1, updated_at = datetime(\'now\') WHERE id = ?',
      [messageBody || mediaBody(media, options), conversation.id]
    );
    conversation = store.getConversationById(conversation.id);

    // 7-8. Emitir SSE al vendedor asignado (evento 'nuevo_mensaje' para que el panel del vendedor lo detecte)
    const payload = {
      conversationId: conversation.id,
      leadId: leadId,
      channel,
      body: messageBody,
      customerName: customer.name,
      tipo: 'mensaje_cliente',
      ts: Date.now(),
    };
    const payloadAdmin = {
      conversationId: conversation.id,
      leadId: leadId,
      channel,
      body: messageBody,
      customerName: customer.name,
      ts: Date.now(),
    };
    if (conversation.assigned_to_id) {
      emit('vendedor', conversation.assigned_to_id, 'nuevo_mensaje', payload);
      // Notificación persistente + push (los mensajes de WhatsApp ya notifican
      // por el camino legacy assigner.notificarPanel — no duplicar)
      if (channel !== 'whatsapp') {
        try {
          const canal = channel === 'messenger' ? 'Messenger' : channel === 'instagram' ? 'Instagram' : channel;
          require('./notify').notify({
            vendedorId: conversation.assigned_to_id, tipo: 'mensaje_cliente', leadId: leadId, push: true,
            titulo: `💬 ${customer.name || 'Cliente'} (${canal})`,
            cuerpo: String(messageBody || mediaBody(media, options)).slice(0, 120),
          }).catch(() => {});
        } catch (e) { /* notify opcional */ }
      }
    }
    emit('admins', null, 'nuevo_mensaje', payloadAdmin);

    // 9. Workflow
    evaluateWorkflow('message:incoming', { conversation, message, customer });

    // 10. Retornar
    return { conversation, message, leadId };
  }

  static async routeOutgoing(conversationId, vendedorId, text) {
    // 1. Buscar conversation
    const conversation = store.getConversationById(conversationId);
    if (!conversation) throw new Error(`Conversation ${conversationId} no existe`);

    const customer = store.getCustomerById(conversation.customer_id);
    const channels = store.getCustomerChannels(conversation.customer_id)
      .filter(c => c.channel === conversation.channel);
    const channelUserId = channels.length > 0 ? channels[0].channel_user_id : (customer ? customer.phone : null);
    console.log(`[ROUTER out] conv=${conversationId} channel=${conversation.channel} channelUserId=${channelUserId} channels_found=${channels.length}`);
    if (!channelUserId) throw new Error('No se encontró channel_user_id para la conversación');

    // 2. Obtener adapter del canal
    const adapter = getAdapter(conversation.channel);
    if (!adapter) throw new Error(`Adapter no registrado para canal ${conversation.channel}`);

    // 3. Enviar mensaje (smart: detecta ventana 24h y envía template si está cerrada)
    let templateSent = false;
    let outgoingMid = null;
    if (conversation.channel === 'whatsapp') {
      const { sendMessageSmart } = require('./whatsapp');
      const leadId = conversation.lead_id || null;
      const smartResult = await sendMessageSmart(channelUserId, text, leadId);
      templateSent = smartResult.templateSent || false;
    } else {
      try {
        console.log(`[ROUTER out] Enviando por ${conversation.channel} a ${channelUserId}...`);
        const result = await adapter.sendMessage(channelUserId, text);
        outgoingMid = result && result.message_id ? result.message_id : null;
        console.log(`[ROUTER out] Enviado OK por ${conversation.channel} mid=${outgoingMid}`);
      } catch (e) {
        console.error(`[ROUTER out] Error enviando por ${conversation.channel}:`, e.response ? JSON.stringify(e.response.data) : e.message);
        throw e;
      }
    }

    // 4. Guardar en timeline
    const timelineMeta = { channel: conversation.channel, mid: outgoingMid };
    const message = store.addTimelineEvent(conversation.id, 'message', {
      ...timelineMeta,
      body: text,
      direction: 'outgoing',
      from_number: '',
      to_number: channelUserId,
    });

    require('../db/adapter').run(
      'UPDATE conversations SET last_message = ?, last_message_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?',
      [text, conversation.id]
    );

    // 5. Actualizar status
    if (conversation.status === 'nuevo' || conversation.status === 'asignado') {
      store.updateConversationStatus(conversation.id, 'contactado');
    }

    // 6. Emitir SSE
    const payload = { conversationId: conversation.id, leadId: conversation.lead_id || null, channel: conversation.channel, body: text, tipo: 'respuesta_panel', ts: Date.now() };
    if (conversation.assigned_to_id) {
      emit('vendedor', conversation.assigned_to_id, 'nuevo_mensaje', payload);
    }
    emit('admins', null, 'nuevo_mensaje', payload);

    // 6b. Notificar push al admin cuando el vendedor responde
    try {
      require('./notify').notify({
        vendedorId: 0, tipo: 'respuesta_vendedor', leadId: conversation.lead_id || null, push: true,
        titulo: '📤 ' + (customer ? customer.name : 'Vendedor') + ' respondió',
        cuerpo: String(text || '').slice(0, 120),
      }).catch(() => {});
    } catch (e) { /* notify opcional */ }

    // 7. Workflow
    evaluateWorkflow('message:outgoing', { conversation, message });

    return message;
  }

  static async assignVendedor(conversationId) {
    const conversation = store.getConversationById(conversationId);
    if (!conversation) throw new Error(`Conversation ${conversationId} no existe`);

    const activos = store.getVendedoresActivos();
    if (activos.length === 0) return conversation;

    const siguiente = activos[0];
    require('../db/adapter').run(
      'UPDATE conversations SET assigned_to_id = ?, status = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [siguiente.id, 'asignado', conversation.id]
    );

    const updated = store.getConversationById(conversationId);
    emit('vendedor', siguiente.id, 'conversation:assigned', { conversationId, ts: Date.now() });
    emit('admins', null, 'conversation:assigned', { conversationId, vendedorId: siguiente.id, ts: Date.now() });
    try {
      require('./notify').notify({
        vendedorId: siguiente.id, tipo: 'lead_asignado', leadId: updated.lead_id || null, push: true,
        titulo: '🆕 Conversación asignada a ti', cuerpo: 'Tienes una nueva conversación. Revísala en tu panel.',
      }).catch(() => {});
    } catch (e) { /* notify opcional */ }
    evaluateWorkflow('conversation:assigned', { conversation: updated });

    return updated;
  }

  static async closeConversation(conversationId) {
    store.updateConversationStatus(conversationId, 'cerrado');
    const conversation = store.getConversationById(conversationId);

    emit('admins', null, 'conversation:closed', { conversationId, ts: Date.now() });
    if (conversation && conversation.assigned_to_id) {
      emit('vendedor', conversation.assigned_to_id, 'conversation:closed', { conversationId, ts: Date.now() });
    }

    evaluateWorkflow('conversation:closed', { conversation });

    return conversation;
  }

  // --- Reacción entrante (Messenger/Instagram) ---
  static async handleReaction(channel, fromUserId, mid, emoji, action) {
    // Buscar conversación y customer
    const conversation = store.getConversationByChannelUser(channel, fromUserId);
    if (!conversation) {
      console.warn(`[ROUTER reaction] No se encontró conversación para ${channel}:${fromUserId}`);
      return;
    }
    const leadId = conversation.lead_id || null;

    // Buscar el mensaje por mid (Messenger usa "mid.$..." como identificador)
    let targetMessage = null;
    if (mid) {
      // Buscar en timeline por metadata que contenga el mid
      const adapter = require('../db/adapter');
      const rows = adapter.all(
        "SELECT * FROM timeline WHERE conversation_id = ? AND event_type = 'message' ORDER BY id DESC LIMIT 100",
        [conversation.id]
      );
      for (const row of rows) {
        try {
          const md = row.metadata ? JSON.parse(row.metadata) : {};
          if (md.mid === mid || md.wamid === mid) {
            targetMessage = row;
            break;
          }
        } catch (e) { /* skip */ }
      }
      // Fallback: buscar por wamid en tabla messages legacy
      if (!targetMessage && leadId) {
        const msg = store.getMessageByWamid(mid);
        if (msg) targetMessage = msg;
      }
    }

    if (!targetMessage) {
      console.warn(`[ROUTER reaction] No se encontró mensaje con mid=${mid}`);
      return;
    }

    // Guardar/quitar reacción en DB
    if (action === 'unreact' || !emoji) {
      // Quitar todas las reacciones de este usuario en este mensaje
      for (const r of store.getReactionsForMessage(targetMessage.id)) {
        if (r.sender_number === fromUserId) {
          store.removeReaction(targetMessage.id, r.emoji, fromUserId);
        }
      }
    } else {
      store.addReaction(targetMessage.id, emoji, fromUserId, 'incoming');
    }

    // Emitir SSE
    if (leadId) {
      const lead = store.getLeadById(leadId);
      if (lead) {
        emit('vendedor', lead.assigned_to_id, 'reaccion', { leadId, messageId: targetMessage.id, emoji, ts: Date.now() });
      }
    }
    emit('admins', null, 'reaccion', { leadId, messageId: targetMessage.id, emoji, ts: Date.now() });
    console.log(`[ROUTER reaction] ${channel} ${fromUserId}: ${emoji || '(quitada)'} → msg ${targetMessage.id}`);
  }

  // --- Read receipt (Messenger/Instagram) ---
  static async handleReadReceipt(channel, fromUserId, mid, watermark) {
    const conversation = store.getConversationByChannelUser(channel, fromUserId);
    if (!conversation) return;
    const leadId = conversation.lead_id || null;

    // Marcar mensajes salientes como leídos
    if (leadId) {
      const adapter = require('../db/adapter');
      adapter.run(
        "UPDATE messages SET status = 'read', read_at = datetime('now','localtime') WHERE lead_id = ? AND direction = 'outgoing' AND (status IS NULL OR status != 'read')",
        [leadId]
      );
    }
    console.log(`[ROUTER read] ${channel} from=${fromUserId} watermark=${watermark}`);
  }

  // --- Delivery confirmation (Messenger/Instagram) ---
  static async handleDelivery(channel, fromUserId, mid) {
    const conversation = store.getConversationByChannelUser(channel, fromUserId);
    if (!conversation) return;

    // Marcar mensaje como entregado
    const msg = store.getMessageByWamid(mid);
    if (msg) {
      store.updateMessageStatus(mid, 'delivered');
      const leadId = msg.lead_id || conversation.lead_id;
      if (leadId) {
        const lead = store.getLeadById(leadId);
        if (lead) {
          emit('vendedor', lead.assigned_to_id, 'status_update', { leadId, messageId: msg.id, status: 'delivered', ts: Date.now() });
        }
      }
    }
    console.log(`[ROUTER delivery] ${channel} from=${fromUserId} mid=${mid}`);
  }
}

module.exports = MessageRouter;
