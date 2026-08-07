/* ═══════ SP OS · Safe areas universales + teclado ═══════
   Android WebView (Capacitor) NO expone env(safe-area-inset-*) — devuelve 0 —
   aunque el contenido se dibuje detrás del notch y de la gesture nav. Este script
   mide los insets reales con probes CSS y compensa el teclado con visualViewport
   + el plugin nativo @capacitor/keyboard (altura exacta del teclado).
   Publica en :root las variables:
   · --safe-t / --safe-b  → padding de notch/barra de estado/gesture nav
   · --kb                 → altura del teclado cubriendo el viewport
   Estrategia:
   · Navegador / PWA / iOS: env() da valores reales → se leen con probes.
   · APK Capacitor confinada (fix nativo setDecorFitsSystemWindows): screen.height -
     innerHeight > 0 → los insets web son 0 y los fallbacks CSS quedan bien.
   · APK Capacitor edge-to-edge (APK antigua sin fix nativo): la diferencia es ~0 →
     se aplica heurística por densidad (barra de estado ≈ gesture nav ≈ 24dp).
   · Teclado: si el plugin nativo existe fuerza el resize del WebView (la barra de
     mensaje sube sola). Si el layout no se encoge, publica la altura exacta en --kb.
     Sin plugin (web/navegador): visualViewport da la zona cubierta. Todo es aditivo:
     si el WebView ya redimensiona, --kb queda en 0 y no se duplica padding. */
(function(){
  var s=document.documentElement.style;
  var H0=window.innerHeight;
  function probe(lado){
    var p=document.createElement('div');
    p.style.cssText='position:fixed;left:0;top:0;width:1px;height:0;visibility:hidden;pointer-events:none;padding-'+lado+':env(safe-area-inset-'+lado+',0px)';
    document.documentElement.appendChild(p);
    var v=p.offsetHeight-p.clientHeight;
    p.remove();
    return v;
  }
  function esNativo(){ return !!(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform()); }
  function aplicar(){
    var top=probe('top'), bottom=probe('bottom');
    if(esNativo()&&!top&&!bottom){
      var dpr=window.devicePixelRatio||1;
      var sys=(window.screen&&window.screen.height)?(window.screen.height-window.innerHeight):0;
      if(sys<30){ top=Math.round(24*dpr); bottom=Math.round(24*dpr); }
    }
    s.setProperty('--safe-t',Math.round(top)+'px');
    s.setProperty('--safe-b',Math.round(bottom)+'px');
  }
  /* Teclado vía visualViewport: zona cubierta por el teclado (0 si el WebView ya
     se redimensionó). Devuelve la altura a usar en --kb, o 0. */
  function cubiertoVV(){
    try{
      if(window.visualViewport){
        var cubierto=window.innerHeight-window.visualViewport.height-window.visualViewport.offsetTop;
        if(cubierto>10) return Math.round(cubierto);
      }
    }catch(e){}
    return 0;
  }
  function teclado(){
    var kb=cubiertoVV();
    s.setProperty('--kb',kb+'px');
  }
  /* Si el layout NO se encogió, el teclado cubre h px (altura exacta del plugin). */
  function kbNat(h){
    var kb=cubiertoVV();
    if(kb>0){ s.setProperty('--kb',kb+'px'); return; }
    var encogido=(window.innerHeight<H0-10);
    s.setProperty('--kb',(encogido?0:Math.round(h||0))+'px');
  }
  /* Re-baseline de H0: rotación/cambios reales de tamaño sin teclado activo. */
  function rebaseline(){
    var act=document.activeElement;
    var escribiendo=act&&(act.tagName==='INPUT'||act.tagName==='TEXTAREA');
    if(!escribiendo) H0=window.innerHeight;
  }
  /* Plugin nativo: fuerza el resize del WebView y escucha el teclado real. */
  (function setupNativo(){
    if(!esNativo()) return;
    var K=window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.Keyboard;
    if(!K||!K.addListener||!K.setResizeMode) return;
    try{
      var modo=/(iPhone|iPad|iPod)/i.test(navigator.userAgent)?'native':'resize';
      K.setResizeMode({mode:modo});
      K.addListener('keyboardDidShow',function(e){
        if(e&&e.keyboardHeight) kbNat(e.keyboardHeight);
      });
      K.addListener('keyboardDidHide',function(){ s.setProperty('--kb','0px'); });
    }catch(e){}
  })();
  window.addEventListener('resize',function(){ rebaseline(); aplicar(); teclado(); });
  window.addEventListener('orientationchange',function(){ setTimeout(rebaseline,180); setTimeout(aplicar,180); setTimeout(teclado,180); });
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize',teclado);
    window.visualViewport.addEventListener('scroll',teclado);
  }
  document.addEventListener('focusin',function(){ setTimeout(teclado,300); });
  document.addEventListener('focusout',function(){ setTimeout(rebaseline,200); setTimeout(teclado,200); });
  aplicar(); teclado();
})();
