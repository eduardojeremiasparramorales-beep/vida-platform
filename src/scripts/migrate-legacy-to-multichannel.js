// migrate-legacy-to-multichannel.js
// Migración one-time: schema legacy (leads + messages) → schema multicanal (customers + conversations + timeline)
// Ejecutar: node src/scripts/migrate-legacy-to-multichannel.js
// Seguro de re-ejecutar (idempotente): usa INSERT OR IGNORE

const path = require('path');
const adapter = require('../db/adapter');

async function migrate() {
  console.log('=== Migración Legacy → Multicanal ===');
  await adapter.initDB();
  const db = adapter.getDB();

  // Si la DB es sql.js (modo async), .all devuelve promesas
  const isAsync = typeof db.all === 'function' && db.all.constructor.name === 'AsyncFunction';
  const all = (sql, params) => isAsync ? db.all(sql, params) : adapter.all(sql, params);
  const one = (sql, params) => isAsync ? db.get(sql, params) : adapter.one(sql, params);
  const run = (sql, params) => isAsync ? db.run(sql, params) : adapter.run(sql, params);

  const leads = await all('SELECT * FROM leads ORDER BY id');
  console.log(`Leads encontrados: ${leads.length}`);

  let customersCreated = 0;
  let conversationsCreated = 0;
  let timelinesCreated = 0;
  let skipped = 0;

  for (const lead of leads) {
    try {
      // 1. Buscar customer existente por número en customer_channels
      let customer = await one(`
        SELECT c.* FROM customers c
        JOIN customer_channels cc ON cc.customer_id = c.id
        WHERE cc.channel = 'whatsapp' AND cc.channel_user_id = ?
        LIMIT 1
      `, [lead.customer_phone]);

      if (!customer) {
        // Intentar por teléfono directo en customers
        customer = await one('SELECT * FROM customers WHERE phone = ? LIMIT 1', [lead.customer_phone]);
      }

      if (!customer) {
        // Crear nuevo customer
        await run(
          'INSERT INTO customers (name, phone, created_at) VALUES (?, ?, ?)',
          [lead.customer_name || 'Cliente', lead.customer_phone, lead.created_at]
        );
        const row = await one('SELECT * FROM customers WHERE id = (SELECT last_insert_rowid())');
        customer = row;

        // Vincular canal WhatsApp
        await run(
          'INSERT INTO customer_channels (customer_id, channel, channel_user_id, channel_username) VALUES (?, ?, ?, ?)',
          [customer.id, 'whatsapp', lead.customer_phone, lead.customer_name || '']
        );
        customersCreated++;
      }

      // 2. Crear conversación (si no existe para este customer + canal)
      const existingConv = await one(
        'SELECT id FROM conversations WHERE customer_id = ? AND channel = ? AND status != ? ORDER BY id DESC LIMIT 1',
        [customer.id, 'whatsapp', 'cerrado']
      );

      let conversation;
      if (existingConv) {
        conversation = { id: existingConv.id };
        skipped++;
      } else {
        await run(`
          INSERT INTO conversations (channel, customer_id, assigned_to_id, status, unread_count, last_message, etiqueta, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          'whatsapp',
          customer.id,
          lead.assigned_to_id,
          lead.status || 'nuevo',
          lead.unread_count || 0,
          lead.last_message || '',
          lead.etiqueta || 'sin_clasificar',
          lead.created_at,
          lead.updated_at || lead.created_at,
        ]);
        const convRow = await one('SELECT * FROM conversations WHERE id = (SELECT last_insert_rowid())');
        conversation = convRow;
        conversationsCreated++;
      }

      // 3. Migrar mensajes → timeline (solo si no hay timeline para esta conversación)
      const existingTimelineCount = await one(
        'SELECT COUNT(*) as c FROM timeline WHERE conversation_id = ?',
        [conversation.id]
      );
      if (existingTimelineCount && existingTimelineCount.c > 0) {
        continue; // ya migrado
      }

      const messages = await all(
        'SELECT * FROM messages WHERE lead_id = ? ORDER BY timestamp ASC, id ASC',
        [lead.id]
      );

      for (const msg of messages) {
        await run(`
          INSERT INTO timeline (
            conversation_id, event_type, channel, body, direction,
            from_number, to_number,
            media_type, media_id, media_mime, media_filename,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          conversation.id,
          'message',
          'whatsapp',
          msg.body || '',
          msg.direction || 'incoming',
          msg.from_number || '',
          msg.to_number || '',
          msg.media_type || null,
          msg.media_id || null,
          msg.media_mime || null,
          msg.media_filename || null,
          msg.timestamp || lead.created_at,
        ]);
        timelinesCreated++;
      }
    } catch (err) {
      console.error(`Error migrando lead ${lead.id} (${lead.customer_phone}): ${err.message}`);
    }
  }

  console.log('\n=== Resumen ===');
  console.log(`Clientes creados: ${customersCreated}`);
  console.log(`Conversaciones creadas: ${conversationsCreated}`);
  console.log(`Conversaciones existentes (skipped): ${skipped}`);
  console.log(`Eventos timeline insertados: ${timelinesCreated}`);
  console.log('=== Migración completada ===');
}

migrate().catch(err => {
  console.error('Error en migración:', err);
  process.exit(1);
});
