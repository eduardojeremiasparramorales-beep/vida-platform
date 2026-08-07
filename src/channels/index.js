// Registro de channel adapters + webhookReceiver unificado

const adapters = {};

function registerAdapter(name, adapterInstance) {
  adapters[name] = adapterInstance;
}

function getAdapter(name) {
  return adapters[name];
}

function bootstrapChannels() {
  const WhatsAppAdapter = require('./whatsapp');
  const MessengerAdapter = require('./messenger');
  const InstagramAdapter = require('./instagram');

  registerAdapter('whatsapp', new WhatsAppAdapter());
  registerAdapter('messenger', new MessengerAdapter());
  registerAdapter('instagram', new InstagramAdapter());
}

async function webhookReceiver(req, res) {
  const channel = req.params.channel || 'whatsapp';
  console.log(`[WEBHOOK ${channel}] Recibido POST — Body:`, JSON.stringify(req.body).slice(0, 300));
  const adapter = getAdapter(channel);

  if (!adapter) {
    return res.sendStatus(404);
  }

  if (typeof adapter.verifySignature === 'function') {
    const valid = adapter.verifySignature(req);
    if (!valid) {
      console.warn(`[WEBHOOK ${channel}] Firma inválida — rechazado`);
      return res.sendStatus(401);
    }
  }

  // Responder inmediatamente a Meta/Twilio para evitar reintentos
  res.sendStatus(200);

  try {
    const payload = adapter.parseWebhookPayload(req.body);
    if (!payload) {
      console.warn(`[WEBHOOK ${channel}] Payload nulo — ignorado`);
      return;
    }

    // Si viene un array de eventos (múltiples entries en un batch), procesar cada uno
    const events = Array.isArray(payload) ? payload : [payload];

    for (const evt of events) {
      // --- Reacción entrante ---
      if (evt._type === 'reaction') {
        console.log(`[WEBHOOK ${channel}] Reacción de ${evt.from}: ${evt.emoji || '(quitada)'} mid=${evt.mid}`);
        try {
          const MessageRouter = require('../services/router');
          await MessageRouter.handleReaction(channel, evt.from, evt.mid, evt.emoji, evt.action);
        } catch (e) {
          console.error(`[WEBHOOK ${channel}] Error procesando reacción:`, e.message);
        }
        continue;
      }

      // --- Read receipt ---
      if (evt._type === 'read') {
        console.log(`[WEBHOOK ${channel}] Read receipt from=${evt.from} mid=${evt.mid} watermark=${evt.watermark}`);
        try {
          const MessageRouter = require('../services/router');
          await MessageRouter.handleReadReceipt(channel, evt.from, evt.mid, evt.watermark);
        } catch (e) {
          console.error(`[WEBHOOK ${channel}] Error procesando read receipt:`, e.message);
        }
        continue;
      }

      // --- Delivery confirmation ---
      if (evt._type === 'delivery') {
        console.log(`[WEBHOOK ${channel}] Delivery from=${evt.from} mids=${evt.mids.join(',')} watermark=${evt.watermark}`);
        try {
          const MessageRouter = require('../services/router');
          for (const mid of evt.mids) {
            await MessageRouter.handleDelivery(channel, evt.from, mid);
          }
        } catch (e) {
          console.error(`[WEBHOOK ${channel}] Error procesando delivery:`, e.message);
        }
        continue;
      }

      // --- Mensaje normal (texto/media) ---
      console.log(`[WEBHOOK ${channel}] Payload OK — from: ${evt.from}, type: ${evt.type}, body: ${evt.body}`);

      // Obtener nombre real del cliente desde Facebook/Instagram
      if (evt.channel === 'messenger' && typeof adapter.getUserName === 'function') {
        try {
          const profile = await adapter.getUserName(evt.from);
          evt.metadata.name = profile.name;
          evt.metadata.profile_pic = profile.profile_pic;
        } catch (e) {
          console.warn(`[${evt.channel}] No se pudo obtener perfil:`, e.message);
        }
      } else if (evt.channel === 'instagram' && typeof adapter.getUserProfile === 'function') {
        try {
          const profile = await adapter.getUserProfile(evt.from);
          evt.metadata.name = profile.name;
          evt.metadata.username = profile.username;
          evt.metadata.profile_pic = profile.profile_pic;
        } catch (e) {
          console.warn(`[${evt.channel}] No se pudo obtener perfil:`, e.message);
        }
      }

      // Media entrante de Messenger/Instagram
      if (evt.media && evt.media.id && /^https?:\/\//.test(String(evt.media.id))) {
        try {
          const axios = require('axios');
          const mediaStore = require('../services/media');
          const resp = await axios.get(evt.media.id, { responseType: 'arraybuffer', timeout: 15000, maxContentLength: 25 * 1024 * 1024 });
          const mime = resp.headers['content-type'] || 'application/octet-stream';
          const ext = (mime.split('/')[1] || 'bin').split(';')[0];
          const filename = mediaStore.saveOutgoingMedia(Buffer.from(resp.data), mime, `${evt.channel}-${Date.now()}.${ext}`);
          evt.media = { id: null, mime, filename };
        } catch (e) {
          console.error(`[WEBHOOK ${channel}] No se pudo descargar media entrante:`, e.message);
        }
      }

      const MessageRouter = require('../services/router');
      console.log(`[WEBHOOK ${channel}] Enrutando mensaje de ${evt.from}...`);
      await MessageRouter.routeIncoming(evt.channel, evt.from, evt.body, {
        media: evt.media,
        metadata: evt.metadata,
        type: evt.type,
        mid: evt.mid,
      });
      console.log(`[WEBHOOK ${channel}] Mensaje enrutado correctamente`);
    }
  } catch (e) {
    console.error(`Error procesando webhook de ${channel}:`, e.message);
  }
}

module.exports = { registerAdapter, getAdapter, bootstrapChannels, webhookReceiver };
