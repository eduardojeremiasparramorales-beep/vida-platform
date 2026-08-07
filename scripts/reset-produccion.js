// Borra TODO el historial de la fase de prueba: leads, clientes multicanal,
// mensajes, conversaciones, vendedores, citas, tareas, notificaciones, etc.
// Deja intacta la configuración del sistema: plantillas de WhatsApp, workflows,
// respuestas rápidas globales, y el catálogo de proyectos/lotes (solo se
// limpian en los lotes las referencias a los leads/clientes/asesores de prueba).
//
// Uso:
//   node scripts/reset-produccion.js          → dry-run, solo muestra qué se borraría
//   node scripts/reset-produccion.js --yes    → ejecuta el borrado de verdad
//
// Después de correrlo con --yes, reinicia el servidor (o el contenedor Docker)
// para que se recree automáticamente la cuenta admin — ensureAdminUser() en
// src/index.js la crea con ADMIN_PHONE/ADMIN_PIN del .env (por defecto
// +573214625618 · PIN 0000). Los demás asesores se vuelven a crear desde Equipo.

const path = require('path');
const fs = require('fs');
const adapter = require('../src/db/adapter');

// Orden hijos → padres (por si algún día se activa PRAGMA foreign_keys).
const HISTORIAL_TABLES = [
  'message_reactions',
  'lote_historial',
  'tareas',
  'citas',
  'lead_notes',
  'scheduled_messages',
  'pending_outbound',
  'notifications',
  'team_messages',
  'campaign_recipients',
  'campaigns',
  'timeline',
  'conversations',
  'customer_channels',
  'customers',
  'messages',
  'leads',
  'ubicaciones_guardadas',
  'vendedor_templates',
  'push_subscriptions',
  'sessions',
  'usuarios',
  'vendedores',
];

const CONSERVADAS = [
  'config', 'wa_templates', 'templates', 'workflows', 'propiedades', 'proyectos',
  'lotes (catálogo — solo se limpian sus referencias a leads/clientes de prueba)',
  'optout (lista de exclusión de WhatsApp — se conserva por cumplimiento)',
];

async function main() {
  const dryRun = !process.argv.includes('--yes');
  const dbPath = path.join(__dirname, '..', 'data', 'sp-leads.db');
  if (!fs.existsSync(dbPath)) {
    console.error('❌ No se encuentra la base de datos en', dbPath);
    process.exit(1);
  }

  await adapter.initDB();

  console.log('📊 Filas actuales por tabla:\n');
  let totalRows = 0;
  for (const t of HISTORIAL_TABLES) {
    const r = adapter.one(`SELECT COUNT(*) AS n FROM ${t}`);
    const n = r ? r.n : 0;
    totalRows += n;
    console.log(`  ${t.padEnd(22)} ${n}`);
  }
  const lotesTocados = adapter.one(
    'SELECT COUNT(*) AS n FROM lotes WHERE cliente_id IS NOT NULL OR lead_id IS NOT NULL OR asesor_id IS NOT NULL'
  );
  console.log(`  lotes (refs a limpiar)   ${lotesTocados ? lotesTocados.n : 0}`);

  console.log('\n✅ Se conserva intacto:\n  - ' + CONSERVADAS.join('\n  - ') + '\n');

  if (dryRun) {
    console.log(`👀 Modo simulación (dry-run) — ${totalRows} filas se borrarían.`);
    console.log('   Corre de nuevo con --yes para ejecutar el borrado real:');
    console.log('   node scripts/reset-produccion.js --yes');
    process.exit(0);
  }

  // Backup del archivo completo antes de tocar nada.
  const backupPath = path.join(__dirname, '..', 'data', `sp-leads-backup-antes-de-reset-${Date.now()}.db`);
  fs.copyFileSync(dbPath, backupPath);
  console.log(`💾 Backup creado en ${path.relative(process.cwd(), backupPath)}`);
  for (const ext of ['-wal', '-shm']) {
    if (fs.existsSync(dbPath + ext)) fs.copyFileSync(dbPath + ext, backupPath + ext);
  }

  console.log('\n🗑️  Borrando...');
  for (const t of HISTORIAL_TABLES) {
    adapter.run(`DELETE FROM ${t}`);
    adapter.run('DELETE FROM sqlite_sequence WHERE name = ?', [t]);
    console.log(`  ✓ ${t}`);
  }

  adapter.run(
    "UPDATE lotes SET cliente_id = NULL, lead_id = NULL, asesor_id = NULL, estado = 'disponible', fecha_separacion = '', fecha_venta = ''"
  );
  console.log('  ✓ lotes (referencias limpiadas, catálogo conservado)');

  adapter.saveDBIfNeeded();

  console.log('\n✅ Listo. Reinicia el servidor (o el contenedor Docker) para que se recree');
  console.log('   la cuenta admin automáticamente. Luego crea de nuevo a los demás asesores');
  console.log('   desde Equipo → Agregar asesor.');
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
