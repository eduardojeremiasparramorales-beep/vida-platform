/* ============================================================================
   Supervisor Center — Shell runtime
   Panel del rol supervisor. Reusa el design system SP OS (sp-os.css + theme.js)
   y los helpers de SPOS (api, toast, ICONS, on, fmt), pero con SU PROPIO shell
   porque sp-shell.js es exclusivo del admin y redirige a cualquier no-admin.
   El supervisor NO debe caer a /m/ (panel del asesor) — su panel es /supervisor/.
   ============================================================================ */
(function () {
  'use strict';

  /* --- Navegación del Supervisor Center (8 secciones = 8 Sprints) ---
     href solo se pone cuando la página del sprint existe; sin href el ítem se
     pinta gris sin enlace (la sección aún no está implementada). */
  const NAV = [
    { title: 'Supervisión', items: [
      { id: 'inicio', label: 'Inicio', icon: 'dashboard', href: '/supervisor/index.html' },
      { id: 'dashboard', label: 'Dashboard', icon: 'analytics', href: '/supervisor/dashboard.html' },
      { id: 'equipo', label: 'Equipo', icon: 'team', href: '/supervisor/equipo.html' },
      { id: 'conversaciones', label: 'Conversaciones', icon: 'inbox', href: '/supervisor/conversaciones.html' },
      { id: 'alertas', label: 'Alertas', icon: 'activity', badge: 'live' },
    ]},
    { title: 'Inteligencia & Cultura', items: [
      { id: 'feed', label: 'SP Feed', icon: 'spark', href: '/supervisor/feed.html' },
      { id: 'ia', label: 'IA Copiloto', icon: 'ai', href: '/supervisor/ia.html' },
      { id: 'analitica', label: 'Analítica', icon: 'analytics', href: '/supervisor/analitica.html' },
    ]},
  ];

  // Íconos básicos que el shell necesita aunque el resto venga de SPOS.ICONS.
  const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICONS_LOCAL = {
    logout: P('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>'),
    sun: P('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    moon: P('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
    monitor: P('<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
    bell: P('<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
    menu: P('<path d="M3 6h18M3 12h18M3 18h18"/>'),
  };

  /* --- API + redirect por auth (igual que sp-shell.js pero para supervisor) --- */
  async function api(path, opts) {
    try {
      const res = await fetch(path, Object.assign({
        headers: { 'Accept': 'application/json' }, credentials: 'include'
      }, opts || {}));
      if (res.status === 401) { location.replace('/login.html'); return null; }
      if (res.status === 403) { // sesión válida pero rol equivocado → a su panel correcto
        const me = await fetch('/api/me', { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null);
        if (me) location.replace(me.rol === 'admin' ? '/os/dashboard.html' : '/m/');
        else location.replace('/login.html');
        return null;
      }
      let body = null;
      try { body = await res.json(); } catch (e) {}
      if (!res.ok) return body || { error: 'http_' + res.status };
      return body;
    } catch (e) { return null; }
  }

  function toast(msg, kind) {
    if (window.SPOS && typeof SPOS.toast === 'function') return SPOS.toast(msg, kind);
    let host = document.querySelector('.os-toasts');
    if (!host) { host = document.createElement('div'); host.className = 'os-toasts'; document.body.appendChild(host); }
    const t = document.createElement('div');
    t.className = 'os-toast' + (kind === 'ok' ? ' os-toast--ok' : kind === 'err' ? ' os-toast--err' : '');
    t.innerHTML = '<span>' + msg + '</span>';
    host.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s, transform .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, 2400);
  }

  const AV = ['#D4AF37', '#4E7B46', '#5B8DEF', '#B0763C', '#8C6BB0', '#3F8E8E'];
  const avatarColor = (s) => AV[(String(s || '?').length + String(s || '?').charCodeAt(0)) % AV.length];
  const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

  /* --- Montaje del shell del Supervisor Center --- */
  async function mount(opts) {
    opts = opts || {};
    const active = opts.active || 'inicio';

    // Sesión del supervisor (api() ya redirige si no es supervisor).
    const me = await api('/api/me');
    if (!me || me.rol !== 'supervisor') {
      // api() ya redirigió; si por algún edge case no, mandamos al login explícitamente.
      if (me) location.replace(me.rol === 'admin' ? '/os/dashboard.html' : me.rol === 'vendedor' ? '/m/' : '/login.html');
      return null;
    }

    const ICONS = (window.SPOS && window.SPOS.ICONS) || {};

    const navHTML = NAV.map(group => {
      const items = group.items.map(it => {
        const ic = ICONS[it.icon] || ICONS_LOCAL[it.icon] || '';
        return `<a class="os-nav__item${it.id === active ? ' active' : ''}" data-section="${it.id}"${it.href ? ` href="${it.href}"` : ''}>
          ${ic.replace('<svg ', '<svg style="width:18px;height:18px" ') || ''}<span>${it.label}</span>
          ${it.badge === 'live' ? '<span class="os-nav__badge" id="navBadgeAlertas" style="display:none;min-width:16px;height:16px;border-radius:999px;background:var(--gold,#D4AF37);color:#0A0A0A;font-size:9.5px;font-weight:700;align-items:center;justify-content:center;padding:0 4px;margin-left:auto">0</span>' : ''}
        </a>`;
      }).join('');
      return `<div class="os-nav__group"><div class="os-nav__title">${group.title}</div>${items}</div>`;
    }).join('');

    const shell = document.createElement('div');
    shell.className = 'os-app';
    shell.innerHTML = `
      <aside class="os-nav" id="osNav">
        <div class="os-brand">
          <div class="os-brand__mark"><img src="/icons/logo.png" alt="SP Leons Group" style="width:100%;height:100%;object-fit:cover;border-radius:8px"></div>
          <div><div class="os-brand__name">Leons&nbsp;Group</div><div class="os-brand__sub">Supervisor Center</div></div>
        </div>
        <div class="os-workspace">
          <div class="os-workspace__logo">🛡️</div>
          <div class="u-grow"><div class="os-workspace__name">Supervisión</div><div class="os-workspace__plan">${esc(me.nombre)}</div></div>
        </div>
        <div class="os-nav__scroll">${navHTML}</div>
        <div class="os-nav__foot">
          <a class="os-nav__item" href="/login.html" id="osLogout">${ICONS_LOCAL.logout}<span>Cerrar sesión</span></a>
        </div>
      </aside>
      <main class="os-main">
        <header class="os-topbar">
          <button class="btn btn--icon btn--quiet u-hide" id="osMenuBtn" style="margin-left:-8px">${ICONS_LOCAL.menu}</button>
          <div><div class="os-topbar__title" id="osTitle">${opts.title || 'Inicio'}</div>${opts.crumb ? `<div class="os-topbar__crumb">${opts.crumb}</div>` : ''}</div>
          <div class="u-grow"></div>
          <button class="btn btn--icon btn--ghost" id="osThemeBtn" title="Tema"></button>
          <button class="btn btn--icon btn--ghost" id="osNotifBtn" title="Notificaciones" style="position:relative">${ICONS_LOCAL.bell}<span id="osNotifBadge" style="display:none;position:absolute;top:4px;right:4px;min-width:15px;height:15px;padding:0 3px;border-radius:999px;background:var(--gold,#D4AF37);color:#0A0A0A;font-size:9px;font-weight:700;line-height:15px;text-align:center"></span></button>
          <div class="avatar avatar--sm" style="background:${avatarColor(me.nombre)}" title="${me.nombre}">${initials(me.nombre)}</div>
        </header>
        <div class="os-content os-content--pad" id="osContent"></div>
      </main>`;

    document.body.innerHTML = '';
    document.body.appendChild(shell);

    // Logout: cierra sesión y vuelve al login.
    document.getElementById('osLogout').addEventListener('click', async (e) => {
      e.preventDefault();
      await fetch('/api/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
      location.href = '/login.html';
    });

    // Sidebar responsive (mismo patrón de sp-shell.js).
    const nav = document.getElementById('osNav');
    const mb = document.getElementById('osMenuBtn');
    function updateMenuBtn(){ if(mb){ if(window.innerWidth<=720){ mb.classList.remove('u-hide'); }else{ mb.classList.add('u-hide'); nav.classList.remove('open'); } } }
    if (window.innerWidth <= 720 && mb) { mb.classList.remove('u-hide'); mb.addEventListener('click', () => nav.classList.toggle('open')); }
    let _resizeTimer; window.addEventListener('resize',()=>{ clearTimeout(_resizeTimer); _resizeTimer=setTimeout(updateMenuBtn,150); });

    // Selector de tema (igual que sp-shell.js — reusa /os/theme.js).
    initThemeToggle();

    // Tiempo real: suscripción al SSE del panel.
    initStream();

    // Cargar conteo inicial de alertas sin leer para el badge del NAV
    api('/api/supervisor/alertas/sin-leer')
      .then(r => {
        if (r && r.sin_leer > 0) {
          const b = document.getElementById('navBadgeAlertas');
          if (b) { b.textContent = String(r.sin_leer); b.style.display = 'inline-flex'; }
        }
      })
      .catch(() => {});

    return { me, content: document.getElementById('osContent'), esc };
  }

  /* --- Selector de tema (espejo de sp-shell.js pero autónomo) --- */
  function themeIcon(pref) {
    return pref === 'light' ? ICONS_LOCAL.sun : pref === 'dark' ? ICONS_LOCAL.moon : ICONS_LOCAL.monitor;
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
          <span style="width:16px;height:16px;display:flex">${ICONS_LOCAL[o.icon]}</span>
          <span>${o.label}</span>
        </div>`).join('');
      document.body.appendChild(panel);
      panel.querySelectorAll('.os-theme-opt').forEach(el => {
        el.addEventListener('click', () => { window.VidaTheme.set(el.getAttribute('data-v')); cerrar(); });
      });
      setTimeout(() => document.addEventListener('click', function onDoc(ev) {
        if (panel && !panel.contains(ev.target) && ev.target !== btn && !btn.contains(ev.target)) { cerrar(); document.removeEventListener('click', onDoc); }
      }), 50);
    });
    document.addEventListener('vida:theme-changed', render);
  }

  /* --- SSE: el supervisor escucha el canal 0 (alertas admin) — ya cableado en index.js --- */
  let _es = null;
  function initStream() {
    if (_es) return;
    try {
      _es = new EventSource('/api/stream');
      _es.addEventListener('notificacion', (e) => {
        try {
          const d = JSON.parse(e.data);
          toast(`${esc(d.titulo || 'Notificación')}${d.cuerpo ? ' — ' + esc(String(d.cuerpo).slice(0, 60)) : ''}`);
          const b = document.getElementById('navBadgeAlertas');
          if (b) { const cur = parseInt(b.textContent, 10) || 0; b.textContent = cur + 1; b.style.display = 'inline-flex'; }
        } catch (err) {}
      });
      _es.addEventListener('nuevo_mensaje', (e) => {
        // Llega alerta del equipo (lead sin responder, reasignación, etc.) — encender badge Alertas.
        const b = document.getElementById('navBadgeAlertas');
        if (b) {
          const cur = parseInt(b.textContent, 10) || 0;
          b.textContent = cur + 1;
          b.style.display = 'inline-flex';
        }
      });
      _es.onerror = () => { try { _es.close(); } catch (e) {} _es = null; setTimeout(initStream, 5000); };
    } catch (e) {}
  }

  /* --- Pequeños helpers de escape / formato --- */
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&','<':'<','>':'>','"':'"',"'":'&#39;'}[c])); }

  // Exponer al window para que cada sección (cuando se separan a archivos en S2+) pueda montar su contenido.
  window.SPS = { mount, api, toast, esc, avatarColor, initials };
})();
