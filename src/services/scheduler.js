// Runner de mensajes programados en SERVIDOR: los envía al vencer aunque el
// vendedor tenga la app cerrada (antes vivían en localStorage y solo salían
// con la app abierta). Ver tabla scheduled_messages en store.js.
const store = require('../db/store');
const { sendMessageSmart } = require('./whatsapp');
const events = require('./events');
const { notify } = require('./notify');
const insignias = require('./insignias');

const TICK_MS = 45000;
const MAX_INTENTOS = 3;
const DIARIO_MS = 3600000; // revisa cada hora; ejecuta las tareas diarias 1 vez/día
let _ultimoDiario = null;   // 'YYYY-MM-DD' del último run diario

let _corriendo = false;
let _buildFirma = null; // inyectada desde index.js (comparte la firma del asesor)

async function tick() {
  if (_corriendo) return; // anti-solape si un tick anterior sigue enviando
  _corriendo = true;
  try {
    const due = store.getScheduledDue();
    for (const s of due) {
      await enviarUno(s);
    }
    await procesarCadencias();
  } catch (e) {
    console.error('[SCHEDULER] tick:', e.message);
  } finally {
    _corriendo = false;
  }
}

// Cadencia de seguimiento (F3.3): envía el paso vencido a cada lead inscrito y avanza.
// Se detiene solo cuando el cliente responde (webhook) o el lead se cierra.
function aplicarVarsCad(txt, lead, asesorNombre) {
  const primer = s => String(s || '').trim().split(/\s+/)[0] || '';
  return String(txt || '')
    .replace(/\{\{\s*nombre\s*\}\}/gi, primer(lead.customer_name) || 'estimado')
    .replace(/\{\{\s*asesor\s*\}\}/gi, primer(asesorNombre) || '')
    .replace(/\{\{\s*proyecto\s*\}\}/gi, lead.proyecto || 'nuestro proyecto');
}
async function procesarCadencias() {
  let pasos;
  try { pasos = store.getCadenciaPasos(); } catch (e) { return; }
  if (!pasos || !pasos.length) return;
  let due;
  try { due = store.getCadenciaDue(); } catch (e) { return; }
  for (const l of due) {
    try {
      const idx = l.cadencia_paso || 0;
      const paso = pasos[idx];
      if (!paso) { store.updateCadenciaLead(l.id, { activa: 0 }); continue; }
      if (!l.assigned_to_id || !l.customer_phone) { store.updateCadenciaLead(l.id, { activa: 0 }); continue; }
      const vendedor = store.getVendedorById(l.assigned_to_id);
      const cuerpoBase = aplicarVarsCad(paso.mensaje, l, vendedor && vendedor.nombre);
      const cuerpo = _buildFirma ? _buildFirma(cuerpoBase, (vendedor && vendedor.nombre) || 'Asesor') : cuerpoBase;
      // Detectar canal del lead (multicanal)
      const cadPhone = l.customer_phone || '';
      let cadChannel = 'whatsapp';
      if (cadPhone.startsWith('messenger_')) cadChannel = 'messenger';
      else if (cadPhone.startsWith('instagram_')) cadChannel = 'instagram';
      let smart;
      if (cadChannel !== 'whatsapp') {
        const { getAdapter } = require('../channels');
        const cadAdapter = getAdapter(cadChannel);
        const cuid = cadPhone.replace(/^(messenger_|instagram_)/, '');
        if (cadAdapter && cuid) { await cadAdapter.sendMessage(cuid, cuerpo); }
        smart = { queued: false, data: null };
      } else {
        smart = await sendMessageSmart(l.customer_phone, cuerpo, l.id);
      }
      if (smart && !smart.queued) {
        const wamid = smart.data && smart.data.messages && smart.data.messages[0] ? smart.data.messages[0].id : null;
        const fromNumber = l.assigned_to_phone || 'panel';
        store.saveMessage(l.id, fromNumber, l.customer_phone, cuerpoBase, 'outgoing', null, null, wamid, 'sent');
        try { store.syncLeadToConversation(store.getLeadById(l.id), { direction: 'outgoing', body: cuerpoBase, fromNumber, toNumber: l.customer_phone }); } catch (e) {}
        try { events.emitToVendedor(l.assigned_to_id, 'nuevo_mensaje', { leadId: l.id, tipo: 'cadencia', ts: Date.now() }); } catch (e) {}
      }
      const nextIdx = idx + 1;
      if (nextIdx < pasos.length && l.cadencia_inicio) {
        const inicioMs = new Date(String(l.cadencia_inicio).replace(' ', 'T') + 'Z').getTime();
        const nextAt = new Date(inicioMs + (Number(pasos[nextIdx].dia) || nextIdx + 1) * 86400000).toISOString().slice(0, 19).replace('T', ' ');
        store.updateCadenciaLead(l.id, { paso: nextIdx, nextAt });
      } else {
        store.updateCadenciaLead(l.id, { paso: nextIdx, activa: 0 });
      }
      console.log(`[CADENCIA] Paso ${idx + 1} enviado a lead ${l.id}`);
    } catch (e) { console.error('[CADENCIA] lead', l.id, e.message); }
  }
}

async function enviarUno(s) {
  // Releer la fila: la tanda se procesa en serie (~segundos por envío) y el vendedor
  // pudo cancelarla DESPUÉS del getScheduledDue() — sin esto se enviaría igual y el
  // 'enviado' pisaría el 'cancelado'.
  const fresh = store.getScheduledById(s.id);
  if (!fresh || fresh.estado !== 'pendiente') return;
  const lead = store.getLeadById(s.lead_id);
  if (!lead || lead.status === 'cerrado') {
    store.updateScheduled(s.id, { estado: 'cancelado', last_error: 'lead_no_disponible' });
    return;
  }
  // Lead reasignado a otro vendedor: no enviar un texto firmado por el vendedor
  // original a una conversación que ya no es suya (regla: un lead = un vendedor).
  if (s.vendedor_id && Number(lead.assigned_to_id) !== Number(s.vendedor_id)) {
    store.updateScheduled(s.id, { estado: 'cancelado', last_error: 'lead_reasignado' });
    try {
      notify({ vendedorId: s.vendedor_id, tipo: 'programado_cancelado', titulo: 'Mensaje programado cancelado', cuerpo: `El lead ${lead.customer_name || lead.customer_phone} fue reasignado; tu mensaje programado no se envió.`, leadId: lead.id, push: true });
    } catch (e2) { }
    return;
  }
  try {
    const vendedor = s.vendedor_id ? store.getVendedorById(s.vendedor_id) : null;
    const nombre = vendedor ? vendedor.nombre : 'Asesor';
    const cuerpo = _buildFirma ? _buildFirma(s.body, nombre) : s.body;
    // Detectar canal del lead (multicanal)
    const progPhone = lead.customer_phone || '';
    let progChannel = 'whatsapp';
    if (progPhone.startsWith('messenger_')) progChannel = 'messenger';
    else if (progPhone.startsWith('instagram_')) progChannel = 'instagram';
    let smart;
    if (progChannel !== 'whatsapp') {
      const { getAdapter } = require('../channels');
      const progAdapter = getAdapter(progChannel);
      const pcuid = progPhone.replace(/^(messenger_|instagram_)/, '');
      if (progAdapter && pcuid) { await progAdapter.sendMessage(pcuid, cuerpo); }
      smart = { queued: false, data: null };
    } else {
      smart = await sendMessageSmart(lead.customer_phone, cuerpo, lead.id);
    }
    // Marcar 'enviado' INMEDIATAMENTE tras aceptar Meta el envío: si la contabilidad
    // de abajo fallara (disco lleno, deploy que mata el proceso), el peor caso es un
    // mensaje sin registrar — nunca un cliente recibiendo el mismo texto duplicado.
    store.updateScheduled(s.id, { estado: 'enviado', sent_at: new Date().toISOString().slice(0, 19).replace('T', ' ') });
    try {
      if (!smart.queued) {
        // Envío free-form real → registrar en el chat.
        // Con ventana cerrada (queued=true) NO se guarda aquí: el cuerpo quedó en
        // pending_outbound y flushPendingOutbound hará el saveMessage cuando el
        // cliente responda — guardarlo dos veces duplicaba la burbuja.
        const wamid = smart.data && smart.data.messages && smart.data.messages[0] ? smart.data.messages[0].id : null;
        const fromNumber = lead.assigned_to_phone || 'panel';
        store.saveMessage(lead.id, fromNumber, lead.customer_phone, s.body, 'outgoing', null, null, wamid, 'sent');
        store.syncLeadToConversation(store.getLeadById(lead.id), { direction: 'outgoing', body: s.body, fromNumber, toNumber: lead.customer_phone });
        events.emitToVendedor(lead.assigned_to_id, 'nuevo_mensaje', { leadId: lead.id, tipo: 'respuesta_panel', ts: Date.now() });
        events.emitToAdmins('nuevo_mensaje', { leadId: lead.id, tipo: 'respuesta_panel', ts: Date.now() });
      }
      events.emitToVendedor(s.vendedor_id, 'programado_enviado', { id: s.id, leadId: lead.id, viaTemplate: !!smart.queued, ts: Date.now() });
    } catch (e2) {
      console.error(`[SCHEDULER] Programado #${s.id} enviado pero falló la contabilidad:`, e2.message);
    }
    console.log(`[SCHEDULER] Programado #${s.id} enviado a lead ${lead.id}${smart.templateSent ? ' (via template, ventana cerrada — saldrá al responder el cliente)' : ''}`);
  } catch (e) {
    const intentos = (s.intentos || 0) + 1;
    if (intentos >= MAX_INTENTOS) {
      store.updateScheduled(s.id, { estado: 'fallido', intentos, last_error: e.message });
      events.emitToVendedor(s.vendedor_id, 'programado_fallido', { id: s.id, leadId: lead.id, error: e.message, ts: Date.now() });
      try {
        notify({ vendedorId: s.vendedor_id, tipo: 'programado_fallido', titulo: 'Mensaje programado falló', cuerpo: `No se pudo enviar el mensaje programado a ${lead.customer_name || lead.customer_phone}: ${e.message}`, leadId: lead.id, push: true });
      } catch (e2) { }
      console.error(`[SCHEDULER] Programado #${s.id} FALLÓ definitivamente:`, e.message);
    } else {
      // Reintento: retrasar 2 min para no martillar en el mismo tick
      store.updateScheduled(s.id, {
        intentos, last_error: e.message,
        send_at: new Date(Date.now() + 120000).toISOString().slice(0, 19).replace('T', ' '),
      });
      console.warn(`[SCHEDULER] Programado #${s.id} falló (intento ${intentos}/${MAX_INTENTOS}), reintento en 2 min:`, e.message);
    }
  }
}

// Seguimiento automático: si el asesor mandó el último mensaje y el cliente no responde
// hace +24h, se crea un recordatorio (tarea con vence_at = ahora) y push. Guard por lead
// para no duplicar; se limpia cuando el cliente vuelve a escribir.
function crearSeguimientosAutomaticos() {
  let creados = 0;
  try {
    const leads = store.getLeadsNecesitanSeguimiento();
    for (const l of leads) {
      if (!l.assigned_to_id) continue;
      try {
        store.createTarea({
          vendedorId: l.assigned_to_id,
          leadId: l.id,
          texto: `Haz seguimiento a ${l.customer_name || 'tu cliente'} — sin respuesta hace +24h`,
          venceAt: new Date().toISOString(),
        });
        store.setFollowupCreated(l.id);
        creados++;
        try { notify({ vendedorId: l.assigned_to_id, tipo: 'seguimiento', titulo: '🔔 Seguimiento pendiente', cuerpo: `${l.customer_name || 'Un cliente'} lleva +24h sin responder. Retómalo.`, leadId: l.id, push: true }); } catch (e) { }
      } catch (e) { console.error('[SCHEDULER] seguimiento auto lead', l.id, e.message); }
    }
  } catch (e) { console.error('[SCHEDULER] crearSeguimientosAutomaticos:', e.message); }
  return creados;
}

// Auto-inscripción en cadencia (opt-in): SOLO si el admin encendió cadencia_auto.
// Inscribe los leads fríos elegibles (una cadencia por lead en su vida). Apagado por
// defecto → no envía nada a nadie sin que el admin lo active explícitamente.
function autoInscribirCadencia() {
  let n = 0;
  try {
    if (store.getConfig('cadencia_auto') !== '1') return 0;
    if (!store.getCadenciaPasos().length) return 0;
    const leads = store.getLeadsParaAutoCadencia(50);
    for (const l of leads) {
      try { if (store.enrollCadencia(l.id)) n++; } catch (e) { console.error('[CADENCIA] auto-inscribir', l.id, e.message); }
    }
  } catch (e) { console.error('[CADENCIA] autoInscribirCadencia:', e.message); }
  return n;
}

// Retención de medios (Privacidad · Parte 3B) — apagada por defecto. Borra SOLO
// archivos de chat (entrantes/salientes) más viejos que N meses; jamás toca `cat_*`
// (fotos del catálogo público, que son permanentes y las sigue sirviendo el sitio).
function limpiarMediaAntigua() {
  const enabled = store.getConfig('media_retention_enabled') === '1';
  if (!enabled) return 0;
  const dias = Number(store.getConfig('media_retention_days')) || 180;
  const fs = require('fs');
  const path = require('path');
  // Vid.a V3: tenant-aware — cada negocio limpia SU carpeta de media.
  const { getMediaDir, isCatalogFile } = require('./media');
  const dir = getMediaDir();
  if (!fs.existsSync(dir)) return 0;
  const limite = Date.now() - dias * 24 * 60 * 60 * 1000;
  let borrados = 0;
  for (const f of fs.readdirSync(dir)) {
    if (isCatalogFile(f)) continue; // catálogo público: nunca se borra por retención
    const fp = path.join(dir, f);
    try {
      const st = fs.statSync(fp);
      if (st.isFile() && st.mtimeMs < limite) { fs.unlinkSync(fp); borrados++; }
    } catch (e) { /* archivo tocado por otro proceso justo ahora — se intenta de nuevo mañana */ }
  }
  return borrados;
}

// data/uploads/ es el escaneo temporal de /api/campanas-sp/analyze-images (solo sirve para
// que Gemini categorice una muestra antes de guardar nada en el proyecto) — nunca se vuelve
// a leer después, así que crece para siempre si nadie la limpia. Sin config gate: es scratch,
// no media de clientes; 7 días es de sobra para cualquier análisis en curso.
function limpiarUploadsAntiguos() {
  const fs = require('fs');
  const path = require('path');
  const campanasSp = require('./campanas-sp');
  const dir = path.join(campanasSp.detectRoot(), 'data', 'uploads');
  if (!fs.existsSync(dir)) return 0;
  const limite = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let borrados = 0;
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    try {
      const st = fs.statSync(fp);
      if (st.isFile() && st.mtimeMs < limite) { fs.unlinkSync(fp); borrados++; }
    } catch (e) { /* archivo tocado por otro proceso justo ahora — se intenta de nuevo mañana */ }
  }
  return borrados;
}

async function tickDiario() {
  const hoy = new Date().toISOString().slice(0, 10);
  if (_ultimoDiario === hoy) return;
  _ultimoDiario = hoy;
  try {
    const seg = crearSeguimientosAutomaticos();
    const cad = autoInscribirCadencia();
    const ins = insignias.recomputeAll();
    const media = limpiarMediaAntigua();
    const uploads = limpiarUploadsAntiguos();
    console.log(`[SCHEDULER] Diario: ${seg} seguimiento(s), ${cad} auto-inscripcion(es) en cadencia, ${media} archivo(s) de media retirados, ${uploads} escaneo(s) temporal(es) retirado(s); insignias`, ins);
  } catch (e) { console.error('[SCHEDULER] tickDiario:', e.message); }
}

function start(buildFirmaFn, runAsTenant) {
  _buildFirma = buildFirmaFn || null;
  // Vid.a V1: tick/tickDiario corren por setInterval, fuera de cualquier request — sin
  // contexto de tenant (ver adapter.js). runAsTenant, inyectado desde index.js, los
  // corre dentro del mismo contexto empresa #1 que usa cada request HTTP.
  const wrap = runAsTenant || ((fn) => fn());
  setInterval(() => wrap(tick), TICK_MS);
  setInterval(() => wrap(tickDiario), DIARIO_MS);
  setTimeout(() => wrap(tickDiario), 15000); // primer cálculo al arrancar (tras estabilizar la BD)
  console.log('[SCHEDULER] Mensajes programados en servidor: activo (tick ' + TICK_MS / 1000 + 's)');
}

module.exports = { start };
