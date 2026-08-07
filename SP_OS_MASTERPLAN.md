# SP OS — Documento Maestro de Producto

> **La plataforma central desde la cual una empresa administra toda su operación comercial alrededor de un único número de WhatsApp.**
>
> No es un CRM. Es un sistema operativo comercial: decenas o cientos de colaboradores trabajando en simultáneo sobre el mismo número, sin perder organización, velocidad ni contexto.

- **Versión del documento:** 1.0
- **Estado del código:** fundación viva en `public/os/` (Design System + 6 pantallas cableadas a datos reales)
- **Principio rector:** un solo sistema, un solo lenguaje visual, una sola navegación. Nunca "muchas herramientas".

---

## 0. Cómo leer este documento

Este documento es la **fuente única de verdad** del producto. Cualquier diseñador o desarrollador debe poder construir SP OS leyéndolo.

Se organiza en:
1. **Visión y filosofía** — el porqué.
2. **Arquitectura por capas** — el modelo mental (no módulos aislados, *capas*).
3. **Arquitectura del sistema SaaS** — workspace, organizaciones, roles, suscripciones.
4. **Design System** — tokens y biblioteca de componentes (implementados en `sp-os.css`).
5. **Inventario de pantallas** — todas, sin excepción, con estado y capa.
6. **Plantilla de documentación de pantalla** — el formato obligatorio.
7. **Pantallas insignia documentadas** — ejemplos completos aplicando la plantilla.
8. **Patrones globales** — estados vacíos, loading, error, overlays, movimiento, accesibilidad, responsive.
9. **Roadmap de construcción.**

El Design System **vivo y navegable** está en `/os/design-system.html` (renderiza los componentes reales, no imágenes).

---

## 1. Visión y filosofía

### 1.1 Visión de producto
WhatsApp es el centro. Todo lo demás existe para potenciar la experiencia alrededor de las conversaciones. El objetivo es ser la plataforma comercial central de la empresa: comunicación, ventas, automatización, operación y plataforma, en un solo lugar.

### 1.2 Filosofía de producto
- El usuario **nunca** debe sentir que usa muchas herramientas.
- Todo comparte lenguaje visual, navegación, componentes e interacciones.
- Ecosistema unificado, no páginas independientes.

### 1.3 Filosofía de diseño
El diseño transmite: **rapidez, profesionalismo, orden, confianza, escalabilidad, tecnología, inteligencia.**
No futurista — un producto real que podría salir hoy al mercado. Simplicidad, consistencia y claridad por encima de la decoración.

### 1.4 Anti-objetivos
- No clonar HubSpot / Zoho / Salesforce / Respond.io.
- No pantallas bonitas sueltas: cada pantalla es parte de un sistema mayor.
- No saturación visual. No "features" sin lugar claro en la arquitectura.

---

## 2. Arquitectura por capas (el diferenciador)

No construimos módulos aislados. Construimos **capas** que se apilan. Cada módulo pertenece a una capa y hereda su lenguaje.

| Capa | Propósito | Módulos |
|------|-----------|---------|
| **1 · Comunicación** | Todos los canales entran a un solo lugar | WhatsApp (core), Instagram, Messenger, Telegram, Email, Llamadas, Chat web |
| **2 · Ventas** | Convertir conversaciones en negocio | Inbox, CRM/Leads, Pipeline, Clientes, Empresas, Propiedades, Cotizaciones, Tareas, Agenda/Calendario |
| **3 · Automatización** | Escalar sin sumar personas | Workflow Builder, Bots, IA/Copiloto, Reglas, Disparadores, Secuencias |
| **4 · Operación** | Gobernar el equipo y la data | Usuarios, Equipos, Roles, Permisos, Auditoría, Logs, Reportes, Analytics |
| **5 · Plataforma** | Convertirlo en SaaS vendible | Suscripciones, Facturación, API, Webhooks, Integraciones, Marketplace, Branding/Multiempresa |

**Regla de oro:** una función siempre vive en una capa. Si no encaja en ninguna, no entra al producto todavía.

---

## 3. Arquitectura del sistema SaaS

### 3.1 Jerarquía de datos
```
Organización (empresa cliente / tenant aislado)
 └─ Workspace (marca · dominio · logo · colores · nº WhatsApp)
     ├─ Equipos
     │   └─ Usuarios (roles + permisos)
     ├─ Canales conectados (WhatsApp, Meta, …)
     ├─ Suscripción (plan · consumo · límites · tokens IA)
     ├─ Módulos activados
     └─ Integraciones / API keys / Webhooks
```

### 3.2 Multiempresa (aislamiento)
Cada organización tiene su empresa, dominio, logo, colores, equipo, campañas, conversaciones, automatizaciones y base de datos **aislada**. El selector de workspace vive en la esquina superior del sidebar (`.os-workspace`).

### 3.3 Roles base
| Rol | Alcance |
|-----|---------|
| **Owner** | Todo, incluida facturación y borrado de workspace |
| **Admin** | Configuración, equipo, automatizaciones, reportes |
| **Supervisor** | Ve todas las conversaciones de su equipo, reasigna |
| **Agente** | Solo sus conversaciones asignadas |
| **Solo lectura** | Consulta reportes y conversaciones sin actuar |

### 3.4 Modelo de operación WhatsApp (core)
Un solo número oficial → todos los leads entran a la misma bandeja → el sistema reparte (round-robin / reglas) → cada agente responde desde el panel. El cliente **siempre** ve el número oficial de la empresa.

---

## 4. Design System

> Implementado en `public/os/sp-os.css`. Navegable en `/os/design-system.html`.

### 4.1 Tokens
| Token | Valor | Uso |
|-------|-------|-----|
| `--bg-0` | `#0A0A0A` | Fondo raíz |
| `--bg-1` | `#121212` | Paneles |
| `--bg-2` | `#171717` | Cards |
| `--border` | `#252525` | Bordes |
| `--gold` | `#C8A45A` | Marca / acento primario |
| `--green` | `#4E7B46` | Éxito / venta |
| `--blue` | `#5B8DEF` | Información |
| `--red` | `#E5484D` | Peligro |
| `--amber` | `#E0A44A` | Advertencia |
| `--text` | `#F8F8F8` | Texto |

**Espaciado:** múltiplos de 8 (`8/16/24/32/48/64`). **Radios:** `12/16/20/24`. **Sombras:** suaves. **Movimiento:** 180ms `cubic-bezier(.4,0,.2,1)`. **Tipografía:** Cinzel (marca/títulos), Inter (interfaz), SF Pro Display (números).

### 4.2 Biblioteca de componentes (estado)
Cada componente existe como clase reutilizable en `sp-os.css`.

| Componente | Clase(s) | Estado |
|-----------|----------|--------|
| App Shell (3 zonas) | `.os-app` `.os-nav` `.os-main` `.os-panel` | ✅ |
| Sidebar + Workspace switch | `.os-nav__item` `.os-workspace` | ✅ |
| Topbar + búsqueda | `.os-topbar` `.os-search` | ✅ |
| Botones (4 variantes + icon/sm/block) | `.btn` `.btn--gold/ghost/quiet/danger` | ✅ |
| Cards / superficies | `.card` `.surface` | ✅ |
| Metric card | `.metric` | ✅ |
| Badges / Chips / Dots | `.badge` `.chip` `.dot` | ✅ |
| Inputs / Select / Textarea | `.input` `.field` | ✅ |
| Tablas | `.table` | ✅ |
| Kanban | `.kanban` `.kan-col` `.kan-card` | ✅ |
| Timeline | `.tl` `.tl-item` | ✅ |
| Avatares | `.avatar--sm/md/lg` | ✅ |
| Empty / Skeleton | `.empty` `.skel` | ✅ |
| Toasts | `.os-toast` (`SPOS.toast`) | ✅ |
| AI Dock (Copiloto) | `.ai-dock` | ✅ |
| Grids / animación de entrada | `.grid--2/3/4` `.rise` | ✅ |
| Chat / burbujas | `.bubble--in/out/note` | ✅ (en Inbox) |
| Modales | `.os-modal` | ⏳ pendiente |
| Command Palette (⌘K) | — | ⏳ pendiente |
| Tabs / Accordion | — | ⏳ pendiente |
| Dropdown / Menú contextual | — | ⏳ pendiente |
| Tooltip | — | ⏳ pendiente |
| Paginación | — | ⏳ pendiente |
| Calendario | — | ⏳ pendiente |
| Gráficas (donut/barras) | inline SVG | ✅ (en Analytics) |

---

## 5. Inventario completo de pantallas

Leyenda de estado: ✅ construida y verificada · 🟡 placeholder premium · ⚪ planificada.

### Capa 1 — Comunicación
| Pantalla | Ruta | Estado |
|----------|------|--------|
| Inbox — lista de conversaciones | `/os/inbox.html` | ✅ |
| Inbox — vista conversación | `/os/inbox.html` | ✅ |
| Inbox — panel del contacto | `/os/inbox.html` | ✅ |
| Conexión de canales (WhatsApp/Meta) | `/os/module.html?m=settings` | ⚪ |
| Configuración de WhatsApp | — | ⚪ |
| Selector de canal / bandeja unificada | Inbox (filtros) | ✅ |

### Capa 2 — Ventas
| Pantalla | Ruta | Estado |
|----------|------|--------|
| Dashboard (centro de control) | `/os/dashboard.html` | ✅ |
| CRM — Leads (tarjetas inteligentes) | `/os/crm.html` | ✅ |
| CRM — ficha 360° (panel) | `/os/crm.html` | ✅ |
| Pipeline (Kanban) | `/os/pipeline.html` | ✅ |
| Clientes | `/os/module.html?m=clients` | 🟡 |
| Empresas | — | ⚪ |
| Propiedades | `/os/module.html?m=properties` | 🟡 |
| Cotizaciones | — | ⚪ |
| Tareas | — | ⚪ |
| Calendario / Agenda | `/os/module.html?m=calendar` | 🟡 |

### Capa 3 — Automatización
| Pantalla | Ruta | Estado |
|----------|------|--------|
| Automatizaciones (lista) | `/os/module.html?m=automations` | 🟡 |
| Workflow Builder (nodos) | — | ⚪ |
| IA / Copiloto (dock global) | presente en todo el shell | 🟡 |
| Reglas y disparadores | — | ⚪ |
| Campañas Meta | `/os/module.html?m=campaigns` | 🟡 |

### Capa 4 — Operación
| Pantalla | Ruta | Estado |
|----------|------|--------|
| Equipo / Usuarios | `/os/equipo.html` | ✅ |
| Roles y permisos | — | ⚪ |
| Analytics | `/os/analytics.html` | ✅ |
| Reportes | `/os/analytics.html` (+ export CSV) | ✅ |
| Auditoría / Logs | — | ⚪ |
| Notificaciones / Centro de actividad | topbar (icono) | ⚪ |

### Capa 5 — Plataforma
| Pantalla | Ruta | Estado |
|----------|------|--------|
| Facturación & Suscripciones | `/os/module.html?m=billing` | 🟡 |
| Selección de plan | — | ⚪ |
| Métodos de pago | — | ⚪ |
| API / Webhooks | — | ⚪ |
| Integraciones | — | ⚪ |
| Marketplace (verticales) | `/os/module.html?m=marketplace` | 🟡 |
| Configuración de empresa / branding | `/os/module.html?m=settings` | 🟡 |
| Perfil / Preferencias | — | ⚪ |
| Centro de actualizaciones | — | ⚪ |

### Autenticación & Onboarding (transversal)
| Pantalla | Ruta | Estado |
|----------|------|--------|
| Login | `/login.html` | ✅ (clásico, pendiente migrar a OS) |
| Registro | — | ⚪ |
| Onboarding (bienvenida) | — | ⚪ |
| Creación de Workspace | — | ⚪ |
| Invitación de usuarios | — | ⚪ |
| Primera configuración | — | ⚪ |

### Sistema & Estados (transversal)
Empty states · Loading / Skeletons · Errores · 404 · Sin conexión · Servidor caído · Actualización disponible → ver **§8 Patrones globales**. Catálogo vivo en `/os/design-system.html` §10.

---

## 6. Plantilla de documentación de pantalla (obligatoria)

Cada pantalla se documenta con estos 11 campos:

```
### [Nombre de la pantalla]  ·  Capa X  ·  Ruta
1. Objetivo — qué resuelve para el usuario.
2. Función en el sistema — su rol dentro del ecosistema.
3. Jerarquía visual — de lo más a lo menos importante.
4. Componentes — clases del Design System usadas.
5. Estados — vacío, cargando, con datos, error, permiso denegado.
6. Interacciones — clics, teclado, arrastrar, atajos.
7. Responsive — comportamiento en desktop / tablet / móvil.
8. Accesibilidad — foco, roles ARIA, contraste, teclado.
9. Animaciones — entradas, transiciones, microinteracciones.
10. Casos de uso — escenarios reales de negocio.
11. Relaciones — a qué otras pantallas conecta.
```

---

## 7. Pantallas insignia documentadas

### Dashboard · Capa 2 · `/os/dashboard.html`
1. **Objetivo** — dar en 3 segundos el estado del negocio: leads, cierres, conversión, respuesta.
2. **Función** — centro de control y punto de partida diario; enruta a Inbox, Pipeline, Campañas.
3. **Jerarquía** — (1) 4 métricas núcleo → (2) embudo comercial → (3) rendimiento de equipo → (4) estado del negocio, acciones rápidas y sugerencia del Copiloto.
4. **Componentes** — `.metric`, `.card`, `.table`, `.badge`, `.dot`, `.grid--4/main`, `.rise`.
5. **Estados** — cargando (skeleton en métricas), con datos (real `/api/metricas`), demo (sin sesión), vacío (0 leads → mensajes neutros).
6. **Interacciones** — "Nuevo lead" → CRM; tarjetas y filas enlazan a sus módulos; ⌘K abre búsqueda.
7. **Responsive** — grid 4→2→1; sidebar colapsa a off-canvas ≤720px.
8. **Accesibilidad** — contraste AA sobre `#0A0A0A`; foco visible; jerarquía de encabezados correcta.
9. **Animaciones** — entrada `.rise` escalonada; barras del embudo animan su ancho 800ms.
10. **Casos de uso** — el dueño abre el sistema y ve si hay leads sin responder y quién rinde.
11. **Relaciones** — Inbox, Pipeline, Equipo, Analytics, Campañas.

### Inbox omnicanal · Capa 1 · `/os/inbox.html`
1. **Objetivo** — atender todas las conversaciones de todos los canales desde un solo lugar.
2. **Función** — corazón del producto; donde el equipo pasa el día.
3. **Jerarquía** — 3 zonas: lista de conversaciones · hilo de chat · panel de contexto del cliente.
4. **Componentes** — `.ibx-*`, `.bubble--in/out/note`, `.avatar`, `.badge`, `.chip`, `.os-panel`, composer.
5. **Estados** — sin conversación seleccionada (empty), cargando (skeleton de burbuja), con hilo, enviando, error de envío (toast), sin permiso (403 filtra).
6. **Interacciones** — filtrar por canal, buscar, abrir hilo, escribir (autogrow), Enter para enviar, nota interna, marcar leído automático.
7. **Responsive** — ≤900px alterna lista↔hilo con botón "volver"; panel se oculta.
8. **Accesibilidad** — `role="log"` en mensajes; foco al composer al abrir; navegación por teclado.
9. **Animaciones** — burbuja entrante suave; toast al enviar; badge de no leídos en nav.
10. **Casos de uso** — 20 agentes sobre el mismo número atienden en paralelo sin pisarse.
11. **Relaciones** — CRM (ficha), Pipeline (etapa), Campañas (origen del lead).

### CRM · Leads · Capa 2 · `/os/crm.html`
1. **Objetivo** — ver y clasificar cada lead como una tarjeta inteligente.
2. **Función** — base de datos comercial viva; puente entre conversación y venta.
3. **Jerarquía** — filtros/búsqueda → grid de tarjetas → panel ficha 360° (timeline + acciones).
4. **Componentes** — `.card--float`, `.badge`, `.chip`, `.avatar`, `.tl`, `.os-panel`.
5. **Estados** — cargando, con datos (`/api/leads`), vacío por filtro, ficha abierta/cerrada.
6. **Interacciones** — buscar, filtrar por etapa, abrir ficha, agendar seguimiento, sugerir respuesta IA, abrir chat.
7. **Responsive** — grid 3→1; panel se oculta ≤1100px.
8. **Accesibilidad** — tarjetas enfocables; etiquetas de estado con texto, no solo color.
9. **Animaciones** — `.rise` en cascada; hover flotante `card--float`.
10. **Casos de uso** — el supervisor filtra "Negociación" y prioriza los de más actividad.
11. **Relaciones** — Inbox, Pipeline, Analytics.

### Pipeline · Capa 2 · `/os/pipeline.html`
1. **Objetivo** — mover visualmente cada lead por su etapa comercial.
2. **Función** — vista operativa del embudo; refleja y edita la etiqueta real del lead.
3. **Jerarquía** — 5 columnas (Nuevos → Vendidos) con conteo → tarjetas arrastrables.
4. **Componentes** — `.kanban`, `.kan-col`, `.kan-card`, `.dot`, `.avatar`.
5. **Estados** — con datos, columna en drop (resaltada), tarjeta arrastrándose, error al persistir (revierte + toast).
6. **Interacciones** — drag & drop entre columnas → `POST /api/leads/:id/etiqueta`.
7. **Responsive** — scroll horizontal de columnas en pantallas estrechas.
8. **Accesibilidad** — (pendiente) alternativa por teclado al arrastre.
9. **Animaciones** — resaltado de columna al pasar por encima; reordenado inmediato.
10. **Casos de uso** — el asesor cierra el día moviendo sus "Cita" a "Vendido".
11. **Relaciones** — CRM, Dashboard (embudo), Analytics.

### Analytics · Capa 4 · `/os/analytics.html`
1. **Objetivo** — inteligencia de negocio: dónde se gana y dónde se pierde.
2. **Función** — lectura ejecutiva sobre los reportes reales del backend.
3. **Jerarquía** — 4 métricas → embudo → actividad por hora → distribución por canal (donut) → tiempos de respuesta → ranking de equipo.
4. **Componentes** — `.metric`, `.card`, SVG donut/barras inline, `.table`, `.badge`.
5. **Estados** — cargando, con datos (`/api/reports/*`), sin datos (ceros), export CSV.
6. **Interacciones** — exportar CSV; (futuro) rango de fechas.
7. **Responsive** — grid principal 2→1; barras se comprimen.
8. **Accesibilidad** — cada gráfico acompañado de cifras legibles, no solo color.
9. **Animaciones** — barras y donut animan al entrar.
10. **Casos de uso** — el dueño revisa el pico horario para reforzar turnos.
11. **Relaciones** — Dashboard, Equipo, Pipeline.

### Equipo · Capa 4 · `/os/equipo.html`
1. **Objetivo** — ver y comparar el rendimiento de cada asesor.
2. **Función** — gobierno del equipo comercial; base para incentivos y reasignación.
3. **Jerarquía** — 4 métricas → tarjetas por asesor → ranking ordenado por cierres.
4. **Componentes** — `.metric`, `.card--float`, `.badge`, `.dot`, `.avatar`, `.table`.
5. **Estados** — con datos (`/api/metricas`), sin asesores (empty), solo-admin (`adminOnly`).
6. **Interacciones** — "Agregar asesor" → gestión clásica; (futuro) abrir ficha del asesor.
7. **Responsive** — grid 3→1.
8. **Accesibilidad** — estado (activo/ausente) con texto + dot.
9. **Animaciones** — `.rise`; barras de conversión.
10. **Casos de uso** — el admin detecta al Top del mes y a quien necesita apoyo.
11. **Relaciones** — Analytics, Dashboard, Pipeline.

---

## 8. Patrones globales

### 8.1 Estados vacíos
Ícono atenuado + título claro + subtítulo que explica qué hará aparecer datos + (opcional) acción primaria. Clase `.empty`. Un empty por cada lista: sin conversaciones, sin campañas, sin propiedades, sin vendedores, sin automatizaciones.

### 8.2 Loading
- **Skeleton** (`.skel`) para contenido estructurado (listas, tablas, métricas). Nunca spinners de página completa.
- El shell aparece primero; el contenido se hidrata. Percepción de velocidad > espera real.

### 8.3 Errores
- **Inline** (dentro del componente) para fallos locales.
- **Toast** (`SPOS.toast(msg,'err')`) para acciones (envío, guardado).
- **Pantalla** para fallos globales: 404, sin conexión, servidor caído, actualización disponible → cada una con el shell + `.empty` + acción de recuperación.

### 8.4 Overlays
Modales (`.os-modal`), toasts (`.os-toast`), tooltips, dropdowns, menús contextuales, **Command Palette / búsqueda global (⌘K)**, Quick Actions. Todos comparten radios, sombras y movimiento del sistema.

### 8.5 Movimiento
Entradas `.rise` escalonadas (40–160ms). Transiciones 180ms. Las animaciones **refuerzan**, no distraen. `prefers-reduced-motion` respetado.

### 8.6 Accesibilidad
Contraste AA sobre negro; foco visible; estados comunicados con texto además de color; navegación por teclado; roles ARIA en chat/listas.

### 8.7 Responsive
Desktop (3 zonas) → Tablet (panel se oculta) → Móvil (sidebar off-canvas, lista↔detalle). Breakpoints 1100px y 720px/900px.

---

## 9. Roadmap de construcción

**Hecho ✅** — Design System (`sp-os.css`), Shell (`sp-shell.js`), Dashboard, Inbox, CRM, Pipeline, Analytics, Equipo, Design System vivo, login→OS.

**Siguiente (orden sugerido):**
1. **Propiedades** — catálogo visual (Capa 2, alto valor comercial).
2. **Workflow Builder** — constructor de nodos (Capa 3, gran diferenciador).
3. **Facturación & Suscripciones + Selección de plan + Métodos de pago** — núcleo SaaS (Capa 5).
4. **Onboarding + Registro + Creación de Workspace + Invitaciones** — activación de nuevos tenants.
5. **Configuración: empresa/branding, WhatsApp/Meta, Roles y permisos** (Capas 1/5).
6. **Command Palette (⌘K), Notificaciones, Modales, Tooltips, Tabs** — completar la biblioteca de overlays.
7. **Pantallas de sistema** — 404, sin conexión, servidor caído, actualización.

**Criterio de "terminado" por pantalla:** cumple los 11 campos de la plantilla, usa solo componentes del Design System, tiene sus estados (vacío/loading/error), es responsive y se verifica en navegador.

---

*SP OS — un solo sistema. Un solo lenguaje. Alrededor de un solo número de WhatsApp.*
