// Supervisor Center — API del rol supervisor.
//
// Montado en index.js como `app.use('/api/supervisor', auth.requireSupervisorOrAdmin, require('./api/supervisor'))`,
// el admin es superset del supervisor: puede ver todo y publicar al SP Feed.
// por lo que TODA ruta aquí abajo exige sesión con rol='supervisor' (no se mezcla con
// endpoints admin ni con vendedor). El supervisor reusa los servicios/store existentes
// — este router solo expresa endpoints agregados nuevos que no existen hoy:
//   - GET  /api/supervisor/                (S1: ping para verificar que la auth funciona)
//   - GET  /api/supervisor/me              (S1: sesión del supervisor + resumen de capacidades)
//   - GET  /api/supervisor/dashboard        (S2: métricas globales del equipo)
//   - GET  /api/supervisor/equipo           (S3: listado de asesores con métricas)
//   - POST /api/supervisor/reasignar/:leadId (S3: delega en store.assignLeadToVendedor)
//   - GET  /api/supervisor/conversaciones    (S4: inbox del equipo con filtros)
//   - GET  /api/supervisor/alertas           (S5: histórico de alertas del escalado)
//   - GET  /api/supervisor/feed           (S6: feed multimedia publicado por admin/supervisor)
//   - POST /api/supervisor/feed            (S6: publicar por URL)
//   - POST /api/supervisor/feed/upload     (S6: publicar subiendo archivo)
//   - GET  /api/supervisor/feed/media/:id  (S6: servir archivo subido con auth)
//   - DELETE /api/supervisor/feed/:id      (S6: soft delete)
//   - GET  /api/supervisor/analitica         (S8: embudo + series — Sprint 8)
//
// S1 expone ping + me; S2 /dashboard; S3 /equipo, /equipo/leads y /reasignar;
// S4 /conversaciones (el timeline se sirve desde los endpoints existentes, ya
// abiertos al supervisor en index.js). Los demás llegan con cada Sprint;
// mientras tanto, devuelven 501 Not Implemented — así el frontend puede probar
// la existencia de la ruta sin que parezca un bug de auth.

const express = require('express');
const router = express.Router();

const auth = require('../services/auth');
const store = require('../db/store');
const events = require('../services/events');
const { notify } = require('../services/notify');

// --- S1: ping de cableado ---
// Útil para verificar, desde el frontend o con curl, que la cookie sp_session
// autentica al supervisor correctamente (response.ok=204 → todo el cableado S1 anda).
router.get('/', (req, res) => {
  res.json({
    ok: true,
    rol: req.session.rol,
    vendedorId: req.session.vendedorId,
    nombre: req.session.nombre,
    sprints: ['me', 'dashboard', 'equipo', 'conversaciones', 'alertas', 'feed', 'analitica'],
  });
});

// --- S1: quién soy + listar mis capacidades ---
// Mismos datos que /api/me pero contextualizados al supervisor: lista las secciones
// del Supervisor Center que están activas en este despliegue (las que ya tienen su
// propio Sprint implementado). El frontend lo usa para habilitar/deshabilitar tabs.
router.get('/me', (req, res) => {
  const v = req.session.vendedorId ? store.getVendedorById(req.session.vendedorId) : null;
  const capacidades = [
    { id: 'me', sprint: 1, activo: true },
    { id: 'dashboard', sprint: 2, activo: true },
    { id: 'equipo', sprint: 3, activo: true },
    { id: 'conversaciones', sprint: 4, activo: true },
    { id: 'alertas', sprint: 5, activo: true },
    { id: 'feed', sprint: 6, activo: true },
    { id: 'ia', sprint: 7, activo: true },
    { id: 'analitica', sprint: 8, activo: true },
  ];
  res.json({
    nombre: req.session.nombre,
    rol: req.session.rol,
    vendedorId: req.session.vendedorId,
    telefono: v ? v.telefono : null,
    foto: v ? (v.foto || null) : null,
    estado: v ? v.estado : null,
    capacidades,
  });
});

// --- Helper: IDs de vendedores que NO son asesores (admin/supervisor) ---
// Misma regla que el round-robin de getVendedoresActivos(): el supervisor nunca
// debe ver al admin ni a sí mismo como parte del equipo de asesores.
function idsNoAsesores() {
  const excl = new Set();
  try {
    const r = store.getDB().exec("SELECT vendedor_id FROM usuarios WHERE rol IN ('admin','supervisor','jefe') AND vendedor_id IS NOT NULL");
    if (r && r.length) r[0].values.forEach(row => excl.add(Number(row[0])));
  } catch (e) { /* noop */ }
  return excl;
}

// --- S2: Dashboard global del equipo ---
// Devuelve una snapshot agregada lista para pintar el dashboard del supervisor:
//   - KPIs globales (leads totales, activos, sin responder, vendidos, conversion)
//   - Embudo (porEtiqueta: sin_clasificar → vendido, distribución de la pipeline)
//   - Ranking de asesores (usando getInsigniaStats, que ya ordena por ventas del mes)
//   - Alertas vivas (leads sin responder hace 30+ minutos y 60+ minutos)
// Reusa store.js — cero SQL nueva. Datos del mismo tenant que el request (multi-tenant
// ya cableado por el middleware de index.js vía AsyncLocalStorage del adapter).
router.get('/dashboard', (req, res) => {
  try {
    const agg = store.getLeadAggregates();
    const { total, porEtiqueta, porEstado, porVendedor, respondidos, sumaRespuestaMin } = agg;
    const vendidosTotal = porEtiqueta['vendido'] || 0;
    const activosTotal = total - (porEstado['cerrado'] || 0);

    // Alertas vivas (los mismos dos cortes que el scheduler de escalado del admin)
    let sinResponder = 0;
    try {
      const r = store.getDB().exec("SELECT COUNT(*) FROM leads WHERE first_response_at IS NULL AND COALESCE(status,'') != 'cerrado'");
      sinResponder = (r && r.length && r[0].values.length) ? Number(r[0].values[0][0]) : 0;
    } catch (e) { /* noop */ }

    // IDs a excluir del "equipo" del supervisor: vendedores que en realidad son
    // admin o supervisor (misma regla que el round-robin de getVendedoresActivos).
    const excl = idsNoAsesores();

    // Ranking por asesor desde getInsigniaStats (ya mapeado y ordenado en store.js)
    let ranking = [];
    try {
      const stats = store.getInsigniaStats() || [];
      ranking = stats.filter(s => !excl.has(Number(s.vendedor_id))).map(s => ({
        vendedorId: s.vendedor_id,
        nombre: s.nombre,
        vendidos: Number(s.vendidos) || 0,
        vendidosMes: Number(s.vendidos_mes) || 0,
        activos: Number(s.activos) || 0,
      })).sort((a, b) => (b.vendidosMes - a.vendidosMes) || (b.vendidos - a.vendidos));
    } catch (e) { /* getInsigniaStats podría no tener datos */ }

    // Por vendedor con métricas individuales (rico para la vista de Equipo en S3)
    const equipo = (porVendedor || []).filter(v => !excl.has(Number(v.id))).map(v => ({
      id: v.id, nombre: v.nombre, estado: v.estado,
      total: v.total, activos: v.activos, vendidos: v.vendidos,
      conversion: v.conversion,
    }));

    // Tiempo de respuesta promedio del negocio (en minutos, redondeado)
    const tiempoRespuestaPromedio = respondidos ? Math.round(sumaRespuestaMin / respondidos) : null;

    res.json({
      kpis: {
        totalLeads: total,
        leadsActivos: activosTotal,
        leadsSinResponder: sinResponder,
        vendidos: vendidosTotal,
        conversionGlobal: total ? Math.round((vendidosTotal / total) * 100) : 0,
        tiempoRespuestaPromedio,
        respondidos,
        totalAsesores: equipo.length,
      },
      embudo: {
        sin_clasificar: porEtiqueta['sin_clasificar'] || 0,
        interesado: porEtiqueta['interesado'] || 0,
        negociacion: porEtiqueta['negociacion'] || 0,
        cita: porEtiqueta['cita'] || 0,
        vendido: vendidosTotal,
        no_interesado: porEtiqueta['no_interesado'] || 0,
      },
      equipo,
      ranking,
      generadoEn: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[SUPERVISOR] dashboard error:', e.message);
    res.status(500).json({ error: 'error_dashboard', detalle: e.message });
  }
});
// --- S3: Equipo — listado de asesores con métricas individuales ---
// Cada asesor: contadores de pipeline (insignias), estado, actividad de hoy y
// tasa de respuesta. Ordenado por cierres del mes → cierres totales (ranking).
router.get('/equipo', (req, res) => {
  try {
    const excl = idsNoAsesores();
    // Un solo query de insignias y un join en memoria (evita N+1 por asesor)
    const stats = {};
    (store.getInsigniaStats() || []).forEach(s => { stats[Number(s.vendedor_id)] = s; });

    const asesores = (store.getVendedores() || [])
      .filter(v => !excl.has(Number(v.id)))
      .map(v => {
        const s = stats[Number(v.id)] || {};
        const m = store.getVendedorMetricas(v.id);
        const total = Number(v.total_leads) || 0;
        const vendidos = Number(s.vendidos) || 0;
        return {
          id: v.id,
          nombre: v.nombre,
          telefono: v.telefono,
          estado: v.estado,
          foto: v.foto || null,
          total,
          activos: Number(s.activos) || 0,
          pendientes: Number(s.pendientes) || 0,
          vendidos,
          vendidosMes: Number(s.vendidos_mes) || 0,
          respondidos: Number(s.respondidos) || 0,
          leadsHoy: m.leadsHoy,
          leadsCerrados: m.leadsCerrados,
          tasaRespuesta: m.tasaRespuesta,
          conversion: total ? Math.round((vendidos / total) * 100) : 0,
          ultimaActividad: m.ultimaActividad,
        };
      })
      .sort((a, b) => (b.vendidosMes - a.vendidosMes) || (b.vendidos - a.vendidos) || a.nombre.localeCompare(b.nombre));

    res.json({ asesores, generadoEn: new Date().toISOString() });
  } catch (e) {
    console.error('[SUPERVISOR] equipo error:', e.message);
    res.status(500).json({ error: 'error_equipo', detalle: e.message });
  }
});

// --- S3: Leads activos de un asesor (para el picker de reasignación) ---
// Reusa getAdminInbox del store (el mismo query que el inbox del admin) y filtra
// solo los leads no cerrados. Sin paginación propia: limite 300 es suficiente
// para la operación manual de un supervisor.
router.get('/equipo/leads', (req, res) => {
  try {
    const asesorId = Number(req.query.asesorId);
    if (!asesorId) return res.status(400).json({ error: 'asesor_requerido' });
    const asesor = store.getVendedorById(asesorId);
    if (!asesor) return res.status(404).json({ error: 'asesor_no_existe' });
    const rows = store.getAdminInbox({ vendedorId: asesorId, limite: 300 }) || [];
    res.json({
      asesor: { id: asesor.id, nombre: asesor.nombre },
      leads: rows
        .filter(l => String(l.status || '') !== 'cerrado')
        .map(l => ({
          id: l.id,
          nombre: l.customer_name,
          telefono: l.customer_phone,
          etiqueta: l.etiqueta || 'sin_clasificar',
          status: l.status || 'nuevo',
          unread: Number(l.unread_count) || 0,
          temperatura: l.temperatura || null,
          creado: l.created_at,
          actualizado: l.updated_at,
        })),
    });
  } catch (e) {
    console.error('[SUPERVISOR] equipo/leads error:', e.message);
    res.status(500).json({ error: 'error_equipo_leads', detalle: e.message });
  }
});

// --- S3: Reasignar un lead entre asesores ---
// Espejo del endpoint admin /api/leads/:id/reasignar pero restringido a asesores
// reales (excluye admin/supervisor) y con los mismos efectos secundarios:
// reassignLead() en store + SSE a ambos vendedores y admins + notificación push.
router.post('/reasignar/:leadId', (req, res) => {
  try {
    const lead = store.getLeadById(req.params.leadId);
    if (!lead) return res.status(404).json({ error: 'lead_no_existe' });
    if (String(lead.status || '') === 'cerrado') return res.status(400).json({ error: 'lead_cerrado' });

    const excl = idsNoAsesores();
    const vendedorId = Number((req.body || {}).vendedorId);
    const vendedor = (store.getVendedores() || []).find(v => Number(v.id) === vendedorId && !excl.has(Number(v.id)));
    if (!vendedor) return res.status(400).json({ error: 'vendedor_no_existe' });
    if (String(vendedor.estado) !== 'activo') return res.status(400).json({ error: 'vendedor_inactivo' });
    if (Number(lead.assigned_to_id) === Number(vendedor.id)) return res.status(400).json({ error: 'mismo_asesor' });

    const anteriorId = lead.assigned_to_id;
    const vendedorAnterior = anteriorId ? (store.getVendedores() || []).find(v => Number(v.id) === Number(anteriorId)) : null;
    store.reassignLead(lead.id, vendedor, anteriorId);

    events.emitToVendedor(vendedor.id, 'nuevo_mensaje', { leadId: lead.id, tipo: 'reasignado', ts: Date.now() });
    if (anteriorId) events.emitToVendedor(anteriorId, 'nuevo_mensaje', { leadId: lead.id, tipo: 'reasignado', ts: Date.now() });
    events.emitToAdmins('lead_actualizado', { leadId: lead.id, tipo: 'reasignado', ts: Date.now() });
    try {
      require('../services/activity').logReasignacion({
        leadId: lead.id, customerName: lead.customer_name,
        de: vendedorAnterior ? vendedorAnterior.nombre : null,
        a: vendedor.nombre, actorNombre: req.session.nombre,
      });
    } catch (e) { /* feed opcional */ }
    notify({ vendedorId: vendedor.id, tipo: 'lead_asignado', leadId: lead.id, push: true,
      titulo: '🆕 Lead asignado a ti', cuerpo: `${lead.customer_name} (${lead.customer_phone})` }).catch(() => {});
    if (anteriorId && Number(anteriorId) !== Number(vendedor.id)) {
      notify({ vendedorId: anteriorId, tipo: 'lead_reasignado', leadId: lead.id, push: true,
        titulo: '🔄 Lead reasignado', cuerpo: `${lead.customer_name} pasó a ${vendedor.nombre}.` }).catch(() => {});
    }

    console.log(`[SUPERVISOR] Reasignado lead ${lead.id} (${lead.customer_name}): vendedor ${anteriorId || '—'} → ${vendedor.id} por ${req.session.nombre}`);
    res.json({ ok: true, leadId: lead.id, vendedor: { id: vendedor.id, nombre: vendedor.nombre } });
  } catch (e) {
    console.error('[SUPERVISOR] reasignar error:', e.message);
    res.status(500).json({ error: 'error_reasignar', detalle: e.message });
  }
});

// --- S4: Conversaciones en vivo — inbox del equipo con filtros ---
// Reusa getUnifiedConversations (legacy leads + multicanal) y filtra en memoria:
//   - busqueda: nombre o teléfono del cliente
//   - vendedorId: solo las de un asesor
//   - etiqueta: etapa del pipeline ('todos' = sin filtro)
//   - soloSinResponder=1: solo conversaciones con mensajes entrantes sin leer
//   - canal: whatsapp | messenger | instagram
// El timeline de cada ítem lo consume el frontend desde los endpoints ya existentes
// (/api/leads/:id/mensajes y /api/inbox/conversations/:id/timeline), abiertos al
// supervisor en index.js (lectura global + cerrar leads).
router.get('/conversaciones', (req, res) => {
  try {
    const { busqueda, vendedorId, etiqueta, soloSinResponder, canal } = req.query;
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const offset = Number(req.query.offset) || 0;
    const items = store.getUnifiedConversations({ busqueda, vendedorId, limite: 300 }) || [];
    const conversaciones = items.filter(it => {
      if (String(it.status || '') === 'cerrado') return false;
      if (String(it.lead_status || '') === 'cerrado') return false;
      if (etiqueta && etiqueta !== 'todos' && String(it.etiqueta || 'sin_clasificar') !== String(etiqueta)) return false;
      if (soloSinResponder === '1' && Number(it.unread_count || 0) === 0) return false;
      if (canal && String(it.channel || 'whatsapp') !== String(canal)) return false;
      return true;
    });
    const pagina = conversaciones.slice(offset, offset + limit);
    res.json({ conversaciones: pagina, total: conversaciones.length, limit, offset, generadoEn: new Date().toISOString() });
  } catch (e) {
    console.error('[SUPERVISOR] conversaciones error:', e.message);
    res.status(500).json({ error: 'error_conversaciones', detalle: e.message });
  }
});

// ── S5: Alertas — panel de monitoreo de eventos del equipo ─────────────────
// Notificaciones del canal de supervisión (vendedor_id = 0) generadas por el
// sistema (asignaciones, escalamientos, mensajes programados, errores, etc.).
// El supervisor NO puede crear alertas manuales — solo administradores.
// ────────────────────────────────────────────────────────────────────────────

// GET /api/supervisor/alertas — historial paginado con filtros
router.get('/alertas', (req, res) => {
  try {
    const tipos = (req.query.tipo || '')
      .split(',')
      .map(s => String(s).trim())
      .filter(Boolean);
    const soloSinLeer = req.query.leidas === '0';
    const leerLeidas = req.query.leidas === '1';
    const desde = Number(req.query.desde) || 0;
    const limit = Math.min(Number(req.query.limite) || 50, 100);

    const todas = store.getNotifications(0, 200);
    let filtradas = todas.filter(n => Number(n.created_at) >= desde);

    if (leerLeidas) filtradas = filtradas.filter(n => n.leida);
    else if (soloSinLeer) filtradas = filtradas.filter(n => !n.leida);

    if (tipos.length > 0) filtradas = filtradas.filter(n => tipos.includes(String(n.tipo)));

    // Resumen por tipo (conteos de todas, no filtradas)
    const conteo = {};
    for (const n of todas) conteo[n.tipo] = (conteo[n.tipo] || 0) + 1;

    res.json({
      alertas: filtradas.slice(0, limit),
      total: filtradas.length,
      limite: limit,
      conteoPorTipo: conteo,
      generadoEn: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[SUPERVISOR] alertas error:', e.message);
    res.status(500).json({ error: 'error_alertas', detalle: e.message });
  }
});

// GET /api/supervisor/alertas/sin-leer — conteo para badge del NAV
router.get('/alertas/sin-leer', (_req, res) => {
  try {
    const n = store.countUnreadNotifications(0);
    res.json({ sin_leer: n });
  } catch (e) {
    console.error('[SUPERVISOR] alertas/sin-leer error:', e.message);
    res.status(500).json({ error: 'error_sin_leer', detalle: e.message });
  }
});

// POST /api/supervisor/alertas/marcar-todas
router.post('/alertas/marcar-todas', (_req, res) => {
  try {
    store.markAllNotificationsRead(0);
    res.json({ ok: true });
  } catch (e) {
    console.error('[SUPERVISOR] alertas/marcar-todas error:', e.message);
    res.status(500).json({ error: 'error_marcar_todas', detalle: e.message });
  }
});

// POST /api/supervisor/alertas/:id/leer
router.post('/alertas/:id/leer', (req, res) => {
  try {
    store.markNotificationRead(req.params.id, 0);
    res.json({ ok: true });
  } catch (e) {
    console.error('[SUPERVISOR] alertas/leer error:', e.message);
    res.status(500).json({ error: 'error_leer', detalle: e.message });
  }
});

// ── S6: SP Feed — contenido multimedia de marca ─────────────────────────────
// Reels/fotos/enlaces sobre lotes, trafficker y el día a día del equipo.
// Publican admin y supervisor (el router se monta con requireSupervisorOrAdmin).
// Archivos subidos → data/feed/ (volumen persistente del contenedor), servidos
// por GET /feed/media/:id con auth. URL externas (YouTube/Instagram/Drive) se
// guardan como media_url y el frontend las embeche/abra.
// ────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const FEED_DIR = path.join(__dirname, '..', '..', 'data', 'feed');
try { fs.mkdirSync(FEED_DIR, { recursive: true }); } catch (e) { console.error('[FEED] mkdir:', e.message); }

const FEED_MIME_OK = {
  'image/jpeg': 'imagen', 'image/png': 'imagen', 'image/webp': 'imagen', 'image/gif': 'imagen',
  'video/mp4': 'video', 'video/webm': 'video', 'video/quicktime': 'video',
};

const feedUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, FEED_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname || '').slice(0, 10)}`),
  }),
  limits: { fileSize: 80 * 1024 * 1024 }, // 80MB (reels cortos)
  fileFilter: (req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    if (FEED_MIME_OK[mime]) cb(null, true);
    else cb(new Error('tipo_no_soportado: solo imagenes (jpeg/png/webp/gif) y videos (mp4/webm/mov)'));
  },
});

// GET /api/supervisor/feed — lista con filtros
router.get('/feed', (req, res) => {
  try {
    const { categoria, tipo, busqueda, limite } = req.query;
    const items = store.getFeedItems({ categoria, tipo, busqueda, limite }) || [];
    const itemsPub = items.map(it => ({
      id: it.id, titulo: it.titulo, descripcion: it.descripcion,
      tipo: it.tipo, categoria: it.categoria,
      media_url: it.media_url || '', media_mime: it.media_mime || '', media_filename: it.media_filename || '',
      autor: it.autor, created_at: it.created_at,
      // El archivo local NO se expone como path crudo: se sirve por media/:id
      mediaId: it.media_path ? it.id : null,
    }));
    res.json({ items: itemsPub, total: itemsPub.length, generadoEn: new Date().toISOString() });
  } catch (e) {
    console.error('[SUPERVISOR] feed error:', e.message);
    res.status(500).json({ error: 'error_feed', detalle: e.message });
  }
});

// POST /api/supervisor/feed — publicar por URL (YouTube, Instagram, Drive, etc.)
router.post('/feed', (req, res) => {
  try {
    const { titulo, descripcion = '', tipo, categoria = 'cultura', mediaUrl = '' } = req.body || {};
    if (!titulo || !String(titulo).trim()) return res.status(400).json({ error: 'titulo_requerido' });
    if (!['video', 'imagen', 'link'].includes(tipo)) return res.status(400).json({ error: 'tipo_invalido' });
    if (!mediaUrl || !String(mediaUrl).trim()) return res.status(400).json({ error: 'url_requerida' });

    const item = store.createFeedItem({
      titulo: String(titulo).trim(), descripcion: String(descripcion).trim(),
      tipo, categoria, mediaUrl: String(mediaUrl).trim(),
      autor: req.session.nombre, creadoPor: req.session.vendedorId,
    });
    events.emitToAdmins('feed', { id: item.id, titulo: item.titulo, tipo: item.tipo, categoria: item.categoria, ts: Date.now() });
    console.log(`[SUPERVISOR] Feed publicado "${item.titulo}" (${item.tipo}/${item.categoria}) por ${req.session.nombre}`);
    res.json({ ok: true, item });
  } catch (e) {
    console.error('[SUPERVISOR] feed crear error:', e.message);
    res.status(500).json({ error: 'error_feed_crear', detalle: e.message });
  }
});

// POST /api/supervisor/feed/upload — publicar subiendo un archivo local
router.post('/feed/upload', feedUpload.single('archivo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'archivo_requerido' });
    const mime = String(req.file.mimetype || '').toLowerCase();
    const tipoAuto = FEED_MIME_OK[mime] === 'video' ? 'video' : 'imagen';
    const { titulo, descripcion = '', categoria = 'cultura', tipo } = req.body || {};
    if (!titulo || !String(titulo).trim()) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(400).json({ error: 'titulo_requerido' });
    }

    const item = store.createFeedItem({
      titulo: String(titulo).trim(), descripcion: String(descripcion).trim(),
      tipo: tipo && ['video', 'imagen'].includes(tipo) ? tipo : tipoAuto,
      categoria, mediaPath: req.file.filename, mediaMime: mime, mediaFilename: req.file.originalname,
      autor: req.session.nombre, creadoPor: req.session.vendedorId,
    });
    events.emitToAdmins('feed', { id: item.id, titulo: item.titulo, tipo: item.tipo, categoria: item.categoria, ts: Date.now() });
    console.log(`[SUPERVISOR] Feed upload "${item.titulo}" (${item.tipo}/${item.categoria}, ${mime}, ${req.file.size}b) por ${req.session.nombre}`);
    res.json({ ok: true, item });
  } catch (e) {
    console.error('[SUPERVISOR] feed upload error:', e.message);
    if (req.file && req.file.path) { try { fs.unlinkSync(req.file.path); } catch (z) {} }
    res.status(500).json({ error: 'error_feed_upload', detalle: e.message });
  }
});

// GET /api/supervisor/feed/media/:id — sirve el archivo subido (con auth)
router.get('/feed/media/:id', (req, res) => {
  try {
    const item = store.getFeedItemById(req.params.id);
    if (!item || !item.media_path) return res.status(404).json({ error: 'no_encontrado' });
    const fp = path.join(FEED_DIR, path.basename(item.media_path));
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'archivo_borrado' });
    const mime = item.media_mime || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(fp);
  } catch (e) {
    console.error('[SUPERVISOR] feed media error:', e.message);
    res.status(500).json({ error: 'error_feed_media', detalle: e.message });
  }
});

// DELETE /api/supervisor/feed/:id — soft delete (quita del feed, conserva archivo)
router.delete('/feed/:id', (req, res) => {
  try {
    const ok = store.deleteFeedItem(req.params.id);
    if (!ok) return res.status(404).json({ error: 'no_encontrado' });
    console.log(`[SUPERVISOR] Feed item ${req.params.id} eliminado por ${req.session.nombre}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[SUPERVISOR] feed delete error:', e.message);
    res.status(500).json({ error: 'error_feed_delete', detalle: e.message });
  }
});

// --- Stubs para próximos sprints (501 hasta que el Sprint correspondiente los implemente) ---
const stub = (id, sprint) => (req, res) => res.status(501).json({ error: 'no_implementado', seccion: id, sprint });

// --- SP Feed — actividad de la empresa en tiempo real -------------------------
// Feed social interno: cada evento operativo (lead asignado, respuesta, etapa,
// venta, reasignación, alerta, asesor conectado, post de capacitación) es una
// publicación cronológica con actor, título, descripción, payload y reacciones.
// Convive con el S6 multimedia (GET /feed sobre sp_feed): este es /feed/actividad.
// -----------------------------------------------------------------------------

// GET /api/supervisor/feed/actividad — historial paginado por cursor (scroll infinito)
router.get('/feed/actividad', (req, res) => {
  try {
    const categoria = String(req.query.categoria || 'todos');
    const antesId = Number(req.query.antesId) || null;
    const limite = Math.min(Number(req.query.limite) || 40, 100);
    const eventos = store.getFeedEvents({ categoria, antesId, limite }) || [];
    const conReacciones = eventos.map(ev => ({
      id: ev.id, tipo: ev.tipo, categoria: ev.categoria,
      actorId: ev.actor_id, actorNombre: ev.actor_nombre,
      leadId: ev.lead_id, conversationId: ev.conversation_id,
      entidadTipo: ev.entidad_tipo, entidadId: ev.entidad_id,
      titulo: ev.titulo, descripcion: ev.descripcion,
      payload: (() => { try { return JSON.parse(ev.payload || '{}'); } catch (e) { return {}; } })(),
      reacciones: store.getFeedReactionsForEvent(ev.id) || [],
      createdAt: ev.created_at,
    }));
    res.json({ eventos: conReacciones, limite, generadoEn: new Date().toISOString() });
  } catch (e) {
    console.error('[SUPERVISOR] feed error:', e.message);
    res.status(500).json({ error: 'error_feed', detalle: e.message });
  }
});

// POST /api/supervisor/feed/post — publicar capacitación / anuncio interno
// Accesible también al admin (el mount del router usa requireSupervisorOrAdmin).
router.post('/feed/post', (req, res) => {
  try {
    const { titulo, descripcion, categoria } = req.body || {};
    if (!titulo || !String(titulo).trim()) return res.status(400).json({ error: 'titulo_requerido' });
    if (String(titulo).length > 160) return res.status(400).json({ error: 'titulo_muy_largo' });
    if (String(descripcion || '').length > 2000) return res.status(400).json({ error: 'descripcion_muy_larga' });
    const cat = String(categoria || 'capacitacion');
    if (!['capacitacion', 'anuncio'].includes(cat)) return res.status(400).json({ error: 'categoria_invalida' });

    const ev = require('../services/activity').logPost({
      actorId: req.session.vendedorId, actorNombre: req.session.nombre,
      titulo: String(titulo).trim(), descripcion: String(descripcion || '').trim(), categoria: cat,
    });
    if (!ev) return res.status(500).json({ error: 'error_crear_post' });
    res.json({ ok: true, id: ev.id });
  } catch (e) {
    console.error('[SUPERVISOR] feed/post error:', e.message);
    res.status(500).json({ error: 'error_post', detalle: e.message });
  }
});

// POST /api/supervisor/feed/:id/reaccion — felicitar/reaccionar a una publicación
// Guarda la reacción y notifica (con push) al asesor protagonista del evento.
router.post('/feed/:id/reaccion', (req, res) => {
  try {
    const { emoji } = req.body || {};
    if (!emoji || !/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2764}\u{1F440}]$/u.test(String(emoji))) {
      return res.status(400).json({ error: 'emoji_invalido' });
    }
    const ev = store.getFeedEventById(req.params.id);
    if (!ev) return res.status(404).json({ error: 'evento_no_existe' });

    store.addFeedReaction(ev.id, req.session.vendedorId, req.session.nombre, String(emoji));
    // Reconocimiento al asesor protagonista (si el evento tiene actor y no es quien reacciona)
    if (ev.actor_id && Number(ev.actor_id) !== Number(req.session.vendedorId)) {
      notify({
        vendedorId: ev.actor_id, tipo: 'reconocimiento', leadId: ev.lead_id, push: true,
        titulo: `${String(emoji)} ${req.session.nombre} te felicitó`,
        cuerpo: `${ev.titulo} — ${String(ev.descripcion || '').slice(0, 80)}`,
      }).catch(() => {});
    }
    res.json({ ok: true, reacciones: store.getFeedReactionsForEvent(ev.id) || [] });
  } catch (e) {
    console.error('[SUPERVISOR] feed reaccion error:', e.message);
    res.status(500).json({ error: 'error_reaccion', detalle: e.message });
  }
});

// --- S8: Analítica del equipo ---
// Embudo + serie temporal + canales + ranking en el período indicado.
// Todo calculado en store.js sobre el mismo tenant del request.
router.get('/analitica', (req, res) => {
  try {
    const periodo = Math.min(Math.max(parseInt(req.query.periodo, 10) || 30, 1), 365);
    const asesorId = req.query.asesorId ? parseInt(req.query.asesorId, 10) : null;

    const agg = store.getLeadAggregates();
    const { total, porEtiqueta, porEstado, porVendedor } = agg;
    const vendidosTotal = porEtiqueta['vendido'] || 0;
    const activosTotal = total - (porEstado['cerrado'] || 0);

    const serie = (store.getLeadSeries({ dias: periodo, vendedorId: asesorId }) || []).map(r => ({
      dia: r.dia,
      entrantes: Number(r.entrantes) || 0,
      vendidos: Number(r.vendidos) || 0,
      cerrados: Number(r.cerrados) || 0,
    }));

    const canales = (store.getCanalDistribution() || []).map(r => ({
      canal: r.channel || 'whatsapp',
      n: Number(r.n) || 0,
    }));

    const excl = idsNoAsesores();
    const ranking = (store.getInsigniaStats() || [])
      .filter(s => !excl.has(Number(s.vendedor_id)))
      .filter(s => !asesorId || Number(s.vendedor_id) === asesorId)
      .map(s => ({
        vendedorId: s.vendedor_id,
        nombre: s.nombre,
        total: Number(s.total) || Number(s.activos) || 0,
        vendidos: Number(s.vendidos) || 0,
        vendidosMes: Number(s.vendidos_mes) || 0,
        activos: Number(s.activos) || 0,
        conversion: s.total ? Math.round((Number(s.vendidos) || 0) / s.total * 100) : 0,
      }))
      .sort((a, b) => (b.vendidosMes - a.vendidosMes) || (b.vendidos - a.vendidos));

    const embudo = Object.entries(porEtiqueta || {}).map(([etiqueta, n]) => ({ etiqueta, n }))
      .sort((a, b) => b.n - a.n);

    res.json({
      periodo,
      resumen: {
        totalLeads: total,
        leadsActivos: activosTotal,
        vendidos: vendidosTotal,
        conversionGlobal: total ? Math.round((vendidosTotal / total) * 100) : 0,
        leadsEnPeriodo: serie.reduce((a, r) => a + r.entrantes, 0),
        vendidosEnPeriodo: serie.reduce((a, r) => a + r.vendidos, 0),
      },
      serie,
      canales,
      embudo,
      ranking,
    });
  } catch (e) {
    console.error('[SUPERVISOR] analitica error:', e.message);
    res.status(500).json({ error: 'error_analitica', detalle: e.message });
  }
});

// --- S8: Export CSV de leads en el período ---
router.get('/analitica/export', (req, res) => {
  try {
    const periodo = Math.min(Math.max(parseInt(req.query.periodo, 10) || 30, 1), 365);
    const asesorId = req.query.asesorId ? parseInt(req.query.asesorId, 10) : null;
    const rows = store.getLeadsExport({ dias: periodo, vendedorId: asesorId }) || [];

    const csvEsc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lineas = [
      ['ID', 'Creado', 'Nombre', 'Telefono', 'Etiqueta', 'Estado', 'Asesor', 'Primera respuesta', 'Ultima actualizacion']
        .map(csvEsc).join(','),
      ...rows.map(r => [r.id, r.created_at, r.customer_name, r.customer_phone, r.etiqueta, r.status, r.asesor, r.first_response_at, r.updated_at].map(csvEsc).join(',')),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="analitica-leads-${periodo}d.csv"`);
    res.send('\uFEFF' + lineas.join('\r\n'));
  } catch (e) {
    console.error('[SUPERVISOR] analitica export error:', e.message);
    res.status(500).json({ error: 'error_export', detalle: e.message });
  }
});

// --- S7: IA Copiloto del supervisor ---
// Estado: si hay proveedor con API key y qué modelo usaría.
router.get('/copiloto/estado', (req, res) => {
  try {
    const nlp = require('../services/nlp');
    const provider = nlp.getProviders().find(p => p.apiKey);
    res.json({
      activo: nlp.isAIEnabled(),
      proveedor: provider ? provider.id : null,
      modelo: nlp.getModel(),
      sugerencias: [
        '¿Qué asesor necesita más apoyo hoy?',
        'Resumen del equipo en una frase',
        '¿Cuántos leads están sin responder?',
        'Top 3 del ranking de ventas',
        '¿Qué canal trae más leads?',
      ],
    });
  } catch (e) {
    console.error('[SUPERVISOR] copiloto estado error:', e.message);
    res.status(500).json({ error: 'error_estado', detalle: e.message });
  }
});

// --- S7: IA Copiloto — consulta con contexto real del equipo ---
// Construye una snapshot del equipo y la inyecta al LLM. Sin API key configurada
// responde con reglas locales (sigue siendo útil sin gastar créditos).
router.post('/copiloto/consulta', async (req, res) => {
  try {
    const { mensaje } = req.body || {};
    if (!mensaje || !String(mensaje).trim()) return res.status(400).json({ error: 'mensaje_requerido' });
    const q = String(mensaje).trim();

    const agg = store.getLeadAggregates();
    const { total, porEtiqueta, porEstado, porVendedor } = agg;
    const excl = idsNoAsesores();
    const sinRespPorAsesor = {};
    try {
      const r = store.getDB().exec("SELECT assigned_to_id, COUNT(*) FROM leads WHERE first_response_at IS NULL AND COALESCE(status,'') != 'cerrado' AND assigned_to_id IS NOT NULL GROUP BY assigned_to_id");
      if (r && r.length) r[0].values.forEach(row => { sinRespPorAsesor[Number(row[0])] = Number(row[1]); });
    } catch (e) { /* noop */ }
    const equipo = (porVendedor || []).filter(v => !excl.has(Number(v.id))).map(v => ({
      nombre: v.nombre, total: v.total, activos: v.activos,
      vendidos: v.vendidos, conversion: v.conversion,
      sinResponder: sinRespPorAsesor[Number(v.id)] || 0,
    })).sort((a, b) => (b.vendidos - a.vendidos) || (b.total - a.total));
    const canales = (store.getCanalDistribution() || []).map(r => `${r.channel || 'whatsapp'}: ${r.n}`).join(', ') || 'sin datos';
    const series = (store.getLeadSeries({ dias: 7 }) || []).reduce((a, r) => a + (Number(r.entrantes) || 0), 0);

    const snapshot = [
      `Leads totales: ${total}. Activos: ${total - (porEstado['cerrado'] || 0)}. Vendidos: ${porEtiqueta['vendido'] || 0}.`,
      `Embudo: ${Object.entries(porEtiqueta || {}).map(([e, n]) => `${e}=${n}`).join(', ')}.`,
      `Leads entrados en 7 días: ${series}. Canales: ${canales}.`,
      `Equipo (nombre, total, activos, vendidos, conversion%, sinResponder):`,
      ...equipo.map(a => `- ${a.nombre}: total=${a.total}, activos=${a.activos}, vendidos=${a.vendidos}, conversion=${a.conversion}%, sinResponder=${a.sinResponder}`),
    ].join('\n');

    const nlp = require('../services/nlp');
    if (!nlp.isAIEnabled()) {
      // Fallback local: reglas simples sobre la snapshot real
      const low = q.toLowerCase();
      let respuesta = `Copiloto sin IA externa — responde con datos locales.\n\n${snapshot}`;
      if (low.includes('sin responder') || low.includes('urgencia')) {
        const peor = equipo.filter(a => a.sinResponder > 0).sort((a, b) => b.sinResponder - a.sinResponder)[0];
        respuesta = peor
          ? `${peor.nombre} es quien más necesita apoyo: ${peor.sinResponder} leads sin responder de ${peor.total} asignados (${peor.conversion}% de conversión).`
          : 'Todo el equipo está al día: no hay leads sin responder.';
      } else if (low.includes('rank') || low.includes('top') || low.includes('mejor')) {
        const top = equipo.slice(0, 3).map((a, i) => `${i + 1}. ${a.nombre} — ${a.vendidos} vendidos (${a.conversion}%)`).join('\n');
        respuesta = `Top del ranking:\n${top}`;
      } else if (low.includes('canal')) {
        respuesta = `Distribución por canal: ${canales}.`;
      } else if (low.includes('resumen') || low.includes('resume')) {
        respuesta = `Resumen: ${total} leads totales, ${porEtiqueta['vendido'] || 0} vendidos, ${porEstado['cerrado'] || 0} cerrados, ${equipo.length} asesores.\n${snapshot}`;
      }
      return res.json({ ok: true, reply: respuesta, model: 'local-fallback', fuente: 'local' });
    }

    const result = await nlp.chatText(
      `Eres Copiloto SP, el asistente IA del supervisor de Leons Group (inmobiliaria colombiana de lotes).
      Tu rol: analizar el equipo comercial y responder en español, con números reales.
      Datos actuales del equipo:\n${snapshot}\n
      Sé concreto, cita números, usa listas cuando ayude. Máximo 150 palabras.`,
      q,
      45000
    );
    res.json({ ok: true, reply: result.text, model: result.model || nlp.getModel(), fuente: 'ia' });
  } catch (e) {
    console.error('[SUPERVISOR] copiloto consulta error:', e.message);
    res.status(502).json({ ok: false, error: e.message });
  }
});

module.exports = router;
