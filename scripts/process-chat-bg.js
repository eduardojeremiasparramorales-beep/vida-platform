const sharp = require('sharp');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'public/images/Fondo mensaje.png');
const OUT_DIR = path.resolve(__dirname, '..', 'public/images');

async function main() {
  const meta = await sharp(SRC).metadata();
  const w = meta.width, h = meta.height;
  console.log(`Original: ${w}x${h}`);

  const size = Math.min(w, 700);
  
  // Option A: Top — iconos superiores
  await sharp(SRC)
    .extract({ left: Math.floor((w - size) / 2), top: 0, width: size, height: size })
    .resize(500, 500)
    .jpeg({ quality: 82 })
    .toFile(path.join(OUT_DIR, 'chat-bg-top.jpg'));
  console.log('chat-bg-top.jpg ✓');

  // Option B: Bottom — iconos inferiores (evita logo central)
  await sharp(SRC)
    .extract({ left: Math.floor((w - size) / 2), top: h - size, width: size, height: size })
    .resize(500, 500)
    .jpeg({ quality: 82 })
    .toFile(path.join(OUT_DIR, 'chat-bg-bottom.jpg'));
  console.log('chat-bg-bottom.jpg ✓');

  // Option C: Middle-upper (justo encima del logo)
  await sharp(SRC)
    .extract({ left: Math.floor((w - size) / 2), top: Math.floor(h * 0.28), width: size, height: size })
    .resize(500, 500)
    .jpeg({ quality: 82 })
    .toFile(path.join(OUT_DIR, 'chat-bg-mid.jpg'));
  console.log('chat-bg-mid.jpg ✓');
}

main().catch(e => { console.error(e); process.exit(1); });
