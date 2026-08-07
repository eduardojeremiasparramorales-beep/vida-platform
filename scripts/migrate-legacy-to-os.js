/**
 * Migración Legacy (leads + messages) → OS Schema (customers + conversations + timeline)
 * Ejecutar en la VM de producción: node scripts/migrate-legacy-to-os.js
 */
const adapter = require('../src/db/adapter');

async function run() {
  await adapter.initDB();
  console.log('[MIGRATE] Iniciando migración legacy → OS...');

  // 1. Migrar leads → customers
  const leads = adapter.all('SELECT * FROM leads');
  console.log(`[MIGRATE] Leads encontrados: ${leads.length}`);

  let customersCreados = 0;
  let conversationsCreados = 0;
  let timelineCreados = 0;

  for (const lead of leads) {
    // Verificar si ya existe customer
    let customer = adapter.one('SELECT * FROM customers WHERE phone = ?', [lead.customer_phone]);
    
    if (!customer) {
      adapter.run(
        'INSERT INTO customers (name, phone, created_at) VALUES (?, ?, ?)',
        [lead.customer_name || 'Cliente', lead.customer_phone, lead.created_at]
      );
      customer = adapter.one('SELECT * FROM customers WHERE phone = ?', [lead.customer_phone]);
      customersCreados++;
    }

    // Verificar si ya existe conversation
    let conv = adapter.one('SELECT * FROM conversations WHERE customer_id = ? AND channel = ?', [customer.id, 'whatsapp']);
    
    if (!conv) {
      adapter.run(
        `INSERT INTO conversations (channel, customer_id, assigned_to_id, status, unread_count, last_message, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'whatsapp',
          customer.id,
          lead.assigned_to_id || null,
          lead.status || 'nuevo',
          lead.unread_count || 0,
          lead.last_message || lead.first_message || '',
          lead.created_at,
          lead.updated_at
        ]
      );
      conv = adapter.one('SELECT * FROM conversations WHERE customer_id = ? AND channel = ?', [customer.id, 'whatsapp']);
      conversationsCreados++;
    } else {
      // Actualizar assigned_to_id si cambió
      if (lead.assigned_to_id && lead.assigned_to_id !== conv.assigned_to_id) {
        adapter.run('UPDATE conversations SET assigned_to_id = ?, updated_at = ? WHERE id = ?', [lead.assigned_to_id, lead.updated_at, conv.id]);
      }
    }

    // Migrar messages → timeline
    const messages = adapter.all('SELECT * FROM messages WHERE lead_id = ?', [lead.id]);
    for (const msg of messages) {
      const exists = adapter.one('SELECT * FROM timeline WHERE conversation_id = ? AND body = ? AND created_at = ?', [conv.id, msg.body, msg.timestamp]);
      if (!exists) {
        adapter.run(
          `INSERT INTO timeline (conversation_id, event_type, channel, body, direction, from_number, to_number, media_type, media_id, media_mime, media_filename, created_at)
           VALUES (?, 'message', 'whatsapp', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [conv.id, msg.body, msg.direction, msg.from_number, msg.to_number, msg.media_type || null, msg.media_id || null, msg.media_mime || null, msg.media_filename || null, msg.timestamp]
        );
        timelineCreados++;
      }
    }
  }

  console.log('[MIGRATE] ✅ Completado:');
  console.log(`  - Customers creados: ${customersCreados}`);
  console.log(`  - Conversations creadas: ${conversationsCreados}`);
  console.log(`  - Timeline events creados: ${timelineCreados}`);

  // Verificación
  const customers = adapter.all('SELECT * FROM customers');
  const convs = adapter.all('SELECT * FROM conversations');
  const timeline = adapter.all('SELECT * FROM timeline');
  console.log('[MIGRATE] Verificación final:');
  console.log(`  - Total customers: ${customers.length}`);
  console.log(`  - Total conversations: ${convs.length}`);
  console.log(`  - Total timeline: ${timeline.length}`);
}

run().catch(e => {
  console.error('[MIGRATE] Error:', e);
  process.exit(1);
});