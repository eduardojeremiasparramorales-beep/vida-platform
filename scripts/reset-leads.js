// Borra TODOS los leads y sus chats (mensajes, conversaciones, notas, citas,
// tareas, campañas) para que no quede ningún registro de que un cliente ya
// escribió. A diferencia de reset-produccion.js, este NO toca las cuentas de
// asesores (vendedores/usuarios/PIN/sesiones) ni la configuración del sistema.
//
// Uso:
//   node scripts/reset-leads.js          → dry-run, solo muestra qué se borraría
//   node scripts/reset-leads.js --yes    → ejecuta el borrado de verdad
//
// Orden hijos → padres siguiendo las FK reales (el mismo tipo de bug que rompía
// el borrado de vendedores — "FOREIGN KEY constraint failed" — puede pasar aquí
// si conversations/customers se borran antes que sus hijos):
//   timeline, workflow_logs        → FK a conversations
//   conversations, customer_channels → FK a customers
//   messages, tareas                → FK a leads

const path = require('path');
const fs = require('fs');
const adapter = require('../src/db/adapter');

// Se borran completas (no tienen la noción de "suelta"/personal).
const TABLES_FULL = [
  'message_reactions',
  'lead_scores',
  'feed_reactions',
  'feed_events',
  'reservas',
  'transacciones',
  'comisiones',
  'documentos',
  'encuestas_satisfaccion',
  'referidos',
  'workflow_logs',
  'timeline',
  'scheduled_messages',
  'pending_outbound',
  'campaign_recipients',
  'campaigns',
  'conversations',
  'customer_channels',
  'customers',
  'messages',
  'leads',
];

// Se borran solo las filas ligadas a un lead — preservan las "sueltas"
// (tareas personales con lead_id=0, citas/notificaciones sin lead_id).
const TABLES_LEAD_SCOPED = [
  { table: 'lead_notes', where: '1=1' }, // siempre lead_id NOT NULL, no hay "sueltas"
  { table: 'citas', where: 'lead_id IS NOT NULL' },
  { table: 'tareas', where: 'lead_id != 0' },
  { table: 'notifications', where: 'lead_id IS NOT NULL' },
];

const CONSERVADAS = [
  'vendedores, usuarios, sesiones y PIN — las cuentas de asesores quedan intactas',
  'config, wa_templates, templates, workflows (solo se borran los workflow_logs)',
  'citas/tareas/notificaciones sueltas (sin lead asociado)',
  'propiedades, proyectos, lotes (catálogo — solo se limpian sus referencias a clientes/leads borrados)',
  'lote_historial (historial de ventas de lotes, no es historial de leads/chats)',
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
  let total = 0;
  for (const t of TABLES_FULL) {
    const r = adapter.one(`SELECT COUNT(*) AS n FROM ${t}`);
    const n = r ? r.n : 0;
    total += n;
    console.log(`  ${t.padEnd(22)} ${n}`);
  }
  for (const { table, where } of TABLES_LEAD_SCOPED) {
    const r = adapter.one(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`);
    const n = r ? r.n : 0;
    total += n;
    console.log(`  ${table.padEnd(22)} ${n} (solo ligadas a un lead)`);
  }
  const lotesTocados = adapter.one('SELECT COUNT(*) AS n FROM lotes WHERE cliente_id IS NOT NULL OR lead_id IS NOT NULL');
  console.log(`  lotes (refs a limpiar)   ${lotesTocados ? lotesTocados.n : 0}`);

  console.log('\n✅ Se conserva intacto:\n  - ' + CONSERVADAS.join('\n  - ') + '\n');

  if (dryRun) {
    console.log(`👀 Modo simulación (dry-run) — ${total} filas se borrarían.`);
    console.log('   Corre de nuevo con --yes para ejecutar el borrado real:');
    console.log('   node scripts/reset-leads.js --yes');
    process.exit(0);
  }

  const backupPath = path.join(__dirname, '..', 'data', `sp-leads-backup-antes-de-reset-leads-${Date.now()}.db`);
  fs.copyFileSync(dbPath, backupPath);
  console.log(`💾 Backup creado en ${path.relative(process.cwd(), backupPath)}`);
  for (const ext of ['-wal', '-shm']) {
    if (fs.existsSync(dbPath + ext)) fs.copyFileSync(dbPath + ext, backupPath + ext);
  }

  console.log('\n🗑️  Borrando...');
  for (const t of TABLES_FULL) {
    adapter.run(`DELETE FROM ${t}`);
    adapter.run('DELETE FROM sqlite_sequence WHERE name = ?', [t]);
    console.log(`  ✓ ${t}`);
  }
  for (const { table, where } of TABLES_LEAD_SCOPED) {
    adapter.run(`DELETE FROM ${table} WHERE ${where}`);
    console.log(`  ✓ ${table} (ligadas a lead)`);
  }

  adapter.run(
    "UPDATE lotes SET cliente_id = NULL, lead_id = NULL, estado = 'disponible', fecha_separacion = '', fecha_venta = '' WHERE cliente_id IS NOT NULL OR lead_id IS NOT NULL"
  );
  console.log('  ✓ lotes (referencias a clientes/leads limpiadas, catálogo y asesor conservados)');

  adapter.saveDBIfNeeded();

  console.log('\n✅ Listo. Los asesores conservan sus cuentas, PIN y sesiones — no hace falta');
  console.log('   reiniciar el servidor ni recrear nada. El CRM queda sin ningún lead ni chat.');
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
