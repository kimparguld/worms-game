import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSET_MANIFEST, type AssetManifestEntry } from '../src/assetManifest.js';

// The manifest is the single source of truth for every texture the game loads,
// but nothing else checks it against reality: a renamed file, a regenerated
// sheet with a different frame count, or a hand-authored replacement drawn at
// the wrong size all stay invisible until the game runs - and then surface as
// a magenta fallback or a subtly wrong sprite, not as an error. This suite is
// the automated form of exactly the failure the assetLoader fallback exists to
// survive.
const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// A PNG's IHDR is always the first chunk and always at a fixed offset: the
// 8-byte signature, then the chunk's 4-byte length, then the 4-byte type
// "IHDR", then width and height as big-endian uint32s. That is the exact
// layout src/pngEncoder.ts writes, read back.
function readPngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(file);
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`${file} is not a PNG`);
  if (buf.toString('ascii', 12, 16) !== 'IHDR') throw new Error(`${file} has no leading IHDR chunk`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// A spritesheet's declared width/height is one *frame*; the file holds
// frameCount of them laid out left-to-right (see placeholderSheetFor, and the
// frameWidth/frameHeight assetLoader hands Phaser).
function expectedFileSize(entry: AssetManifestEntry): { width: number; height: number } {
  const frames = entry.kind === 'spritesheet' ? (entry.frameCount ?? 1) : 1;
  return { width: entry.width * frames, height: entry.height };
}

describe('ASSET_MANIFEST files on disk', () => {
  it('declares at least one entry', () => {
    expect(ASSET_MANIFEST.length).toBeGreaterThan(0);
  });

  for (const entry of ASSET_MANIFEST) {
    it(`${entry.key} resolves to public/${entry.path} at its declared size`, () => {
      const file = resolve(PUBLIC_DIR, entry.path);
      expect(existsSync(file), `missing file for manifest key "${entry.key}": public/${entry.path}`).toBe(true);
      expect(readPngSize(file)).toEqual(expectedFileSize(entry));
    });
  }
});
