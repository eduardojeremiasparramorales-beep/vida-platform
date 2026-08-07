// Script de limpieza: elimina vendedor por teléfono + borra todos los leads
// Uso: node scripts/limpiar.js
require('dotenv').config();
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'sp-leads.db');

async function main() {
  if (!fs.existsSync(DB_PATH)) { console.error('No se encontró la base de datos en:', DB_PATH); process.exit(1); }

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(DB_PATH));

  // 1. Eliminar el vendedor con teléfono mal puesto
  const TELEFONO_MAL = '3214315618';
  db.run(`DELETE FROM vendedores WHERE telefono = '${TELEFONO_MAL}'`);
  db.run(`DELETE FROM usuarios WHERE vendedor_id IN (SELECT id FROM vendedores WHERE telefono = '${TELEFONO_MAL}')`);
  console.log(`✅ Vendedor ${TELEFONO_MAL} eliminado`);

  // 2. Borrar todos los leads y mensajes
  db.run(`DELETE FROM leads`);
  db.run(`DELETE FROM messages`);
  db.run(`DELETE FROM sessions WHERE rol = 'vendedor'`); // limpiar sesiones de vendedores
  console.log('✅ Todos los leads y mensajes eliminados');

  // 3. Resetear contador de leads en vendedores
  db.run(`UPDATE vendedores SET total_leads = 0`);
  console.log('✅ Contadores de vendedores reseteados');

  // 4. Guardar
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  console.log('✅ Base de datos guardada');

  // Mostrar estado final
  const vs = db.exec('SELECT nombre, telefono, estado FROM vendedores');
  console.log('\n📋 Vendedores activos:');
  if (vs.length && vs[0].values.length) {
    vs[0].values.forEach(([n, t, e]) => console.log(`  - ${n} | ${t} | ${e}`));
  } else {
    console.log('  (ninguno)');
  }

  db.close();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
