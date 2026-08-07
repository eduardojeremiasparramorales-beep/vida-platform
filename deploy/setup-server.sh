#!/bin/bash
# ==============================================================
# setup-server.sh — Configuración única de la VM para deploy
# sin contraseñas. Ejecutar UNA SOLA VEZ como ubuntu (no root).
# ==============================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${CYAN}[$(date '+%H:%M:%S')]${NC} $1"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }

log "=== Configuración de deploy sin contraseñas ==="
echo ""

# 1. Verificar que no somos root
if [ "$(id -u)" -eq 0 ]; then fail "Ejecutar como ubuntu (no root)"; fi

# 2. SSH key para GitHub
if [ ! -f ~/.ssh/id_ed25519 ]; then
  log "Generando clave SSH para GitHub..."
  ssh-keygen -t ed25519 -C "deploy@spcrm" -f ~/.ssh/id_ed25519 -N ""
  ok "Clave SSH generada"
else
  ok "Clave SSH ya existe"
fi

echo ""
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  PASO MANUAL REQUERIDO                                      ${NC}"
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Agrega esta clave pública a GitHub como DEPLOY KEY con WRITE ACCESS:"
echo ""
echo "  1. Ve a: https://github.com/eduardojeremiasparramorales-beep/sp-inmobiliaria-leads/settings/keys"
echo "  2. Click 'Add deploy key'"
echo "  3. Título: deploy@spcrm"
echo "  4. Key (copia la siguiente línea):"
echo ""
cat ~/.ssh/id_ed25519.pub
echo ""
echo "  5. MARCA 'Allow write access'"
echo "  6. Click 'Add key'"
echo ""

# 3. Preguntar si ya agregó la key
read -p "¿Ya agregaste la clave en GitHub? (s/N): " CONFIRM
if [[ "$CONFIRM" != "s" && "$CONFIRM" != "S" && "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo "Hazlo y luego vuelve a ejecutar este script."
  exit 1
fi

# 4. Probar conexión SSH
log "Probando conexión SSH con GitHub..."
ssh -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1 || true
# El mensaje "successfully authenticated" aparece aunque ssh devuelva 1
if ssh -T git@github.com 2>&1 | grep -q "successfully authenticated"; then
  ok "Conexión SSH OK"
else
  fail "No se pudo conectar. Revisa la deploy key en GitHub."
fi

# 5. Cambiar remote a SSH
cd /home/ubuntu/sp-crm/app
CURRENT=$(git remote get-url origin)
if echo "$CURRENT" | grep -q "^https"; then
  log "Cambiando remote de HTTPS a SSH..."
  git remote set-url origin git@github.com:eduardojeremiasparramorales-beep/sp-inmobiliaria-leads.git
  ok "Remote cambiado: $CURRENT → git@github.com:..."
else
  ok "Remote ya es SSH"
fi

# 6. Configurar git para evitar conversiones de línea molestas
git config core.autocrlf input
git config core.eol lf
git config pull.rebase false

# 7. Verificar que data/ y media/ están en .gitignore y no trackeados
log "Verificando .gitignore..."
cd /home/ubuntu/sp-crm/app
TRACKED=$(git ls-files data/ media/ 2>/dev/null)
if [ -n "$TRACKED" ]; then
  log "Archivos de datos trackeados en git — eliminando del índice..."
  git rm -r --cached data/ media/ 2>/dev/null || true
  git commit -m "chore: dejar de trackear data/ y media/ en git"
  ok "Commit hecho — haz push pronto"
fi

echo ""
ok "Configuración completada"
echo ""
echo -e "${GREEN}Ahora el deploy es un solo comando:${NC}"
echo ""
echo "  sudo bash deploy/deploy.sh"
echo ""
echo "O manualmente:"
echo "  cd /home/ubuntu/sp-crm/app && git pull && docker compose up -d --build"
