// Constructor de Dashboards — Widgets personalizables por usuario
// Cada admin puede crear su dashboard con widgets arrastrables.

const store = require('../db/store');
const log = require('../utils/logger');

function ensureTable() {
  const db = store.getDB();
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_dashboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      widgets TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboards_usuario ON user_dashboards(usuario_id);
  `);
}

const WIDGET_TYPES = {
  metric_leads: { nombre: 'Leads Totales', icono: '📊', fetch: 'metricas' },
  metric_ventas: { nombre: 'Ventas', icono: '✅', fetch: 'metricas' },
  metric_conversion: { nombre: 'Conversión %', icono: '📈', fetch: 'metricas' },
  metric_respuesta: { nombre: 'Tiempo Respuesta', icono: '⏱', fetch: 'metricas' },
  pipeline: { nombre: 'Pipeline', icono: '🔄', fetch: 'pipeline' },
  leads_calientes: { nombre: 'Leads Calientes', icono: '🔥', fetch: 'leadsCalientes' },
  feed_reciente: { nombre: 'Feed Reciente', icono: '📰', fetch: 'feed' },
  calendario_mini: { nombre: 'Calendario', icono: '📅', fetch: 'citas' },
  vendedores_ranking: { nombre: 'Ranking Vendedores', icono: '🏆', fetch: 'ranking' },
  reservas_activas: { nombre: 'Reservas Activas', icono: '⏱', fetch: 'reservas' },
};

function getLayout(usuarioId) {
  ensureTable();
  const r = store.one(`SELECT * FROM user_dashboards WHERE usuario_id = ?`, [usuarioId]);
  if (!r) return { widgets: [] };
  return { id: r.id, widgets: JSON.parse(r.widgets || '[]') };
}

function saveLayout(usuarioId, widgets) {
  ensureTable();
  const existente = store.one(`SELECT id FROM user_dashboards WHERE usuario_id = ?`, [usuarioId]);
  if (existente) {
    store.run(`UPDATE user_dashboards SET widgets = ?, updated_at = datetime('now','localtime') WHERE usuario_id = ?`, [JSON.stringify(widgets), usuarioId]);
  } else {
    store.run(`INSERT INTO user_dashboards (usuario_id, widgets) VALUES (?, ?)`, [usuarioId, JSON.stringify(widgets)]);
  }
  return { ok: true };
}

function addWidget(usuarioId, widgetType, posicion = {}) {
  const layout = getLayout(usuarioId);
  const tipo = WIDGET_TYPES[widgetType];
  if (!tipo) return { ok: false, error: 'Tipo de widget no válido' };

  const widget = {
    id: `w_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: widgetType,
    ...tipo,
    x: posicion.x || 0,
    y: posicion.y || layout.widgets.length * 2,
    w: posicion.w || 1,
    h: posicion.h || 1,
  };

  layout.widgets.push(widget);
  saveLayout(usuarioId, layout.widgets);
  return { ok: true, widget };
}

function removeWidget(usuarioId, widgetId) {
  const layout = getLayout(usuarioId);
  layout.widgets = layout.widgets.filter(w => w.id !== widgetId);
  saveLayout(usuarioId, layout.widgets);
  return { ok: true };
}

function moveWidget(usuarioId, widgetId, newX, newY) {
  const layout = getLayout(usuarioId);
  const widget = layout.widgets.find(w => w.id === widgetId);
  if (widget) {
    widget.x = newX;
    widget.y = newY;
    saveLayout(usuarioId, layout.widgets);
  }
  return { ok: true };
}

function getWidgetTypes() {
  return Object.entries(WIDGET_TYPES).map(([id, w]) => ({ id, ...w }));
}

// Fetch data para cada tipo de widget
function fetchWidgetData(widgetType) {
  switch (widgetType) {
    case 'metric_leads': {
      const r = store.one(`SELECT COUNT(*) as total FROM leads WHERE status != 'cerrado'`);
      return { value: r ? r.total : 0, label: 'Leads activos' };
    }
    case 'metric_ventas': {
      const r = store.one(`SELECT COUNT(*) as total FROM leads WHERE etiqueta = 'vendido'`);
      return { value: r ? r.total : 0, label: 'Ventas totales' };
    }
    case 'metric_conversion': {
      const total = store.one(`SELECT COUNT(*) as t FROM leads WHERE status != 'cerrado'`);
      const vendidos = store.one(`SELECT COUNT(*) as t FROM leads WHERE etiqueta = 'vendido'`);
      const t = total ? total.t : 0;
      const v = vendidos ? vendidos.t : 0;
      return { value: t > 0 ? ((v / t) * 100).toFixed(1) + '%' : '0%', label: 'Conversión' };
    }
    case 'metric_respuesta': {
      return { value: '~15min', label: 'Tiempo promedio' };
    }
    case 'pipeline': {
      const etapas = store.all(`SELECT etiqueta, COUNT(*) as total FROM leads WHERE status != 'cerrado' GROUP BY etiqueta`);
      return { items: etapas };
    }
    case 'leads_calientes': {
      const leads = store.all(`SELECT id, customer_name, etiqueta FROM leads WHERE status != 'cerrado' ORDER BY updated_at DESC LIMIT 5`);
      return { items: leads };
    }
    case 'vendedores_ranking': {
      const v = store.all(`SELECT nombre, total_leads FROM vendedores WHERE estado = 'activo' ORDER BY total_leads DESC LIMIT 5`);
      return { items: v };
    }
    default:
      return { value: '—', label: widgetType };
  }
}

module.exports = {
  ensureTable,
  getLayout,
  saveLayout,
  addWidget,
  removeWidget,
  moveWidget,
  getWidgetTypes,
  fetchWidgetData,
  WIDGET_TYPES,
};
