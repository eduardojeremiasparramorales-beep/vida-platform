// Constantes globales del sistema
module.exports = {
  // Sesión
  SESSION_TTL_MS: 1000 * 60 * 60 * 24 * 30, // 30 días
  SESSION_CLEANUP_INTERVAL: 1000 * 60 * 60 * 24, // 1 día

  // Escalación de leads
  ESC_ALERTA_MIN: 15,
  ESC_REASIGNAR_MIN: 30,
  ESC_ADMIN_MIN: 60,
  ESC_ASENTADO_HORAS: 24,
  ESCALATION_CHECK_INTERVAL: 60000, // 1 min

  // Archivos
  MAX_FILE_SIZE: 16 * 1024 * 1024, // 16MB (límite de WhatsApp para audio/video)
  MAX_MESSAGE_LENGTH: 4096,

  // Tiempos
  SSE_HEARTBEAT: 25000,
  MEDIA_PROPAGATION_DELAY: 150,
  TEMPLATE_REENGAGEMENT_DELAY: 3000,

  // NLP
  NLP_TIMEOUT_DEFAULT: 15000,
  NLP_CACHE_TTL: 5 * 60 * 1000,

  // Rate limiting
  LOGIN_MAX_ATTEMPTS: 10,
  LOGIN_WINDOW_MS: 15 * 60 * 1000,
  MEDIA_MAX_PER_MIN: 30,
  WEBHOOK_MAX_PER_MIN: 300,
  MESSAGE_MAX_PER_MIN: 20,
  API_MAX_PER_MIN: 300, // paraguas general para el resto de /api/*, no reemplaza los límites específicos

  // API
  API_VERSION: 'v22.0',
  DEFAULT_PORT: 3000,
  LEADS_QUERY_LIMIT: 200,
};
