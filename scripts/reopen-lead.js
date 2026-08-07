/**
 * Buscar y reabrir lead "macfosft" (cerrado → interesado)
 * Ejecutar en la VM: node scripts/reopen-lead.js
 */
const store = require('../src/db/store');

async function run() {
  await store.initDB();
  const adapter = require('../src/db/adapter');

  // Buscar leads que contengan "macfosft" en el nombre (case insensitive)
  const leads = adapter.all(`SELECT * FROM leads WHERE LOWER(customer_name) LIKE '%macfosft%' OR LOWER(customer_name) LIKE '%macfost%'`);
  
  if (leads.length === 0) {
    console.log('No se encontró lead "macfosft". Estos son los leads cerrados:');
    const cerrados = adapter.all("SELECT * FROM leads WHERE status = 'cerrado'");
    cerrados.forEach(l => console.log(`  ID:${l.id} | Nombre:${l.customer_name} | Tel:${l.customer_phone} | Etiqueta:${l.etiqueta || 'N/A'}`));
    if (cerrados.length === 0) console.log('  (no hay leads cerrados)');
    process.exit(0);
  }

  for (const lead of leads) {
    store.updateLeadStatus(lead.id, 'nuevo');
    store.setLeadEtiqueta(lead.id, 'interesado');
    console.log(`✅ Lead reabierto: ID:${lead.id} | ${lead.customer_name} | ${lead.customer_phone} → status: nuevo, etiqueta: interesado`);
  }
}

run().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});