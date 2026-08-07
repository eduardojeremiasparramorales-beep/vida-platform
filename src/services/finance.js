// Centro Financiero Básico
// Trackea ingresos, egresos, comisiones y P&L por proyecto.

const store = require('../db/store');
const log = require('../utils/logger');

function ensureTable() {
  const db = store.getDB();
  db.exec(`
    CREATE TABLE IF NOT EXISTS transacciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL CHECK (tipo IN ('ingreso', 'egreso')),
      categoria TEXT NOT NULL DEFAULT 'venta',
      concepto TEXT NOT NULL,
      monto REAL NOT NULL DEFAULT 0,
      moneda TEXT DEFAULT 'COP',
      proyecto_id INTEGER,
      lead_id INTEGER,
      vendedor_id INTEGER,
      fecha TEXT DEFAULT (date('now')),
      notas TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (proyecto_id) REFERENCES proyectos(id),
      FOREIGN KEY (lead_id) REFERENCES leads(id),
      FOREIGN KEY (vendedor_id) REFERENCES vendedores(id)
    );

    CREATE TABLE IF NOT EXISTS comisiones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vendedor_id INTEGER NOT NULL,
      lead_id INTEGER NOT NULL,
      monto_venta REAL NOT NULL,
      porcentaje REAL NOT NULL DEFAULT 5,
      monto_comision REAL NOT NULL,
      estado TEXT DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagada', 'cancelada')),
      fecha_calculo TEXT DEFAULT (date('now')),
      fecha_pago TEXT,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (vendedor_id) REFERENCES vendedores(id),
      FOREIGN KEY (lead_id) REFERENCES leads(id)
    );

    CREATE INDEX IF NOT EXISTS idx_transacciones_tipo ON transacciones(tipo);
    CREATE INDEX IF NOT EXISTS idx_transacciones_fecha ON transacciones(fecha);
    CREATE INDEX IF NOT EXISTS idx_transacciones_proyecto ON transacciones(proyecto_id);
    CREATE INDEX IF NOT EXISTS idx_comisiones_vendedor ON comisiones(vendedor_id);
    CREATE INDEX IF NOT EXISTS idx_comisiones_estado ON comisiones(estado);
  `);
}

// --- Transacciones ---
function crearTransaccion(data) {
  ensureTable();
  const { tipo, categoria, concepto, monto, moneda, proyectoId, leadId, vendedorId, fecha, notas } = data;
  const result = store.run(
    `INSERT INTO transacciones (tipo, categoria, concepto, monto, moneda, proyecto_id, lead_id, vendedor_id, fecha, notas)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [tipo, categoria || 'venta', concepto, monto, moneda || 'COP', proyectoId || null, leadId || null, vendedorId || null, fecha || new Date().toISOString().slice(0, 10), notas || '']
  );
  return { ok: true, id: result.lastInsertRowid };
}

function listarTransacciones(filtros = {}) {
  ensureTable();
  let where = [];
  let params = [];
  if (filtros.tipo) { where.push('tipo = ?'); params.push(filtros.tipo); }
  if (filtros.categoria) { where.push('categoria = ?'); params.push(filtros.categoria); }
  if (filtros.proyectoId) { where.push('proyecto_id = ?'); params.push(filtros.proyectoId); }
  if (filtros.vendedorId) { where.push('vendedor_id = ?'); params.push(filtros.vendedorId); }
  if (filtros.desde) { where.push('fecha >= ?'); params.push(filtros.desde); }
  if (filtros.hasta) { where.push('fecha <= ?'); params.push(filtros.hasta); }
  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return store.all(
    `SELECT t.*, p.nombre as proyecto_nombre, v.nombre as vendedor_nombre
     FROM transacciones t
     LEFT JOIN proyectos p ON t.proyecto_id = p.id
     LEFT JOIN vendedores v ON t.vendedor_id = v.id
     ${whereStr}
     ORDER BY t.fecha DESC, t.created_at DESC
     LIMIT ?`,
    [...params, filtros.limite || 200]
  );
}

function eliminarTransaccion(id) {
  ensureTable();
  store.run(`DELETE FROM transacciones WHERE id = ?`, [id]);
  return { ok: true };
}

// --- Comisiones ---
function calcularComision(vendedorId, leadId, montoVenta, porcentaje = 5) {
  ensureTable();
  const monto = montoVenta * (porcentaje / 100);
  const result = store.run(
    `INSERT INTO comisiones (vendedor_id, lead_id, monto_venta, porcentaje, monto_comision)
     VALUES (?, ?, ?, ?, ?)`,
    [vendedorId, leadId, montoVenta, porcentaje, monto]
  );
  log.info('FINANZAS', `Comisión calculada: $${monto.toLocaleString()} para vendedor ${vendedorId}`);
  return { ok: true, id: result.lastInsertRowid, monto };
}

function listarComisiones(filtros = {}) {
  ensureTable();
  let where = [];
  let params = [];
  if (filtros.vendedorId) { where.push('c.vendedor_id = ?'); params.push(filtros.vendedorId); }
  if (filtros.estado) { where.push('c.estado = ?'); params.push(filtros.estado); }
  if (filtros.desde) { where.push('c.fecha_calculo >= ?'); params.push(filtros.desde); }
  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return store.all(
    `SELECT c.*, v.nombre as vendedor_nombre, l.customer_name as lead_nombre
     FROM comisiones c
     LEFT JOIN vendedores v ON c.vendedor_id = v.id
     LEFT JOIN leads l ON c.lead_id = l.id
     ${whereStr}
     ORDER BY c.created_at DESC
     LIMIT ?`,
    [...params, filtros.limite || 200]
  );
}

function marcarComisionPagada(id) {
  ensureTable();
  store.run(`UPDATE comisiones SET estado = 'pagada', fecha_pago = date('now') WHERE id = ?`, [id]);
  return { ok: true };
}

// --- Dashboard Financiero ---
function obtenerResumen(filtros = {}) {
  ensureTable();
  const desde = filtros.desde || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const hasta = filtros.hasta || new Date().toISOString().slice(0, 10);

  const ingresos = store.one(
    `SELECT COALESCE(SUM(monto), 0) as total FROM transacciones WHERE tipo = 'ingreso' AND fecha BETWEEN ? AND ?`,
    [desde, hasta]
  );
  const egresos = store.one(
    `SELECT COALESCE(SUM(monto), 0) as total FROM transacciones WHERE tipo = 'egreso' AND fecha BETWEEN ? AND ?`,
    [desde, hasta]
  );
  const comisionesPendientes = store.one(
    `SELECT COALESCE(SUM(monto_comision), 0) as total FROM comisiones WHERE estado = 'pendiente'`
  );
  const comisionesPagadas = store.one(
    `SELECT COALESCE(SUM(monto_comision), 0) as total FROM comisiones WHERE estado = 'pagada' AND fecha_pago BETWEEN ? AND ?`,
    [desde, hasta]
  );

  // Ingresos por proyecto
  const porProyecto = store.all(
    `SELECT p.nombre, SUM(t.monto) as total
     FROM transacciones t
     LEFT JOIN proyectos p ON t.proyecto_id = p.id
     WHERE t.tipo = 'ingreso' AND t.fecha BETWEEN ? AND ?
     GROUP BY t.proyecto_id
     ORDER BY total DESC`,
    [desde, hasta]
  );

  // Ingresos vs egresos por mes (últimos 6 meses)
  const tendencia = store.all(
    `SELECT strftime('%Y-%m', fecha) as mes,
            SUM(CASE WHEN tipo = 'ingreso' THEN monto ELSE 0 END) as ingresos,
            SUM(CASE WHEN tipo = 'egreso' THEN monto ELSE 0 END) as egresos
     FROM transacciones
     WHERE fecha >= date('now', '-6 months')
     GROUP BY mes
     ORDER BY mes`
  );

  // Top vendedores por venta
  const topVendedores = store.all(
    `SELECT v.nombre, COUNT(*) as ventas, SUM(t.monto) as monto_total
     FROM transacciones t
     LEFT JOIN vendedores v ON t.vendedor_id = v.id
     WHERE t.tipo = 'ingreso' AND t.categoria = 'venta' AND t.fecha BETWEEN ? AND ?
     GROUP BY t.vendedor_id
     ORDER BY monto_total DESC
     LIMIT 5`,
    [desde, hasta]
  );

  return {
    periodo: { desde, hasta },
    ingresos: ingresos.total,
    egresos: egresos.total,
    utilidad: ingresos.total - egresos.total,
    margen: ingresos.total > 0 ? (((ingresos.total - egresos.total) / ingresos.total) * 100).toFixed(1) : '0',
    comisionesPendientes: comisionesPendientes.total,
    comisionesPagadas: comisionesPagadas.total,
    porProyecto,
    tendencia,
    topVendedores,
  };
}

module.exports = {
  ensureTable,
  crearTransaccion,
  listarTransacciones,
  eliminarTransaccion,
  calcularComision,
  listarComisiones,
  marcarComisionPagada,
  obtenerResumen,
};
