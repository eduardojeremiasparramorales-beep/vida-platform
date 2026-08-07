/**
 * Meta Pixel — SP Leons Group
 * Inyectar en páginas públicas para tracking de conversiones.
 *
 * Uso: <script src="/js/pixel.js"></script>
 * El pixel ID se obtiene automáticamente del endpoint /api/pixel-config.
 *
 * Eventos disponibles (vía SPPixel):
 *   SPPixel.track('Lead')              — lead generado
 *   SPPixel.track('CompleteRegistration') — registro completado
 *   SPPixel.track('ViewContent', { content_name: 'Proyecto X' }) — vista de proyecto
 *   SPPixel.trackCustom('WhatsAppClick', { source: 'boton' }) — clic en WhatsApp
 */
(function() {
  'use strict';

  window.SPPixel = {
    _ready: false,
    _queue: [],
    _pixelId: null,

    track: function(event, params) {
      if (window.fbq) window.fbq('track', event, params || {});
      else this._queue.push(['track', event, params]);
    },
    trackCustom: function(name, params) {
      if (window.fbq) window.fbq('trackCustom', name, params || {});
      else this._queue.push(['trackCustom', name, params]);
    },
    getPixelId: function() { return this._pixelId; },
  };

  // Fetch pixel ID from server and initialize
  fetch('/api/pixel-config', { credentials: 'samehere' })
    .then(function(r) { return r.json(); })
    .then(function(cfg) {
      var pixelId = cfg.pixelId;
      if (!pixelId) return;

      window.SPPixel._pixelId = pixelId;

      // Inject Meta Pixel library
      (function(f,b,e,v,n,t,s){
        if(f.fbq)return;n=f.fbq=function(){
          n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)
        };
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s);
      })(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');

      window.fbq('init', pixelId);
      window.fbq('track', 'PageView');

      // Flush queued events
      window.SPPixel._queue.forEach(function(args) {
        window.fbq.apply(null, args);
      });
      window.SPPixel._queue = [];
      window.SPPixel._ready = true;
    })
    .catch(function() {});

  // Auto-track: clic en enlaces wa.me / whatsapp
  document.addEventListener('click', function(e) {
    var link = e.target.closest('a[href*="wa.me"], a[href*="wa.link"], a[href*="whatsapp.com"]');
    if (link && window.fbq) {
      window.fbq('trackCustom', 'WhatsAppClick', {
        url: link.href,
        source: document.title,
      });
    }
  }, true);
})();
