/* ============================================================================
   SP OS — Shell runtime
   Provee: iconos, navegación, guard de sesión, helper de API (con fallback demo),
   toasts, y montaje del workspace de 3 zonas. Un solo producto, un solo lenguaje.
   ============================================================================ */
(function () {
  'use strict';

  /* Glass-lite: en dispositivos de poca memoria, los backdrop-filter del tema
     glass causan jank — se anulan globalmente (ver sp-os.css §19). */
  try {
    if (navigator.deviceMemory && navigator.deviceMemory < 4) {
      const marcarLite = () => document.body.classList.add('glass-lite');
      if (document.body) marcarLite(); else document.addEventListener('DOMContentLoaded', marcarLite);
    }
  } catch (e) { }

  /* --- Íconos (stroke, 24x24) --- */
  const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICONS = {
    dashboard: P('<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 8h6V4h-6z"/>'),
    inbox: P('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13l3.5 7v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6z"/>'),
    leads: P('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'),
    pipeline: P('<path d="M3 3v18h18"/><rect x="7" y="9" width="3" height="8" rx="1"/><rect x="13" y="5" width="3" height="12" rx="1"/>'),
    clients: P('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>'),
    properties: P('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/>'),
    projects: P('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 4v16"/>'),
    campaigns: P('<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>'),
    automations: P('<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6H15a3 3 0 0 1 3 3v6M6 8.5V15a3 3 0 0 0 3 3h6.5"/>'),
    calendar: P('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
    analytics: P('<path d="M3 3v18h18"/><path d="M7 14l3-4 3 3 4-6"/>'),
    team: P('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>'),
    billing: P('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>'),
    marketplace: P('<path d="M4 8h16l-1 12H5z"/><path d="M9 8a3 3 0 0 1 6 0"/>'),
    ai: P('<path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z"/><path d="M18.5 15.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z"/>'),
    settings: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.9 1.13V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 6 19.4a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3.6 15a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 6 6a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 12 3.6a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 18 6a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 20.4 12H21a2 2 0 1 1 0 4z"/>'),
    activity: P('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
    logs: P('<path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
    api: P('<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>'),
    notifications: P('<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
    search: P('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
    logout: P('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>'),
    plus: P('<path d="M12 5v14M5 12h14"/>'),
    up: P('<path d="M7 17 17 7M7 7h10v10"/>'),
    down: P('<path d="M7 7 17 17M17 7v10H7"/>'),
    check: P('<path d="M20 6 9 17l-5-5"/>'),
    clock: P('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    msg: P('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    flame: P('<path d="M12 2s4 4 4 8a4 4 0 0 1-8 0c0-1 .5-2 .5-2S6 10 6 14a6 6 0 0 0 12 0c0-5-6-12-6-12z"/>'),
    spark: P('<path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z"/>'),
    menu: P('<path d="M3 6h18M3 12h18M3 18h18"/>'),
    collapse: P('<path d="m15 18-6-6 6-6"/>'),
    expand: P('<path d="m9 18 6-6-6-6"/>'),
    money: P('<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5a2.5 2 0 0 1 5 0c0 2.5-5 1-5 3.5a2.5 2 0 0 0 5 0"/>'),
    target: P('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>'),
    zap: P('<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>'),
    refresh: P('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'),
    sun: P('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    moon: P('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
    monitor: P('<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  };

  /* --- Navegación (una sola verdad) --- */
  const NAV = [
    { title: 'Operación', items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', href: '/os/dashboard.html' },
      { id: 'inbox', label: 'Inbox', icon: 'inbox', href: '/os/inbox.html', badge: 'live' },
      { id: 'crm', label: 'CRM · Leads', icon: 'leads', href: '/os/crm.html' },
      { id: 'pipeline', label: 'Pipeline', icon: 'pipeline', href: '/os/pipeline.html' },
      { id: 'reservas', label: 'Reservas', icon: 'clock', href: '/os/reservas.html' },
      { id: 'clients', label: 'Clientes', icon: 'clients', href: '/os/clientes.html' },
    ]},
    { title: 'Negocio', items: [
      { id: 'proyectos', label: 'Proyectos', icon: 'properties', href: '/os/proyectos.html' },
      { id: 'galeria', label: 'Galería', icon: 'spark', href: '/os/galeria.html' },
      { id: 'campaigns', label: 'Campañas', icon: 'campaigns', href: '/os/campanas.html' },
      { id: 'campanas-sp', label: 'Campañas SP', icon: 'spark', href: '/os/campanas-sp.html' },
      { id: 'meta-ads', label: 'Meta Ads', icon: 'campaigns', href: '/os/meta-ads.html', admin: true },
      { id: 'automations', label: 'Automatizaciones', icon: 'automations', href: '/os/automatizaciones.html' },
      { id: 'calendar', label: 'Calendario', icon: 'calendar', href: '/os/calendario.html' },
      { id: 'finanzas', label: 'Finanzas', icon: 'analytics', href: '/os/finanzas.html' },
      { id: 'documentos', label: 'Documentos', icon: 'clients', href: '/os/documentos.html' },
      { id: 'reportes', label: 'Reportes', icon: 'analytics', href: '/os/reportes.html' },
    ]},
    { title: 'Organización', items: [
      { id: 'feed', label: 'SP Feed', icon: 'spark', href: '/os/feed.html' },
      { id: 'timeline', label: 'Notificaciones', icon: 'notifications', href: '/os/timeline.html' },
      { id: 'ia-chat', label: 'Chat IA', icon: 'ai', href: '/os/ia-chat.html', admin: true },
      { id: 'ai-agents', label: 'Agentes IA', icon: 'ai', href: '/os/ai-agents.html', admin: true },
      { id: 'intelligence', label: 'SP Intelligence', icon: 'spark', href: '/os/intelligence.html', admin: true },
      { id: 'team', label: 'Equipo', icon: 'team', href: '/os/equipo.html', admin: true },
      { id: 'team-chat', label: 'Chat Interno', icon: 'msg', href: '/os/equipo-interno.html', admin: true },
      { id: 'integrations', label: 'Integraciones', icon: 'api', href: '/os/integraciones.html' },
      { id: 'settings', label: 'Configuración', icon: 'settings', href: '/os/configuracion.html', admin: true },
      { id: 'dedup', label: 'Depurar', icon: 'zap', href: '/os/deduplicar.html', admin: true },
      { id: 'design', label: 'Design System', icon: 'spark', href: '/os/design-system.html' },
    ]},
  ];

  /* --- API helper: usa el backend real, retorna null en error --- */
  async function api(path, opts) {
    try {
      const res = await fetch(path, Object.assign({
        headers: { 'Accept': 'application/json' }, credentials: 'include'
      }, opts || {}));
      if (res.status === 401) { if (!location.pathname.startsWith('/login')) location.replace('/login.html'); return null; }
      let body = null;
      try { body = await res.json(); } catch (e) { /* respuesta sin JSON (204, HTML de error, etc.) */ }
      // En error HTTP, devolver el body igual (trae { error: '...' } del backend) en vez de
      // descartarlo — así los callers pueden mostrar el motivo real en vez de un genérico.
      if (!res.ok) return body || { error: 'http_' + res.status };
      return body;
    } catch (e) {
      return null;
    }
  }

  /* --- Toast --- */
  function toast(msg, kind) {
    let host = document.querySelector('.os-toasts');
    if (!host) { host = document.createElement('div'); host.className = 'os-toasts'; document.body.appendChild(host); }
    const t = document.createElement('div');
    t.className = 'os-toast' + (kind === 'ok' ? ' os-toast--ok' : kind === 'err' ? ' os-toast--err' : '');
    t.innerHTML = (kind === 'ok' ? ICONS.check : kind === 'err' ? ICONS.notifications : ICONS.spark).replace('<svg ', '<svg style="width:15px;height:15px" ') + '<span>' + msg + '</span>';
    host.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s, transform .3s'; t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; setTimeout(() => t.remove(), 320); }, 2600);
  }

  const AV = ['#D4AF37', '#4E7B46', '#5B8DEF', '#B0763C', '#8C6BB0', '#3F8E8E'];
  const avatarColor = (s) => AV[(String(s || '?').length + String(s || '?').charCodeAt(0)) % AV.length];
  const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  // Formatea teléfono: +573001112233 → 300 111 2233
  const fmtPhone = (p) => {
    if (!p) return '';
    const s = String(p).replace(/\D/g, '');
    if (s.startsWith('57') && s.length === 12) return s.slice(2).replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3');
    if (s.length === 10) return s.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3');
    return p;
  };

  /* --- Nav mínima para vendedores --- */
  const NAV_VENDEDOR = [{
    title: 'Mi Trabajo',
    items: [{ id: 'inbox', label: 'Mi Panel', icon: 'inbox', href: '/m/', badge: 'live' }],
  }];

  /* --- Montaje del shell --- */
  async function mount(opts) {
    opts = opts || {};
    const active = opts.active || 'dashboard';
    const me = await api('/api/me');

    // Sin sesión activa → login (siempre, sin modo demo)
    if (!me) { location.replace('/login.html'); return null; }

    // Tres roles con tres paneles diferentes: admin (SP OS aquí en /os/*),
    // supervisor (Supervisor Center en /supervisor/*), vendedor (panel móvil en /m/*).
    // /os/* es EXCLUSIVO del admin. Cualquiera que no sea admin aquí fue redirigido
    // a su propio panel — para no romper la UX de un vendedor ni la de un supervisor.
    const isAdmin = me.rol === 'admin';
    if (!isAdmin) {
      const destino = me.rol === 'supervisor' ? '/supervisor/' : '/m/';
      location.replace(destino);
      return null;
    }

    const navGroups = isAdmin ? NAV : NAV_VENDEDOR;
    const navHTML = navGroups.map(group => {
      const items = group.items.filter(it => !(it.admin && !isAdmin)).map(it => `
        <a class="os-nav__item${it.id === active ? ' active' : ''}" href="${it.href}">
          ${ICONS[it.icon] || ''}<span>${it.label}</span>
          ${it.badge === 'live' ? '<span class="os-nav__badge" id="navBadgeInbox">•</span>' : ''}
        </a>`).join('');
      return `<div class="os-nav__group"><div class="os-nav__title">${group.title}</div>${items}</div>`;
    }).join('');

    const shell = document.createElement('div');
    shell.className = 'os-app' + (opts.panel ? ' has-panel' : '');
    shell.innerHTML = `
      <aside class="os-nav" id="osNav">
        <div class="os-brand">
          <div class="os-brand__mark"><img src="/icons/logo.png" alt="SP Leons Group" style="width:100%;height:100%;object-fit:cover;border-radius:8px"></div>
          <div><div class="os-brand__name">Leons&nbsp;Group</div><div class="os-brand__sub">CRM Inmobiliario</div></div>
        </div>
        <div class="os-workspace">
          <div class="os-workspace__logo">🏡</div>
          <div class="u-grow"><div class="os-workspace__name">Leons Group</div><div class="os-workspace__plan">Inversiones &amp; Finca Raíz</div></div>
        </div>
        <div class="os-nav__scroll">${navHTML}</div>
        <div class="os-nav__foot">
          <div class="os-nav__item" id="osLogout">${ICONS.logout}<span>Cerrar sesión</span></div>
          <div class="os-nav__item" id="osCollapseBtn" title="Minimizar barra">${ICONS.collapse}<span>Minimizar</span></div>
        </div>
      </aside>
      <main class="os-main">
        <header class="os-topbar">
          <button class="btn btn--icon btn--quiet u-hide" id="osMenuBtn" style="margin-left:-8px">${ICONS.menu}</button>
          <div><div class="os-topbar__title">${opts.title || 'Dashboard'}</div>${opts.crumb ? `<div class="os-topbar__crumb">${opts.crumb}</div>` : ''}</div>
          <div class="u-grow"></div>
          <button class="btn btn--icon btn--ghost" id="osThemeBtn" title="Tema"></button>
          <button class="btn btn--icon btn--ghost" id="osNotifBtn" title="Notificaciones" style="position:relative">${ICONS.notifications}<span id="osNotifBadge" style="display:none;position:absolute;top:4px;right:4px;min-width:15px;height:15px;padding:0 3px;border-radius:999px;background:var(--gold,#D4AF37);color:#0A0A0A;font-size:9px;font-weight:700;line-height:15px;text-align:center"></span></button>
          <div class="avatar avatar--sm" style="${me.foto?'' : `background:${avatarColor(me.nombre)}`}" title="${me.nombre}">${me.foto?`<img src="${esc(me.foto)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:initials(me.nombre)}</div>
          ${opts.action || ''}
        </header>
        <div class="os-content${opts.padded ? ' os-content--pad' : ''}" id="osContent"></div>
      </main>
      ${opts.panel ? '<aside class="os-panel" id="osPanel"></aside>' : ''}`;

    document.body.innerHTML = '';
    document.body.appendChild(shell);

    // AI Copilot dock (siempre presente = un solo producto)
    const dock = document.createElement('div');
    dock.className = 'ai-dock';
    dock.innerHTML = `<div class="ai-dock__spark">${ICONS.spark.replace('<svg ', '<svg style="width:16px;height:16px" ')}</div><span class="ai-dock__label">Copiloto SP</span><span class="ai-dock__hint">⌘J</span>`;
    dock.addEventListener('click', abrirCopiloto);
    document.body.appendChild(dock);

    // Eventos
    document.getElementById('osLogout').addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
      location.href = '/login.html';
    });
    const nav = document.getElementById('osNav');
    const mb = document.getElementById('osMenuBtn');
    function updateMenuBtn(){ if(mb){ if(window.innerWidth<=720){ mb.classList.remove('u-hide'); }else{ mb.classList.add('u-hide'); nav.classList.remove('open'); } } }
    if (window.innerWidth <= 720 && mb) { mb.classList.remove('u-hide'); mb.addEventListener('click', () => nav.classList.toggle('open')); }
    let _resizeTimer; window.addEventListener('resize',()=>{ clearTimeout(_resizeTimer); _resizeTimer=setTimeout(updateMenuBtn,150); });
    window.addEventListener('keydown', (e) => { if (e.key === 'j' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); abrirCopiloto(); } });

    /* --- Sidebar colapsable: toggle + tooltip lateral custom --- */
    const osApp = document.querySelector('.os-app');
    const collapseBtn = document.getElementById('osCollapseBtn');
    function setCollapseBtnIcon(collapsed) {
      if (!collapseBtn) return;
      const span = collapseBtn.querySelector('span');
      const svg = collapseBtn.querySelector('svg');
      const newIcon = collapsed ? ICONS.expand : ICONS.collapse;
      const wrapper = document.createElement('span');
      wrapper.innerHTML = newIcon;
      if (svg) svg.replaceWith(wrapper.firstChild); else collapseBtn.insertBefore(wrapper.firstChild, span);
      if (span) span.textContent = collapsed ? 'Expandir' : 'Minimizar';
      collapseBtn.title = collapsed ? 'Expandir barra' : 'Minimizar barra';
    }
    if (collapseBtn && osApp) {
      collapseBtn.addEventListener('click', () => {
        osApp.classList.toggle('nav-collapsed');
        setCollapseBtnIcon(osApp.classList.contains('nav-collapsed'));
        const tip = document.getElementById('osNavTip'); if (tip) tip.remove();
      });
    }
    function showNavTip(label, rect) {
      let tip = document.getElementById('osNavTip');
      if (tip) tip.remove();
      tip = document.createElement('div');
      tip.id = 'osNavTip'; tip.className = 'os-nav__tip'; tip.textContent = label;
      document.body.appendChild(tip);
      const top = rect.top + rect.height / 2 - tip.offsetHeight / 2;
      tip.style.left = (rect.right + 8) + 'px';
      tip.style.top = Math.max(8, Math.min(window.innerHeight - tip.offsetHeight - 8, top)) + 'px';
      requestAnimationFrame(() => tip.classList.add('show'));
    }
    function hideNavTip() { const tip = document.getElementById('osNavTip'); if (tip) tip.remove(); }
    nav.querySelectorAll('.os-nav__item').forEach(el => {
      el.addEventListener('mouseenter', () => {
        if (!osApp || !osApp.classList.contains('nav-collapsed')) return;
        const span = el.querySelector('span:not(.os-nav__badge)');
        if (!span || !span.textContent) return;
        showNavTip(span.textContent, el.getBoundingClientRect());
        el.addEventListener('mouseleave', hideNavTip, { once: true });
      });
    });
    nav.querySelectorAll('.os-nav__title').forEach(el => {
      el.addEventListener('mouseenter', () => {
        if (!osApp || !osApp.classList.contains('nav-collapsed')) return;
        if (!el.textContent.trim()) return;
        showNavTip(el.textContent.trim(), el.getBoundingClientRect());
        el.addEventListener('mouseleave', hideNavTip, { once: true });
      });
    });

    initThemeToggle();
    initNotificaciones();
    initStream();

    return { me, content: document.getElementById('osContent'), panel: document.getElementById('osPanel') };
  }

  /* ── Tiempo real compartido: UNA conexión SSE a nivel de shell ──
     Cualquier página admin puede suscribirse: SPOS.on('lead_actualizado', fn) */
  let _es = null;
  const _listeners = {};
  function on(evento, fn) {
    if (!_listeners[evento]) _listeners[evento] = [];
    _listeners[evento].push(fn);
    if (_es) _es.addEventListener(evento, fn);
  }
  function initStream() {
    if (_es) return;
    try {
      _es = new EventSource('/api/stream');
      ['nuevo_mensaje', 'lead_actualizado', 'message:new', 'conversation:assigned', 'conversation:closed', 'status_update', 'notificacion'].forEach(ev => {
        (_listeners[ev] || []).forEach(fn => _es.addEventListener(ev, fn));
      });
      _es.addEventListener('notificacion', (e) => {
        try {
          const d = JSON.parse(e.data);
          setNotifBadge(getNotifBadge() + 1);
          toast(`${esc(d.titulo || 'Notificación')}${d.cuerpo ? ' — ' + esc(String(d.cuerpo).slice(0, 60)) : ''}`);
        } catch (err) { /* noop */ }
      });
      _es.onerror = () => { try { _es.close(); } catch (e) {} _es = null; setTimeout(initStream, 5000); };
    } catch (e) { /* SSE no disponible */ }
  }

  /* ── Selector de tema (Sistema/Claro/Oscuro) — motor real en /os/theme.js,
     esto solo dibuja el botón + dropdown y llama VidaTheme.set(). ── */
  function themeIcon(pref) {
    return pref === 'light' ? ICONS.sun : pref === 'dark' ? ICONS.moon : ICONS.monitor;
  }
  function initThemeToggle() {
    const btn = document.getElementById('osThemeBtn');
    if (!btn || !window.VidaTheme) return;
    const render = () => { btn.innerHTML = themeIcon(window.VidaTheme.get()); };
    render();

    const OPTS = [
      { v: 'system', label: 'Sistema', icon: 'monitor' },
      { v: 'light', label: 'Claro', icon: 'sun' },
      { v: 'dark', label: 'Oscuro', icon: 'moon' },
    ];
    let panel = null;
    const cerrar = () => { if (panel) { panel.remove(); panel = null; } };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (panel) { cerrar(); return; }
      const actual = window.VidaTheme.get();
      panel = document.createElement('div');
      panel.style.cssText = 'position:fixed;top:56px;right:16px;width:180px;background:var(--bg-1);border:1px solid var(--border);border-radius:12px;z-index:9999;box-shadow:0 16px 48px rgba(0,0,0,.25);overflow:hidden';
      panel.innerHTML = OPTS.map(o => `
        <div class="os-theme-opt" data-v="${o.v}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;font-size:13px;font-weight:500;${o.v === actual ? 'color:var(--gold,#D4AF37);background:var(--gold-soft,rgba(212,175,55,.1))' : 'color:var(--text)'}">
          <span style="width:16px;height:16px;display:flex">${ICONS[o.icon].replace('<svg ', '<svg style="width:16px;height:16px" ')}</span>
          <span>${o.label}</span>
        </div>`).join('');
      document.body.appendChild(panel);
      panel.querySelectorAll('.os-theme-opt').forEach(el => {
        el.addEventListener('mouseenter', () => { if (el.dataset.v !== actual) el.style.background = 'var(--bg-2)'; });
        el.addEventListener('mouseleave', () => { if (el.dataset.v !== actual) el.style.background = ''; });
        el.addEventListener('click', () => { window.VidaTheme.set(el.getAttribute('data-v')); cerrar(); });
      });
      setTimeout(() => document.addEventListener('click', function onDoc(ev) {
        if (panel && !panel.contains(ev.target) && ev.target !== btn && !btn.contains(ev.target)) { cerrar(); document.removeEventListener('click', onDoc); }
      }), 50);
    });
    // El sistema puede cambiar en vivo (pref='system' y cambia el modo del SO) — mantener
    // el ícono del botón sincronizado sin que el usuario tenga que reabrir nada.
    document.addEventListener('vida:theme-changed', render);
  }

  /* ── Centro de notificaciones (campana del topbar) ── */
  function getNotifBadge() {
    const b = document.getElementById('osNotifBadge');
    return b ? Number(b.textContent) || 0 : 0;
  }
  function setNotifBadge(n) {
    const b = document.getElementById('osNotifBadge');
    if (!b) return;
    if (n > 0) { b.textContent = n > 99 ? '99+' : String(n); b.style.display = 'block'; }
    else { b.style.display = 'none'; b.textContent = ''; }
  }
  function tiempoRelativo(ts) {
    const s = Math.floor((Date.now() - Number(ts)) / 1000);
    if (s < 60) return 'ahora';
    if (s < 3600) return Math.floor(s / 60) + ' min';
    if (s < 86400) return Math.floor(s / 3600) + ' h';
    return Math.floor(s / 86400) + ' d';
  }
  async function initNotificaciones() {
    const btn = document.getElementById('osNotifBtn');
    if (!btn) return;
    const data = await api('/api/notificaciones?limit=30');
    if (data) setNotifBadge(data.sin_leer || 0);

    let panel = null;
    btn.addEventListener('click', async () => {
      if (panel) { panel.remove(); panel = null; return; }
      const d = await api('/api/notificaciones?limit=30');
      const items = (d && d.notificaciones) || [];
      panel = document.createElement('div');
      panel.style.cssText = 'position:fixed;top:calc(56px + env(safe-area-inset-top, 0px));right:16px;width:340px;max-width:calc(100vw - 32px);max-height:65vh;overflow-y:auto;background:var(--bg-0,#111);border:1px solid var(--border,#222);border-radius:12px;z-index:9999;box-shadow:0 16px 48px rgba(0,0,0,.5)';
      panel.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border-soft,#1a1a1a)">
          <span style="font-weight:600;font-size:13px">Notificaciones</span>
          <button class="btn btn--ghost btn--xs" id="osNotifLeerTodas" style="font-size:11px">Marcar leídas</button>
        </div>
        ${items.length === 0 ? '<div style="padding:22px;text-align:center;color:var(--text-3,#777);font-size:12px">Sin notificaciones</div>' : items.map(n => `
          <div data-lead="${n.lead_id || ''}" class="os-notif-item" style="padding:11px 14px;border-bottom:1px solid var(--border-soft,#1a1a1a);cursor:${n.lead_id ? 'pointer' : 'default'};${n.leida ? 'opacity:.55' : ''}">
            <div style="font-size:12.5px;font-weight:600;margin-bottom:2px">${esc(n.titulo || '')}</div>
            ${n.cuerpo ? `<div style="font-size:12px;color:var(--text-2,#999);line-height:1.4">${esc(n.cuerpo)}</div>` : ''}
            <div style="font-size:10.5px;color:var(--text-3,#777);margin-top:3px">${tiempoRelativo(n.created_at)}</div>
          </div>`).join('')}`;
      document.body.appendChild(panel);
      panel.querySelector('#osNotifLeerTodas').addEventListener('click', async () => {
        await api('/api/notificaciones/leer-todas', { method: 'POST' });
        setNotifBadge(0);
        panel.remove(); panel = null;
      });
      panel.querySelectorAll('.os-notif-item[data-lead]').forEach(el => {
        const leadId = el.getAttribute('data-lead');
        if (leadId) el.addEventListener('click', () => { location.href = '/os/inbox.html?lead=' + leadId; });
      });
      const cerrar = (e) => { if (panel && !panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) { panel.remove(); panel = null; document.removeEventListener('click', cerrar); } };
      setTimeout(() => document.addEventListener('click', cerrar), 50);
    });
  }

  /* ── Copiloto SP: panel flotante con IA ── */
  let copilotoAbierto = false, copilotoModal = null;

  async function abrirCopiloto() {
    if (copilotoAbierto) { cerrarCopiloto(); return; }
    copilotoAbierto = true;

    const overlay = document.createElement('div');
    overlay.className = 'os-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9998;opacity:0;transition:opacity .2s';
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.style.opacity = '1');
    overlay.addEventListener('click', cerrarCopiloto);

    // Cargar briefing
    const data = await api('/api/nlp/daily-briefing', { method: 'POST' });
    const brief = data?.briefing || null;
    const stats = data?.stats || {};

    const modal = document.createElement('div');
    modal.className = 'os-modal';
    modal.style.cssText = 'position:fixed;bottom:calc(90px + env(safe-area-inset-bottom, 0px));right:24px;width:380px;max-width:calc(100vw - 32px);max-height:70vh;background:var(--bg-0);border:1px solid var(--border);border-radius:var(--r);z-index:9999;box-shadow:0 16px 64px rgba(0,0,0,.5);display:flex;flex-direction:column;opacity:0;transform:translateY(12px) scale(.97);transition:all .2s cubic-bezier(.16,1,.3,1)';
    modal.id = 'copilotoModal';
    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border-soft)">
        <div style="display:flex;align-items:center;gap:8px">
          ${ICONS.spark.replace('<svg ', '<svg style="width:16px;height:16px;color:var(--gold)" ')}
          <span style="font-weight:600;font-size:14px">Copiloto SP</span>
          ${brief ? '<span style="font-size:10px;padding:2px 8px;border-radius:999px;background:var(--gold-soft);color:var(--gold)">' + (data?.model || 'IA') + '</span>' : '<span style="font-size:10px;padding:2px 8px;border-radius:999px;background:var(--bg-3);color:var(--text-3)">Sin conexión</span>'}
        </div>
        <button class="btn btn--icon btn--quiet" id="copilotoClose" style="width:28px;height:28px">${ICONS.menu.replace('<svg ', '<svg style="width:16px;height:16px" ')}</button>
      </div>
      <div style="flex:1;overflow-y:auto;padding:14px 18px">
        ${brief ? `
        <div style="margin-bottom:14px">
          <div style="font-size:11px;color:var(--text-3);text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Consejo del día</div>
          <p style="font-size:13px;color:var(--text);line-height:1.5">${esc(brief.tip || '')}</p>
        </div>
        <div style="margin-bottom:14px">
          <div style="font-size:11px;color:var(--text-3);text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Prioridad</div>
          <p style="font-size:13px;color:var(--gold);line-height:1.5">${esc(brief.priorityAction || '')}</p>
        </div>
        <div style="margin-bottom:14px;padding:12px;background:var(--bg-2);border-radius:var(--r-sm)">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:center">
            <div><div style="font-size:20px;font-weight:700;color:var(--gold)">${stats.activos || 0}</div><div style="font-size:10px;color:var(--text-3)">Leads activos</div></div>
            <div><div style="font-size:20px;font-weight:700;color:${stats.sinResponder > 0 ? '#e74c3c' : 'var(--gold)'}">${stats.sinResponder || 0}</div><div style="font-size:10px;color:var(--text-3)">Sin responder</div></div>
          </div>
        </div>
        ` : `
        <div style="text-align:center;padding:24px 0;color:var(--text-3)">
          <p style="font-size:13px">${data?.error || 'No hay conexión con la IA'}</p>
          <p style="font-size:11px;margin-top:6px">Configura tu API Key en <a href="/os/configuracion.html" style="color:var(--gold)">Ajustes → IA Copiloto</a></p>
        </div>
        `}
        ${brief ? `
        <div>
          <div style="font-size:11px;color:var(--text-3);text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px">Frase del día</div>
          <p style="font-size:12.5px;color:var(--text-2);font-style:italic;line-height:1.5">"${esc(brief.fraseDelDia || '')}"</p>
        </div>
        ` : ''}
      </div>
      <div style="padding:10px 18px;border-top:1px solid var(--border-soft);display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn--ghost btn--sm" onclick="SPOS.toast('Abrir Inbox','ok');location.href='/os/inbox.html'" style="font-size:11px">Ir a Inbox</button>
        <button class="btn btn--ghost btn--sm" onclick="SPOS.toast('Abrir CRM','ok');location.href='/os/crm.html'" style="font-size:11px">Ir a CRM</button>
        <button class="btn btn--ghost btn--sm" onclick="SPOS.toast('Configurar IA','ok');location.href='/os/configuracion.html'" style="font-size:11px">Configurar IA</button>
      </div>`;

    document.body.appendChild(modal);
    copilotoModal = modal;
    requestAnimationFrame(() => { modal.style.opacity = '1'; modal.style.transform = 'translateY(0) scale(1)'; });

    document.getElementById('copilotoClose')?.addEventListener('click', cerrarCopiloto);
    // Cerrar con Escape
    const escHandler = (e) => { if (e.key === 'Escape') { cerrarCopiloto(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);
  }

  function cerrarCopiloto() {
    copilotoAbierto = false;
    const modal = document.getElementById('copilotoModal');
    if (modal) { modal.style.opacity = '0'; modal.style.transform = 'translateY(8px) scale(.97)'; setTimeout(() => modal.remove(), 200); }
    document.querySelectorAll('.os-overlay').forEach(el => { el.style.opacity = '0'; setTimeout(() => el.remove(), 200); });
  }

  /* ── Helper para sugerir respuesta desde inbox/crm ── */
  async function sugerirRespuesta(leadId, customerName) {
    if (!leadId) { toast('No hay lead seleccionado', 'err'); return []; }
    try {
      const res = await fetch('/api/nlp/suggest-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ leadId, customerName: customerName || '' })
      });
      const data = await res.json();
      if (!data || !data.suggestions || !data.suggestions.length) {
        toast('No se pudieron generar sugerencias. ¿API Key configurada?', 'err');
        return [];
      }
      return data.suggestions;
    } catch (e) {
      toast('Error al conectar con IA', 'err');
      return [];
    }
  }

  function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  /* --- Tabs helper: SPOS.tabs(rootEl) — alterna .active entre .tabs__item y .tabs__pane --- */
  function tabs(root) {
    if (!root) return;
    const items = root.querySelectorAll('.tabs__item');
    items.forEach(t => t.addEventListener('click', () => {
      const target = t.dataset.tab;
      root.querySelectorAll('.tabs__item').forEach(x => x.classList.toggle('active', x === t));
      root.parentNode.querySelectorAll('.tabs__pane').forEach(p => p.classList.toggle('active', p.dataset.tab === target));
    }));
  }

  /* --- sortTable helper: SPOS.sortTable(tableEl) — clic en th ordena con flecha + aria-sort --- */
  function sortTable(table) {
    if (!table) return;
    const ths = table.querySelectorAll('thead th');
    ths.forEach((th, idx) => {
      if (th.dataset.noSort !== undefined) return;
      th.style.cursor = 'pointer';
      th.dataset.sortDir = '';
      th.addEventListener('click', () => {
        const tbody = table.querySelector('tbody');
        if (!tbody) return;
        const rows = Array.from(tbody.querySelectorAll('tr'));
        if (!rows.length) return;
        const dir = th.dataset.sortDir === 'asc' ? 'desc' : 'asc';
        ths.forEach(x => { x.dataset.sortDir = ''; const ar = x.querySelector('.sort-ar'); if (ar) ar.remove(); x.removeAttribute('aria-sort'); });
        th.dataset.sortDir = dir;
        const ar = document.createElement('span'); ar.className = 'sort-ar'; ar.textContent = dir === 'asc' ? ' ↑' : ' ↓'; th.appendChild(ar);
        th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
        const numIdx = th.dataset.sortType === 'num';
        rows.sort((a, b) => {
          const va = (a.cells[idx] && a.cells[idx].textContent) ? a.cells[idx].textContent.trim() : '';
          const vb = (b.cells[idx] && b.cells[idx].textContent) ? b.cells[idx].textContent.trim() : '';
          let cmp;
          if (numIdx || th.dataset.sortKey === 'num') {
            const na = parseFloat(va.replace(/[^\d.-]/g, '')); const nb = parseFloat(vb.replace(/[^\d.-]/g, ''));
            cmp = (!isNaN(na) && !isNaN(nb)) ? na - nb : 0;
          } else {
            cmp = va.localeCompare(vb, 'es');
          }
          return dir === 'asc' ? cmp : -cmp;
        });
        rows.forEach(r => tbody.appendChild(r));
      });
    });
  }

  window.SPOS = { ICONS, NAV, api, toast, mount, avatarColor, initials, fmtPhone, abrirCopiloto, sugerirRespuesta, cerrarCopiloto, esc, on, tabs, sortTable,
    fmt: {
      n: (v) => (v == null ? '—' : Number(v).toLocaleString('es-CO')),
      money: (v) => (v == null ? '—' : '$' + Number(v).toLocaleString('es-CO')),
      pct: (v) => (v == null ? '—' : v + '%'),
    }
  };
})();
