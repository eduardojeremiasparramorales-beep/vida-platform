#!/bin/bash
# ==============================================================
# deploy.sh — SP Inmobiliaria CRM - Despliegue en Google Cloud VM
# Uso: sudo bash deploy/deploy.sh
# Ejecutar como root en la VM (e2-micro, Ubuntu 22.04)
# ==============================================================
set -euo pipefail

DOMAIN="spcrm.duckdns.org"
APP_DIR="/home/ubuntu/sp-crm/app"
BACKUP_DIR="/home/ubuntu/backups"
ENV_FILE="$APP_DIR/.env"
CADDYFILE="/etc/caddy/Caddyfile"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${CYAN}[$(date '+%H:%M:%S')]${NC} $1"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }

log "${CYAN}═══════════════════════════════════════════${NC}"
log "${CYAN}  SP Inmobiliaria CRM — Deploy en GCP VM   ${NC}"
log "${CYAN}═══════════════════════════════════════════${NC}"
echo ""

# === 1. VERIFICAR REQUISITOS ===
log "📦 Verificando requisitos..."

if [ "$(id -u)" -ne 0 ]; then fail "Ejecutar con sudo o como root"; fi

command -v docker     >/dev/null 2>&1 || { warn "Docker no instalado. Instalando..."; apt-get update -qq && apt-get install -y -qq ca-certificates curl && install -m 0755 -d /etc/apt/keyrings && curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc && chmod a+r /etc/apt/keyrings/docker.asc && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null && apt-get update -qq && apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin; ok "Docker instalado"; }
command -v docker compose >/dev/null 2>&1 || fail "docker compose no disponible"
command -v caddy >/dev/null 2>&1 || { warn "Caddy no instalado. Instalando..."; apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && echo "deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" | tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null && apt-get update -qq && apt-get install -y -qq caddy; ok "Caddy instalado"; }
command -v sqlite3   >/dev/null 2>&1 || { warn "sqlite3 no instalado (necesario para checkpoint de backup). Instalando..."; apt-get install -y -qq sqlite3; ok "sqlite3 instalado"; }

ok "Requisitos OK"

# === 2. CLONAR / ACTUALIZAR REPO ===
log "📂 Actualizando código..."
if [ -d "$APP_DIR" ]; then
  cd "$APP_DIR"
  git fetch origin HEAD 2>/dev/null
  if [ $? -eq 0 ]; then
    git reset --hard origin/HEAD && git clean -fd
    ok "Código actualizado + archivos huérfanos eliminados"
  else
    warn "git fetch falló — revisa conexión con GitHub"
  fi
else
  mkdir -p "$(dirname "$APP_DIR")"
  git clone https://github.com/eduardojeremiasparramorales-beep/sp-inmobiliaria-leads.git "$APP_DIR"
  cd "$APP_DIR"
fi

# === 3. CONFIGURAR .env ===
log "🔧 Configurando .env..."
if [ -f "$ENV_FILE" ]; then
  warn ".env ya existe — se conservan valores actuales"
else
  echo ""
  log "⚠️  CREAR .env DE PRODUCCIÓN"
  echo ""
  echo "Ingresa los valores (o presiona Enter para usar placeholder):"
  echo ""

  read -p "WHATSAPP_TOKEN: " wt
  read -p "PHONE_NUMBER_ID: " pn
  read -p "WHATSAPP_BUSINESS_ACCOUNT_ID: " ba
  read -p "APP_SECRET (OBLIGATORIO): " as
  read -p "ADMIN_PASSWORD (mín 16 chars): " ap

  cat > "$ENV_FILE" <<ENVEOF
PORT=3000
NODE_ENV=production

# === WHATSAPP CLOUD API ===
WHATSAPP_TOKEN=${wt:-PONER_TOKEN_AQUI}
PHONE_NUMBER_ID=${pn:-PONER_PHONE_NUMBER_ID_AQUI}
WHATSAPP_BUSINESS_ACCOUNT_ID=${ba:-PONER_WABA_ID_AQUI}
VERIFY_TOKEN=SpLeonsGroupVerify
WHATSAPP_API_VERSION=v22.0
APP_SECRET=${as:-PONER_APP_SECRET_AQUI}

# === AUTENTICACIÓN ===
ADMIN_EMAIL=admin@spinmobiliaria.com
ADMIN_PASSWORD=${ap:-Spadmin2026}

# === COOKIES ===
SECURE_COOKIES=true

# === NOTIFICACIONES PUSH (VAPID) ===
# Generar con: npx web-push generate-vapid-keys
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@spinmobiliaria.com

# === OPENAI (NLP opcional) ===
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini

# === TWILIO (Click-to-call opcional) ===
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_NUMBER=
ENVEOF
  ok ".env creado en $ENV_FILE"
fi

# === 4. CONFIGURAR CADDY ===
log "🌐 Configurando Caddy..."
mkdir -p "$(dirname "$CADDYFILE")"
cat > "$CADDYFILE" <<CADDYEOF
$DOMAIN {
    reverse_proxy localhost:3000
    encode gzip {
        except application/vnd.android.package-archive
        except application/zip
    }
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
CADDYEOF
caddy fmt --overwrite "$CADDYFILE" 2>/dev/null || true
systemctl reload caddy 2>/dev/null || systemctl start caddy 2>/dev/null || warn "Caddy no inició automáticamente"
ok "Caddy configurado para $DOMAIN"

# === 5. CONSTRUIR Y EJECUTAR DOCKER ===
log "🐳 Construyendo imagen Docker..."
cd "$APP_DIR"
docker compose down --remove-orphans 2>/dev/null || true
docker compose build --pull
docker compose up -d
ok "CRM corriendo en puerto 3000"

# === 6. HEALTHCHECK ===
log "🏥 Verificando health..."
sleep 5
for i in 1 2 3 4 5; do
  if docker compose exec -T crm node -e "require('http').get('http://localhost:3000/api/health',(r)=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{const j=JSON.parse(d);process.exit(j.status==='ok'?0:1)})})" 2>/dev/null; then
    ok "CRM saludable"
    break
  fi
  sleep 3
  if [ $i -eq 5 ]; then warn "Healthcheck no respondió — revisa logs con: docker compose logs"; fi
done

# === 7. BACKUP AUTOMÁTICO ===
log "💾 Configurando backup diario..."
mkdir -p "$BACKUP_DIR"
cat > "/etc/cron.daily/sp-crm-backup" <<'CRONEOF'
#!/bin/bash
APP_DIR="/home/ubuntu/sp-crm/app"
BACKUP_DIR="/home/ubuntu/backups"
DB_PATH="$APP_DIR/data/sp-leads.db"
MEDIA_DIR="$APP_DIR/data/media"
[ ! -f "$DB_PATH" ] && exit 0
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
command -v sqlite3 >/dev/null 2>&1 && sqlite3 "$DB_PATH" "PRAGMA wal_checkpoint(TRUNCATE);" || true
cp "$DB_PATH" "$BACKUP_DIR/sp-leads-$TIMESTAMP.db"
gzip -f "$BACKUP_DIR/sp-leads-$TIMESTAMP.db"
if [ -d "$MEDIA_DIR" ] && [ "$(ls -A "$MEDIA_DIR" 2>/dev/null)" ]; then
  tar -czf "$BACKUP_DIR/sp-media-$TIMESTAMP.tar.gz" -C "$APP_DIR/data" media
fi
find "$BACKUP_DIR" -name "sp-leads-*.db.gz" -mtime +30 -delete
find "$BACKUP_DIR" -name "sp-media-*.tar.gz" -mtime +30 -delete
echo "[$(date)] Backup: sp-leads-$TIMESTAMP.db.gz + sp-media-$TIMESTAMP.tar.gz" >> "$BACKUP_DIR/backup.log"
CRONEOF
chmod +x "/etc/cron.daily/sp-crm-backup"
ok "Backup diario configurado"

# === 8. STACK TRÁFICO (firewall) ===
log "🔥 Configurando firewall..."
ufw allow 22/tcp  >/dev/null 2>&1 || true
ufw allow 80/tcp  >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
ufw --force enable >/dev/null 2>&1 || true
ok "Firewall configurado (22, 80, 443)"

# === 9. MOSTRAR RESUMEN ===
echo ""
log "${GREEN}═══════════════════════════════════════════${NC}"
log "${GREEN}  ✅ DESPLIEGUE COMPLETADO                 ${NC}"
log "${GREEN}═══════════════════════════════════════════${NC}"
echo ""
echo "  URL:     https://$DOMAIN"
echo "  Login:   https://$DOMAIN/login.html"
echo "  Admin:   $(grep ^ADMIN_EMAIL $ENV_FILE | cut -d= -f2)"
echo ""
echo "  Comandos útiles:"
echo "    docker compose logs -f     → Ver logs"
echo "    docker compose restart     → Reiniciar CRM"
echo "    docker compose down && up  → Reconstruir"
echo "    bash deploy/backup.sh      → Backup manual"
echo ""
warn "⚠️  ANTES DE USAR EN PRODUCCIÓN:"
echo "  1. Verifica .env → APP_SECRET esté configurado"
echo "  2. Verifica .env → WHATSAPP_TOKEN sea válido"
echo "  3. Agrega vendedores reales (ver CLAUDE.md)"
echo "  4. Prueba webhook: https://$DOMAIN/webhook"
echo ""
