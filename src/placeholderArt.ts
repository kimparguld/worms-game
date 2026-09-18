import type { AssetManifestEntry } from './assetManifest.js';

export interface PlaceholderSheet {
  width: number;
  height: number;
  rgba: Uint8Array;
}

function colorBytes(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

// A flat silhouette fill, with a 1px darker border around each frame - but
// only for 'spritesheet' entries, and only so a multi-frame placeholder
// sheet is readable at a glance (frame boundaries visible); a plain
// 'image'/'nineslice' entry is a single frame and stays a flat, unbordered
// fill (the border condition below would otherwise cover its entire area
// for small assets, since x=0 and x=width-1 both count as "the edge").
export function placeholderSheetFor(entry: AssetManifestEntry): PlaceholderSheet {
  const isSpritesheet = entry.kind === 'spritesheet';
  const frameCount = isSpritesheet ? Math.max(1, entry.frameCount ?? 1) : 1;
  const frameWidth = entry.width;
  const frameHeight = entry.height;
  const width = frameWidth * frameCount;
  const height = frameHeight;
  const rgba = new Uint8Array(width * height * 4);
  const [r, g, b] = colorBytes(entry.placeholderColor);
  const [br, bg, bb] = colorBytes(entry.placeholderColor).map((c) => Math.round(c * 0.6)) as [number, number, number];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const frameX = x % frameWidth;
      const isBorder = isSpritesheet && (frameX === 0 || frameX === frameWidth - 1 || y === 0 || y === frameHeight - 1);
      const idx = (y * width + x) * 4;
      if (isBorder) {
        rgba[idx] = br;
        rgba[idx + 1] = bg;
        rgba[idx + 2] = bb;
      } else {
        rgba[idx] = r;
        rgba[idx + 1] = g;
        rgba[idx + 2] = b;
      }
      rgba[idx + 3] = 255;
    }
  }

  return { width, height, rgba };
}
