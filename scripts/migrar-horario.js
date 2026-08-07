const path = require("path");
const fs = require("fs");

// ──────────────────────────────────────────────
// Tablas y columnas a SALTAR (NO migrar)
// ──────────────────────────────────────────────

// Columnas INTEGER (epoch millis) → NO tocar
const SKIP_INTEGER = new Set([
  "sessions.created_at",
  "notifications.created_at",
]);

// Columnas TEXT con date('now') (solo fecha, sin hora) → NO tocar
const SKIP_DATE_ONLY = new Set([
  "proyectos.fecha_inicio",
  "lotes.fecha_separacion",
  "lotes.fecha_venta",
  "tareas.fecha_vencimiento",
  "tareas.vence_at",
]);

// ══════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════

async function main() {
  const DB_PATH = path.join(__dirname, "..", "data", "sp-leads.db");
  if (!fs.existsSync(DB_PATH)) {
    console.error("[ERROR] Base de datos no encontrada: " + DB_PATH);
    process.exit(1);
  }

  // Intentar better-sqlite3 primero; caer a sql.js si no está compilado
  let db, isBetter;
  try {
    const Database = require("better-sqlite3");
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    isBetter = true;
    console.log("Usando better-sqlite3 (nativo)");
  } catch (e) {
    try {
      const initSqlJs = require("sql.js");
      const SQL = await initSqlJs();
      const buf = fs.readFileSync(DB_PATH);
      db = new SQL.Database(buf);
      isBetter = false;
      console.log("Usando sql.js (fallback WASM)");
    } catch (e2) {
      console.error("No se pudo abrir la base de datos:", e2.message);
      process.exit(1);
    }
  }

  // ── helpers ──────────────────────────────────
  function all(sql) {
    if (isBetter) return db.prepare(sql).all();
    const stmt = db.prepare(sql);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  function run(sql) {
    if (isBetter) return db.prepare(sql).run();
    db.run(sql);
    return { changes: db.getRowsModified() };
  }

  // ── guard de idempotencia (config table) ─────
  function getConfig(key) {
    try {
      const rows = all("SELECT value FROM config WHERE key = '" + key + "'");
      return rows.length > 0 ? rows[0].value : null;
    } catch (e) {
      return null;
    }
  }

  function setConfig(key, value) {
    run("INSERT OR REPLACE INTO config (key, value) VALUES ('" + key + "', '" + value + "')");
  }

  const migrationKey = "migracion_horario_utc5";
  const alreadyRun = getConfig(migrationKey);
  if (alreadyRun) {
    console.log("Migracion ya ejecutada el " + alreadyRun + ". Saliendo (idempotente).");
    if (isBetter) db.close();
    else db.close();
    process.exit(0);
  }

  // ── descubrir tablas ─────────────────────────
  const tables = all(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).map((r) => r.name);

  // ── descubrir columnas DATETIME por tabla ────
  // Para cada tabla, obtenemos las columnas cuyo tipo contiene 'DATETIME' o 'TIMESTAMP'
  const candidates = [];

  for (const tbl of tables) {
    const cols = all("PRAGMA table_info('" + tbl + "')");
    for (const col of cols) {
      const colType = (col.type || "").toUpperCase();
      if (!colType.includes("DATETIME") && !colType.includes("TIMESTAMP")) continue;

      const key = tbl + "." + col.name;

      // Saltar INTEGER (epoch)
      if (SKIP_INTEGER.has(key)) {
        console.log("  [SKIP INTEGER] " + key);
        continue;
      }

      // Saltar TEXT date-only
      if (SKIP_DATE_ONLY.has(key)) {
        console.log("  [SKIP DATE-ONLY] " + key);
        continue;
      }

      candidates.push({ table: tbl, column: col.name, key });
    }
  }

  if (candidates.length === 0) {
    console.log("\nNo se encontraron columnas DATETIME elegibles.");
    console.log("Migracion completada. 0 tablas actualizadas, 0 filas modificadas.");
    cleanup();
    return;
  }

  console.log(
    "\n" +
      candidates.length +
      " columna(s) DATETIME elegible(s) en " +
      [...new Set(candidates.map((c) => c.table))].length +
      " tabla(s):\n"
  );

  let totalTables = 0;
  let totalRows = 0;

  for (const { table, column, key } of candidates) {
    const sql =
      "UPDATE \"" +
      table +
      "\" SET \"" +
      column +
      "\" = datetime(\"" +
      column +
      "\", '+5 hours') WHERE \"" +
      column +
      "\" IS NOT NULL AND \"" +
      column +
      "\" != ''";

    try {
      const result = run(sql);
      if (result.changes > 0) {
        console.log(key + ": " + result.changes + " filas actualizadas");
        totalRows += result.changes;
        totalTables++;
      } else {
        console.log(key + ": 0 filas (sin cambios)");
      }
    } catch (err) {
      console.error(key + ": ERROR — " + err.message);
    }
  }

  // ── finalizar ─────────────────────────────────
  // Marcar como ejecutada (idempotencia)
  setConfig(migrationKey, new Date().toISOString().replace("T", " ").substring(0, 19));

  if (isBetter) {
    db.close();
  } else {
    // sql.js: escribir a disco
    const data = db.export();
    const buffer = data ? Buffer.from(data) : Buffer.alloc(0);
    fs.writeFileSync(DB_PATH, buffer);
    db.close();
  }

  console.log(
    "\nMigracion completada. " +
      totalTables +
      " tabla(s) actualizada(s), " +
      totalRows +
      " filas modificadas."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});