const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const store = require('../db/store');

function detectPython() {
  if (process.env.PYTHON_PATH && fs.existsSync(process.env.PYTHON_PATH)) return process.env.PYTHON_PATH;
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.LOCALAPPDATA || '', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'python.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Python', 'bin', 'python.exe'),
        'python.exe',
      ]
    : ['/usr/bin/python3', '/usr/bin/python', 'python3'];
  for (const c of candidates) {
    try { if (c.includes('/') || c.includes('\\')) { if (fs.existsSync(c)) return c; } else { execSync('which ' + c, { stdio: 'ignore' }); return c; } } catch (e) {}
  }
  return process.platform === 'win32' ? 'python.exe' : 'python3';
}

const PYTHON = detectPython();

// Chequeo al arranque del server (no perezoso): si Python no está disponible en el
// contenedor, `docker logs` lo dice de inmediato en vez de esperar a que un admin genere
// una campaña y reciba un error de spawn poco claro. Mismo patrón que isFfmpegAvailable()
// de audio.js — spawnSync corto y cacheado, solo que este corre una vez al cargar el módulo.
let _pythonOk = false;
try {
  const r = spawnSync(PYTHON, ['--version'], { timeout: 5000 });
  _pythonOk = r.status === 0 && !r.error;
} catch (e) { _pythonOk = false; }
if (!_pythonOk) {
  console.warn(`[CAMPANAS-SP] Python no disponible ("${PYTHON}") — el generador de creativos fallará hasta corregirlo. Revisar Dockerfile (python3/py3-pillow) o PYTHON_PATH.`);
}

function detectRoot() {
  // Linux (VM): /home/ubuntu/sp-crm/app
  const linuxDefault = '/home/ubuntu/sp-crm/app';
  if (process.platform !== 'win32' && fs.existsSync(linuxDefault)) return linuxDefault;
  // Windows: raíz del propio repo (src/services/../.. = raíz), no una carpeta hermana
  // adivinada por nombre. Los checks viejos a "C:\Sp Leons"/"C:\Sp Inmobiliaria" quedaron
  // de antes de que el proyecto se organizara dentro de sp-leons-crm/ — "C:\Sp Inmobiliaria"
  // sigue existiendo como carpeta padre y hacía matchear una copia vieja de CAMPAÑAS_SP
  // ahí en vez del repo real, silenciosamente sirviendo generadores desactualizados.
  return path.resolve(__dirname, '..', '..');
}

function getCampanasSpDir() {
  return path.join(detectRoot(), 'CAMPAÑAS_SP');
}

function getRunApiPath() {
  return path.join(getCampanasSpDir(), 'run_api.py');
}

// Prompts de fondo por sección — enfoque de venta de lotes/tierra en Colombia.
// Se usan para generate_background() (Gemini), con la foto real del cliente como referencia
// de estilo (nunca se inventa un lugar de la nada).
const BACKGROUND_PROMPTS = {
  portada: 'Fotografía aérea cinematográfica de un lote de tierra rural colombiano al atardecer, luz dorada cálida, composición amplia y épica, estilo editorial premium de bienes raíces de lujo.',
  destacado: 'Fotografía de un terreno destacado con vegetación verde exuberante, cielo despejado, ángulo que transmite amplitud y oportunidad de inversión.',
  inversionistas: 'Fotografía de terreno rural colombiano de gran extensión, luz natural cálida, composición que transmite solidez y potencial de valorización.',
  familias: 'Fotografía cálida y acogedora de un entorno natural rural al atardecer, colores cálidos, sensación de hogar futuro y tranquilidad.',
  confianza: 'Fotografía profesional de terreno con vías de acceso visibles y entorno cuidado, transmite seriedad, avance de obra y confiabilidad.',
  precio: 'Fotografía atractiva y limpia de un lote de tierra, buena luz natural, colores tierra y verdes, composición que resalta valor.',
  escasez: 'Fotografía dramática de terreno con luz intensa de atardecer, pocos elementos, foco en el paisaje, sensación de exclusividad.',
  ubicacion: 'Fotografía de contexto geográfico y paisaje de la región, vías de acceso, entorno natural circundante, luz de día clara.',
  beneficios: 'Fotografía de entorno natural con vegetación abundante, transmite amenidades y calidad de vida alrededor del proyecto.',
};
const IMAGE_KEYS = ['portada', 'destacado', 'inversionistas', 'familias', 'confianza', 'precio', 'escasez', 'ubicacion', 'beneficios'];
const AI_BG_SIZE = { width: 1080, height: 1080 }; // base cuadrada: segura para recortar a 4:5/16:9/9:16 después

function isAIEnabled() {
  return !!(process.env.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY.trim());
}

function generateBackground(prompt, outputPath, refImagePath, width, height) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, [getAiGeneratorPath()], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString('utf-8'); });
    proc.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr.slice(0, 400) || `exit ${code}`));
      try {
        const r = JSON.parse(stdout.trim());
        if (r.ok) { try { store.bumpUsage('generaciones_ia'); } catch (e) {} resolve(r.path); } else reject(new Error(r.error || 'sin datos de imagen'));
      } catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
    });
    proc.on('error', reject);
    proc.stdin.write(JSON.stringify({
      action: 'generate_background', prompt, output_path: outputPath,
      width, height, ref_image: refImagePath,
    }));
    proc.stdin.end();
  });
}

// Construye {key: rutaAbsoluta} para el pipeline de Pillow: primero categoriza las fotos
// por contenido con Gemini (analyzeImages, ya existente) en vez de confiar en el orden
// alfabético; luego intenta generar un fondo premium por sección con generate_background.
// Nunca revienta la generación: cualquier fallo de IA cae en la foto real del cliente,
// y si Gemini no está configurado, devuelve {} (Python usa su asignación alfabética original).
async function buildImageAssignments(imagesDir, outputDir) {
  if (!isAIEnabled() || !imagesDir || !fs.existsSync(imagesDir)) return {};
  const files = fs.readdirSync(imagesDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  if (!files.length) return {};

  const rawByKey = {};
  try {
    const fullPaths = files.map((f) => path.join(imagesDir, f));
    const analysis = await analyzeImages(fullPaths);
    const cat = (analysis && analysis.categorias) || {};
    const used = new Set();
    for (const k of IMAGE_KEYS) {
      const arr = cat[k] || (k === 'beneficios' ? cat.amenidades : null);
      const filename = Array.isArray(arr) ? arr[0] : null;
      if (filename && files.includes(filename)) {
        rawByKey[k] = path.join(imagesDir, filename);
        used.add(filename);
      }
    }
    // Fotos que Gemini no categorizó en ninguna sección: repartirlas entre los keys vacíos
    // (mejor que dejarlos sin foto, y evita repetir una foto ya usada en otra sección).
    const leftovers = files.filter((f) => !used.has(f));
    let li = 0;
    for (const k of IMAGE_KEYS) {
      if (!rawByKey[k] && leftovers[li]) { rawByKey[k] = path.join(imagesDir, leftovers[li]); li++; }
    }
  } catch (e) {
    console.error('[CAMPANAS-SP] analyzeImages falló, se usará asignación alfabética:', e.message);
    return {};
  }
  if (!Object.keys(rawByKey).length) return {};

  const aiDir = path.join(outputDir, '.ai');
  fs.mkdirSync(aiDir, { recursive: true });
  const finalByKey = {};
  for (const k of Object.keys(rawByKey)) {
    const outPath = path.join(aiDir, `${k}.png`);
    if (fs.existsSync(outPath)) { finalByKey[k] = outPath; continue; } // cache: no regenerar si ya existe
    try {
      await generateBackground(BACKGROUND_PROMPTS[k] || BACKGROUND_PROMPTS.portada, outPath, rawByKey[k], AI_BG_SIZE.width, AI_BG_SIZE.height);
      finalByKey[k] = fs.existsSync(outPath) ? outPath : rawByKey[k];
    } catch (e) {
      console.error(`[CAMPANAS-SP] fondo IA falló para "${k}", se usa la foto original:`, e.message);
      finalByKey[k] = rawByKey[k];
    }
  }
  return finalByKey;
}

async function generateAssets(projectId) {
  const project = store.getCampanasSpProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  store.updateCampanasSpProject(projectId, { status: 'generating' });

  // Recalcula desde el slug en vez de confiar ciegamente en las rutas guardadas en BD: tras
  // un redeploy en Docker, cualquier fila vieja con images_dir apuntando a CAMPAÑAS_SP/projects
  // (código, no persistido) quedaría huérfana. Si la ruta guardada todavía existe y tiene
  // fotos de verdad (típico en desarrollo local), se respeta.
  const computedImagesDir = path.join(getProjectDir(project.slug), 'images');
  const imagesDir = (project.images_dir && project.images_dir !== computedImagesDir
      && fs.existsSync(project.images_dir)
      && fs.readdirSync(project.images_dir).some((f) => /\.(png|jpe?g|webp)$/i.test(f)))
    ? project.images_dir
    : computedImagesDir;

  const computedOutputDir = path.join(getProjectDir(project.slug), 'generated');
  const outputDir = (project.output_dir && fs.existsSync(project.output_dir)) ? project.output_dir : computedOutputDir;
  fs.mkdirSync(outputDir, { recursive: true });

  let imageAssignments = {};
  try {
    imageAssignments = await buildImageAssignments(imagesDir, outputDir);
  } catch (e) {
    console.error('[CAMPANAS-SP] buildImageAssignments falló, se usa asignación alfabética:', e.message);
  }

  const input = {
    project: {
      name: project.name,
      location: project.location,
      description: project.description,
      price: project.price,
      price_currency: project.price_currency,
      area: project.area,
      features: safeParse(project.features),
      highlights: safeParse(project.highlights),
      whatsapp: project.whatsapp,
      cta: project.cta,
    },
    images_dir: imagesDir,
    output_dir: outputDir,
    template: project.template || 'premium',
    image_assignments: imageAssignments,
  };

  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, [getRunApiPath()], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString('utf-8'); });
    proc.stderr.on('data', (data) => { stderr += data.toString('utf-8'); });

    proc.on('close', async (code) => {
      if (code !== 0) {
        // run_api.py, en sus validaciones tempranas (images_dir/output_dir faltante, JSON
        // inválido), imprime un JSON claro por STDOUT antes de salir con código != 0 — no
        // es un traceback por stderr. Priorizar ese mensaje evita errores mudos como
        // "Python exit code 1: " sin nada más cuando stderr viene vacío.
        let pyError = null;
        try {
          const parsed = JSON.parse(stdout.trim());
          if (parsed && parsed.error) pyError = parsed.error;
        } catch (e) { /* stdout no era JSON — nos quedamos con stderr */ }
        const errMsg = pyError
          ? `Python: ${pyError}`
          : `Python exit code ${code}: ${stderr.slice(0, 500) || '(sin salida de error — revisar docker logs)'}`;
        store.updateCampanasSpProject(projectId, { status: 'error', error: errMsg });
        return reject(new Error(errMsg));
      }
      let result;
      try {
        result = JSON.parse(stdout.trim());
      } catch (e) {
        const errMsg = `JSON parse error: ${e.message}. Output: ${stdout.slice(0, 500)}`;
        store.updateCampanasSpProject(projectId, { status: 'error', error: errMsg });
        return reject(new Error(errMsg));
      }

      // Reel en video real (Fase 3): corre DESPUÉS de que los 27 assets ya están
      // guardados — si ffmpeg falla, los estáticos quedan intactos, solo se anota el
      // motivo (mismo espíritu tolerante-a-fallos que el resto de run_api.py).
      const frames = (result.assets && result.assets.reel_frames) || [];
      if (frames.length === 5) {
        try {
          const reelDir = path.join(outputDir, 'reel');
          result.reel_video = await assembleReelVideo(reelDir, frames);
        } catch (e) {
          console.error('[CAMPANAS-SP] Ensamblado de reel falló, quedan los 5 frames estáticos:', e.message);
          result.reel_video_error = e.message.slice(0, 300);
        }
      }

      store.updateCampanasSpProject(projectId, {
        status: result.ok ? 'ready' : 'error',
        assets_result: JSON.stringify(result),
        error: result.errors ? result.errors.join('; ') : '',
        output_dir: outputDir,
      });
      resolve(result);
    });

    proc.on('error', (err) => {
      store.updateCampanasSpProject(projectId, { status: 'error', error: err.message });
      reject(err);
    });

    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
  });
}

// Ensambla los 5 frames estáticos del reel en un .mp4 real con crossfade — Fase 3.
// Mismo patrón spawn que audio.js (stderr acotado a 8KB, timeout de seguridad).
// Offsets del xfade encadenado: cada frame dura 5s en pantalla (incluido el propio
// crossfade de 0.3s hacia el siguiente), así que el offset del xfade i-ésimo es
// i*(5-0.3)=i*4.7 medido sobre la salida acumulada de los xfade anteriores — es
// exactamente el patrón que ya trae REEL_GUION.md (offsets 4.7/9.4/14.1/18.8, ~24-25s).
function assembleReelVideo(reelDir, frameFiles) {
  return new Promise((resolve, reject) => {
    const outPath = path.join(reelDir, 'reel.mp4');
    const DUR = 5, XFADE = 0.3;
    const inputArgs = [];
    frameFiles.forEach((f) => { inputArgs.push('-loop', '1', '-t', String(DUR), '-r', '30', '-i', path.join(reelDir, f)); });

    const filters = [];
    let prev = '0:v';
    for (let i = 1; i < frameFiles.length; i++) {
      const offset = (i * (DUR - XFADE)).toFixed(1);
      const out = i === frameFiles.length - 1 ? 'vout' : `v${i}`;
      filters.push(`[${prev}][${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${offset}[${out}]`);
      prev = out;
    }

    const args = [
      '-y', ...inputArgs,
      '-filter_complex', filters.join(';'),
      '-map', '[vout]',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart',
      outPath,
    ];
    const p = spawn('ffmpeg', args);
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += d; if (stderr.length > 8192) stderr = stderr.slice(-8192); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 0) resolve('reel/reel.mp4');
      else reject(new Error('ffmpeg salió con código ' + code + ': ' + stderr.slice(-500)));
    });
    // 25s de video a 1080x1920 en la e2-micro puede tardar ~20-60s (ver plan) — 120s de margen.
    setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} }, 120000).unref();
  });
}

function safeParse(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try { return JSON.parse(val); }
  catch (e) { return []; }
}

// Los proyectos viven bajo data/ (volumen persistido en Docker: solo ./data:/app/data
// sobrevive un redeploy) — NUNCA bajo CAMPAÑAS_SP/, que es código que viaja con la imagen
// y se pisa en cada `docker compose up -d --build`. Antes las fotos subidas y los assets
// generados se perdían en cada deploy sin que nadie lo notara hasta la siguiente campaña.
function getProjectDir(slug) {
  return path.join(detectRoot(), 'data', 'campanas-projects', slug);
}

function scanProjectImages(slug) {
  const dir = path.join(getProjectDir(slug), 'images');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));
}

function getAssetsBaseUrl(project) {
  const assets = safeParse(project.assets_result || '{}');
  return assets;
}

function getAiGeneratorPath() {
  return path.join(getCampanasSpDir(), 'generators', 'ai_generator.py');
}

async function analyzeImages(imagePaths) {
  if (!imagePaths || !imagePaths.length) throw new Error('No hay imágenes para analizar');
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, [getAiGeneratorPath()], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (data) => { stdout += data.toString('utf-8'); });
    proc.stderr.on('data', (data) => { stderr += data.toString('utf-8'); });
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr.slice(0, 500)));
      try { resolve(JSON.parse(stdout.trim())); }
      catch (e) { reject(new Error(`JSON parse: ${e.message}. Output: ${stdout.slice(0, 300)}`)); }
    });
    proc.on('error', reject);
    proc.stdin.write(JSON.stringify({ action: 'analyze', images: imagePaths }));
    proc.stdin.end();
  });
}

// Auto-completa el formulario de Campañas SP con datos REALES del proyecto/lotes del CRM
// (nunca inventa nada — si un dato no existe en la BD, se deja vacío para que el admin lo
// complete a mano). Es solo lectura: la copia de fotos ocurre al crear el proyecto (POST).
function autoFillFromCRM(proyectoId) {
  const p = store.getProyectoById ? store.getProyectoById(Number(proyectoId)) : null;
  if (!p) return { price: '', area: '', features: [], highlights: [], disponibles: 0 };

  const lotes = (store.getLotesByProyecto ? store.getLotesByProyecto(Number(proyectoId)) : []) || [];
  const disponibles = lotes.filter((l) => l.estado === 'disponible');
  const precios = disponibles.map((l) => Number(l.precio)).filter((n) => n > 0);
  const priceMin = precios.length ? Math.min(...precios) : null;

  // Área "típica": la moda de los lotes disponibles, no un promedio que podría no
  // corresponder a ningún lote real (ej. dos lotes de 400m2 y uno de 900m2 → 400, no 566).
  const areaCounts = {};
  disponibles.forEach((l) => { if (l.area) areaCounts[l.area] = (areaCounts[l.area] || 0) + 1; });
  const areaKeys = Object.keys(areaCounts);
  const areaModa = areaKeys.length ? areaKeys.sort((a, b) => areaCounts[b] - areaCounts[a])[0] : null;

  const highlights = [];
  if (disponibles.length > 0 && disponibles.length <= 15) {
    highlights.push(`Solo ${disponibles.length} lote${disponibles.length > 1 ? 's' : ''} disponible${disponibles.length > 1 ? 's' : ''}`);
  }

  return {
    proyecto_id: p.id,
    name: p.nombre || '',
    location: [p.ciudad, p.departamento].filter(Boolean).join(', '),
    description: p.descripcion || '',
    price: priceMin ? 'Desde $' + Math.round(priceMin).toLocaleString('es-CO') : '',
    area: areaModa ? `${areaModa}m²` : '',
    features: [],
    highlights,
    disponibles: disponibles.length,
  };
}

// Resuelve una URL/entrada interna de foto (imagen_url de proyectos, item de
// lotes.fotografias) a una ruta real en disco. Nunca lanza: devuelve null ante
// cualquier formato desconocido, foto externa (http) o archivo inexistente —
// una foto que no se puede resolver simplemente se omite, no rompe la importación.
function resolveCrmPhotoPath(entry) {
  try {
    const mediaStore = require('./media');
    const str = typeof entry === 'string' ? entry : (entry && (entry.url || entry.filename)) || '';
    if (!str || /^https?:\/\//i.test(str)) return null;
    const filename = path.basename(str.split('?')[0]);
    const fp = mediaStore.getMediaPath(filename);
    return fs.existsSync(fp) ? fp : null;
  } catch (e) { return null; }
}

// Copia (nunca mueve) las fotos reales de un proyecto/lotes del CRM hacia la carpeta de
// imágenes del proyecto publicitario — para no tener que resubirlas a mano. Devuelve
// cuántas se copiaron; cualquier foto individual que falle se omite sin abortar el resto.
function copyRealProjectPhotos(proyectoId, destDir) {
  if (!store.getProyectoById) return 0;
  const proyecto = store.getProyectoById(Number(proyectoId));
  if (!proyecto) return 0;
  fs.mkdirSync(destDir, { recursive: true });

  const sources = [];
  if (proyecto.imagen_url) sources.push(proyecto.imagen_url);
  const lotes = (store.getLotesByProyecto ? store.getLotesByProyecto(Number(proyectoId)) : []) || [];
  for (const lote of lotes) {
    let fotos = [];
    try { fotos = JSON.parse(lote.fotografias || '[]'); } catch (e) { fotos = []; }
    for (const f of fotos) sources.push(f);
  }

  let copied = 0;
  for (const src of sources) {
    const fp = resolveCrmPhotoPath(src);
    if (!fp) continue;
    try {
      const destName = `crm_${copied}_${path.basename(fp)}`;
      fs.copyFileSync(fp, path.join(destDir, destName));
      copied++;
    } catch (e) { console.error('[CAMPANAS-SP] copiar foto del CRM falló:', e.message); }
  }
  return copied;
}

module.exports = {
  generateAssets,
  getProjectDir,
  scanProjectImages,
  getAssetsBaseUrl,
  detectRoot,
  getCampanasSpDir,
  analyzeImages,
  autoFillFromCRM,
  copyRealProjectPhotos,
  pythonAvailable: () => _pythonOk,
  aiEnabled: isAIEnabled,
};
