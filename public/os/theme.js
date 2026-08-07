/* ============================================================================
   Vid.a / SP OS — Motor de tema (Claro / Oscuro / Sistema)
   Carga bloqueante, ANTES de sp-os.css, en el <head> de cada página — así fija
   data-theme antes del primer paint (sin esto, la página pintaría oscuro y
   luego saltaría a claro: el "flash" que este archivo existe para evitar).
   Un solo archivo para admin (/os/*.html, login.html) y móvil (/m/) — ambos lo
   cargan por ruta absoluta, así que un solo lugar define la verdad del tema.
   ============================================================================ */
(function () {
  'use strict';

  var KEY = 'vida_theme'; // valores: 'system' | 'light' | 'dark'
  var root = document.documentElement;

  function getPref() {
    try { return localStorage.getItem(KEY) || 'system'; } catch (e) { return 'system'; }
  }

  function systemPrefersLight() {
    try { return matchMedia('(prefers-color-scheme: light)').matches; } catch (e) { return false; }
  }

  function resolve(pref) {
    return pref === 'system' ? (systemPrefersLight() ? 'light' : 'dark') : pref;
  }

  function updateThemeColorMeta(resolved) {
    try {
      var color = resolved === 'light' ? '#F4EFE3' : '#0A0A0A';
      var meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'theme-color';
        (document.head || document.documentElement).appendChild(meta);
      }
      meta.content = color;
    } catch (e) { /* no bloquea el resto del theming */ }
  }

  function syncCapacitorStatusBar(resolved) {
    // Solo aplica dentro de la app nativa del asesor (/m/); en admin (navegador normal)
    // window.Capacitor no existe y esto no hace nada. Mismo patrón defensivo que ya usa
    // el resto del código nativo: isPluginAvailable antes de tocar el plugin.
    try {
      if (window.Capacitor && window.Capacitor.isPluginAvailable && window.Capacitor.isPluginAvailable('StatusBar')) {
        var StatusBar = window.Capacitor.Plugins.StatusBar;
        // Style claro de fondo → texto/iconos oscuros de la barra (Style.Dark en la API
        // de Capacitor significa "contenido oscuro", pensado para fondos claros).
        StatusBar.setStyle({ style: resolved === 'light' ? 'Dark' : 'Light' }).catch(function () {});
        StatusBar.setBackgroundColor({ color: resolved === 'light' ? '#F4EFE3' : '#0A0A0A' }).catch(function () {});
      }
    } catch (e) { /* no nativo o plugin ausente — nada que hacer */ }
  }

  function apply(pref) {
    var resolved = resolve(pref);
    if (resolved === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme'); // oscuro = default de :root, sin atributo
    root.style.colorScheme = resolved;
    updateThemeColorMeta(resolved);
    syncCapacitorStatusBar(resolved);
    return resolved;
  }

  // Clase temporal (200ms, ver sp-os.css) para que el cambio de tema se sienta como
  // transición y no como parpadeo — solo tiene sentido cuando el usuario ya está viendo
  // la página (document.body existe); en la carga inicial no se usa, ahí no hay nada que
  // "transicionar" todavía.
  function withTransition(fn) {
    var b = document.body;
    if (!b) { fn(); return; }
    b.classList.add('theming');
    fn();
    setTimeout(function () { b.classList.remove('theming'); }, 250);
  }

  function set(pref) {
    try { localStorage.setItem(KEY, pref); } catch (e) {}
    var resolved;
    withTransition(function () { resolved = apply(pref); });
    document.dispatchEvent(new CustomEvent('vida:theme-changed', { detail: { pref: pref, resolved: resolved } }));
    return resolved;
  }

  // Aplica de inmediato — esto es lo que evita el flash, corre en el primer tick del <head>.
  apply(getPref());

  // Cambio de tema del sistema operativo en vivo (solo importa si pref === 'system').
  try {
    var mq = matchMedia('(prefers-color-scheme: light)');
    var onSystemChange = function () {
      if (getPref() !== 'system') return;
      var r;
      withTransition(function () { r = apply('system'); });
      document.dispatchEvent(new CustomEvent('vida:theme-changed', { detail: { pref: 'system', resolved: r } }));
    };
    if (mq.addEventListener) mq.addEventListener('change', onSystemChange);
    else if (mq.addListener) mq.addListener(onSystemChange); // Safari viejo / WebView Android antiguo
  } catch (e) {}

  window.VidaTheme = {
    THEMES: ['system', 'light', 'dark'],
    get: getPref,
    resolved: function () { return resolve(getPref()); },
    set: set,
    cycle: function () {
      var order = ['system', 'light', 'dark'];
      var next = order[(order.indexOf(getPref()) + 1) % order.length];
      set(next);
      return next;
    },
  };
})();
