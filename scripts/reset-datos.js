// Reset de datos del CRM: borra clientes e historial dejando el equipo intacto.
//
// BORRA: leads, mensajes, reacciones, notas, citas, tareas, conversaciones, timeline,
//        customers/canales multicanal, scores, reservas, finanzas, documentos,
//        encuestas, referidos, campaign_recipients, pending_outbound, notifications,
//        feed_events/reactions y logs de workflows. Resetea contadores.
// CONSERVA: vendedores, usuarios/admin, plantillas, propiedades, workflows,
//           plantillas de WhatsApp y configuración.
//
// Uso (requiere confirmación explícita):
//   node scripts/reset-datos.js CONFIRMAR
//
// ⚠️ HAZ UN RESPALDO ANTES (copiar la carpeta data/). Esta acción no es reversible.

require('dotenv').config();
const fs = require('fs');
const adapter = require('../src/db/adapter');
const { MEDIA_DIR } = require('../src/services/media');

// Tablas de datos transaccionales a vaciar (en orden hijo→padre por las FKs).
// IMPORTANTE: todas las tablas con FK a leads DEBEN ir antes de 'leads'.
const TABLAS_A_BORRAR = [
  'message_reactions',
  'lead_notes',
  'lead_scores',
  'scheduled_messages',
  'pending_outbound',
  'campaign_recipients',
  'citas',
  'tareas',
  'notifications',
  'feed_reactions',
  'feed_events',
  'reservas',
  'transacciones',
  'comisiones',
  'documentos',
  'encuestas_satisfaccion',
  'referidos',
  'messages',
  'workflow_logs',
  'timeline',
  'conversations',
  'customer_channels',
  'customers',
  'leads',
];

function contar(tabla) {
  try {
    const r = adapter.one(`SELECT COUNT(*) AS n FROM ${tabla}`);
    return r ? r.n : 0;
  } catch (e) {
    return null; // la tabla puede no existir
  }
}

function borrar(tabla) {
  try {
    adapter.run(`DELETE FROM ${tabla}`);
    // Reiniciar autoincrement si la tabla de secuencias existe
    try { adapter.run(`DELETE FROM sqlite_sequence WHERE name = ?`, [tabla]); } catch (e) {}
    return true;
  } catch (e) {
    console.warn(`  ⚠️  No se pudo vaciar ${tabla}: ${e.message}`);
    return false;
  }
}

async function main() {
  if (!process.argv.includes('CONFIRMAR')) {
    console.error('\n⛔ Falta confirmación. Esto BORRA todos los clientes y el historial.');
    console.error('   Haz primero un respaldo (copia la carpeta data/) y luego ejecuta:');
    console.error('   node scripts/reset-datos.js CONFIRMAR\n');
    process.exit(1);
  }

  await adapter.initDB();

  console.log('\n📊 Estado ANTES del reset:');
  for (const t of TABLAS_A_BORRAR) {
    const n = contar(t);
    if (n !== null) console.log(`  - ${t.padEnd(20)} ${n}`);
  }

  console.log('\n🧹 Borrando datos...');
  for (const t of TABLAS_A_BORRAR) borrar(t);

  // Resetear contadores del equipo (los leads ya no existen)
  try { adapter.run('UPDATE vendedores SET total_leads = 0'); } catch (e) {}

  adapter.saveDBIfNeeded(); // persistir si el motor es sql.js (better-sqlite3 ya persistió)

  // Borrar archivos de media huérfanos (audios/imágenes ya sin mensaje que los referencie).
  // Se corre dentro del contenedor (como root) para evitar problemas de permisos en el host.
  try {
    if (fs.existsSync(MEDIA_DIR)) {
      const archivos = fs.readdirSync(MEDIA_DIR);
      let borrados = 0;
      for (const f of archivos) {
        try { fs.unlinkSync(require('path').join(MEDIA_DIR, f)); borrados++; } catch (e) {}
      }
      console.log(`\n🗑️  Media borrada: ${borrados}/${archivos.length} archivos en ${MEDIA_DIR}`);
    }
  } catch (e) {
    console.warn('  ⚠️  No se pudo limpiar la carpeta de media:', e.message);
  }

  console.log('\n✅ Datos borrados. Estado DESPUÉS:');
  for (const t of TABLAS_A_BORRAR) {
    const n = contar(t);
    if (n !== null) console.log(`  - ${t.padEnd(20)} ${n}`);
  }

  console.log('\n👥 Equipo conservado:');
  try {
    const vs = adapter.all(`
      SELECT v.nombre, v.telefono, v.estado,
             CASE WHEN u.rol = 'admin' THEN 'admin (no recibe clientes)' WHEN u.rol = 'supervisor' THEN 'supervisor' ELSE 'asesor' END AS tipo
      FROM vendedores v
      LEFT JOIN usuarios u ON u.vendedor_id = v.id
      ORDER BY v.nombre
    `);
    vs.forEach(v => console.log(`  - ${v.nombre} | ${v.telefono} | ${v.estado} | ${v.tipo}`));
  } catch (e) {
    console.warn('  (no se pudo listar el equipo:', e.message, ')');
  }

  console.log('\n🎉 Reset completado. Reinicia el contenedor para limpiar el estado en memoria.\n');
}

main().catch(e => { console.error('Error en el reset:', e.message); process.exit(1); });
