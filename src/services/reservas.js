// Reservas con countdown timer y auto-vencimiento
// Cuando un lead pasa a "reservado", inicia un temporizador configurable.
// Si el vendedor no confirma la venta antes de que venza, el lead vuelve a "interesado"
// y se notifica al supervisor.

const store = require('../db/store');
const { notify } = require('./notify');
const log = require('../utils/logger');

const HORAS_DEFAULT = 48;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // cada 5 minutos

function ensureTable() {
  const db = store.getDB();
  db.exec(`
    CREATE TABLE IF NOT EXISTS reservas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL UNIQUE,
      lote_id INTEGER,
      proyecto_id INTEGER,
      vendedor_id INTEGER,
      horas_limite INTEGER DEFAULT ${HORAS_DEFAULT},
      fecha_inicio DATETIME DEFAULT (datetime('now','localtime')),
      fecha_vence DATETIME,
      estado TEXT DEFAULT 'activa' CHECK (estado IN ('activa', 'vencida', 'completada', 'cancelada')),
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (lead_id) REFERENCES leads(id),
      FOREIGN KEY (lote_id) REFERENCES lotes(id),
      FOREIGN KEY (proyecto_id) REFERENCES proyectos(id),
      FOREIGN KEY (vendedor_id) REFERENCES vendedores(id)
    );
    CREATE INDEX IF NOT EXISTS idx_reservas_estado ON reservas(estado);
    CREATE INDEX IF NOT EXISTS idx_reservas_lead ON reservas(lead_id);
    CREATE INDEX IF NOT EXISTS idx_reservas_vence ON reservas(fecha_vence);
  `);
}

function crearReserva(leadId, opts = {}) {
  ensureTable();
  const horas = opts.horas || HORAS_DEFAULT;
  const now = new Date();
  const vence = new Date(now.getTime() + horas * 60 * 60 * 1000);

  // Si ya tiene reserva activa, cancelar la anterior
  store.run(
    `UPDATE reservas SET estado = 'cancelada', updated_at = datetime('now','localtime') WHERE lead_id = ? AND estado = 'activa'`,
    [leadId]
  );

  store.run(
    `INSERT INTO reservas (lead_id, lote_id, proyecto_id, vendedor_id, horas_limite, fecha_inicio, fecha_vence, estado)
     VALUES (?, ?, ?, ?, ?, datetime('now','localtime'), ?, 'activa')`,
    [leadId, opts.loteId || null, opts.proyectoId || null, opts.vendedorId || null, horas, vence.toISOString()]
  );

  log.info('RESERVAS', `Reserva creada para lead ${leadId} — vence en ${horas}h`);

  return { ok: true, horas, fecha_vence: vence.toISOString() };
}

function confirmarVenta(reservaId) {
  ensureTable();
  const r = store.one(`SELECT * FROM reservas WHERE id = ?`, [reservaId]);
  if (!r) return { ok: false, error: 'Reserva no encontrada' };
  if (r.estado !== 'activa') return { ok: false, error: 'La reserva ya no está activa' };

  store.run(
    `UPDATE reservas SET estado = 'completada', updated_at = datetime('now','localtime') WHERE id = ?`,
    [reservaId]
  );

  log.info('RESERVAS', `Reserva ${reservaId} confirmada como venta`);
  return { ok: true };
}

function extenderReserva(reservaId, horasExtra) {
  ensureTable();
  const r = store.one(`SELECT * FROM reservas WHERE id = ?`, [reservaId]);
  if (!r || r.estado !== 'activa') return { ok: false, error: 'Reserva no encontrada o inactiva' };

  const actual = new Date(r.fecha_vence);
  const nueva = new Date(actual.getTime() + horasExtra * 60 * 60 * 1000);

  store.run(
    `UPDATE reservas SET fecha_vence = ?, horas_limite = horas_limite + ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    [nueva.toISOString(), horasExtra, reservaId]
  );

  log.info('RESERVAS', `Reserva ${reservaId} extendida ${horasExtra}h → vence ${nueva.toISOString()}`);
  return { ok: true, fecha_vence: nueva.toISOString() };
}

function cancelarReserva(reservaId) {
  ensureTable();
  store.run(
    `UPDATE reservas SET estado = 'cancelada', updated_at = datetime('now','localtime') WHERE id = ? AND estado = 'activa'`,
    [reservaId]
  );
  return { ok: true };
}

function obtenerReserva(leadId) {
  ensureTable();
  const r = store.one(
    `SELECT r.*, l.numero as lote_numero, p.nombre as proyecto_nombre, v.nombre as vendedor_nombre
     FROM reservas r
     LEFT JOIN lotes l ON r.lote_id = l.id
     LEFT JOIN proyectos p ON r.proyecto_id = p.id
     LEFT JOIN vendedores v ON r.vendedor_id = v.id
     WHERE r.lead_id = ? AND r.estado = 'activa'
     ORDER BY r.created_at DESC LIMIT 1`,
    [leadId]
  );
  if (!r) return null;

  const ahora = new Date();
  const vence = new Date(r.fecha_vence);
  const restanteMs = Math.max(0, vence.getTime() - ahora.getTime());
  const horas = Math.floor(restanteMs / 3600000);
  const minutos = Math.floor((restanteMs % 3600000) / 60000);

  return {
    ...r,
    tiempo_restante_horas: horas,
    tiempo_restante_minutos: minutos,
    expirada: restanteMs <= 0,
    urgente: horas < 4,
  };
}

function listarReservas(estado) {
  ensureTable();
  const where = estado ? `WHERE r.estado = '${estado}'` : `WHERE r.estado IN ('activa', 'vencida')`;
  return store.all(
     `SELECT r.*, l.numero as lote_numero, p.nombre as proyecto_nombre, v.nombre as vendedor_nombre,
            ld.customer_name as lead_nombre, ld.customer_phone as lead_telefono
     FROM reservas r
     LEFT JOIN lotes l ON r.lote_id = l.id
     LEFT JOIN proyectos p ON r.proyecto_id = p.id
     LEFT JOIN vendedores v ON r.vendedor_id = v.id
     LEFT JOIN leads ld ON r.lead_id = ld.id
     ${where}
     ORDER BY r.fecha_vence ASC`
  );
}

// Verificar reservas vencidas (llamar desde scheduler)
function verificarVencidas() {
  ensureTable();
  const vencidas = store.all(
    `SELECT r.*, v.nombre as vendedor_nombre, v.telefono as vendedor_telefono
     FROM reservas r
     LEFT JOIN vendedores v ON r.vendedor_id = v.id
     WHERE r.estado = 'activa' AND r.fecha_vence <= datetime('now','localtime')`
  );

  for (const r of vencidas) {
    store.run(
      `UPDATE reservas SET estado = 'vencida', updated_at = datetime('now','localtime') WHERE id = ?`,
      [r.id]
    );

    // Revertir lead a "interesado" si estaba como "negociacion" o "reservado"
    store.run(
      `UPDATE leads SET status = 'interesado', updated_at = datetime('now','localtime') WHERE id = ? AND status IN ('negociacion', 'reservado')`,
      [r.lead_id]
    );

    log.warn('RESERVAS', `Reserva ${r.id} vencida — lead ${r.lead_id} revertido`);

    // Notificar al supervisor y al vendedor
    const titulo = `Reserva vencida — Lead #${r.lead_id}`;
    const cuerpo = r.vendedor_nombre
      ? `La reserva de ${r.vendedor_nombre} venció sin confirmar venta.`
      : `La reserva del lead #${r.lead_id} venció.`;

    store.run(
      `INSERT INTO feed_events (tipo, categoria, actor_id, actor_nombre, lead_id, titulo, descripcion, payload)
       VALUES ('reserva_vencida', 'alertas', ?, ?, ?, ?, ?, ?)`,
      [r.vendedor_id || 0, r.vendedor_nombre || 'Sistema', r.lead_id, titulo, cuerpo, JSON.stringify({ reserva_id: r.id })]
    );

    // Notificar via SSE a admins
    try {
      const { emitToAdmins } = require('./events');
      emitToAdmins('notificacion', {
        id: r.id, tipo: 'reserva_vencida',
        titulo, cuerpo, leadId: r.lead_id, ts: Date.now()
      });
    } catch (e) { /* SSE no disponible */ }
  }

  return vencidas.length;
}

// Iniciar scheduler de verificación
let _interval = null;
function startScheduler() {
  if (_interval) return;
  _interval = setInterval(() => {
    try {
      const count = verificarVencidas();
      if (count > 0) log.info('RESERVAS', `${count} reserva(s) vencida(s) procesada(s)`);
    } catch (e) {
      log.error('RESERVAS', 'Error en scheduler de reservas', e.message);
    }
  }, CHECK_INTERVAL_MS);
  log.info('RESERVAS', 'Scheduler de reservas iniciado');
}

module.exports = {
  crearReserva,
  confirmarVenta,
  extenderReserva,
  cancelarReserva,
  obtenerReserva,
  listarReservas,
  verificarVencidas,
  startScheduler,
  ensureTable,
};
