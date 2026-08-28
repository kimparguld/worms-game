import type { Terrain } from './types.js';

// Mountain silhouette: a base flat line plus a few random sine "octaves"
// summed together, so each match gets a differently-shaped mountain range
// instead of one fixed hill.
//
// The height budget below is deliberately conservative so that nothing the
// generator builds ever reaches the top of the screen: a cliff or building
// that runs off the top edge looks broken, and a worm spawned on top of one
// ends up behind the HUD (or clipped away entirely). The budget is:
//
//   natural ground  <= BASE + sum(max amplitudes) = 0.37 + 0.15 = 0.52
//   ground (cliffs) <= MAX_GROUND_HEIGHT_FRACTION            = 0.72
//   building roofs  <= MAX_BUILDING_ROOF_FRACTION            = 0.80
//
// which leaves the top 20% of the screen clear for the HUD and life bars.
// The cliff rise range is also chosen so that clamping to the ground cap can
// never eat the whole rise: the worst case is a cliff sitting on the highest
// possible natural ground (0.52), which still leaves 0.20 of headroom - at
// or above CLIFF_RISE_MIN_FRACTION, so the ninja rope always gets a wall.
const MOUNTAIN_BASE_FRACTION = 0.37;
const MOUNTAIN_OCTAVES = [
  { minAmplitudeFraction: 0.05, maxAmplitudeFraction: 0.09, minFrequency: 1, maxFrequency: 2 },
  { minAmplitudeFraction: 0.02, maxAmplitudeFraction: 0.04, minFrequency: 2, maxFrequency: 4 },
  { minAmplitudeFraction: 0.01, maxAmplitudeFraction: 0.02, minFrequency: 4, maxFrequency: 7 },
];

const CLIFF_WIDTH_FRACTION = 0.1;
const CLIFF_RISE_MIN_FRACTION = 0.2;
const CLIFF_RISE_MAX_FRACTION = 0.3;
const MAX_GROUND_HEIGHT_FRACTION = 0.72;

// The four fixed worm spawn X columns, expressed as fractions of the game's
// real 960px width (150, 200, 760, 810 - see createMatchRuntime in
// matchLoop.ts), so this works for any terrain width, including the smaller
// widths the tests exercise. Cliffs and buildings are kept clear of these
// columns (plus a margin) so a worm can never spawn walled in by a cliff
// face, or on top of / squeezed against a building.
const SPAWN_EXCLUSION_FRACTIONS = [0.156, 0.208, 0.792, 0.844];
// ~38px at 960 width - wide enough to keep a cliff/building's edge, not just
// its center, clear of the spawn column.
const SPAWN_EXCLUSION_MARGIN_FRACTION = 0.04;

// Deterministically samples a fraction from [rangeMin, rangeMax] that is
// guaranteed not to place an item of the given half-width anywhere near a
// spawn column - no reroll, no retry budget, no chance of failure.
//
// For each spawn column, the forbidden zone is the set of center fractions
// at which an item of this half-width would come within
// SPAWN_EXCLUSION_MARGIN_FRACTION of that column:
// [spawn - halfWidthFraction - margin, spawn + halfWidthFraction + margin].
// These per-column zones are clipped to the requested range, merged (they
// can and do overlap for this project's actual spawn fractions - e.g. 0.156
// and 0.208 are close enough that their zones merge into one), and then the
// complement (the allowed sub-intervals) is sampled uniformly by weighting
// each sub-interval by its length, so the result is uniform over the whole
// allowed region rather than biased toward whichever interval is checked
// first.
function sampleExcludingSpawnColumns(rangeMin: number, rangeMax: number, halfWidthFraction: number): number {
  const forbidden: Array<[number, number]> = [];
  for (const spawnFraction of SPAWN_EXCLUSION_FRACTIONS) {
    const lo = Math.max(rangeMin, spawnFraction - halfWidthFraction - SPAWN_EXCLUSION_MARGIN_FRACTION);
    const hi = Math.min(rangeMax, spawnFraction + halfWidthFraction + SPAWN_EXCLUSION_MARGIN_FRACTION);
    if (lo < hi) forbidden.push([lo, hi]);
  }
  forbidden.sort((a, b) => a[0] - b[0]);

  // Sweep-merge overlapping/adjacent forbidden intervals.
  const merged: Array<[number, number]> = [];
  for (const [lo, hi] of forbidden) {
    const last = merged[merged.length - 1];
    if (last && lo <= last[1]) {
      last[1] = Math.max(last[1], hi);
    } else {
      merged.push([lo, hi]);
    }
  }

  // Allowed sub-intervals are the complement of the merged forbidden
  // intervals within [rangeMin, rangeMax].
  const allowed: Array<[number, number]> = [];
  let cursor = rangeMin;
  for (const [lo, hi] of merged) {
    if (lo > cursor) allowed.push([cursor, lo]);
    cursor = Math.max(cursor, hi);
  }
  if (cursor < rangeMax) allowed.push([cursor, rangeMax]);

  const totalLength = allowed.reduce((sum, [lo, hi]) => sum + (hi - lo), 0);
  // Defensive fallback: should never happen with this project's actual
  // constants (verified: every cliff/building range keeps a wide allowed
  // margin), but if the allowed region is ever empty, return a well-defined
  // midpoint rather than throwing or looping.
  if (totalLength <= 0) return (rangeMin + rangeMax) / 2;

  let offset = Math.random() * totalLength;
  for (const [lo, hi] of allowed) {
    const len = hi - lo;
    if (offset < len) return lo + offset;
    offset -= len;
  }
  // Floating-point edge case: offset landed exactly on the total length.
  return allowed[allowed.length - 1][1];
}

const BUILDING_COUNT_MIN = 2;
const BUILDING_COUNT_MAX = 3;
const BUILDING_WIDTH_MIN_FRACTION = 0.06;
const BUILDING_WIDTH_MAX_FRACTION = 0.11;
const BUILDING_RISE_MIN_FRACTION = 0.14;
const BUILDING_RISE_MAX_FRACTION = 0.26;
// Even when a building lands on top of an already-capped cliff, it still gets
// this much height of its own, so a building is always visible as building
// material rather than collapsing to a zero-height sliver.
const BUILDING_MIN_HEIGHT_FRACTION = 0.08;
const MAX_BUILDING_ROOF_FRACTION = 0.8;

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
    heights[x] = height * MOUNTAIN_BASE_FRACTION + offset;
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

// Deterministically samples a cliff's centerFraction from [min, max] such
// that its footprint (including the spawn margin) never overlaps a known
// spawn column - see sampleExcludingSpawnColumns.
function pickCliffCenterFraction(min: number, max: number): number {
  return sampleExcludingSpawnColumns(min, max, CLIFF_WIDTH_FRACTION / 2);
}

function applyCliffs(heights: Float64Array, width: number, height: number): void {
  // Two disjoint fraction ranges so a second cliff (if any) can never
  // overlap the first and corrupt its boundary-height reference.
  applyCliff(heights, width, height, pickCliffCenterFraction(0.15, 0.45));
  if (randomInt(1, 2) === 2) applyCliff(heights, width, height, pickCliffCenterFraction(0.55, 0.85));
}

function computeGroundHeights(width: number, height: number): Float64Array {
  const heights = computeMountainHeights(width, height);
  applyCliffs(heights, width, height);
  return heights;
}

// Deterministically samples a building's startX such that its footprint
// (including the spawn margin) never overlaps a known spawn column. Reframed
// as picking the building's *center* fraction (reusing the same
// sampleExcludingSpawnColumns helper cliffs use) over the valid center range
// [halfWidthFraction, 1 - halfWidthFraction], then converted back to a pixel
// startX and clamped to the valid [0, width - buildingWidth] start range.
function pickBuildingStartX(width: number, buildingWidth: number): number {
  const maxStart = Math.max(0, width - buildingWidth);
  const halfWidthFraction = buildingWidth / width / 2;
  const rangeMin = halfWidthFraction;
  const rangeMax = Math.max(rangeMin, 1 - halfWidthFraction);
  const centerFraction = sampleExcludingSpawnColumns(rangeMin, rangeMax, halfWidthFraction);
  const startX = Math.round(centerFraction * width - buildingWidth / 2);
  return Math.min(Math.max(0, startX), maxStart);
}

// Adds flat-roofed building plateaus on top of the mountain silhouette,
// returning the set of columns that are building material (mask value 2,
// rendered with a distinct roof/wall palette in drawTerrain) rather than
// plain ground (mask value 1).
function applyBuildings(heights: Float64Array, width: number, height: number): Set<number> {
  const buildingColumns = new Set<number>();
  // Each building's roof is measured from the natural ground, not from
  // whatever an earlier building already raised these columns to - otherwise
  // two overlapping buildings stack their rises and blow the height budget.
  const groundHeights = heights.slice();
  const count = randomInt(BUILDING_COUNT_MIN, BUILDING_COUNT_MAX);
  for (let i = 0; i < count; i++) {
    const buildingWidth = Math.max(
      1,
      Math.round(randomBetween(width * BUILDING_WIDTH_MIN_FRACTION, width * BUILDING_WIDTH_MAX_FRACTION)),
    );
    const startX = pickBuildingStartX(width, buildingWidth);
    const minX = Math.max(0, startX);
    const maxX = Math.min(width - 1, startX + buildingWidth);

    let naturalMax = 0;
    for (let x = minX; x <= maxX; x++) naturalMax = Math.max(naturalMax, groundHeights[x]);
    const riseFraction = randomBetween(BUILDING_RISE_MIN_FRACTION, BUILDING_RISE_MAX_FRACTION);
    const roofHeight = Math.max(
      naturalMax + height * BUILDING_MIN_HEIGHT_FRACTION,
      Math.min(height * MAX_BUILDING_ROOF_FRACTION, naturalMax + height * riseFraction),
    );

    for (let x = minX; x <= maxX; x++) {
      heights[x] = roofHeight;
      buildingColumns.add(x);
    }
  }
  return buildingColumns;
}

export function generateSilhouetteMask(width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  const heights = computeGroundHeights(width, height);
  const naturalHeights = heights.slice();
  const buildingColumns = applyBuildings(heights, width, height);

  for (let x = 0; x < width; x++) {
    const groundHeight = heights[x];
    const isBuildingColumn = buildingColumns.has(x);
    const naturalHeight = naturalHeights[x];
    for (let y = 0; y < height; y++) {
      if (y < height - groundHeight) {
        mask[y * width + x] = 0;
      } else if (isBuildingColumn && y < height - naturalHeight) {
        mask[y * width + x] = 2;
      } else {
        mask[y * width + x] = 1;
      }
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
  return terrain.mask[yi * terrain.width + xi] !== 0;
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
