import type { Terrain } from './types.js';

// Mountain silhouette: a base flat line plus a few random sine "octaves"
// summed together, so each match gets a differently-shaped mountain range
// instead of one fixed hill. Amplitudes are kept small enough that ground
// height always stays well within [0, height] - the cliff/building rise
// math below depends on that bound to guarantee a real jump/rise.
const MOUNTAIN_OCTAVES = [
  { minAmplitudeFraction: 0.05, maxAmplitudeFraction: 0.09, minFrequency: 1, maxFrequency: 2 },
  { minAmplitudeFraction: 0.02, maxAmplitudeFraction: 0.04, minFrequency: 2, maxFrequency: 4 },
  { minAmplitudeFraction: 0.01, maxAmplitudeFraction: 0.02, minFrequency: 4, maxFrequency: 7 },
];

const CLIFF_WIDTH_FRACTION = 0.04;
const CLIFF_RISE_MIN_FRACTION = 0.25;
const CLIFF_RISE_MAX_FRACTION = 0.35;
const MAX_GROUND_HEIGHT_FRACTION = 0.95;

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number): number {
  return Math.floor(randomBetween(min, max + 1));
}

function computeMountainHeights(width: number, height: number): Float64Array {
  const heights = new Float64Array(width);
  const octaves = MOUNTAIN_OCTAVES.map((o) => ({
    amplitude: randomBetween(o.minAmplitudeFraction, o.maxAmplitudeFraction) * height,
    frequency: randomBetween(o.minFrequency, o.maxFrequency),
    phase: randomBetween(0, Math.PI * 2),
  }));
  for (let x = 0; x < width; x++) {
    let offset = 0;
    for (const oct of octaves) {
      offset += Math.sin((x / width) * Math.PI * 2 * oct.frequency + oct.phase) * oct.amplitude;
    }
    heights[x] = height * 0.5 + offset;
  }
  return heights;
}

// Carves a near-vertical wall face into the mountain so the ninja rope has
// something to grapple onto - a smooth sine silhouette alone has no
// vertical surfaces anywhere. The rise is computed relative to the actual
// natural height just outside the cliff's own span (not the cliff's own
// center point), so the resulting jump at the cliff's edge is guaranteed to
// be at least `riseFraction * height`, regardless of how the mountain
// happens to slope through that span.
function applyCliff(heights: Float64Array, width: number, height: number, centerFraction: number): void {
  const centerX = Math.round(width * centerFraction);
  const halfWidth = Math.max(1, Math.round((width * CLIFF_WIDTH_FRACTION) / 2));
  const minX = Math.max(0, centerX - halfWidth);
  const maxX = Math.min(width - 1, centerX + halfWidth);
  const leftBoundaryX = Math.max(0, minX - 1);
  const rightBoundaryX = Math.min(width - 1, maxX + 1);
  const boundaryHeight = Math.max(heights[leftBoundaryX], heights[rightBoundaryX]);
  const riseFraction = randomBetween(CLIFF_RISE_MIN_FRACTION, CLIFF_RISE_MAX_FRACTION);
  const raisedHeight = Math.min(height * MAX_GROUND_HEIGHT_FRACTION, boundaryHeight + height * riseFraction);
  for (let x = minX; x <= maxX; x++) heights[x] = raisedHeight;
}

function applyCliffs(heights: Float64Array, width: number, height: number): void {
  // Two disjoint fraction ranges so a second cliff (if any) can never
  // overlap the first and corrupt its boundary-height reference.
  applyCliff(heights, width, height, randomBetween(0.15, 0.45));
  if (randomInt(1, 2) === 2) applyCliff(heights, width, height, randomBetween(0.55, 0.85));
}

function computeGroundHeights(width: number, height: number): Float64Array {
  const heights = computeMountainHeights(width, height);
  applyCliffs(heights, width, height);
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
