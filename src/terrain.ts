import type { Terrain } from './types.js';

// Positions (as a fraction of width) where a raised plateau is carved into
// the hill, creating a near-vertical wall face on each side - the ninja
// rope needs a wall to grapple onto, and the base sine-wave silhouette is
// otherwise a single smooth slope with nothing vertical anywhere.
const CLIFF_SPOTS = [0.35, 0.62];
const CLIFF_WIDTH_FRACTION = 0.06;
const CLIFF_RISE_FRACTION = 0.22;

function computeGroundHeights(width: number, height: number): Float64Array {
  const heights = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    heights[x] = height * 0.5 + Math.sin((x / width) * Math.PI * 2) * height * 0.15;
  }
  for (const spot of CLIFF_SPOTS) {
    const centerX = Math.round(width * spot);
    const halfWidth = Math.max(1, Math.round((width * CLIFF_WIDTH_FRACTION) / 2));
    const raisedHeight = Math.min(height * 0.92, heights[centerX] + height * CLIFF_RISE_FRACTION);
    for (let x = Math.max(0, centerX - halfWidth); x <= Math.min(width - 1, centerX + halfWidth); x++) {
      heights[x] = raisedHeight;
    }
  }
  return heights;
}

export function generateSilhouetteMask(width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  const heights = computeGroundHeights(width, height);
  for (let x = 0; x < width; x++) {
    const groundHeight = heights[x];
    for (let y = 0; y < height; y++) {
      mask[y * width + x] = y >= height - groundHeight ? 1 : 0;
    }
  }
  return mask;
}

export function createTerrain(width: number, height: number): Terrain {
  return { width, height, mask: generateSilhouetteMask(width, height) };
}

export function isSolid(terrain: Terrain, x: number, y: number): boolean {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || xi >= terrain.width || yi < 0 || yi >= terrain.height) return false;
  return terrain.mask[yi * terrain.width + xi] === 1;
}

export function findSurfaceY(terrain: Terrain, x: number): number {
  for (let y = 0; y < terrain.height; y++) {
    if (isSolid(terrain, x, y)) return y;
  }
  return terrain.height;
}

export function carveCircle(terrain: Terrain, cx: number, cy: number, radius: number): void {
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(terrain.width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(terrain.height - 1, Math.ceil(cy + radius));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) {
        terrain.mask[y * terrain.width + x] = 0;
      }
    }
  }
}
