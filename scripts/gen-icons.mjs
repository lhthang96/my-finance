// Rasterises the app icon into PNGs (run once, commit the output):  node scripts/gen-icons.mjs
// Writes src/web/public/icon-192.png, icon-512.png and icon-maskable-512.png.
// The maskable variant is a full-bleed square with the ring inside the 80% safe zone.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/web/public');
const iconSvg = fs.readFileSync(path.join(OUT, 'icon.svg'), 'utf8');

// Maskable: no rounded corners (the OS masks them), ring scaled to fit the safe zone.
const maskableSvg = iconSvg
  .replace('<rect width="512" height="512" rx="116" fill="#0B0F17"/>', '<rect width="512" height="512" fill="#0B0F17"/>')
  .replace('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">\n  <g transform="translate(256 256) scale(0.78) translate(-256 -256)">')
  .replace('</svg>', '  </g>\n</svg>');

await sharp(Buffer.from(iconSvg)).resize(192, 192).png().toFile(path.join(OUT, 'icon-192.png'));
await sharp(Buffer.from(iconSvg)).resize(512, 512).png().toFile(path.join(OUT, 'icon-512.png'));
await sharp(Buffer.from(maskableSvg)).resize(512, 512).png().toFile(path.join(OUT, 'icon-maskable-512.png'));
console.log('Wrote icon-192.png, icon-512.png, icon-maskable-512.png to src/web/public');
