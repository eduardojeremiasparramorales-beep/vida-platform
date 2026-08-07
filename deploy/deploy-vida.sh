#!/bin/bash
# ==============================================================
# deploy-vida.sh — Deploy Vid.a en la VM de GCP
# Ejecutar desde la consola SSH del navegador GCP como usuario
# eduardojeremiassparramorales (sudo)
# ==============================================================
set -euo pipefail

APP_DIR="$HOME/vida-app"
REPO="https://github.com/eduardojeremiasparramorales-beep/vida-platform.git"
CADDYFILE="/etc/caddy/Caddyfile"

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${CYAN}[$(date '+%H:%M:%S')]${NC} $1"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }

log "${CYAN}═══════════════════════════════════════${NC}"
log "${CYAN}  Vid.a — Deploy en GCP VM             ${NC}"
log "${CYAN}═══════════════════════════════════════${NC}"
echo ""

# 1. Verificar Docker
command -v docker >/dev/null 2>&1 || fail "Docker no instalado"
command -v docker compose >/dev/null 2>&1 || fail "docker compose no disponible"
ok "Docker OK"

# 2. Clonar o actualizar
if [ -d "$APP_DIR" ]; then
  log "Actualizando código..."
  cd "$APP_DIR"
  git pull origin main 2>/dev/null || fail "git pull falló"
  ok "Código actualizado"
else
  log "Clonando repo..."
  git clone "$REPO" "$APP_DIR"
  cd "$APP_DIR"
  ok "Repo clonado"
fi

# 3. Crear .env si no existe
ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  log "Creando .env..."
  cat > "$ENV_FILE" <<'ENVEOF'
PORT=3000
NODE_ENV=production

# === VID.A PLATFORM ===
VIDA_MASTER_KEY=a2fb3fc7d303ee300e997535c13200097f99936472cf162e19019528c7
VIDA_PLATFORM_EMAIL=fundador@vid.a
VIDA_PLATFORM_PASSWORD=7777
ADMIN_EMAIL=fundador@vid.a
ADMIN_PASSWORD=7777

# === COOKIES ===
SECURE_COOKIES=true

# === CAMPAÑA SANDRA ===
SANDRA_WEB_DIR=/app/sandra-web

# === WHATSAPP (opcional) ===
WHATSAPP_TOKEN=
PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
VERIFY_TOKEN=vidA-platform-verify
WHATSAPP_API_VERSION=v22.0
APP_SECRET=

# === OPENAI (opcional) ===
OPENAI_API_KEY=
OPENAI_MODEL=gpt-40-mini

# === TWILIO (opcional) ===
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_NUMBER=

# === VAPID (notificaciones push) ===
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:fundador@vid.a
ENVEOF
  ok ".env creado"
else
  ok ".env ya existe"
fi

# 4. Construir y levantar
log "Construyendo imagen Docker..."
docker compose down 2>/dev/null || true
docker compose build --pull
docker compose up -d
ok "Vid.a corriendo en puerto 3001"

# 5. Healthcheck
log "Verificando salud..."
sleep 5
for i in 1 2 3 4 5; do
  if docker compose exec -T vida node -e "require('http').get('http://localhost:3000/api/health',(r)=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{const j=JSON.parse(d);process.exit(j.status==='ok'?0:1)})})" 2>/dev/null; then
    ok "Vid.a saludable"
    break
  fi
  sleep 3
  if [ $i -eq 5 ]; then
    echo ""
    log "⚠️  Healthcheck no respondió. Logs:"
    docker compose logs --tail=20
    exit 1
  fi
done

# 6. Actualizar Caddy para servir /c/* desde Vid.a (puerto 3001)
log "Configurando Caddy..."
cat > "$CADDYFILE" <<'CADDYEOF'
spcrm.duckdns.org {
    handle /c/* {
        reverse_proxy localhost:3001
    }
    handle /api/campana* {
        reverse_proxy localhost:3001
    }
    handle /api/campana-publico* {
        reverse_proxy localhost:3001
    }
    handle /plataforma* {
        reverse_proxy localhost:3001
    }
    handle {
        reverse_proxy localhost:3000
    }
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
CADDYEOF
sudo systemctl restart caddy 2>/dev/null || sudo systemctl start caddy 2>/dev/null || true
ok "Caddy configurado"

# 7. Resumen
echo ""
log "${GREEN}═══════════════════════════════════════${NC}"
log "${GREEN}  ✅ VID.A DESPLEGADO                  ${NC}"
log "${GREEN}═══════════════════════════════════════${NC}"
echo ""
echo "  Landing campaña: https://spcrm.duckdns.org/c/sandra-concejo"
echo "  Panel equipo:    https://spcrm.duckdns.org/c/sandra-concejo/panel.html"
echo "  Plataforma:      https://spcrm.duckdns.org/plataforma"
echo ""
echo "  Login panel: +573214625618 / PIN 7777"
echo "  Login plataforma: PIN 7777"
echo ""
echo "  Logs: docker compose logs -f"
echo "  Reiniciar: docker compose restart"
echo ""
