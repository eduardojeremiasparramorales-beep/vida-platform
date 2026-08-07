// Motor de automatización IF/THEN
const axios = require('axios');
const store = require('../db/store');
const { getAdapter } = require('../channels');

class WorkflowEngine {
  constructor() {
    this.rules = [];
    this.router = null;
    this.customActions = {};
  }

  init(routerInstance) {
    this.router = routerInstance;
    this.loadRules();
  }

  loadRules() {
    try {
      this.rules = store.getAllWorkflows({ activo: true });
    } catch (e) {
      console.error('WorkflowEngine.loadRules error:', e.message);
      this.rules = [];
    }
  }

  registerAction(type, handler) {
    this.customActions[type] = handler;
  }

  getFieldValue(field, context) {
    const { conversation, customer } = context;
    switch (field) {
      case 'body': return context.message ? context.message.body : '';
      case 'channel': return conversation ? conversation.channel : '';
      case 'customer_name': return customer ? customer.name : '';
      case 'etiqueta': return conversation ? conversation.etiqueta : '';
      case 'status': return conversation ? conversation.status : '';
      case 'priority': return conversation ? conversation.priority : '';
      default: return '';
    }
  }

  evaluateCondition(condition, context) {
    const { field, operator, value } = condition;
    const actual = this.getFieldValue(field, context);
    const actualStr = actual == null ? '' : String(actual);

    switch (operator) {
      case 'contains':
        return actualStr.toLowerCase().includes(String(value).toLowerCase());
      case 'equals':
        return actualStr === String(value);
      case 'not_equals':
        return actualStr !== String(value);
      case 'in':
        return Array.isArray(value) && value.map(String).includes(actualStr);
      case 'regex':
        try { return new RegExp(value, 'i').test(actualStr); } catch (e) { return false; }
      default:
        return false;
    }
  }

  async executeAction(action, context) {
    const { conversation } = context;
    const type = action.type;
    const params = action.params || {};

    try {
      switch (type) {
        case 'tag':
          store.updateConversationTag(conversation.id, params.value);
          break;
        case 'assign':
          if (this.router) await this.router.assignVendedor(conversation.id);
          break;
        case 'send_template': {
          const adapter = getAdapter(conversation.channel);
          if (adapter && adapter.sendTemplate) {
            const customer = store.getCustomerById(conversation.customer_id);
            const channels = store.getCustomerChannels(conversation.customer_id)
              .filter(c => c.channel === conversation.channel);
            const to = channels.length > 0 ? channels[0].channel_user_id : (customer ? customer.phone : null);
            await adapter.sendTemplate(to, params.name, params.params || null);
          }
          break;
        }
        case 'send_message':
          if (this.router) await this.router.routeOutgoing(conversation.id, null, params.text);
          break;
        case 'notify_admin': {
          try {
            const { notify } = require('./notify');
            await notify({
              vendedorId: 0, tipo: 'workflow', leadId: conversation.lead_id || null, push: true,
              titulo: '⚙️ Automatización', cuerpo: String(params.message || 'Un flujo automatizado se disparó.'),
            });
          } catch (e) { /* notify opcional */ }
          break;
        }
        case 'webhook':
          if (params.url) await axios.post(params.url, { conversation, ...params.payload });
          break;
        default:
          if (this.customActions[type]) await this.customActions[type](action, context);
          break;
      }
      return { ok: true, type };
    } catch (e) {
      // Fallo de envío (p.ej. ventana de 24h cerrada en Messenger/IG): avisar en vez
      // de fallar en silencio — el vendedor asignado y los admins ven qué pasó.
      if (type === 'send_template' || type === 'send_message') {
        try {
          const { notify } = require('./notify');
          const destino = conversation && conversation.assigned_to_id ? conversation.assigned_to_id : 0;
          notify({
            vendedorId: destino, tipo: 'fallo_envio', leadId: (conversation && conversation.lead_id) || null, push: true,
            titulo: '⚠️ No se pudo enviar un mensaje automático',
            cuerpo: `Canal ${conversation ? conversation.channel : '?'}: ${e.message}`.slice(0, 160),
          }).catch(() => {});
        } catch (err) { /* notify opcional */ }
      }
      return { ok: false, type, error: e.message };
    }
  }

  async evaluate(triggerEvent, context) {
    const matching = this.rules.filter(r => r.trigger_event === triggerEvent);
    if (matching.length === 0) return;

    for (const rule of matching) {
      let conditions = [];
      let actions = [];
      try { conditions = JSON.parse(rule.conditions || '[]'); } catch (e) { conditions = []; }
      try { actions = JSON.parse(rule.actions || '[]'); } catch (e) { actions = []; }

      const cumpleTodas = conditions.every(c => this.evaluateCondition(c, context));
      if (!cumpleTodas) continue;

      const results = [];
      for (const action of actions) {
        const r = await this.executeAction(action, context);
        results.push(r);
      }

      try {
        store.addWorkflowLog(rule.id, context.conversation ? context.conversation.id : null, triggerEvent, { results });
      } catch (e) { /* noop */ }
    }
  }
}

const instance = new WorkflowEngine();
instance.loadRules();

module.exports = instance;
module.exports.WorkflowEngine = WorkflowEngine;
