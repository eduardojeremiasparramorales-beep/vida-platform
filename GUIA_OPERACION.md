# 📘 Guía de Operación — SP OS CRM

Esta es tu lista de tareas **en orden**. Todo lo de código ya está hecho; esto es lo que solo tú puedes hacer.

---

## Paso 1 — Desplegar la última versión en la VM (Google Cloud)

Conéctate por SSH a la VM y ejecuta:

```bash
cd /home/ubuntu/sp-crm/app
git fetch origin && git reset --hard origin/master
docker compose up -d --build
```

Verifica que arrancó bien:

```bash
docker compose logs --tail=30
```

Debes ver `SP OS` escuchando en el puerto. Luego abre `https://spcrm.duckdns.org/api/health` en el navegador — debe responder `ok`.

---

## Paso 2 — Revisar el `.env` de producción

En la VM, revisa que `/home/ubuntu/sp-crm/app/.env` tenga:

| Variable | Qué es | Dónde se consigue |
|---|---|---|
| `WHATSAPP_TOKEN` | Token **permanente** de la API de WhatsApp | Meta Developers → tu app → WhatsApp → API Setup. ⚠️ El token temporal vence en 24h; genera uno permanente con un System User en Business Manager |
| `PHONE_NUMBER_ID` | ID del número oficial | Misma pantalla de API Setup |
| `APP_SECRET` | Firma de los webhooks | Meta Developers → App Settings → Basic |
| `VERIFY_TOKEN` | Palabra clave que tú inventas | La misma que pondrás en el paso 3 |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Tu login de admin | Los eliges tú |

Si cambias el `.env`, reinicia: `docker compose up -d --build`.

---

## Paso 3 — Conectar el webhook en Meta Developers

1. Entra a [developers.facebook.com](https://developers.facebook.com) → tu app → **WhatsApp → Configuration**.
2. En **Webhook**, clic en **Edit**:
   - **Callback URL:** `https://spcrm.duckdns.org/webhook`
   - **Verify token:** el mismo `VERIFY_TOKEN` del `.env`
3. Clic en **Verify and save** — debe quedar en verde.
4. En **Webhook fields**, clic **Manage** y suscribe el campo **`messages`**.

---

## Paso 4 — Crear tus vendedores reales

Opción A — desde la web: entra como admin a `https://spcrm.duckdns.org` → **Equipo** → **Agregar asesor**.

Opción B — por curl (crea vendedor + login en un paso):

```bash
curl -X POST https://spcrm.duckdns.org/api/usuarios \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Nombre Apellido","telefono":"+573XXXXXXXXX","email":"vendedor@email.com","password":"pin-o-clave","rol":"vendedor"}'
```

Luego asigna el **PIN de 4 dígitos** a cada vendedor (con eso entran desde el celular):
el PIN se configura en Equipo, o vía `POST /api/vendedores/:id/pin`.

---

## Paso 5 — Probar el flujo completo (prueba de fuego)

1. Desde **otro celular** (no el oficial), envía un WhatsApp al número oficial de la empresa: **+57 321 462 5618**.
2. Verifica que:
   - El cliente recibe el mensaje de bienvenida automático.
   - El lead aparece en el **Inbox del admin** (`/os/inbox.html`).
   - El lead aparece en el **panel del vendedor asignado** (`/os/vendedor.html`).
   - El vendedor puede responder desde su panel y el cliente lo recibe **desde el número oficial**.
3. Prueba enviar un **audio** desde el panel (requiere HTTPS — en `spcrm.duckdns.org` ya lo tienes).

Si algo falla, mira los logs: `docker compose logs -f --tail=50`.

---

## Paso 6 — Respuestas rápidas y plantillas Meta

- **Respuestas rápidas** (templates internos): créalas en **Equipo → Templates**. Los vendedores las usan con un clic o escribiendo `/` en el chat.
- **Plantillas Meta aprobadas** (para reactivar chats con más de 24h sin respuesta del cliente):
  1. Créalas en **Meta Business Manager → WhatsApp Manager → Message Templates** y espera aprobación.
  2. Regístralas en el CRM: `POST /api/wa-templates` con `{"nombre":"nombre_exacto_meta","idioma":"es"}` o desde Equipo.
  3. Aparecerán en el botón **Reactivar** del chat.

---

## Paso 7 — Instalar la PWA en los celulares de los vendedores

En el celular de cada vendedor:

1. Abrir `https://spcrm.duckdns.org` en Chrome (Android) o Safari (iPhone).
2. Iniciar sesión con su teléfono + PIN.
3. Menú del navegador → **"Agregar a pantalla de inicio"** / **"Instalar app"**.
4. Aceptar el permiso de **notificaciones** cuando lo pida (para recibir push de nuevos mensajes).
5. Aceptar el permiso de **micrófono** la primera vez que graben un audio.

---

## Paso 8 — Lanzar la primera campaña Meta Ads

1. Campaña con objetivo **Mensajes → WhatsApp**, apuntando al número oficial.
2. Todos los leads entrarán al webhook → round-robin automático entre vendedores activos.
3. Monitorea en **Dashboard** y **Analytics** (ya con datos reales).

---

## Diagnóstico rápido de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| No llegan mensajes al CRM | Webhook no verificado o campo `messages` sin suscribir | Paso 3 |
| "error_whatsapp" al responder | Token vencido (era temporal) | Genera token permanente (Paso 2) |
| No puedo grabar audio | Estás entrando por HTTP o sin permiso de micrófono | Usa siempre `https://spcrm.duckdns.org` |
| Vendedor no ve leads | No tiene leads asignados o estado ≠ "activo" | Revisa su estado en Equipo |
| Inbox admin vacío pero vendedor sí ve chats | Versión vieja desplegada | Paso 1 (redeploy) |
