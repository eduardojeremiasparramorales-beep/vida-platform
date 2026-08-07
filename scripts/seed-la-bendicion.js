// Siembra el proyecto "La Bendición" (Tocaima, Cundinamarca) con la
// reconstrucción digital aproximada del plano físico: manzanas, filas de
// lotes y numeración siguiendo la distribución del plano original.
//
// Uso:
//   node scripts/seed-la-bendicion.js           → crea el proyecto si no existe
//   node scripts/seed-la-bendicion.js --force   → borra los lotes y re-siembra
//
// En la VM (Docker):
//   docker exec sp-crm node scripts/seed-la-bendicion.js
//
// Notas:
// - Los lotes se generan todos en estado "disponible"; los vendidos/separados
//   se marcan después desde el Centro de Control (un clic por lote).
// - El trazado es una base fiel al ESQUEMA del plano (franjas, manzanas,
//   lago, cúspide norte). Se afina visualmente con el calco: botón
//   "Subir plano" + regulador de opacidad + "Dibujar lote" para retocar.

const store = require('../src/db/store');
const adapter = require('../src/db/adapter');

// Lienzo del plano digital: 1200 (ancho) x 1600 (alto). Y crece hacia el norte.
// Coincide con la escala del calco cuando se sube la foto del plano (retrato).

// Genera una fila de lotes rectangulares a partir de un origen y un ángulo.
// x,y: esquina inicial · ang: grados (0 = este, 90 = norte)
// n: cantidad · w: frente del lote · d: fondo del lote
function fila({ x, y, ang, n, w, d, mz, area, precio = 0 }) {
  const rad = (ang * Math.PI) / 180;
  const ux = Math.cos(rad), uy = Math.sin(rad);     // dirección de la fila
  const px = -Math.sin(rad), py = Math.cos(rad);    // perpendicular (fondo)
  const lots = [];
  for (let i = 0; i < n; i++) {
    const ox = x + ux * i * w, oy = y + uy * i * w;
    lots.push({
      manzana: mz,
      area: typeof area === 'function' ? area(i) : area,
      precio,
      estado: 'disponible',
      dimensiones: '',
      poligono: [
        [ox, oy],
        [ox + ux * w, oy + uy * w],
        [ox + ux * w + px * d, oy + uy * w + py * d],
        [ox + px * d, oy + py * d],
      ].map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]),
    });
  }
  return lots;
}

// ── Distribución según el plano físico ──────────────────────────────────
// MZ A: cúspide norte — filas horizontales que se ensanchan hacia abajo
// MZ B: franja oriental doble junto a la escorrentía
// MZ C/D: filas bajas entre la zona verde y la portería (sur)
// MZ E: suroeste — lotes grandes irregulares
// MZ F/G: franja diagonal noroeste (doble + interior), lotes de 128 m²
// MZ H: bloques centro-oeste entre el lago y la franja
// MZ I: filas intermedias noroeste
const BLOQUES = [
  // MZ A — cúspide (lotes 1-133 aprox)
  ...[[1440, 470, 8], [1396, 445, 10], [1352, 425, 12], [1308, 408, 14],
     [1264, 392, 15], [1220, 378, 16], [1176, 368, 17], [1132, 358, 18]]
    .map(([y, x, n]) => ({ x, y, ang: -4, n, w: 24, d: 36, mz: 'A', area: 160 })),
  // filas al oriente de la casa/piscina
  { x: 650, y: 1088, ang: -4, n: 7, w: 24, d: 36, mz: 'A', area: 160 },
  { x: 650, y: 1044, ang: -4, n: 8, w: 24, d: 36, mz: 'A', area: 160 },
  { x: 650, y: 1000, ang: -4, n: 8, w: 24, d: 36, mz: 'A', area: 160 },

  // MZ B — franja oriental (doble fila)
  { x: 820, y: 1180, ang: -58, n: 17, w: 25, d: 34, mz: 'B', area: 160 },
  { x: 856, y: 1162, ang: -58, n: 17, w: 25, d: 34, mz: 'B', area: 160 },

  // MZ I — filas intermedias NO (entre franja F y cúspide)
  { x: 300, y: 1180, ang: 50, n: 20, w: 18, d: 28, mz: 'I', area: 128 },
  { x: 342, y: 1152, ang: 50, n: 20, w: 18, d: 28, mz: 'I', area: 128 },

  // MZ C — filas bajas (arcos al norte de la portería)
  { x: 430, y: 620, ang: 7, n: 20, w: 23, d: 36, mz: 'C', area: 160 },
  { x: 415, y: 576, ang: 7, n: 21, w: 23, d: 36, mz: 'C', area: 160 },
  { x: 400, y: 532, ang: 7, n: 22, w: 23, d: 36, mz: 'C', area: 160 },
  { x: 455, y: 488, ang: 7, n: 19, w: 23, d: 36, mz: 'C', area: 160 },
  { x: 470, y: 444, ang: 7, n: 18, w: 23, d: 36, mz: 'C', area: 160 },
  { x: 490, y: 400, ang: 7, n: 17, w: 23, d: 36, mz: 'C', area: 160 },
  { x: 510, y: 356, ang: 7, n: 15, w: 23, d: 36, mz: 'C', area: 160 },

  // MZ D — borde sur / portería
  { x: 520, y: 300, ang: 10, n: 14, w: 23, d: 36, mz: 'D', area: 160 },
  { x: 540, y: 256, ang: 10, n: 12, w: 23, d: 36, mz: 'D', area: 160 },

  // MZ E — suroeste, lotes grandes (área variable 300-850 m²)
  { x: 150, y: 560, ang: 30, n: 9, w: 40, d: 52, mz: 'E', area: i => 300 + (i % 8) * 70 },
  { x: 185, y: 480, ang: 30, n: 9, w: 40, d: 52, mz: 'E', area: i => 320 + (i % 7) * 75 },
  { x: 220, y: 400, ang: 30, n: 8, w: 40, d: 52, mz: 'E', area: i => 350 + (i % 6) * 80 },
  { x: 255, y: 320, ang: 30, n: 7, w: 40, d: 52, mz: 'E', area: i => 400 + (i % 5) * 90 },

  // MZ F — franja diagonal NO (doble fila, 128 m²)
  { x: 120, y: 740, ang: 50, n: 52, w: 17, d: 28, mz: 'F', area: 128 },
  { x: 144, y: 722, ang: 50, n: 52, w: 17, d: 28, mz: 'F', area: 128 },

  // MZ G — franja interior paralela
  { x: 186, y: 700, ang: 50, n: 40, w: 17, d: 28, mz: 'G', area: 128 },

  // MZ H — bloques centro-oeste entre lago y franja
  { x: 300, y: 760, ang: 20, n: 10, w: 26, d: 38, mz: 'H', area: 200 },
  { x: 330, y: 700, ang: 20, n: 10, w: 26, d: 38, mz: 'H', area: 200 },
];

async function main() {
  const force = process.argv.includes('--force');
  await store.initDB();

  // Buscar o crear el proyecto
  let proyecto = store.getProyectos().find(p => p.nombre === 'La Bendición');
  if (!proyecto) {
    proyecto = store.createProyecto({
      nombre: 'La Bendición',
      ciudad: 'Tocaima',
      departamento: 'Cundinamarca',
      estado: 'en_venta',
      descripcion: 'Proyecto campestre · 23 ha + 6508 m² · Lote 1 MAT 307-100850 / Lote 2 MAT 307-100851 · Vía a Jerusalén',
      fecha_inicio: '',
      plano_bounds: JSON.stringify([[0, 0], [1600, 1200]]),
    });
    console.log(`✅ Proyecto creado: "${proyecto.nombre}" (id ${proyecto.id})`);
  } else {
    console.log(`ℹ️  Proyecto ya existe: "${proyecto.nombre}" (id ${proyecto.id})`);
  }

  const existentes = store.getLotesByProyecto(proyecto.id);
  if (existentes.length && !force) {
    console.log(`⚠️  El proyecto ya tiene ${existentes.length} lotes. Usa --force para borrarlos y re-sembrar.`);
    adapter.saveDBIfNeeded();
    return;
  }
  if (existentes.length && force) {
    existentes.forEach(l => store.deleteLote(l.id));
    console.log(`🧹 ${existentes.length} lotes anteriores eliminados (--force).`);
  }

  // Generar todos los lotes con numeración continua (como en el plano)
  let numero = 1;
  const lotes = [];
  for (const b of BLOQUES) {
    for (const lote of fila(b)) {
      lote.numero = String(numero++);
      lotes.push(lote);
    }
  }

  const n = store.bulkCreateLotes(proyecto.id, lotes);
  console.log(`✅ ${n} lotes sembrados en "${proyecto.nombre}" (manzanas A-I, numeración 1-${n}).`);
  console.log('');
  console.log('Siguientes pasos en el Centro de Control (/os/proyecto.html?id=' + proyecto.id + '):');
  console.log('  1. "Subir plano" → carga la foto del plano como calco (opacidad regulable).');
  console.log('  2. Marca los vendidos/separados: clic en el lote → acción rápida.');
  console.log('  3. Ajusta precios por lote o retoca polígonos con "Dibujar lote".');

  adapter.saveDBIfNeeded(); // flush inmediato (necesario con sql.js)
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
