// Generate PWA PNG icons from SVG source
// Usage: node scripts/generate-icons.js
// Requires: npm install sharp

const fs = require('fs');
const path = require('path');

async function generate() {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    console.log('Installing sharp...');
    require('child_process').execSync('npm install sharp --no-save', { stdio: 'inherit' });
    sharp = require('sharp');
  }

  const publicDir = path.join(__dirname, '..', 'public', 'icons');
  const svgPath = path.join(publicDir, 'icon-192.svg');
  const svg = fs.readFileSync(svgPath);

  // Generate 192x192 PNG
  await sharp(svg).resize(192, 192).png().toFile(path.join(publicDir, 'icon-192.png'));
  console.log('✓ icon-192.png');

  // Generate 512x512 PNG
  await sharp(svg).resize(512, 512).png().toFile(path.join(publicDir, 'icon-512.png'));
  console.log('✓ icon-512.png');

  // Generate favicon
  await sharp(svg).resize(32, 32).png().toFile(path.join(publicDir, '..', 'favicon.png'));
  console.log('✓ favicon.png');

  console.log('All icons generated!');
}

generate().catch(console.error);
