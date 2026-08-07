// Centro de Notificaciones Inteligente — Timeline de eventos
// Extiende el SSE events.js para persistir TODOS los eventos del sistema
// en una tabla consultable, creando un timeline completo.

const store = require('../db/store');
const log = require('../utils/logger');

function ensureTable() {
  const db = store.getDB();
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL,
      categoria TEXT NOT NULL DEFAULT 'operaciones',
      entidad TEXT DEFAULT '',
      entidad_id INTEGER,
      actor_id INTEGER,
      actor_nombre TEXT DEFAULT '',
      titulo TEXT NOT NULL,
      descripcion TEXT DEFAULT '',
      datos TEXT DEFAULT '{}',
      leido INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (actor_id) REFERENCES vendedores(id)
    );
    CREATE INDEX IF NOT EXISTS idx_system_events_tipo ON system_events(tipo);
    CREATE INDEX IF NOT EXISTS idx_system_events_categoria ON system_events(categoria);
    CREATE INDEX IF NOT EXISTS idx_system_events_created_at ON system_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_system_events_leido ON system_events(leido);
  `);
}

// Registrar un evento en el timeline
function registrarEvento(evt) {
  ensureTable();
  const {
    tipo,               // 'lead_nuevo', 'lead_respondio', 'asesor_tardó', 'reserva_vence', etc.
    categoria = 'operaciones', // 'operaciones', 'leads', 'ventas', 'ia', 'alertas', 'equipo'
    entidad = '',       // 'lead', 'conversacion', 'reserva', 'campana', etc.
    entidadId = null,
    actorId = null,
    actorNombre = '',
    titulo,
    descripcion = '',
    datos = {},
  } = evt;

  const result = store.run(
    `INSERT INTO system_events (tipo, categoria, entidad, entidad_id, actor_id, actor_nombre, titulo, descripcion, datos)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [tipo, categoria, entidad, entidadId, actorId, actorNombre, titulo, descripcion, JSON.stringify(datos)]
  );

  // También emitir via SSE para tiempo real
  try {
    const { emitToAdmins, emitToTodos } = require('./events');
    const ssePayload = {
      id: result.lastInsertRowid,
      tipo, categoria, titulo, descripcion,
      entidad, entidadId, actorId, actorNombre,
      datos, ts: Date.now()
    };
    emitToAdmins('evento', ssePayload);
    // Si es alerta crítica, emitir a todos
    if (categoria === 'alertas') emitToTodos('evento', ssePayload);
  } catch (e) { /* SSE no disponible */ }

  return result.lastInsertRowid;
}

// Obtener eventos (timeline)
function obtenerEventos(opts = {}) {
  ensureTable();
  const { tipo, categoria, entidad, desde, limite = 50, soloNoLeidos = false } = opts;
  let where = [];
  let params = [];

  if (tipo) { where.push('tipo = ?'); params.push(tipo); }
  if (categoria) { where.push('categoria = ?'); params.push(categoria); }
  if (entidad) { where.push('entidad = ?'); params.push(entidad); }
  if (desde) { where.push('created_at >= ?'); params.push(desde); }
  if (soloNoLeidos) { where.push('leido = 0'); }

  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return store.all(
    `SELECT * FROM system_events ${whereStr} ORDER BY created_at DESC LIMIT ?`,
    [...params, limite]
  );
}

// Contar no leídos
function contarNoLeidos() {
  ensureTable();
  const r = store.one(`SELECT COUNT(*) as total FROM system_events WHERE leido = 0`);
  return r ? r.total : 0;
}

// Marcar como leído
function marcarLeido(eventoId) {
  ensureTable();
  store.run(`UPDATE system_events SET leido = 1 WHERE id = ?`, [eventoId]);
}

// Marcar todos como leídos
function marcarTodosLeidos() {
  ensureTable();
  store.run(`UPDATE system_events SET leido = 1 WHERE leido = 0`);
}

// Helper: registrar eventos comunes del sistema
function onLeadNuevo(lead) {
  return registrarEvento({
    tipo: 'lead_nuevo',
    categoria: 'leads',
    entidad: 'lead',
    entidadId: lead.id,
    actorId: lead.assigned_to_id,
    titulo: `Nuevo lead: ${lead.customer_name || lead.customer_phone}`,
    descripcion: `Lead #${lead.id} asignado a ${lead.assigned_to_name || 'sin asesor'}`,
  });
}

function onLeadRespondio(lead, ultimoMensaje) {
  return registrarEvento({
    tipo: 'lead_respondio',
    categoria: 'leads',
    entidad: 'lead',
    entidadId: lead.id,
    actorId: lead.assigned_to_id,
    titulo: `${lead.customer_name || 'Cliente'} respondió`,
    descripcion: ultimoMensaje ? ultimoMensaje.slice(0, 100) : 'Mensaje recibido',
  });
}

function onAsesorTardó(lead, minutosEspera) {
  return registrarEvento({
    tipo: 'asesor_tardo',
    categoria: 'alertas',
    entidad: 'lead',
    entidadId: lead.id,
    actorId: lead.assigned_to_id,
    actorNombre: lead.assigned_to_name || '',
    titulo: `Asesor sin responder — ${minutosEspera} min`,
    descripcion: `${lead.customer_name || 'Cliente'} esperando respuesta hace ${minutosEspera} minutos`,
    datos: { minutos: minutosEspera },
  });
}

function onReservaVence(reserva, horasRestantes) {
  return registrarEvento({
    tipo: 'reserva_vence',
    categoria: 'alertas',
    entidad: 'reserva',
    entidadId: reserva.id,
    actorId: reserva.vendedor_id,
    actorNombre: reserva.vendedor_nombre || '',
    titulo: `Reserva vence en ${horasRestantes}h`,
    descripcion: `La reserva del lead #${reserva.lead_id} vence pronto`,
    datos: { horas_restantes: horasRestantes, lead_id: reserva.lead_id },
  });
}

function onVentaCerrada(lead, vendedor) {
  return registrarEvento({
    tipo: 'venta_cerrada',
    categoria: 'ventas',
    entidad: 'lead',
    entidadId: lead.id,
    actorId: vendedor ? vendedor.id : null,
    actorNombre: vendedor ? vendedor.nombre : '',
    titulo: `Venta cerrada — ${lead.customer_name || 'Cliente'}`,
    descripcion: `Lead #${lead.id} marcado como vendido`,
  });
}

function onCampanaResultado(campana, metricas) {
  return registrarEvento({
    tipo: 'campana_resultado',
    categoria: 'operaciones',
    entidad: 'campana',
    entidadId: campana.id,
    titulo: `Campaña "${campana.nombre}" — ${metricas.resumen}`,
    descripcion: `CTR: ${metricas.ctr}%, CPL: $${metricas.cpl}, Leads: ${metricas.leads}`,
    datos: metricas,
  });
}

function onMetaAlcanzada(vendedor, porcentaje) {
  return registrarEvento({
    tipo: 'meta_alcanzada',
    categoria: 'ventas',
    entidad: 'vendedor',
    entidadId: vendedor.id,
    actorId: vendedor.id,
    actorNombre: vendedor.nombre,
    titulo: `Meta al ${porcentaje}% — ${vendedor.nombre}`,
    descripcion: `${vendedor.nombre} alcanzó el ${porcentaje}% de su meta mensual`,
    datos: { porcentaje },
  });
}

module.exports = {
  ensureTable,
  registrarEvento,
  obtenerEventos,
  contarNoLeidos,
  marcarLeido,
  marcarTodosLeidos,
  onLeadNuevo,
  onLeadRespondio,
  onAsesorTardó,
  onReservaVence,
  onVentaCerrada,
  onCampanaResultado,
  onMetaAlcanzada,
};
