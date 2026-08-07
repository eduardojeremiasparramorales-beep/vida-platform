// Script de migración: schema LEGACY (leads, messages) -> schema NUEVO (customers, customer_channels, conversations, timeline)
// Ejecutar con: node src/db/migrate.js

const path = require('path');
const fs = require('fs');
const { createNewTables } = require('./schema');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'sp-leads.db');

async function openDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    const Database = require('better-sqlite3');
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    return { db, isBetter: true };
  } catch (e) {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    const db = fs.existsSync(DB_PATH)
      ? new SQL.Database(fs.readFileSync(DB_PATH))
      : new SQL.Database();
    return { db, isBetter: false };
  }
}

function all(db, isBetter, sql, params = []) {
  if (isBetter) return db.prepare(sql).all(...params);
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function one(db, isBetter, sql, params = []) {
  const rows = all(db, isBetter, sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function run(db, isBetter, sql, params = []) {
  if (isBetter) return db.prepare(sql).run(...params);
  db.run(sql, params);
}

function exec(db, isBetter, sql) {
  if (isBetter) db.exec(sql);
  else db.run(sql);
}

function saveIfNeeded(db, isBetter) {
  if (isBetter) return;
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

async function migrate() {
  const { db, isBetter } = await openDB();

  createNewTables(db);

  // Verificar si ya hay datos migrados para no duplicar
  const yaTiene = one(db, isBetter, 'SELECT COUNT(*) as c FROM conversations');
  if (yaTiene && yaTiene.c > 0) {
    console.log(`Migración omitida: conversations ya tiene ${yaTiene.c} registros.`);
    return;
  }

  let customersCount = 0;
  let conversationsCount = 0;
  let timelineCount = 0;

  try {
    exec(db, isBetter, 'BEGIN TRANSACTION');

    // 1. Migrar customers (distintos por teléfono)
    const leadsDistintos = all(db, isBetter,
      'SELECT DISTINCT customer_name, customer_phone FROM leads');

    const customerIdByPhone = {};
    for (const l of leadsDistintos) {
      run(db, isBetter,
        'INSERT INTO customers (name, phone) VALUES (?, ?)',
        [l.customer_name || 'Cliente', l.customer_phone]);
      const c = one(db, isBetter,
        'SELECT id FROM customers WHERE phone = ? ORDER BY id DESC LIMIT 1',
        [l.customer_phone]);
      customerIdByPhone[l.customer_phone] = c.id;
      customersCount++;

      // 2. Migrar customer_channels
      run(db, isBetter,
        'INSERT OR IGNORE INTO customer_channels (customer_id, channel, channel_user_id) VALUES (?, ?, ?)',
        [c.id, 'whatsapp', l.customer_phone]);
    }

    // 3. Migrar conversations (una por lead)
    const leads = all(db, isBetter, 'SELECT * FROM leads');
    const conversationIdByLeadId = {};
    for (const lead of leads) {
      const customerId = customerIdByPhone[lead.customer_phone];
      run(db, isBetter, `
        INSERT INTO conversations (
          channel, customer_id, assigned_to_id, status, unread_count,
          last_message, last_message_at, etiqueta, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        'whatsapp', customerId, lead.assigned_to_id || null, lead.status || 'nuevo',
        lead.unread_count || 0, lead.last_message || '', lead.updated_at,
        lead.etiqueta || 'sin_clasificar', lead.created_at, lead.updated_at,
      ]);
      const conv = one(db, isBetter,
        'SELECT id FROM conversations WHERE customer_id = ? ORDER BY id DESC LIMIT 1',
        [customerId]);
      conversationIdByLeadId[lead.id] = conv.id;
      conversationsCount++;
    }

    // 4. Migrar timeline desde messages
    const messages = all(db, isBetter, 'SELECT * FROM messages');
    for (const m of messages) {
      const conversationId = conversationIdByLeadId[m.lead_id];
      if (!conversationId) continue;
      run(db, isBetter, `
        INSERT INTO timeline (
          conversation_id, event_type, channel, body, direction,
          from_number, to_number, media_type, media_id, media_mime, media_filename, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        conversationId, 'message', 'whatsapp', m.body, m.direction,
        m.from_number, m.to_number, m.media_type || null, m.media_id || null,
        m.media_mime || null, m.media_filename || null, m.timestamp,
      ]);
      timelineCount++;
    }

    exec(db, isBetter, 'COMMIT');
    saveIfNeeded(db, isBetter);

    console.log(`Migrados ${customersCount} customers, ${conversationsCount} conversations, ${timelineCount} timeline entries`);
  } catch (e) {
    exec(db, isBetter, 'ROLLBACK');
    console.error('Error en migración, ROLLBACK aplicado:', e.message);
    throw e;
  }
}

if (require.main === module) {
  migrate().catch(e => {
    console.error('Migración fallida:', e);
    process.exit(1);
  });
}

module.exports = { migrate };
