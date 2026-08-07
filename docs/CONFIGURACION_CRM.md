# SP Leóns Group — Configurar CRM + Meta Ads

## Datos actuales

| Dato | Valor |
|------|-------|
| Número WhatsApp | +57 321 462 5618 |
| Dominio | spcrm.duckdns.org |
| VERIFY_TOKEN | spInmobiliaria2026SecureVerifyToken |

## Credenciales que debes sacar de Meta

### 1. PHONE_NUMBER_ID
1. Abre [business.facebook.com](https://business.facebook.com)
2. **WhatsApp** → **Números de teléfono**
3. Selecciona +57 321 462 5618
4. Copia el **ID de número de teléfono** (son solo dígitos, ej: 1224496694078803)

### 2. WHATSAPP_TOKEN
1. Business Manager → **WhatsApp** → **Configuración de API**
2. Generar **Token permanente**
3. Permisos necesarios: `messages`, `whatsapp_business_messaging`
4. Copia el token (empieza con `EAA...`)

### 3. APP_SECRET
1. [developers.facebook.com](https://developers.facebook.com)
2. **Mi Apps** → Selecciona tu app de WhatsApp
3. **Configuración** → **Básico**
4. Copia el **App Secret**

### 4. WHATSAPP_BUSINESS_ACCOUNT_ID
1. Business Manager → **Configuración** → **Información de cuenta**
2. Copia el ID

## Poner en producción

1. Conéctate a la VM:
```bash
ssh ubuntu@spcrm.duckdns.org
```

2. Edita el .env:
```bash
sudo nano /home/ubuntu/sp-crm/app/.env
```

Rellena:
```
WHATSAPP_TOKEN=EAA...tu_token_real
PHONE_NUMBER_ID=el_id_que_copiaste
WHATSAPP_BUSINESS_ACCOUNT_ID=el_id_de_cuenta
APP_SECRET=el_app_secret
```

3. Guarda y reinicia:
```bash
cd /home/ubuntu/sp-crm/app
sudo docker compose down
sudo docker compose up -d --build
```

## Configurar webhook en Meta Developers

1. [developers.facebook.com](https://developers.facebook.com) → Tu App → WhatsApp → Webhook
2. URL: `https://spcrm.duckdns.org/webhook`
3. Verify Token: `spInmobiliaria2026SecureVerifyToken`
4. Suscribir a: `messages`, `message_deliveries`

## Probar webhook

```bash
curl -X GET "https://spcrm.duckdns.org/webhook?hub.mode=subscribe&hub.verify_token=spInmobiliaria2026SecureVerifyToken&hub.challenge=1234"
```
Debe responder: `1234`
