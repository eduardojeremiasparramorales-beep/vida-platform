const axios = require('axios');
const crypto = require('crypto');
const ChannelAdapter = require('./adapter');

const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v22.0';
const MEDIA_TYPES = ['image', 'audio', 'video', 'document', 'sticker'];

class WhatsAppAdapter extends ChannelAdapter {
  constructor() {
    super('whatsapp');
  }

  getApiConfig() {
    // Vid.a V3: tenant-aware — el mismo helper que usa services/whatsapp.js
    // (env para empresa #1, canal cifrado del control plane para negocios clientes).
    const { token, phoneNumberId } = require('../services/whatsapp').getAuth();
    if (!token || !phoneNumberId) throw new Error('Faltan WHATSAPP_TOKEN o PHONE_NUMBER_ID');
    return {
      url: `https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/messages`,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    };
  }

  async sendMessage(to, text) {
    const { url, headers } = this.getApiConfig();
    const res = await axios.post(url, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: text },
    }, { headers });
    return res.data;
  }

  async sendTemplate(to, templateName, params) {
    const { url, headers } = this.getApiConfig();
    const components = params ? [{
      type: 'body',
      parameters: params.map(p => ({ type: 'text', text: String(p) })),
    }] : [];
    const res = await axios.post(url, {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: templateName, language: { code: 'es' }, components },
    }, { headers });
    return res.data;
  }

  async sendMedia(to, mediaId, type, caption, filename) {
    const { url, headers } = this.getApiConfig();
    const media = { id: mediaId };
    if (caption && type !== 'audio' && type !== 'sticker') media.caption = caption;
    if (type === 'document' && filename) media.filename = filename;
    const res = await axios.post(url, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type,
      [type]: media,
    }, { headers });
    return res.data;
  }

  async getMediaUrl(mediaId) {
    const { token } = require('../services/whatsapp').getAuth();
    const res = await axios.get(`https://graph.facebook.com/${API_VERSION}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data; // { url, mime_type, sha256, file_size, id }
  }

  async downloadMedia(mediaId) {
    const { token } = require('../services/whatsapp').getAuth();
    const meta = await this.getMediaUrl(mediaId);
    const res = await axios.get(meta.url, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
    });
    return { buffer: Buffer.from(res.data), mime: meta.mime_type || 'application/octet-stream' };
  }

  async uploadMedia(buffer, mime, filename) {
    const { token, phoneNumberId } = require('../services/whatsapp').getAuth();
    if (!token || !phoneNumberId) throw new Error('Faltan WHATSAPP_TOKEN o PHONE_NUMBER_ID');

    const FormData = require('form-data');
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mime);
    form.append('file', buffer, { filename: filename || 'archivo', contentType: mime });

    const res = await axios.post(`https://graph.facebook.com/${API_VERSION}/${phoneNumberId}/media`, form, {
      headers: { Authorization: `Bearer ${token}`, ...form.getHeaders() },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    return res.data.id;
  }

  async markAsRead(messageId) {
    const { url, headers } = this.getApiConfig();
    const res = await axios.post(url, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    }, { headers });
    return res.data;
  }

  parseWebhookPayload(body) {
    if (!body || body.object !== 'whatsapp_business_account') return null;

    for (const entry of body.entry || []) {
      if (!entry || !Array.isArray(entry.changes)) continue;
      for (const change of entry.changes || []) {
        if (!change || change.field !== 'messages') continue;
        const value = change.value;
        if (!value) continue;

        const messages = value.messages || [];
        const contacts = value.contacts || [];
        if (messages.length === 0) continue;

        const msg = messages[0];
        if (!msg || !msg.from) continue;

        const contact = contacts.find(c => c && c.wa_id === msg.from);
        const name = (contact && contact.profile && contact.profile.name) || 'Cliente';

        let type = 'text';
        let text = null;
        let media = null;

        if (msg.type === 'text') {
          type = 'text';
          text = msg.text && msg.text.body;
        } else if (msg.type === 'location') {
          type = 'location';
          const loc = msg.location || {};
          text = JSON.stringify({ latitude: loc.latitude, longitude: loc.longitude, name: loc.name || '', address: loc.address || '' });
        } else if (MEDIA_TYPES.includes(msg.type)) {
          type = msg.type;
          const mediaObj = msg[msg.type] || {};
          media = { id: mediaObj.id, mime: mediaObj.mime_type || null, filename: mediaObj.filename || null };
          text = mediaObj.caption || null;
        }

        const ctx = msg.context || {};
        return {
          channel: 'whatsapp',
          from: msg.from,
          type,
          body: text || null,
          media,
          metadata: {
            name,
            username: null,
            campaign_id: ctx.campaign_id || null,
            ad_id: ctx.ad_id || value.referral?.source_id || null,
            ad_name: value.referral?.headline || null,
          },
        };
      }
    }
    return null;
  }

  verifySignature(req) {
    const secret = process.env.APP_SECRET || process.env.META_APP_SECRET;
    if (!secret) return true; // sin secret configurado, no bloquear
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

module.exports = WhatsAppAdapter;
