// Vid.a â€” Vertical CAMPAÃ‘A: rutas de panel (requieren sesiÃ³n del tenant) y rutas
// pÃºblicas de la pÃ¡gina de campaÃ±a (sin sesiÃ³n, resuelven tenant por slug).
const express = require('express');
const campana = require('./store');
const schema = require('./schema');
const adapter = require('../../db/adapter');
const platform = require('../../db/platform');

// ---------------- Panel (auth) ----------------
const panel = express.Router();

// Toda la API de campaÃ±a exige sesiÃ³n del tenant activo (auth.requireAuth se aplica
// en index.js al montar este router; aquÃ­ solo lÃ³gica).
function requireRol(...roles) {
  return (req, res, next) => {
    const r = req.session && req.session.rol;
    if (roles.includes('admin') && r === 'admin') return next();
    if (roles.includes(r)) return next();
    return res.status(403).json({ error: 'sin_permiso', detalle: `se requiere uno de: ${roles.join(', ')}` });
  };
}

// Config de la vertical
panel.get('/config', (req, res) => {
  res.json({ estados_voto: campana.getEstadosVoto(), roles_equipo: schema.ROLES_EQUIPO, info: campana.getInfoCampana(), vertical: 'campaÃ±a' });
});
panel.put('/config', requireRol('admin', 'gerente'), (req, res) => {
  try {
    if (req.body.estados_voto) campana.setEstadosVoto(req.body.estados_voto);
    if (req.body.info) campana.setInfoCampana(req.body.info);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Votantes
panel.get('/votantes', (req, res) => {
  try {
    const filtros = {
      q: req.query.q, zona: req.query.zona, barrio: req.query.barrio,
      estado_voto: req.query.estado_voto, ocupacion: req.query.ocupacion,
      vendedor: req.query.vendedor, referido_de: req.query.referido_de,
      limite: req.query.limite || 200, offset: req.query.offset || 0,
    };
    const votantes = campana.listVotantes(filtros);
    const total = campana.countVotantes(filtros);
    res.json({ votantes, total, filtros: campana.getOpcionesSegmento() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
panel.get('/votantes/:id', (req, res) => {
  try {
    const v = campana.getVotante(req.params.id);
    if (!v) return res.status(404).json({ error: 'votante_no_existe' });
    res.json({ votante: v, referidos: campana.getReferidos(v.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
panel.post('/votantes', requireRol('admin', 'gerente', 'secretario', 'conductor', 'voluntariado'), (req, res) => {
  try {
    if (!req.body.nombre) return res.status(400).json({ error: 'nombre_requerido' });
    if (!req.body.assigned_to_id) req.body.assigned_to_id = req.session.vendedorId;
    const v = campana.crearVotante(req.body);
    res.json({ ok: true, votante: v });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
panel.put('/votantes/:id', requireRol('admin', 'gerente', 'secretario', 'conductor', 'voluntariado'), (req, res) => {
  try {
    const v = campana.updateVotante(req.params.id, req.body || {});
    if (!v) return res.status(404).json({ error: 'votante_no_existe' });
    res.json({ ok: true, votante: v });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
panel.post('/votantes/:id/estado', requireRol('admin', 'gerente', 'secretario', 'conductor', 'voluntariado'), (req, res) => {
  try {
    const { estado_voto, compromiso_nota } = req.body || {};
    if (!estado_voto) return res.status(400).json({ error: 'estado_voto_requerido' });
    const v = campana.setEstadoVoto(req.params.id, estado_voto, compromiso_nota);
    res.json({ ok: true, votante: v });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Referidos
panel.get('/votantes/:id/referidos', (req, res) => {
  try { res.json({ referidos: campana.getReferidos(req.params.id) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
panel.post('/votantes/:id/referidos', requireRol('admin', 'gerente', 'secretario', 'conductor', 'voluntariado'), (req, res) => {
  try {
    const r = campana.addReferido(req.params.id, req.body || {});
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
panel.post('/referidos/:id/estado', requireRol('admin', 'gerente', 'secretario'), (req, res) => {
  try {
    campana.setReferidoEstado(req.params.id, (req.body || {}).estado || 'registrado');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// EstadÃ­sticas + segmentaciÃ³n
panel.get('/stats', (req, res) => {
  try { res.json(campana.getStats()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
panel.get('/segmentos', (req, res) => {
  try { res.json(campana.getOpcionesSegmento()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Equipo
panel.get('/equipo', (req, res) => {
  try { res.json({ equipo: campana.getEquipo(), roles: schema.ROLES_EQUIPO }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
panel.post('/equipo', requireRol('admin', 'gerente'), (req, res) => {
  try {
    const m = campana.crearMiembroEquipo(req.body || {});
    res.json({ ok: true, miembro: m });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
panel.post('/equipo/:id/rol', requireRol('admin', 'gerente'), (req, res) => {
  try {
    campana.setRolEquipo(req.params.id, (req.body || {}).rol || 'voluntariado');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------- PÃºblico (sin sesiÃ³n; tenant por slug) ----------------
const publico = express.Router();

// Ejecuta fn dentro del tenant resuelto por slug (idÃ©ntico a como /api/login resuelve)
function withTenantBySlug(slug, req, res, fn) {
  try {
    const emp = platform.getEmpresaBySlug(String(slug || '').toLowerCase());
    if (!emp || !emp.activo) return res.status(404).json({ error: 'campaÃ±a_no_encontrada' });
    adapter.tenantContext.run({ empresaId: emp.id, dbPath: emp.db_path }, () => {
      try { fn(emp); } catch (e) { res.status(500).json({ error: e.message }); }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// Info pÃºblica de la campaÃ±a: nombre, cargo, eslogan, estadÃ­sticas agregadas (sin PII)
publico.get('/:slug', (req, res) => {
  withTenantBySlug(req.params.slug, req, res, (emp) => {
    const info = campana.getInfoCampana();
    const stats = campana.getStats();
    res.json({
      slug: emp.slug, empresa: emp.nombre, vertical: emp.vertical || 'crm',
      info: { ...info, nombre: info.nombre || emp.nombre },
      stats: { total_votantes: stats.total, por_estado: stats.por_estado.filter(e => e.count > 0), por_zona: stats.por_zona, total_referidos: stats.total_referidos },
    });
  });
});

module.exports = { panel, publico };
