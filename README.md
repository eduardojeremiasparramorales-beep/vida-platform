# Vid.a — Plataforma multi-empresa

Motor CRM + control plane multi-tenant. Cada negocio es un **tenant** con su propia base SQLite (`data/<slug>.db`) y su carpeta de media (`data/media-<slug>/`).

## Estructura de tenancy

- **Empresa #1 — SP Leons Group** (`plan_status='fundador'`): el dueño. Conexión directa (sin cifrado de canales): usa `data/sp-leads.db`, tokens por variables de entorno (`.env`) y dominio propio `spcrm.duckdns.org`. La empresa #1 se siembra automáticamente en `src/db/platform.js`.
- **Empresas cliente** (nuevas): se crean desde el panel de plataforma `/plataforma` (API `/api/plataforma/empresas`), se les aprovisiona BD + carpeta media (`src/services/vida-provision.js`) y sus tokens de canal se cifran en el control plane (`src/services/crypto-vault.js`, AES-256-GCM con `VIDA_MASTER_KEY`).

## Puesta en marcha

```bash
npm install
cp .env.example .env   # completar: VIDA_MASTER_KEY, VIDA_PLATFORM_EMAIL/PASSWORD
npm start              # http://localhost:3000
```

- Panel CRM: `/` (empresa #1) · `/s/` selector de empresa (login con `empresaSlug`)
- Panel plataforma (control plane): `/plataforma` — login con `VIDA_PLATFORM_EMAIL/PASSWORD`

## Rutas clave

| Ruta | Qué hace |
|---|---|
| `src/db/adapter.js` | Multi-tenant: `tenantContext` (AsyncLocalStorage), `DEFAULT_EMPRESA_ID=1`, `DEFAULT_DB_PATH=data/sp-leads.db` |
| `src/db/platform.js` | Control plane: tabla `empresas` en `data/vida-plataforma.db`, admins, sesiones; `seedEmpresaUno()` |
| `src/services/vida-provision.js` | `provisionEmpresa()`: slug, carpeta media, DB del negocio con `store.createSchema` |
| `src/services/crypto-vault.js` | Cifrado AES-256-GCM de tokens de canal (clientes) |
| `src/index.js` | Middleware tenant + rutas `/api/plataforma/*` + selector de empresa en `/api/login` |
| `public/plataforma/` | Panel Vid.a (control plane) |
| `public/os/` | Panel CRM (inbox, votantes/leads, reportes…) |

## Verticales

`store.createSchema()` (y sus `ensureColumn`) definen las tablas por tenant. La vertical **campaña** (votantes, referidos, estados de voto, roles de equipo, página pública) se monta encima: ver `src/verticales/campana.js` y el tenant `C:\Sandra Suarez`.
