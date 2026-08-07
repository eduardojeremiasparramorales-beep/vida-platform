// Vid.a — Vertical CAMPAÑA (punto de entrada del paquete).
const { campanaSchema, ensureCampaignSchema, ensureReferidosTable, ESTADOS_VOTO_DEF, ROLES_EQUIPO } = require('./schema');
const store = require('./store');

module.exports = {
  campanaSchema,
  ensureCampaignSchema,
  ensureReferidosTable,
  ESTADOS_VOTO_DEF,
  ROLES_EQUIPO,
  store,
};