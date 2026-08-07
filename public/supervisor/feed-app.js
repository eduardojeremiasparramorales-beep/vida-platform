/* ============================================================================
   SP Feed en Tiempo Real — componente compartido (Supervisor Center y admin /os/)
   Red social interna: actividad de la empresa como publicaciones cronológicas
   con icono, actor, hora relativa, descripción, acciones por tipo y reacciones.
   Funciona con SPS.mount (supervisor) y SPOS.mount (admin) — recibe el helper
   de API y escape desde el shell que lo cargue.
   ============================================================================ */
(function () {
  'use strict';

  // Categorías del filtro superior (mismas claves que backend feed_events.categoria)
  const FILTROS = [
    { k: 'todos', label: 'Todo' },
    { k: 'operaciones', label: 'Operaciones' },
    { k: 'leads', label: 'Leads' },
    { k: 'ventas', label: 'Ventas' },
    { k: 'ia', label: 'IA' },
    { k: 'alertas', label: 'Alertas' },
    { k: 'equipo', label: 'Equipo' },
    { k: 'capacitacion', label: 'Capacitación' },
  ];

  // Icono y colores por categoría (clases feed--{cat} definidas en sp-os.css)
  const CAT_ICON = {
    operaciones: 'msg', leads: 'leads', ventas: 'money', ia: 'spark',
    alertas: 'clock', equipo: 'team', capacitacion: 'spark',
  };

  // Acciones sugeridas por tipo de evento
  const ACCIONES = {
    lead_asignado: [{ label: 'Ver conversación', goto: 'conversacion' }],
    asesor_respondio: [{ label: 'Ver conversación', goto: 'conversacion' }],
    etapa_cambio: [{ label: 'Ver lead', goto: 'conversacion' }],
    venta: [{ label: 'Ver lead', goto: 'conversacion' }],
    reasignacion: [{ label: 'Ver lead', goto: 'conversacion' }],
    reasignacion_auto: [{ label: 'Ver lead', goto: 'conversacion' }],
    tiempo_objetivo: [
      { label: 'Intervenir', goto: 'conversacion' },
      { label: 'Ver alerta', goto: 'alertas' },
    ],
    asesor_conectado: [{ label: 'Ver equipo', goto: 'equipo' }],
    capacitacion: [],
    anuncio: [],
  };

  const EMOJIS = ['👍', '🎉', '🏆', '❤️'];

  // --- utilidades ---
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function timeAgo(createdAt) {
    if (!createdAt) return '';
    const t = new Date(String(createdAt).replace(' ', 'T'));
    if (isNaN(t.getTime())) return '';
    const s = Math.floor((Date.now() - t.getTime()) / 1000);
    if (s < 10) return 'Ahora';
    if (s < 60) return 'hace ' + s + ' s';
    if (s < 3600) return 'hace ' + Math.floor(s / 60) + ' min';
    if (s < 86400) return 'hace ' + Math.floor(s / 3600) + ' h';
    if (s < 172800) return 'Ayer';
    return t.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  }

  function parsePayload(raw) {
    if (!raw) return {};
    try { return typeof raw === 'object' ? raw : JSON.parse(raw); } catch (e) { return {}; }
  }

  // --- montaje del feed ---
  function init(opts) {
    const host = opts.host;
    const api = opts.api;
    const ICONS = opts.icons || {};
    const avatarColor = opts.avatarColor || (() => '#D4AF37');
    const initials = opts.initials || ((n) => String(n || 'S').slice(0, 2).toUpperCase());
    const toast = opts.toast || ((m, k) => console.log('[feed]', m, k));

    let categoria = 'todos';
    let eventos = [];            // eventos cargados (nuevos primero)
    let ids = new Set();         // deduplicación SSE
    let antesId = null;          // cursor paginación
    let cargando = false;
    let finAlcanzado = false;
    let nuevosPendientes = [];   // eventos SSE esperando al usuario (filtro/scroll)
    let es = null;
    let selFilter = null;
    let listaEl = null, pillEl = null;

    host.innerHTML = `
      <div class="os-content__max feed-wrap">
        <div class="feed-filters" id="feedFiltros"></div>
        <div class="feed-composer card" id="feedComposer" style="display:none"></div>
        <div class="feed-pill" id="feedPill" style="display:none">—</div>
        <div class="feed-list" id="feedLista"></div>
        <div class="feed-sentinel" id="feedSentinel"></div>
      </div>`;

    const filtrosEl = host.querySelector('#feedFiltros');
    const composerEl = host.querySelector('#feedComposer');
    listaEl = host.querySelector('#feedLista');
    pillEl = host.querySelector('#feedPill');
    const sentinel = host.querySelector('#feedSentinel');

    // --- filtros superiores ---
    filtrosEl.innerHTML = FILTROS.map(f => `<button class="chip${f.k === 'todos' ? ' active' : ''}" data-k="${f.k}">${f.label}</button>`).join('');
    filtrosEl.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
      filtrosEl.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      categoria = c.getAttribute('data-k');
      recargar();
    }));

    // --- compositor (capacitación / anuncio) ---
    composerEl.innerHTML = `
      <div class="u-row u-gap2" style="flex-wrap:wrap">
        <div class="avatar avatar--sm" style="background:${avatarColor(opts.me && opts.me.nombre)}">${initials(opts.me && opts.me.nombre)}</div>
        <div class="u-grow" style="min-width:220px">
          <input class="input" id="feedPostTitulo" placeholder="Título del anuncio o capacitación…" maxlength="160" style="margin-bottom:8px">
          <textarea class="input" id="feedPostTexto" rows="2" maxlength="2000" placeholder="Detalle (opcional)…" style="resize:vertical"></textarea>
        </div>
        <div class="u-col u-gap2" style="align-items:flex-end">
          <select class="input" id="feedPostCat" style="width:auto">
            <option value="capacitacion">Capacitación</option>
            <option value="anuncio">Anuncio interno</option>
          </select>
          <button class="btn btn--gold btn--sm" id="feedPostBtn">Publicar</button>
        </div>
      </div>`;
    composerEl.querySelector('#feedPostBtn').addEventListener('click', async () => {
      const titulo = composerEl.querySelector('#feedPostTitulo').value.trim();
      const descripcion = composerEl.querySelector('#feedPostTexto').value.trim();
      const categoriaPost = composerEl.querySelector('#feedPostCat').value;
      if (!titulo) { toast('Escribe un título', 'err'); return; }
      const btn = composerEl.querySelector('#feedPostBtn');
      btn.disabled = true; btn.textContent = '…';
      const r = await api('/api/supervisor/feed/post', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titulo, descripcion, categoria: categoriaPost }),
      });
      btn.disabled = false; btn.textContent = 'Publicar';
      if (r && r.ok) {
        composerEl.querySelector('#feedPostTitulo').value = '';
        composerEl.querySelector('#feedPostTexto').value = '';
        toast('Publicado en el feed', 'ok');
        recargar();
      } else {
        toast((r && r.error) || 'No se pudo publicar', 'err');
      }
    });
    composerEl.style.display = 'block';

    // --- helpers de render ---
    function badgeCat(cat) {
      const f = FILTROS.find(x => x.k === cat);
      return `<span class="feed-cat feed--${esc(cat)}">${esc((f && f.label) || cat)}</span>`;
    }

    function iconoEvento(ev) {
      return ICONS[CAT_ICON[ev.categoria] || 'activity'] || '';
    }

    function payloadChips(payload) {
      const chips = [];
      if (payload && payload.de && payload.a) {
        chips.push(`<span class="badge badge--mute" style="font-size:10px">${esc(payload.de)} → ${esc(payload.a)}</span>`);
      }
      if (payload && payload.minutos) {
        chips.push(`<span class="badge badge--red" style="font-size:10px">${esc(payload.minutos)} min sin respuesta</span>`);
      }
      return chips.length ? `<div class="feed-chips">${chips.join('')}</div>` : '';
    }

    function botonesAccion(ev) {
      const accs = ACCIONES[ev.tipo] || [];
      const convBase = opts.conversacionesUrl || '/supervisor/conversaciones.html';
      const btns = accs.map(a => {
        let href = '#';
        if (a.goto === 'conversacion' && ev.leadId) href = convBase + '?leadId=' + ev.leadId;
        else if (a.goto === 'alertas') href = '/supervisor/alertas.html';
        else if (a.goto === 'equipo') href = '/supervisor/equipo.html';
        return `<a class="btn btn--ghost btn--sm" href="${href}" style="text-decoration:none">${a.label}</a>`;
      }).join('');
      return btns ? `<div class="feed-actions">${btns}</div>` : '';
    }

    function reaccionesHTML(ev) {
      const reacciones = ev.reacciones || [];
      const conteo = {};
      for (const r of reacciones) conteo[r.emoji] = (conteo[r.emoji] || 0) + 1;
      const mios = new Set(reacciones.filter(r => Number(r.vendedor_id) === Number(opts.me && opts.me.vendedorId)).map(r => r.emoji));
      const emojis = EMOJIS.map(e => {
        const n = conteo[e] || 0;
        return `<button class="feed-emoji${mios.has(e) ? ' mine' : ''}" data-emoji="${e}" data-id="${ev.id}" title="Reaccionar">${e}<span>${n || ''}</span></button>`;
      }).join('');
      return `<div class="feed-reacts">${emojis}</div>`;
    }

    function cardHTML(ev, isNew) {
      const actor = ev.actorNombre || 'Sistema';
      const esSistema = !ev.actorNombre || !ev.actorId;
      return `<article class="feed-card${isNew ? ' feed-in' : ''}" data-id="${ev.id}">
        <div class="feed-card__side">
          <div class="feed-card__icon feed--${esc(ev.categoria)}">${iconoEvento(ev).replace('<svg ', '<svg style="width:19px;height:19px" ')}</div>
        </div>
        <div class="feed-card__main">
          <div class="feed-card__top">
            ${esSistema
              ? `<div class="feed-card__avatar feed--${esc(ev.categoria)}">${iconoEvento(ev).replace('<svg ', '<svg style="width:15px;height:15px" ')}</div>`
              : `<div class="avatar avatar--sm" style="background:${avatarColor(actor)}">${initials(actor)}</div>`}
            <div class="u-grow" style="min-width:0">
              <div class="feed-card__who">${esc(actor)}${ev.entidadTipo === 'vendedor' && ev.actorId ? ' <span class="t-dim3" style="font-weight:400">· asesor</span>' : ''}</div>
              <div class="feed-card__time">${timeAgo(ev.createdAt)}</div>
            </div>
            ${badgeCat(ev.categoria)}
          </div>
          <div class="feed-card__title">${esc(ev.titulo)}</div>
          <div class="feed-card__desc">${esc(ev.descripcion || '')}</div>
          ${payloadChips(parsePayload(ev.payload))}
          <div class="feed-card__foot">
            ${botonesAccion(ev)}
            ${reaccionesHTML(ev)}
          </div>
        </div>
      </article>`;
    }

    function render(vistaNueva = false) {
      if (!eventos.length) {
        listaEl.innerHTML = `<div class="empty">${ICONS.activity || ''}<div>Sin actividad en <b>${(FILTROS.find(f => f.k === categoria) || {}).label}</b> todavía. El feed se llena solo con la operación.</div></div>`;
        return;
      }
      const html = eventos.map(ev => cardHTML(ev, false)).join('');
      listaEl.innerHTML = html;
      if (vistaNueva) listaEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      bindReacciones();
    }

    function prependEvento(ev) {
      const empty = listaEl.querySelector('.empty');
      if (empty) empty.remove();
      const el = document.createElement('div');
      el.innerHTML = cardHTML(ev, true);
      const card = el.firstElementChild;
      listaEl.prepend(card);
      bindReacciones(card);
      setTimeout(() => card.classList.remove('feed-in'), 700);
    }

    // --- reacciones ---
    async function reaccionar(feedId, emoji, btn) {
      const r = await api('/api/supervisor/feed/' + feedId + '/reaccion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      });
      if (r && r.ok) {
        const card = listaEl.querySelector('[data-id="' + feedId + '"]') || document.querySelector('.feed-card[data-id="' + feedId + '"]');
        if (card) {
          const ev = eventos.find(x => Number(x.id) === Number(feedId));
          if (ev) { ev.reacciones = r.reacciones || []; card.querySelector('.feed-reacts').outerHTML = reaccionesHTML(ev); bindReacciones(card); }
        }
        if (emoji !== '❤️') toast(emoji + ' ' + (btn.dataset.emoji ? 'Reacción enviada' : ''), 'ok');
      } else {
        toast((r && r.error) || 'No se pudo reaccionar', 'err');
      }
    }
    function bindReacciones(scope) {
      (scope || listaEl).querySelectorAll('.feed-emoji').forEach(b => {
        b.addEventListener('click', () => reaccionar(b.getAttribute('data-id'), b.getAttribute('data-emoji'), b));
      });
    }

    // --- carga inicial / paginación / filtros ---
    async function cargarPagina(reset) {
      if (cargando) return;
      cargando = true;
      const qs = new URLSearchParams();
      if (categoria !== 'todos') qs.set('categoria', categoria);
      if (!reset && antesId) qs.set('antesId', antesId);
      qs.set('limite', '40');
      const r = await api('/api/supervisor/feed/actividad' + (qs.toString() ? '?' + qs : ''));
      cargando = false;
      if (!r) return;
      const nuevos = (r.eventos || []).filter(ev => !ids.has(Number(ev.id)));
      nuevos.forEach(ev => ids.add(Number(ev.id)));
      if (reset) { eventos = []; listaEl.innerHTML = ''; }
      eventos = eventos.concat(nuevos);
      render();
      antesId = nuevos.length ? nuevos[nuevos.length - 1].id : antesId;
      finAlcanzado = !nuevos.length || nuevos.length < 40;
    }

    function recargar() {
      ids = new Set();
      antesId = null;
      finAlcanzado = false;
      nuevosPendientes = [];
      ocultarPill();
      cargarPagina(true);
    }

    // scroll infinito
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting) && !finAlcanzado) cargarPagina(false);
    }, { rootMargin: '400px' });
    observer.observe(sentinel);

    // --- SSE en tiempo real (deduplicado por id) ---
    function conectarStream() {
      try { es = new EventSource('/api/stream'); } catch (e) { return; }
      es.addEventListener('actividad', (e) => {
        try {
          const ev = JSON.parse(e.data);
          const id = Number(ev.id);
          if (!id || ids.has(id)) return;
          ids.add(id);
          ev.reacciones = [];
          // ¿Coincide con el filtro activo y el usuario está arriba? → insertar ya
          if ((categoria === 'todos' || ev.categoria === categoria) && window.scrollY < 120) {
            eventos.unshift(ev);
            prependEvento(ev);
          } else {
            nuevosPendientes.push(ev);
            mostrarPill(nuevosPendientes.length);
          }
        } catch (err) { /* payload inválido */ }
      });
      es.onerror = () => { try { es.close(); } catch (e2) {} es = null; setTimeout(conectarStream, 5000); };
    }

    function mostrarPill(n) {
      pillEl.innerHTML = `<button class="btn btn--gold btn--sm">${n} ${n === 1 ? 'evento nuevo' : 'eventos nuevos'} — Ver</button>`;
      pillEl.style.display = 'block';
      pillEl.querySelector('button').addEventListener('click', () => {
        for (const ev of nuevosPendientes) {
          if (categoria === 'todos' || ev.categoria === categoria) { eventos.unshift(ev); prependEvento(ev); }
        }
        nuevosPendientes = [];
        ocultarPill();
      });
    }
    function ocultarPill() { pillEl.style.display = 'none'; }

    cargarPagina(true);
    conectarStream();
  }

  window.SPFeed = { init };
})();
