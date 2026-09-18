import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSET_MANIFEST } from '../src/assetManifest.ts';
import { placeholderSheetFor } from '../src/placeholderArt.ts';
import { encodePng } from '../src/pngEncoder.ts';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(projectRoot, 'public');

let created = 0;
let skipped = 0;

for (const entry of ASSET_MANIFEST) {
  const filePath = join(publicDir, entry.path);
  if (existsSync(filePath)) {
    skipped++;
    continue;
  }
  const sheet = placeholderSheetFor(entry);
  const png = encodePng(sheet.width, sheet.height, sheet.rgba);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, png);
  created++;
  console.log(`created ${entry.path} (${sheet.width}x${sheet.height})`);
}

console.log(`\nplaceholder art: ${created} created, ${skipped} already present (real art left untouched)`);
