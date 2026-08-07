# Configuración de SP Inmobiliaria CRM

## Resumen

Este documento explica cómo configurar y lanzar el CRM de leads para SP Inmobiliaria.

---

## 1. Requisitos Previos

- Node.js 16+ instalado
- Cuenta de Meta Business (con acceso a WhatsApp Cloud API)
- Número de teléfono WhatsApp Business verificado en Meta
- (Opcional) Docker si deseas containerizar

---

## 2. Credenciales Necesarias de Meta

Necesitarás obtener de Meta Business Manager / Facebook Developers:

### A. WHATSAPP_TOKEN
- Ir a: **Meta App > WhatsApp > API Setup**
- Generar o copiar un **Temporary Access Token** o **System User Token**
- Debe tener permisos:
  - `whatsapp_business_messaging`
  - `whatsapp_business_management`
- **Duración:** Tokens temporales expiran. Considera usar System User Tokens para producción

### B. PHONE_NUMBER_ID
- Ir a: **Meta App > WhatsApp > Sender Phone Numbers**
- Copiar el **Phone Number ID** (es un número largo, ej: 1224496694078803)
- Este es el número WhatsApp desde el que se enviarán mensajes a clientes
- **Importante:** Debe estar verificado en Meta

### C. VERIFY_TOKEN (Token de Webhook)
- Este token **LO GENERAS TÚ** (no viene de Meta)
- Usa cualquier cadena aleatoria segura:
  ```bash
  # Linux/macOS
  openssl rand -hex 32

  # Windows (si tienes openssl instalado)
  openssl rand -hex 32

  # O simplemente genera algo seguro manualmente
  sp_inmobiliaria_webhook_verify_token_abc123def456ghi789jkl012mno345pqr
  ```
- Este token lo configurarás en **Meta App > WhatsApp > Webhook Settings > Verify Token**

### D. WHATSAPP_BUSINESS_ACCOUNT_ID
- Ir a: **Meta App > Settings > Basic > App ID**
- (Este valor ya está en .env.example pero actualmente no se usa)

---

## 3. Instalación y Configuración Local

### Paso 1: Clonar/Acceder al proyecto

```bash
cd C:\Sp Inmobiliaria\sp-inmobiliaria-leads-UPDATED
```

### Paso 2: Instalar dependencias

```bash
npm install
```

### Paso 3: Crear archivo .env

```bash
# Copiar plantilla
cp .env.example .env

# (En Windows PowerShell)
Copy-Item .env.example .env
```

### Paso 4: Completar variables en .env

Edita `.env` con tus valores reales:

```env
NODE_ENV=development

WHATSAPP_TOKEN=EAABsZCxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
PHONE_NUMBER_ID=1224496694078803
VERIFY_TOKEN=tu_token_aleatorio_aqui_generado_con_openssl

API_TOKEN=sp_api_token_abc123def456ghi789jkl012mno345pqr
```

### Paso 5: Crear vendedores de prueba (opcional)

En desarrollo, puedes usar el endpoint de seed:

```bash
# Con API_TOKEN configurado (header: Authorization: Bearer <API_TOKEN>)
curl -X POST http://localhost:3000/api/seed \
  -H "Authorization: Bearer tu_api_token" \
  -H "Content-Type: application/json"
```

Respuesta esperada:
```json
{
  "ok": true,
  "vendedoresCreados": 5
}
```

### Paso 6: Iniciar el servidor

```bash
# Desarrollo (con auto-reload)
npm run dev

# Producción
npm start
```

El servidor debería iniciar en `http://localhost:3000`

---

## 4. Configurar Webhook en Meta

Necesitas decirle a Meta dónde enviar los eventos de WhatsApp.

### En Producción (Railway o tu hosting)

1. **Obtén la URL pública:**
   - Si usas Railway: `https://tu-app.up.railway.app`
   - Si usas otro host: `https://tu-dominio.com`

2. **En Meta App > WhatsApp > Webhook Settings:**
   - **Webhook URL:** `https://tu-app.up.railway.app/webhook`
   - **Verify Token:** El valor que pusiste en .env (VERIFY_TOKEN)
   - **Subscribe to this webhook:** Selecciona `messages`

3. **Verificación:** Meta enviará un GET a tu endpoint `/webhook` con parámetros. Si devuelves el challenge, está todo OK.

### En Desarrollo Local

Para probar localmente sin cambiar la configuración de Meta, usa el endpoint de test:

```bash
# Simular un webhook de nuevo lead
curl -X POST http://localhost:3000/api/test-webhook \
  -H "Authorization: Bearer tu_api_token" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+5718112345001",
    "name": "Juan Pérez",
    "message": "Hola, me interesa un lote en Tocaima"
  }'
```

---

## 5. Endpoints del CRM

### Públicos (sin autenticación)
- `GET /` - Status del servidor
- `GET /webhook` - Verificación de webhook desde Meta (requerida para producción)
- `POST /webhook` - Recibir mensajes de WhatsApp desde Meta

### Protegidos (requieren API_TOKEN en header)
```
Authorization: Bearer tu_api_token
```

- `GET /api/stats` - Estadísticas generales (vendedores, leads)
- `GET /api/leads` - Lista todos los leads
- `GET /api/vendedores` - Lista todos los vendedores
- `POST /api/vendedores` - Crear nuevo vendedor
  ```json
  { "nombre": "Carlos", "telefono": "+5718112345601" }
  ```
- `POST /api/vendedores/:id/estado` - Cambiar estado (activo/ocupado/inactivo/vacaciones/suspendido)
  ```json
  { "estado": "activo" }
  ```
- `GET /api/logs` - Ver últimos 50 mensajes procesados

### Solo en Desarrollo (NODE_ENV=development)
- `POST /api/seed` - Crear vendedores de prueba
- `POST /api/test-webhook` - Simular webhook de cliente
- `POST /api/test-reply` - Simular respuesta de vendedor

---

## 6. Estructura de Datos

### Leads
```json
{
  "id": 1,
  "customer_phone": "+5718112345001",
  "customer_name": "Juan Pérez",
  "assigned_to_id": 1,
  "assigned_to_phone": "+5718112345601",
  "status": "nuevo|asignado|contactado|calificado|cerrado",
  "messages_count": 3,
  "first_message": "Hola, me interesa un lote",
  "last_message": "¿Cuál es el precio?",
  "first_response_at": "2026-06-28T14:30:00",
  "escalation_level": 0,
  "created_at": "2026-06-28T14:00:00",
  "updated_at": "2026-06-28T14:30:00"
}
```

### Vendedores
```json
{
  "id": 1,
  "nombre": "Carlos Méndez",
  "telefono": "+5718112345601",
  "email": "",
  "estado": "activo|ocupado|inactivo|vacaciones|suspendido",
  "rol": "vendedor|admin",
  "total_leads": 5,
  "created_at": "2026-06-28T10:00:00"
}
```

---

## 7. Flujo de Lead

1. **Cliente envía mensaje a número WhatsApp:**
   - Meta recibe el mensaje
   - Meta envía webhook a `/webhook` del servidor

2. **Servidor procesa el mensaje:**
   - Si es nuevo cliente: crea un lead
   - Asigna a vendedor activo con menos leads (round-robin)
   - Guarda el mensaje en base de datos
   - Reenvía el mensaje al vendedor vía WhatsApp

3. **Vendedor responde:**
   - Responde al número WhatsApp del servidor
   - Servidor detecta que es un vendedor
   - Reenvía su mensaje al cliente
   - Marca lead como "contactado"

4. **Escalación:**
   - Si lead no tiene respuesta en 30 min: envía alerta al vendedor
   - Si lead no tiene respuesta en 60 min: marca para reasignación (futuro)

---

## 8. Despliegue en Railway

### Pre-requisitos
- Cuenta en Railway.app
- Acceso al repositorio GitHub

### Pasos

1. **Conecta tu repo de GitHub a Railway:**
   - Ir a railway.app
   - New Project > Deploy from GitHub repo
   - Selecciona `eduardojeremiasparramorales-beep/sp-inmobiliaria-leads`

2. **Configura variables de entorno en Railway:**
   - En Project > Variables
   - Agrega todas las variables de .env.example
   - CRÍTICO: `API_TOKEN`, `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `VERIFY_TOKEN` con valores reales
   - NODE_ENV=production

3. **Railway auto-detectará package.json:**
   - Instalará dependencias automáticamente
   - Ejecutará `npm start`
   - URL pública: `https://sp-inmobiliaria-leads.up.railway.app` (o similar)

4. **Configura webhook en Meta:**
   - URL: `https://tu-railway-app.up.railway.app/webhook`
   - Verify Token: El valor de VERIFY_TOKEN en Railway

---

## 9. Solución de Problemas

### "VERIFY_TOKEN no está seteado"
- La validación del webhook falla
- Solución: Asegurate de que `.env` tenga `VERIFY_TOKEN=valor_aqui`

### "No puedo ver leads en /api/leads"
- Posible: No has enviado el header `Authorization: Bearer API_TOKEN`
- Solución: Agrega header en tu request

### Webhook no se verifica en Meta
- Posible: VERIFY_TOKEN en Meta App no coincide con el de .env
- Posible: La URL del servidor no es accesible (testing local no funciona)
- Solución: Usa `/api/test-webhook` para testing local

### Vendedores no reciben mensajes
- Posible: El numero del vendedor no está registrado en el CRM
- Solución: Asegúrate de agregar vendedores primero (via `POST /api/vendedores` o `/api/seed`)

### Error "lead 123 no existe" al asignar
- Posible: Corrupción en base de datos
- Solución: Elimina archivo `data/sp-leads.db` (perderás datos), reinicia, y vuelve a crear vendedores

---

## 10. Seguridad en Producción

Antes de lanzar a producción:

- [ ] VERIFY_TOKEN en .env es único y seguro (openssl rand -hex 32)
- [ ] API_TOKEN en .env es único y seguro
- [ ] WHATSAPP_TOKEN es un System User Token (no temporal)
- [ ] NODE_ENV=production
- [ ] .env NO está committeado (revisa .gitignore)
- [ ] API_TOKEN se distribuye solo a vendedores/aplicaciones autorizadas
- [ ] Webhooks solo aceptan requests de IPs de Meta
- [ ] Base de datos está en volumen persistente (Railway, Docker)
- [ ] Logs se envían a servicio externo (no solo stdout)

---

## 11. Contacto y Soporte

- Repo GitHub: https://github.com/eduardojeremiasparramorales-beep/sp-inmobiliaria-leads
- CLAUDE.md del proyecto: Instrucciones de arquitectura
- Eduardo Jeremias Parra: eduardojeremiasparramorales@gmail.com

---
