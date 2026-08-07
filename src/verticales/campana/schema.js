// Vid.a â€” Vertical CAMPAÃ‘A (votantes / segmentaciÃ³n / estados de voto / referidos).
// Un tenant con vertical='campaÃ±a' reutiliza las tablas base del CRM (leads = votantes,
// vendedores = equipo) y aÃ±ade columnas y helpers especÃ­ficos aquÃ­. provisionEmpresa()
// corre `campanaSchema()` sobre la BD vacÃ­a del tenant (ver services/vida-provision.js).
const adapter = require('../../db/adapter');

// Estados de voto por defecto para una campaÃ±a a concejo local (se pueden reemplazar
// por tenant vÃ­a config `vertical.campana.estados_voto`, ver store.js).
const ESTADOS_VOTO_DEF = [
  { id: 'lista', label: 'En lista', color: '#9ca3af' },
  { id: 'contactado', label: 'Contactado', color: '#60a5fa' },
  { id: 'simpatizante', label: 'Simpatizante', color: '#34d399' },
  { id: 'indeciso', label: 'Indeciso', color: '#fbbf24' },
  { id: 'comprometido', label: 'Comprometido', color: '#a78bfa' },
  { id: 'votara', label: 'VotarÃ¡', color: '#22d3ee' },
  { id: 'no_votaran', label: 'No votarÃ¡', color: '#f87171' },
  { id: 'ya_voto', label: 'Ya votÃ³', color: '#4ade80' },
];

// Estructura de mando de una campaÃ±a (gerente â†’ secretario â†’ conductor â†’ comunicaciones
// â†’ voluntariado). Se mapea al campo `vendedores.rol` del tenant (equipo base).
const ROLES_EQUIPO = [
  { id: 'gerente', label: 'Gerente' },
  { id: 'secretario', label: 'Secretario' },
  { id: 'conductor', label: 'Conductor pÃºblico' },
  { id: 'comunicaciones', label: 'Equipo comunicaciones' },
  { id: 'voluntariado', label: 'ComitÃ© voluntariado' },
];

// MigraciÃ³n idempotente: aÃ±ade como campila el schema especÃ­fico de un tenant campaÃ±a.
function ensureCampaignSchema() {
  const cols = adapter.all('PRAGMA table_info(leads)').map(r => r.name);
  const add = (c, t) => { if (!cols.includes(c)) { try { adapter.exec(`ALTER TABLE leads ADD COLUMN ${c} ${t}`); } catch (e) {} } };
  add('zona', 'TEXT');                 // zona / sector electoral
  add('barrio', 'TEXT');
  add('ocupacion', 'TEXT');           // perfil del ciudadano (planillas)
  add('fecha_nacimiento', 'TEXT');
  add('cedula', 'TEXT');              // documento (padrÃ³n, opcional)
  add('estado_voto', "TEXT DEFAULT 'lista'");
  add('referido_por', 'INTEGER');     // lead que lo refiricÃ³ (cadena de referidos)
  add('compromiso_nota', 'TEXT');     // planilla: cÃ³mo se manifestÃ³ el compromiso
  add('fecha_compromiso', 'DATETIME');
  add('resultado', 'TEXT');           // desenlace final en la elecciÃ³n (votÃ³ / no votÃ³ / se abstuvo)

  adapter.exec(`
    CREATE INDEX IF NOT EXISTS idx_leads_estado_voto ON leads(estado_voto);
    CREATE INDEX IF NOT EXISTS idx_leads_zona ON leads(zona);
    CREATE INDEX IF NOT EXISTS idx_leads_referido_por ON leads(referido_por);
  `);
}

// Tabla de referidos: cada fila es "el votante X refiriÃ³ a la persona Y" (telefÃ³nico / mapa).
function ensureReferidosTable() {
  adapter.exec(`
    CREATE TABLE IF NOT EXISTS votantes_referidos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      votante_id INTEGER NOT NULL,       -- lead que refiere
      ref_nombre TEXT DEFAULT '',
      ref_telefono TEXT DEFAULT '',
      ref_zona TEXT DEFAULT '',
      estado TEXT DEFAULT 'registrado',
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (votante_id) REFERENCES leads(id)
    );
    CREATE INDEX IF NOT EXISTS idx_vref_votante ON votantes_referidos(votante_id);
  `);
}

// Punto de entrada â€” corre completo sobre la BD del tenant campaÃ±a (transacciÃ³n implÃ­cita
// del adapter: cada exec es idempotente).
function campanaSchema() {
  ensureCampaignSchema();
  ensureReferidosTable();
}

module.exports = { campanaSchema, ensureCampaignSchema, ensureReferidosTable, ESTADOS_VOTO_DEF, ROLES_EQUIPO };
