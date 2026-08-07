// Clase base para adaptadores de canal (WhatsApp, Messenger, Instagram)
//
// Formato normalizado de parseWebhookPayload:
// {
//   channel: string,
//   from: string,
//   type: 'text' | 'image' | 'audio' | 'video' | 'document',
//   body: string | null,
//   media: { id, mime, filename } | null,
//   metadata: { name, username, campaign_id, ad_id, ad_name }
// }

class ChannelAdapter {
  constructor(name) {
    this.name = name; // 'whatsapp' | 'messenger' | 'instagram'
  }

  async sendMessage(to, text) {
    throw new Error(`${this.name}: sendMessage not implemented`);
  }

  async sendMedia(to, mediaId, type, caption) {
    throw new Error(`${this.name}: sendMedia not implemented`);
  }

  // En Messenger/Instagram no existen plantillas HSM como en WhatsApp: se resuelve
  // el texto de la plantilla (catálogo wa_templates) y se envía como mensaje normal
  // dentro de la ventana de 24h. Si Meta rechaza el envío (ventana cerrada), el
  // error sube al caller para que notifique el fallo en vez de fallar en silencio.
  async sendTemplate(to, name, params) {
    const texto = this.resolveTemplateText(name, params);
    return this.sendMessage(to, texto);
  }

  resolveTemplateText(name, params) {
    try {
      const store = require('../db/store');
      const tpl = store.getWATemplateByName ? store.getWATemplateByName(name) : null;
      if (tpl && tpl.componentes) {
        const comps = JSON.parse(tpl.componentes);
        const body = (Array.isArray(comps) ? comps : []).find(c => (c.type || '').toUpperCase() === 'BODY');
        if (body && body.text) {
          let texto = body.text;
          const vals = Array.isArray(params) ? params : [];
          vals.forEach((v, i) => { texto = texto.replace(new RegExp(`\\{\\{${i + 1}\\}\\}`, 'g'), String(v)); });
          return texto;
        }
      }
    } catch (e) { /* fallback abajo */ }
    return 'Hola 👋 Queremos retomar tu solicitud. ¿Sigues interesado? Escríbenos y con gusto te atendemos.';
  }

  parseWebhookPayload(body) {
    throw new Error(`${this.name}: parseWebhookPayload not implemented`);
  }

  verifySignature(req) {
    return true;
  }
}

module.exports = ChannelAdapter;
