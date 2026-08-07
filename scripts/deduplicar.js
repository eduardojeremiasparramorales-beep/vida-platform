const path = require('path');
const fs = require('fs');

async function main() {
  const dbPath = path.join(__dirname, '..', 'data', 'sp-leads.db');
  if (!fs.existsSync(dbPath)) {
    console.error('❌ No se encuentra la base de datos en', dbPath);
    process.exit(1);
  }

  // Backup
  const backupPath = path.join(__dirname, '..', 'data', 'sp-leads-backup-before-dedup.db');
  fs.copyFileSync(dbPath, backupPath);
  console.log('✅ Backup creado en data/sp-leads-backup-before-dedup.db');

  // Usar store.js (compatible better-sqlite3 / sql.js)
  const store = require('../src/db/store');
  store.initDB();

  const groups = store.getDuplicateGroups();

  if (groups.length === 0) {
    console.log('✅ No hay leads duplicados. Todo limpio.');
    process.exit(0);
  }

  console.log(`\n📊 Se encontraron ${groups.length} grupo(s) con duplicados:\n`);

  let totalMerged = 0;

  for (const group of groups) {
    console.log(`📌 ${group.phone} (${group.leads.length} registros):`);
    group.leads.forEach(l => console.log(`   ID ${l.id} | ${l.nombre} | ${l.status} | vendedor: ${l.vendedorId} | msgs: ${l.mensajes}`));

    // Estrategia: conservar el que tenga más mensajes, o el más antiguo, o el que tenga vendedor
    const sorted = [...group.leads].sort((a, b) => {
      if ((a.vendedorId && !b.vendedorId)) return -1;
      if ((!a.vendedorId && b.vendedorId)) return 1;
      if (a.status !== 'cerrado' && b.status === 'cerrado') return -1;
      if (a.status === 'cerrado' && b.status !== 'cerrado') return 1;
      return (b.mensajes || 0) - (a.mensajes || 0);
    });

    const primary = sorted[0];
    const duplicates = sorted.slice(1);
    console.log(`   → Primario: ID ${primary.id} (${primary.mensajes} msgs, vendedor: ${primary.vendedorId})`);

    for (const dup of duplicates) {
      console.log(`   → Fusionando ID ${dup.id} → ID ${primary.id}...`);
      try {
        const result = store.mergeLeads(primary.id, dup.id);
        console.log(`      ✓ ${result.messagesMoved} mensajes movidos`);
        totalMerged++;
      } catch (e) {
        console.error(`      ✗ Error: ${e.message}`);
      }
    }
  }

  // Verificación final
  console.log('\n=== VERIFICACIÓN POST-DEDUP ===');
  const remaining = store.getDuplicateGroups();
  if (remaining.length === 0) {
    console.log('✅ No quedan duplicados.');
  } else {
    console.log(`⚠️ Quedan ${remaining.length} grupo(s) con duplicados (revisar manualmente):`);
    remaining.forEach(g => {
      console.log(`   ${g.phone}: ${g.leads.map(l => `ID ${l.id} (${l.status})`).join(', ')}`);
    });
  }

  console.log(`\n✅ Proceso completado. ${totalMerged} duplicado(s) fusionado(s).`);
  console.log(`ℹ️  Backup guardado en: ${backupPath}`);
}

main().catch(e => {
  console.error('❌ Error fatal:', e);
  process.exit(1);
});