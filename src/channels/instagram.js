const axios = require('axios');
const crypto = require('crypto');
const ChannelAdapter = require('./adapter');
const store = require('../db/store');

const API_VERSION = 'v22.0';
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;

class InstagramAdapter extends ChannelAdapter {
  constructor() {
    super('instagram');
  }

  // Prioridad: token guardado desde la UI (Integraciones → tabla config) > .env.
  getConfig() {
    const token = store.getConfig('channel_instagram_token') || process.env.INSTAGRAM_TOKEN;
    const igUserId = store.getConfig('channel_instagram_user_id') || process.env.INSTAGRAM_USER_ID;
    if (!token || !igUserId) throw new Error('Faltan INSTAGRAM_TOKEN o INSTAGRAM_USER_ID');
    return { token, igUserId };
  }

  async sendMessage(to, text) {
    const { token, igUserId } = this.getConfig();
    const res = await axios.post(`${GRAPH}/${igUserId}/messages`, {
      recipient: { id: to },
      message: { text },
    }, { params: { access_token: token } });
    return res.data;
  }

  async sendMedia(to, mediaId, type, caption) {
    const { token, igUserId } = this.getConfig();
    const res = await axios.post(`${GRAPH}/${igUserId}/messages`, {
      recipient: { id: to },
      message: { attachment: { type, payload: { url: mediaId } } },
    }, { params: { access_token: token } });
    return res.data;
  }

  async getUserProfile(userId) {
    const { token } = this.getConfig();
    try {
      const res = await axios.get(`${GRAPH}/${userId}`, {
        params: { fields: 'username,name,profile_pic', access_token: token },
      });
      return { username: res.data.username || null, name: res.data.name || 'Cliente', profile_pic: res.data.profile_pic || null };
    } catch (e) {
      return { username: null, name: 'Cliente', profile_pic: null };
    }
  }


  async sendLocation(to, latitude, longitude) {
    const lat = Number(latitude), lng = Number(longitude);
    const url = `https://www.google.com/maps?q=${lat},${lng}`;
    const text = `Ubicacion: ${lat}, ${lng}\n${url}`;
    return this.sendMessage(to, text);
  }

    parseWebhookPayload(body) {
    if (!body || body.object !== 'instagram') return null;

    const entry = (body.entry || [])[0];
    if (!entry) return null;

    const results = [];
    const messagingEvents = entry.messaging || [];

    for (const messaging of messagingEvents) {
      if (!messaging || !messaging.sender) continue;
      const from = messaging.sender.id;

      // --- Reacción del cliente a un mensaje (field: message_reactions) ---
      if (messaging.reaction) {
        const reaction = messaging.reaction;
        const mid = reaction.mid || (reaction.reaction && reaction.reaction.mid) || null;
        const emoji = (reaction.reaction && reaction.reaction.emoji) || reaction.emoji || '';
        const action = (reaction.reaction && reaction.reaction.action) || reaction.action || 'react';
        results.push({
          _type: 'reaction',
          channel: 'instagram',
          from,
          mid,
          emoji,
          action, // 'react' o 'unreact'
        });
        continue;
      }

      // --- Read receipt (field: messaging_seen) ---
      if (messaging.read) {
        results.push({
          _type: 'read',
          channel: 'instagram',
          from,
          mid: messaging.read.mid || null,
          watermark: messaging.read.watermark || null,
          ts: messaging.timestamp || null,
        });
        continue;
      }

      // --- Delivery confirmation (field: message_deliveries) ---
      if (messaging.delivery) {
        const delivery = messaging.delivery;
        const mids = delivery.mids || [];
        results.push({
          _type: 'delivery',
          channel: 'instagram',
          from,
          mids,
          watermark: delivery.watermark || null,
          ts: messaging.timestamp || null,
        });
        continue;
      }

      // --- Mensaje de texto o media ---
      const message = messaging.message || {};
      let type = 'text';
      let text = message.text || null;
      let media = null;

      if (Array.isArray(message.attachments) && message.attachments.length > 0) {
        const att = message.attachments[0];
        type = att.type || 'document';
        media = { id: att.payload && att.payload.url, mime: null, filename: null };
      }

      results.push({
        _type: 'message',
        channel: 'instagram',
        from,
        type,
        body: text,
        media,
        mid: message.mid || null,
        metadata: {
          name: null, // se obtiene aparte con getUserProfile(from)
          username: null, // idem
          campaign_id: null,
          ad_id: (messaging.referral && messaging.referral.ad_id) || null,
          ad_name: null,
        },
      });
    }

    return results.length === 1 ? results[0] : (results.length > 0 ? results : null);
  }

  verifySignature(req) {
    const secret = process.env.APP_SECRET || process.env.META_APP_SECRET;
    if (!secret) return process.env.NODE_ENV !== 'production';
    const sig = req.headers['x-hub-signature-256'];
    if (!sig || !req.rawBody) return false;
    const esperado = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado));
    } catch (e) {
      return false;
    }
  }
}

// Verificación GET /webhook/instagram
function handleInstagramVerification(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const verifyToken = process.env.INSTAGRAM_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
}

module.exports = InstagramAdapter;
module.exports.handleInstagramVerification = handleInstagramVerification;
