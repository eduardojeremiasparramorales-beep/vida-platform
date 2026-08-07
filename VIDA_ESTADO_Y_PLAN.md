# Vid.a / Plan Maestro — Estado y próximos pasos

Documento de traspaso para continuar en otra sesión. Generado tras cerrar Fase 5, Parte 3A, Parte 3B, Fase 3, Vid.a V1 y Vid.a V2 en una sola sesión larga. Repo: `C:\Sp Inmobiliaria\sp-leons-crm`, rama `master`.

## Estado en `origin/master` ahora mismo

| Bloque | Commit | Desplegado a la VM |
|---|---|---|
| Fase 0 — Docker/Python | `cc58c26` | ✅ Sí |
| Fase 1 — Atribución de campaña | `a0f983d` | ✅ Sí |
| Fase 2 — Puente catálogo | `a0f983d` | ✅ Sí |
| Fase 5 — IA híbrida Gemini+Pillow | `715aec3` | ✅ Sí |
| Parte 3A — Tema claro/oscuro | `6c7ac54` | ✅ Sí |
| Parte 3B — Panel de Configuración | `d4fc79d` | ✅ Sí |
| Fase 3 — Reel en video real | `58f7fdf` | ✅ Sí |
| Vid.a V1 — Fundación multi-tenant | `12647b1` | ✅ Sí (smoke test completo en producción real) |
| **Vid.a V2 — Control plane + panel** | `9b24cce` | ❌ **No — falta desplegar** |

**Antes de tocar V3**: desplegar V2 (`git fetch origin master && git reset --hard origin/master && git clean -fd && docker compose up -d --build`) y hacer el smoke test de `/plataforma/` en producción real — igual de riguroso que se hizo con V1, porque V2 puede crear negocios de verdad y toca cifrado.

## ⚠️ Acción manual pendiente en la VM (no viaja con el código)

`.env` de la VM necesita estas 3 variables nuevas — sin ellas, `/plataforma/` no arranca en producción aunque el código ya esté ahí (`.env` está gitignored a propósito, nunca viaja en los commits):

```
VIDA_MASTER_KEY=<32 bytes en hex — generar con: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
VIDA_PLATFORM_EMAIL=<email real del fundador de Vid.a>
VIDA_PLATFORM_PASSWORD=<contraseña real, no el default>
```

**Importante sobre `VIDA_MASTER_KEY`**: una vez que haya negocios reales con canales conectados (tokens cifrados guardados), esta clave NO se puede regenerar sin perder acceso a esos tokens. Generarla una sola vez y guardarla en un lugar seguro (no solo en `.env` de la VM).

## Vid.a V2 — qué quedó construido (verificado end-to-end en local, con servidor real)

- `src/db/platform.js`: BD separada `data/vida-plataforma.db` — tablas `empresas`, `empresa_dominios`, `empresa_canales`, `platform_admins`, `platform_sessions`.
- `src/services/crypto-vault.js`: AES-256-GCM, tokens de canal nunca en claro.
- `src/services/vida-provision.js`: `provisionEmpresa(nombre, adminData)` — crea la fila en el control plane, la carpeta de medios, y corre `store.createSchema()` dentro del `tenantContext` de la empresa nueva.
- `public/plataforma/index.html`: panel mínimo — login, listar negocios (con tamaño de BD), crear negocio, suspender/activar, conectar canal.
- Endpoints en `src/index.js` (bajo `requirePlatformAdmin`, sesión propia vía cookie `sp_platform_session`, separada de las sesiones de cada negocio): `POST /api/plataforma/login`, `POST /api/plataforma/logout`, `GET /api/plataforma/empresas`, `POST /api/plataforma/empresas`, `POST /api/plataforma/empresas/:id/estado`, `POST/GET /api/plataforma/empresas/:id/canales`, `GET /api/plataforma/me`.

**Dos bugs reales encontrados y corregidos durante la verificación** (ver commit `9b24cce` para el detalle completo):
1. Dos `ensureColumn` en `store.js` estaban antes de `createNewTables()` — rompían en silencio al provisionar una BD genuinamente vacía por primera vez.
2. El id autoincremental de `empresas` colisionaba con `DEFAULT_EMPRESA_ID=1` de `adapter.js` — el primer negocio creado habría escrito sus datos dentro de la BD real de Leons Group. Se sembró `empresa id=1="SP Leons Group"` explícitamente para reservar ese id para siempre.

**No construido en V2 (fuera de alcance, según el plan original)**: UI para editar/borrar un negocio (solo suspender), UI para desconectar un canal, panel de "salud" más allá del tamaño de BD (último mensaje, errores — el plan lo mencionaba pero es más natural para V3, cuando ya haya tráfico real por negocio).

## Vid.a V3 — el siguiente paso real (el que de verdad conecta negocios de clientes)

Esto es lo que falta para que un negocio creado en `/plataforma/` reciba mensajes de WhatsApp de verdad:

1. **`channels/whatsapp.js` (webhook)**: hoy ignora `value.metadata.phone_number_id` — hay que leerlo, hacer `platform.getEmpresaByCanalId(phoneNumberId)`, y envolver el resto del procesamiento del mensaje en `adapter.tenantContext.run({empresaId: empresa.id, dbPath: empresa.db_path}, ...)`. Mensaje de un `phone_number_id` no registrado → responder 200 OK igual (Meta reintenta si no) pero no procesar nada.
2. **`getApiConfig()`** (el que arma headers/URL para enviar mensajes salientes): hoy lee `process.env.WHATSAPP_TOKEN` directo. Tiene que revisar primero `platform.getCanalToken()` del tenant activo (descifrando con `crypto-vault`), con fallback a `process.env` SOLO para empresa #1 (retrocompatibilidad con Leons Group, que sigue usando variables de entorno, no canales cifrados en el control plane).
3. **Piloto real**: el usuario tiene un negocio propio distinto a Leons Group — conectarlo de punta a punta es la prueba de fuego de V3. Login en `/plataforma/`, crear el negocio, conectar su `phone_number_id` + token real (Meta permite varios números en la misma app/webhook — no hace falta una app de Meta nueva, solo que el número esté agregado a la misma WABA o se maneje el `phone_number_id` correcto).
4. **`MEDIA_DIR` tenant-aware**: hoy es una constante fija en `services/media.js`. Necesita una función `getMediaDir()` que lea del tenant activo.
5. **`sessions.empresa_id`**: para que el login de un vendedor de un negocio nuevo sepa a qué empresa pertenece (hoy el login solo conoce Leons Group). Login resuelve la empresa por selector manual en V3 (por dominio es V4).
6. **Scheduler multi-tenant de verdad**: hoy `tick()`/`tickDiario()` corren envueltos en el contexto de empresa #1 únicamente (ver V1). V3 necesita que iteren `for (empresa of platform.getEmpresas().filter(e => e.activo)) { await tenantContext.run({empresaId: empresa.id, dbPath: empresa.db_path}, () => tick()); }` — cada negocio activo recibe su propio tick.

**Verificación de V3** (del plan original): WhatsApp real al número del piloto → aparece solo en el piloto; mensaje a Leons Group → solo en Leons Group; envío saliente desde cada uno usa su propio token.

## Vid.a V4 — resolución por dominio (después de V3)

Middleware que lee `Host` → `platform.getEmpresaByHostname()` → contexto. Caddy con `on_demand_tls` para certificados automáticos de dominios de clientes. Nota del plan original: el usuario iba a comprar el dominio de Vid.a — si ya lo tiene, es solo DNS + una fila en `empresa_dominios`, cero código nuevo (la función `addEmpresaDominio` ya existe en `platform.js`).

## Fase 4 — Meta Ads (independiente de Vid.a, sigue bloqueada)

Sin tocar en toda la sesión — necesita que el usuario consiga: Ad Account ID (`act_…`), token de System User con `ads_management`+`ads_read`, Page ID. Spec completa en la conversación original del Plan Maestro (servicio nuevo `src/services/meta-ads.js`, todo se crea `PAUSED`, `special_ad_categories: ['HOUSING']` obligatorio).

## Cosas sueltas que salieron en el camino (no bloquean nada, pero vale la pena saber)

- **`GOOGLE_API_KEY` no está configurada en la VM de producción** — Campañas SP (Fase 5) cae a Pillow sin fondos de IA. Funciona igual, solo sin ese extra. Activar cuando se quiera.
- **Tres endpoints de export de leads redundantes** sin consolidar: `/api/reports/export.csv` (el más completo, sin botón en ninguna UI), `/api/leads/export.csv` (el que sí usa `reportes.html`), `/api/admin/export/leads` (huérfano). Decisión de producto pendiente, no técnica.
- **`updateUsuarioPassword`** (cambio de contraseña para el admin legacy email+password) existe en `store.js` pero nunca se llama desde ningún endpoint — huérfano. Bajo impacto porque el login real es phone+PIN.
- **Sombras `rgba(0,0,0,..)` sin tokenizar** en `public/m/index.html` (sheet, emoji picker, barra de subida) — funcionan bien en tema claro, solo un poco más fuertes de lo ideal (Parte 3A, detalle menor).
- **`var(--gold)` como color de texto sin auditar exhaustivamente** en scripts embebidos de las 19 páginas admin — solo se corrigieron los casos centralizados en `sp-os.css` (Parte 3A).
- **`campanas.html` vs `campanas-sp.html`**: son dos páginas paralelas para la misma feature (generador de creativos), ambas pegándole a los mismos endpoints `/api/campanas-sp/*`. `campanas-sp.html` (el wizard de 5 pasos) es la que el usuario usa de verdad — `campanas.html` (con tabs, más vieja) quedó sin uso real pero sigue en el nav como "Campañas". Decisión de producto pendiente: consolidar en una sola.

## Nota sobre la sesión paralela de Claude

Durante esta sesión hubo otra sesión de Claude trabajando activamente en el mismo directorio (`C:\Sp Inmobiliaria\sp-leons-crm`), en paralelo, sobre Messenger/Instagram (reacciones, typing indicators, read receipts). En un punto, un staging amplio de esa sesión arrastró cambios míos de `src/index.js` (los endpoints de Vid.a V2) hacia su propio commit (`42752c979`) — sin daño funcional (se verificó que el código quedó completo y correcto antes de la mezcla), pero es la razón por la que el commit `9b24cce` de V2 no incluye `index.js` a pesar de que ese archivo sí cambió. Si sigue habiendo trabajo concurrente en la próxima sesión: revisar `git log` y `git status` al empezar, y preferir `git add <archivo>` explícito sobre `git add -A`/`git commit -a`.

## Orden recomendado para la próxima sesión

1. Desplegar V2 a la VM + `VIDA_MASTER_KEY`/`VIDA_PLATFORM_EMAIL`/`VIDA_PLATFORM_PASSWORD` en su `.env`.
2. Smoke test de `/plataforma/` en producción real (login, crear negocio de prueba, confirmar aislamiento, borrar el de prueba).
3. Vid.a V3 (la parte que de verdad importa: negocios de clientes reciben WhatsApp real).
4. Vid.a V4 (dominios) — rápido una vez V3 esté probado.
5. Fase 4 (Meta Ads) — en paralelo, en cuanto el usuario tenga las credenciales.
