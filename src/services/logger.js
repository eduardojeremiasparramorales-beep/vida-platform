// Registro centralizado de errores: archivo rotado (data/errors.log) + contador en
// memoria para /api/admin/salud + alerta al admin si hay una ráfaga de errores.
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', 'data');
const LOG_FILE = path.join(LOG_DIR, 'errors.log');
const MAX_SIZE = 5 * 1024 * 1024; // 5MB, se rota a errors.log.1

const recientes = []; // timestamps de errores (última hora)
let alertaEnviadaAt = 0;

function rotarSiHaceFalta() {
  try {
    const st = fs.statSync(LOG_FILE);
    if (st.size > MAX_SIZE) {
      fs.renameSync(LOG_FILE, LOG_FILE + '.1'); // sobreescribe la rotación anterior
    }
  } catch (e) { /* no existe aún */ }
}

function logError(origen, err, extra) {
  const msg = err && err.stack ? err.stack : String(err);
  const linea = `[${new Date().toISOString()}] [${origen}] ${msg}${extra ? ' | ' + JSON.stringify(extra).slice(0, 300) : ''}\n`;
  console.error(linea.trim());
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    rotarSiHaceFalta();
    fs.appendFileSync(LOG_FILE, linea);
  } catch (e) { /* disco lleno u otro problema: no tumbar el proceso por loguear */ }

  const ahora = Date.now();
  recientes.push(ahora);
  while (recientes.length && recientes[0] < ahora - 60 * 60 * 1000) recientes.shift();

  // Ráfaga: >10 errores en 5 min → notificar al admin (máx 1 alerta cada 30 min)
  const enCinco = recientes.filter(t => t > ahora - 5 * 60 * 1000).length;
  if (enCinco > 10 && ahora - alertaEnviadaAt > 30 * 60 * 1000) {
    alertaEnviadaAt = ahora;
    try {
      require('./notify').notify({
        vendedorId: 0, tipo: 'error_sistema', push: true,
        titulo: '🛑 Errores en el sistema',
        cuerpo: `${enCinco} errores en los últimos 5 minutos. Revisa los logs del servidor.`,
      }).catch(() => {});
    } catch (e) { /* noop */ }
  }
}

function erroresUltimaHora() {
  const ahora = Date.now();
  while (recientes.length && recientes[0] < ahora - 60 * 60 * 1000) recientes.shift();
  return recientes.length;
}

module.exports = { logError, erroresUltimaHora, LOG_FILE };
