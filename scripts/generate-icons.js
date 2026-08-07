const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'SP_LEONS_GROUP', 'BRAND', 'icono.png');
const OUT_PUBLIC = path.join(__dirname, '..', 'public', 'icons');
const OUT_MOBILE = path.join(__dirname, '..', 'mobile-app', 'resources');

async function generate() {
  if (!fs.existsSync(SRC)) {
    console.error('❌ No existe:', SRC);
    process.exit(1);
  }

  const img = sharp(SRC);
  const meta = await img.metadata();
  console.log(`📐 Origen: ${meta.width}x${meta.height} ${meta.format}`);

  // 1. PWA icons (public/icons)
  await img.clone().resize(192, 192, { fit: 'cover' }).png().toFile(path.join(OUT_PUBLIC, 'icon-192.png'));
  console.log('✅ icon-192.png');

  await img.clone().resize(512, 512, { fit: 'cover' }).png().toFile(path.join(OUT_PUBLIC, 'icon-512.png'));
  console.log('✅ icon-512.png');

  // maskable: 512x512 con safe zone 40% (padding 60px cada lado)
  await img.clone()
    .resize(392, 392, { fit: 'inside' })
    .extend({ top: 60, bottom: 60, left: 60, right: 60, background: { r: 10, g: 10, b: 10, alpha: 1 } })
    .png()
    .toFile(path.join(OUT_PUBLIC, 'icon-maskable-512.png'));
  console.log('✅ icon-maskable-512.png');

  // logo.png (favicon fallback)
  await img.clone().resize(192, 192, { fit: 'cover' }).png().toFile(path.join(OUT_PUBLIC, 'logo.png'));
  console.log('✅ logo.png');

  // favicon.ico (16, 32, 48)
  await img.clone().resize(48, 48, { fit: 'cover' }).toFile(path.join(OUT_PUBLIC, 'favicon.ico'));
  console.log('✅ favicon.ico');

  // 2. Mobile app resources (Capacitor)
  // icon.png: 1024x1024 (app store)
  await img.clone().resize(1024, 1024, { fit: 'cover' }).png().toFile(path.join(OUT_MOBILE, 'icon.png'));
  console.log('✅ mobile-app/resources/icon.png (1024x1024)');

  // icon-foreground.png: 432x432 con padding para adaptive icon
  await img.clone()
    .resize(350, 350, { fit: 'inside' })
    .extend({ top: 41, bottom: 41, left: 41, right: 41, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(OUT_MOBILE, 'icon-foreground.png'));
  console.log('✅ mobile-app/resources/icon-foreground.png (432x432)');

  // splash screen: 1242x2688 (iPhone X/XS/11 Pro portrait) - centrado
  await img.clone()
    .resize(800, 800, { fit: 'inside' })
    .extend({ top: 944, bottom: 944, left: 221, right: 221, background: { r: 10, g: 10, b: 10, alpha: 1 } })
    .jpeg({ quality: 90 })
    .toFile(path.join(OUT_MOBILE, 'logo-sp-leons-v2.jpg'));
  console.log('✅ mobile-app/resources/logo-sp-leons-v2.jpg (1242x2688)');

  console.log('\n🎉 Todos los iconos generados.');
}

generate().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});