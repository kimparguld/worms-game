import { WATER_BAND_HEIGHT_FRACTION } from './constants.js';
import { generateDecorations } from './terrainDecorations.js';
import { computeAllowedIntervals, sampleFromIntervals } from './intervalSampling.js';
import type { Terrain } from './types.js';

// The Y coordinate of the water's surface - fixed at the bottom of the map,
// beneath the deepest a mountain/cliff/building can generate, so it's only
// ever revealed where terrain has been dug or blown away down to it.
export function waterLevelY(terrain: Terrain): number {
  return terrain.height * (1 - WATER_BAND_HEIGHT_FRACTION);
}

// Mountain silhouette: a base flat line plus a few random sine "octaves"
// summed together, so each match gets a differently-shaped mountain range
// instead of one fixed hill.
//
// The height budget below is deliberately conservative so that nothing the
// generator builds ever reaches the top of the screen: a cliff or building
// that runs off the top edge looks broken, and a worm spawned on top of one
// ends up behind the HUD (or clipped away entirely). The budget is:
//
//   natural ground  <= BASE + sum(max amplitudes) = 0.37 + 0.18 = 0.55
//   ground (cliffs) <= MAX_GROUND_HEIGHT_FRACTION            = 0.72
//   building roofs  <= MAX_BUILDING_ROOF_FRACTION            = 0.80
//
// which leaves the top 20% of the screen clear for the HUD and life bars.
// The cliff rise range is also chosen so that clamping to the ground cap can
// never eat the whole visible wall: the worst case is a cliff sitting on the
// highest possible natural ground (0.55), which still leaves 0.17 of headroom
// - above the 0.15 height jump the tests require for a rope-grabbable wall.
const MOUNTAIN_BASE_FRACTION = 0.37;
// minFrequency/maxFrequency count full sine cycles across the whole map
// width - e.g. the first octave completing 1-2 cycles reads as a couple of
// broad rolling humps, layered under the second/third octaves' progressively
// smaller, more frequent bumps, the way stacked noise octaves usually work.
// (These max values were accidentally dropped to 0 at some point, collapsing
// every octave toward a near-flat, barely-undulating line and leaving the
// cliffs/buildings as the only visible relief - hence the "square blocks"
// look; restored here to the values this was tuned and tested at.)
const MOUNTAIN_OCTAVES = [
  { minAmplitudeFraction: 0.07, maxAmplitudeFraction: 0.13, minFrequency: 1, maxFrequency: 2 },
  { minAmplitudeFraction: 0.03, maxAmplitudeFraction: 0.06, minFrequency: 2, maxFrequency: 4 },
  { minAmplitudeFraction: 0.015, maxAmplitudeFraction: 0.03, minFrequency: 4, maxFrequency: 7 },
];

// Paired with the rise below: at this width, a 0.2-0.3 rise reads as an
// actual cliff face with a standable top, wide enough to see as a wall
// rather than a flagpole. This had also drifted down to 0.013 (~29px at a
// 2240px map) - 10x narrower - which combined with the tall rise produced a
// thin vertical spike sticking up out of the mountain instead of a cliff.
const CLIFF_WIDTH_FRACTION = 0.13;
// Must clear the 0.15 height-jump the tests require for a rope-grabbable
// wall even in the worst case (see the height-budget comment above: natural
// ground can reach 0.55, the ground cap is 0.72, leaving only 0.17 of
// headroom to clamp into) - these had drifted down to 0.05-0.1, well under
// that floor, so a cliff could no longer be counted on to produce a wall the
// rope could actually grapple.
const CLIFF_RISE_MIN_FRACTION = 0.2;
const CLIFF_RISE_MAX_FRACTION = 0.3;
// Matches the "<= 0.72" this file's own height-budget comment documents
// above - this had drifted to 1.72 (effectively disabling the cap, since
// boundaryHeight + rise never gets anywhere near 172% of the map height),
// which let a cliff's raised plateau go arbitrarily high with nothing to
// stop it.
const MAX_GROUND_HEIGHT_FRACTION = 0.72;

// ~38px at 960 width - wide enough to keep a cliff/building's edge, not just
// its center, clear of the spawn column.
const SPAWN_EXCLUSION_MARGIN_FRACTION = 0.04;
const SPAWN_COUNT = 4;
// Keeps every worm well clear of the map's left/right edges.
const SPAWN_MARGIN_FRACTION = 0.08;

// Picks 4 worm spawn X columns, expressed as fractions of the game's width
// so this works at any resolution - createMatchRuntime in matchLoop.ts reads
// these back off the generated Terrain (see createTerrain) to place worms at
// exactly these columns, so the two always agree. Cliffs, buildings, lakes,
// and floating islands are all kept clear of these columns (plus a margin)
// so a worm can never spawn walled in by a cliff face, on top of/squeezed
// against a building, or dropped in a lake.
//
// The usable width is split into SPAWN_COUNT equal slots and one column is
// picked at a random point inside each - this guarantees a minimum spacing
// between every pair of worms (the slot width itself) while still varying
// every match, and the final shuffle means there's no fixed "team 1 always
// spawns on the left" pattern: any worm can land in any slot, so a match's
// two teammates can end up right next to each other or clear across the map.
function pickSpawnFractions(): number[] {
  const usableFraction = 1 - SPAWN_MARGIN_FRACTION * 2;
  const slotFraction = usableFraction / SPAWN_COUNT;
  const pad = slotFraction * 0.15;
  const fractions: number[] = [];
  for (let i = 0; i < SPAWN_COUNT; i++) {
    const slotStart = SPAWN_MARGIN_FRACTION + i * slotFraction;
    fractions.push(randomBetween(slotStart + pad, slotStart + slotFraction - pad));
  }
  for (let i = fractions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [fractions[i], fractions[j]] = [fractions[j], fractions[i]];
  }
  return fractions;
}

const GROUND_TEXTURE_KEYS = ['terrain_ground', 'terrain_ground_2', 'terrain_ground_3'];

// Picks which of the alternate ground fill textures (assetManifest.ts) this
// match's terrain renders with - see TerrainRenderer, which reads this back
// off the generated Terrain.
function pickGroundTextureKey(): string {
  return GROUND_TEXTURE_KEYS[randomInt(0, GROUND_TEXTURE_KEYS.length - 1)];
}

// Deterministically samples a fraction from [rangeMin, rangeMax] that is
// guaranteed not to place an item of the given half-width anywhere near a
// spawn column, nor (if given) overlapping any of extraForbiddenFractions -
// no reroll, no retry budget, no chance of failure.
//
// For each spawn column, the forbidden zone is the set of center fractions
// at which an item of this half-width would come within
// SPAWN_EXCLUSION_MARGIN_FRACTION of that column. extraForbiddenFractions
// works the same way but for an already-known [lo, hi] span (e.g. a lake's
// footprint) rather than a single point - callers pass it pre-widened by
// their own half-width plus margin.
//
// These two kinds of exclusion aren't equal priority: never placing a
// feature at a spawn column is a hard gameplay requirement (a worm must
// never spawn walled in or on top of one), while extraForbiddenFractions is
// a softer aesthetic one (e.g. keeping a building facade off a lake edge).
// With spawn columns now randomized across the whole map rather than fixed
// near the edges (see pickSpawnFractions), their exclusion zones can
// occasionally combine with a lake's to blank out an entire candidate range
// - so this tries honoring both constraints first, and only drops the
// softer extraForbidden one if that leaves nothing, rather than silently
// dropping both the way a single-tier fallback would.
function sampleExcludingSpawnColumns(
  rangeMin: number,
  rangeMax: number,
  halfWidthFraction: number,
  spawnFractions: number[],
  extraForbiddenFractions: Array<[number, number]> = [],
): number {
  const spawnForbidden: Array<[number, number]> = spawnFractions.map((spawnFraction) => [
    spawnFraction - halfWidthFraction - SPAWN_EXCLUSION_MARGIN_FRACTION,
    spawnFraction + halfWidthFraction + SPAWN_EXCLUSION_MARGIN_FRACTION,
  ]);

  const withExtra = computeAllowedIntervals(rangeMin, rangeMax, [...spawnForbidden, ...extraForbiddenFractions]);
  const sampled = sampleFromIntervals(withExtra);
  if (sampled !== null) return sampled;

  const spawnOnly = computeAllowedIntervals(rangeMin, rangeMax, spawnForbidden);
  const spawnOnlySampled = sampleFromIntervals(spawnOnly);
  if (spawnOnlySampled !== null) return spawnOnlySampled;

  // Last resort: with spawn columns now spread across the whole map instead
  // of clustered in two fixed pairs, it's possible (though rare - see the
  // stress test in terrain.test.ts) for every one of the 4 spawn zones
  // combined to blanket an entire candidate range, leaving nothing that's
  // fully clear. There's no position left that satisfies the guarantee
  // outright, so pick whichever point keeps the most distance from every
  // spawn column instead of an arbitrary (and possibly worst-case) range
  // midpoint - the closest this can get to "safe" when true safety isn't
  // achievable.
  return pointFarthestFromSpawnColumns(rangeMin, rangeMax, spawnFractions);
}

function pointFarthestFromSpawnColumns(rangeMin: number, rangeMax: number, spawnFractions: number[]): number {
  const insideRange = spawnFractions.filter((f) => f > rangeMin && f < rangeMax).sort((a, b) => a - b);
  // Candidates: the range's own edges (farthest from spawn columns that sit
  // entirely outside the range) plus the midpoint between every consecutive
  // pair of in-range spawn columns (the locally-farthest point between them)
  // - the optimum for "maximize the minimum distance to any point in a set"
  // is always one of these.
  const candidates = [rangeMin, rangeMax];
  for (let i = 0; i + 1 < insideRange.length; i++) {
    candidates.push((insideRange[i] + insideRange[i + 1]) / 2);
  }

  let best = candidates[0];
  let bestMinDistance = -Infinity;
  for (const candidate of candidates) {
    const minDistance =
      spawnFractions.length === 0 ? Infinity : Math.min(...spawnFractions.map((f) => Math.abs(candidate - f)));
    if (minDistance > bestMinDistance) {
      bestMinDistance = minDistance;
      best = candidate;
    }
  }
  return best;
}

const BUILDING_COUNT_MIN = 3;
const BUILDING_COUNT_MAX = 4;
const BUILDING_WIDTH_MIN_FRACTION = 0.06;
const BUILDING_WIDTH_MAX_FRACTION = 0.11;
const BUILDING_RISE_MIN_FRACTION = 0.14;
const BUILDING_RISE_MAX_FRACTION = 0.26;
// Even when a building lands on top of an already-capped cliff, it still gets
// this much height of its own, so a building is always visible as building
// material rather than collapsing to a zero-height sliver.
const BUILDING_MIN_HEIGHT_FRACTION = 0.08;
const MAX_BUILDING_ROOF_FRACTION = 0.8;

// Detached blob-shaped landmasses floating above the main terrain - the
// "chunk" look this project is aiming for (see the reference art in the
// terrain-complexity plan). Radius is a fraction of *width* (like every
// other footprint constant here), but the vertical band is a fraction of
// *height* and picked with enough margin that even the largest island,
// including its widest lobe overshoot, can never intrude into the top
// clearance budget (0.19, see the height-budget comment above) - see the
// worked-through worst-case in this file's terrain plan.
const FLOATING_ISLAND_COUNT_MIN = 2;
const FLOATING_ISLAND_COUNT_MAX = 4;
const FLOATING_ISLAND_RADIUS_MIN_FRACTION = 0.02;
const FLOATING_ISLAND_RADIUS_MAX_FRACTION = 0.035;
const FLOATING_ISLAND_CENTER_Y_MIN_FRACTION = 0.33;
const FLOATING_ISLAND_CENTER_Y_MAX_FRACTION = 0.5;
// A lobe's center can drift up to 0.6*radius from the island's own center,
// and a lobe's own radius can be up to 0.8*radius - so a lobe's footprint
// can reach up to 1.4*radius from the island's nominal center. Widening the
// spawn-column exclusion by this same factor keeps a lobe from ever
// creeping closer to a spawn column than a plain circle of that width would.
const FLOATING_ISLAND_LOBE_OVERSHOOT = 1.4;

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

// How much of the plateau's own half-width, right past its untouched wall
// columns (see WALL_CORE_WIDTH below), eases from the full raised height
// down toward CLIFF_CORNER_ROUND_DEPTH_FRACTION of the rise - this is what
// turns a flat-topped rectangle into a rounded-shoulder mesa. Depth is a
// fraction of the *rise*, not of height, so it scales with however tall
// this particular cliff happened to roll.
const CLIFF_CORNER_ROUND_FRACTION = 0.4;
const CLIFF_CORNER_ROUND_DEPTH_FRACTION = 0.5;
// Small per-column noise added across the rounded portion of the top, on top
// of the corner curve, so it reads as an uneven rock surface rather than a
// mathematically smooth curve. An order of magnitude below
// MAX_NATURAL_ADJACENT_SLOPE_FRACTION (terrainDecorations.ts) so it never
// reads as its own cliff edge to the decoration placer.
const CLIFF_SURFACE_JITTER_FRACTION = 0.01;
// Columns closest to each wall boundary that are left at exactly
// `raisedHeight`, untouched by rounding/jitter - this is deliberately the
// only part of the plateau this function guarantees the shape of, because
// it's what the height-budget's near-vertical-wall guarantee (see the
// module comment) and this file's own tests measure: the jump from
// leftBoundaryX/rightBoundaryX into these columns. Everything else in the
// plateau is free to be reshaped without touching that guarantee.
const CLIFF_WALL_CORE_WIDTH = 2;

// Carves a near-vertical wall face into the mountain so the ninja rope has
// something to grapple onto - a smooth sine silhouette alone has no
// vertical surfaces anywhere. The rise is computed relative to the actual
// natural height just outside the cliff's own span (not the cliff's own
// center point), so the resulting jump at the cliff's edge is guaranteed to
// be at least `riseFraction * height`, regardless of how the mountain
// happens to slope through that span.
//
// Past that guaranteed wall (see CLIFF_WALL_CORE_WIDTH), the rest of the
// plateau's top eases down and gets a little surface noise instead of
// staying a perfectly flat rectangle - a flat-topped block with two square
// top corners reads as an obviously artificial slab, not a rock formation.
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
  const rise = raisedHeight - boundaryHeight;

  const span = maxX - minX;
  const wallCoreWidth = Math.min(CLIFF_WALL_CORE_WIDTH, Math.floor(span / 2));
  const cornerRadius = Math.max(1, Math.round(span * CLIFF_CORNER_ROUND_FRACTION));

  // Raw per-column noise, smoothed with a small moving average below (see
  // the loop) - independent random noise per column is too high-frequency
  // to read as anything but static; smoothing it turns the rounded top into
  // a bumpy rock surface instead.
  const rawJitter = new Float64Array(span + 1);
  for (let i = 0; i <= span; i++) {
    rawJitter[i] = (Math.random() - 0.5) * 2 * height * CLIFF_SURFACE_JITTER_FRACTION;
  }
  const smoothRadius = Math.max(1, Math.round(span * 0.02));

  for (let x = minX; x <= maxX; x++) {
    const distFromNearestEdge = Math.min(x - minX, maxX - x);
    if (distFromNearestEdge < wallCoreWidth) {
      heights[x] = raisedHeight;
      continue;
    }
    const cornerT = Math.min(1, (distFromNearestEdge - wallCoreWidth) / cornerRadius);
    const dip = rise * CLIFF_CORNER_ROUND_DEPTH_FRACTION * Math.sin((cornerT * Math.PI) / 2);

    let jitterSum = 0;
    let jitterCount = 0;
    for (let k = -smoothRadius; k <= smoothRadius; k++) {
      const j = x - minX + k;
      if (j >= 0 && j <= span) {
        jitterSum += rawJitter[j];
        jitterCount++;
      }
    }
    heights[x] = raisedHeight - dip + jitterSum / jitterCount;
  }
}

// Deterministically samples a cliff's centerFraction from [min, max] such
// that its footprint (including the spawn margin) never overlaps a known
// spawn column - see sampleExcludingSpawnColumns.
function pickCliffCenterFraction(min: number, max: number, spawnFractions: number[]): number {
  return sampleExcludingSpawnColumns(min, max, CLIFF_WIDTH_FRACTION / 2, spawnFractions);
}

function applyCliffs(heights: Float64Array, width: number, height: number, spawnFractions: number[]): void {
  // Two disjoint fraction ranges so a second cliff can never overlap the
  // first and corrupt its boundary-height reference.
  applyCliff(heights, width, height, pickCliffCenterFraction(0.15, 0.45, spawnFractions));
  applyCliff(heights, width, height, pickCliffCenterFraction(0.55, 0.85, spawnFractions));
}

const LAKE_COUNT_MIN = 2;
const LAKE_COUNT_MAX = 3;
const LAKE_WIDTH_MIN_FRACTION = 0.05;
const LAKE_WIDTH_MAX_FRACTION = 0.12;
// A lake's center dips to just below the water line (see waterLevelY), so
// its deepest point is guaranteed-exposed open water - not just low ground -
// while a sine falloff blends it back up to the surrounding natural terrain
// at its edges, for a basin instead of a hard-edged pit.
const LAKE_TARGET_HEIGHT_FRACTION = WATER_BAND_HEIGHT_FRACTION * 0.75;

function pickLakeCenterFraction(halfWidthFraction: number, spawnFractions: number[]): number {
  return sampleExcludingSpawnColumns(halfWidthFraction, 1 - halfWidthFraction, halfWidthFraction, spawnFractions);
}

// Returns each lake's [minXFraction, maxXFraction] footprint so buildings
// can be kept off them entirely - see pickBuildingStartX.
function applyLakes(
  heights: Float64Array,
  width: number,
  height: number,
  spawnFractions: number[],
): Array<[number, number]> {
  const count = randomInt(LAKE_COUNT_MIN, LAKE_COUNT_MAX);
  const targetHeight = height * LAKE_TARGET_HEIGHT_FRACTION;
  const lakeRanges: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    const lakeWidth = Math.max(
      1,
      Math.round(randomBetween(width * LAKE_WIDTH_MIN_FRACTION, width * LAKE_WIDTH_MAX_FRACTION)),
    );
    const halfWidthFraction = lakeWidth / width / 2;
    const centerX = Math.round(pickLakeCenterFraction(halfWidthFraction, spawnFractions) * width);
    const minX = Math.max(0, centerX - Math.round(lakeWidth / 2));
    const maxX = Math.min(width - 1, centerX + Math.round(lakeWidth / 2));
    lakeRanges.push([minX / width, maxX / width]);
    const span = Math.max(1, maxX - minX);
    for (let x = minX; x <= maxX; x++) {
      // 0 at the lake's edges, 1 at its center.
      const basinShape = Math.sin(((x - minX) / span) * Math.PI);
      heights[x] = heights[x] * (1 - basinShape) + targetHeight * basinShape;
    }
  }
  return lakeRanges;
}

function computeGroundHeights(
  width: number,
  height: number,
  spawnFractions: number[],
): { heights: Float64Array; lakeRanges: Array<[number, number]> } {
  const heights = computeMountainHeights(width, height);
  // Lakes before cliffs: applyCliff always overwrites its own span with a
  // plateau raised by a fixed fraction above its (possibly lake-lowered)
  // boundary, so the cliff's wall-face jump is preserved regardless of a
  // lake landing nearby - reversed, a lake applied after could soften or
  // erase the cliff's face entirely.
  const lakeRanges = applyLakes(heights, width, height, spawnFractions);
  applyCliffs(heights, width, height, spawnFractions);
  return { heights, lakeRanges };
}

// Deterministically samples a building's startX such that its footprint
// (including the spawn margin) never overlaps a known spawn column, nor a
// lake's footprint. Reframed as picking the building's *center* fraction
// (reusing the same sampleExcludingSpawnColumns helper cliffs use) over the
// valid center range [halfWidthFraction, 1 - halfWidthFraction], then
// converted back to a pixel startX and clamped to the valid
// [0, width - buildingWidth] start range.
//
// Lakes are excluded (not just naturally avoided) because a building's
// facade is drawn down to *its own column's* natural ground height (see
// generateSilhouetteMask) - a footprint that clips a lake's near-water low
// point would stretch that one column's facade almost down to the water
// line, a visible spike of facade texture cutting deep into what should be
// plain dirt. Buildings never need to touch a lake for any gameplay reason,
// so the simplest fix is to keep the two apart entirely, the same way
// spawn columns already are.
function pickBuildingStartX(
  width: number,
  buildingWidth: number,
  lakeRanges: Array<[number, number]>,
  spawnFractions: number[],
): number {
  const maxStart = Math.max(0, width - buildingWidth);
  const halfWidthFraction = buildingWidth / width / 2;
  const rangeMin = halfWidthFraction;
  const rangeMax = Math.max(rangeMin, 1 - halfWidthFraction);
  const extraForbidden: Array<[number, number]> = lakeRanges.map(([lo, hi]) => [
    lo - halfWidthFraction - SPAWN_EXCLUSION_MARGIN_FRACTION,
    hi + halfWidthFraction + SPAWN_EXCLUSION_MARGIN_FRACTION,
  ]);
  const centerFraction = sampleExcludingSpawnColumns(
    rangeMin,
    rangeMax,
    halfWidthFraction,
    spawnFractions,
    extraForbidden,
  );
  const startX = Math.round(centerFraction * width - buildingWidth / 2);
  return Math.min(Math.max(0, startX), maxStart);
}

// Adds flat-roofed building plateaus on top of the mountain silhouette,
// returning the set of columns that are building material (mask value 2,
// rendered with a distinct roof/wall palette in drawTerrain) rather than
// plain ground (mask value 1). generateSilhouetteMask draws each such
// column's facade down to that column's own natural (pre-building) height,
// so the facade/ground-texture seam varies smoothly with the mountain - safe
// to do unconditionally because pickBuildingStartX already keeps a
// building's footprint off any lake, the one place a column's natural
// height could otherwise dip anomalously low (see that function's comment).
function applyBuildings(
  heights: Float64Array,
  width: number,
  height: number,
  lakeRanges: Array<[number, number]>,
  spawnFractions: number[],
): Set<number> {
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
    const startX = pickBuildingStartX(width, buildingWidth, lakeRanges, spawnFractions);
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

function pickIslandCenterFraction(halfWidthFraction: number, spawnFractions: number[]): number {
  return sampleExcludingSpawnColumns(halfWidthFraction, 1 - halfWidthFraction, halfWidthFraction, spawnFractions);
}

// Stamps a small cluster of overlapping circular lobes (an irregular blob,
// not a perfect disc) directly into the mask as ground material - detached
// floating chunks read as their own silhouette with no heightmap column of
// their own, so they're written straight into the mask rather than folded
// into computeGroundHeights.
//
// Every write is clamped against the *current* mask's own topmost surface
// per column (surfaceRow, read once before any island is placed) and the
// same top-clearance budget every other feature respects. A cliff or
// building can reach much higher than the average natural silhouette, so
// this project's earlier fixed Y-band approach could let an island merge
// into (and round off) a cliff face it happened to land near - clamping
// against the real per-column surface instead guarantees an island can
// never touch, let alone reshape, existing terrain, regardless of where a
// cliff or building happens to sit.
function applyFloatingIslands(mask: Uint8Array, width: number, height: number, spawnFractions: number[]): void {
  const surfaceRow = new Int32Array(width).fill(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (mask[y * width + x] !== 0) {
        surfaceRow[x] = y;
        break;
      }
    }
  }
  const topClearanceRow = Math.ceil(height * 0.19) + 1;

  const count = randomInt(FLOATING_ISLAND_COUNT_MIN, FLOATING_ISLAND_COUNT_MAX);
  for (let i = 0; i < count; i++) {
    const radius = randomBetween(
      width * FLOATING_ISLAND_RADIUS_MIN_FRACTION,
      width * FLOATING_ISLAND_RADIUS_MAX_FRACTION,
    );
    const halfWidthFraction = (radius * FLOATING_ISLAND_LOBE_OVERSHOOT) / width;
    const centerX = Math.round(pickIslandCenterFraction(halfWidthFraction, spawnFractions) * width);
    const centerY = Math.round(
      randomBetween(FLOATING_ISLAND_CENTER_Y_MIN_FRACTION, FLOATING_ISLAND_CENTER_Y_MAX_FRACTION) * height,
    );

    const lobeCount = randomInt(2, 3);
    for (let lobe = 0; lobe < lobeCount; lobe++) {
      const lobeAngle = randomBetween(0, Math.PI * 2);
      const lobeDistance = lobe === 0 ? 0 : radius * randomBetween(0.3, 0.6);
      const lobeRadius = radius * (lobe === 0 ? 1 : randomBetween(0.55, 0.8));
      const lx = centerX + Math.cos(lobeAngle) * lobeDistance;
      const ly = centerY + Math.sin(lobeAngle) * lobeDistance * 0.6;
      const minX = Math.max(0, Math.floor(lx - lobeRadius));
      const maxX = Math.min(width - 1, Math.ceil(lx + lobeRadius));
      const minY = Math.max(topClearanceRow, Math.floor(ly - lobeRadius));
      const maxY = Math.min(height - 1, Math.ceil(ly + lobeRadius));
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (y >= surfaceRow[x]) continue; // never touch/merge into this column's existing terrain
          // Squashed vertically (0.85) so the lobe reads as a rounded chunk
          // rather than a perfect circle.
          if ((x - lx) ** 2 + ((y - ly) / 0.85) ** 2 <= lobeRadius * lobeRadius) mask[y * width + x] = 1;
        }
      }
    }
  }
}

// spawnFractions defaults to a freshly randomized set (see pickSpawnFractions)
// so every ordinary caller gets a terrain that keeps its own random spawn
// columns clear without having to know about them; tests that need to pin
// down exactly where those columns are (e.g. to assert nothing ever lands on
// them) can pass their own instead.
export function generateSilhouetteMask(
  width: number,
  height: number,
  spawnFractions: number[] = pickSpawnFractions(),
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const { heights, lakeRanges } = computeGroundHeights(width, height, spawnFractions);
  const naturalHeights = heights.slice();
  const buildingColumns = applyBuildings(heights, width, height, lakeRanges, spawnFractions);
  // No column is ever solid this far down, regardless of its generated
  // height - it's reserved for water, only ever exposed where terrain gets
  // dug or blown away down to it.
  const waterStartY = height * (1 - WATER_BAND_HEIGHT_FRACTION);

  for (let x = 0; x < width; x++) {
    const groundHeight = heights[x];
    const isBuildingColumn = buildingColumns.has(x);
    const naturalHeight = naturalHeights[x];
    for (let y = 0; y < height; y++) {
      if (y < height - groundHeight || y >= waterStartY) {
        mask[y * width + x] = 0;
      } else if (isBuildingColumn && y < height - naturalHeight) {
        mask[y * width + x] = 2;
      } else {
        mask[y * width + x] = 1;
      }
    }
  }
  applyFloatingIslands(mask, width, height, spawnFractions);
  return mask;
}

export function createTerrain(width: number, height: number): Terrain {
  const spawnFractions = pickSpawnFractions();
  const mask = generateSilhouetteMask(width, height, spawnFractions);
  const decorationMask = new Uint8Array(width * height);
  return {
    width,
    height,
    mask,
    decorationMask,
    dirty: true,
    spawnFractions,
    groundTextureKey: pickGroundTextureKey(),
    decorations: generateDecorations(width, height, mask, decorationMask, spawnFractions),
  };
}

// Solid wherever either layer says so - the natural ground, or a decoration
// standing on it (see Terrain.decorationMask). A decoration never reshapes
// the ground it sits on, so the two have to be checked independently rather
// than merged into one mask.
export function isSolid(terrain: Terrain, x: number, y: number): boolean {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || xi >= terrain.width || yi < 0 || yi >= terrain.height) return false;
  const i = yi * terrain.width + xi;
  return terrain.mask[i] !== 0 || terrain.decorationMask[i] !== 0;
}

// Finds the nearest solid row at or below fromY - the world-topmost surface
// by default (fromY = 0), but the same column can have solid rows above
// fromY too (an overhang, or a building roof over a dug-out tunnel), which
// this ignores: callers that already know roughly where they are (e.g. a
// worm's shadow) pass their own y so they find the surface actually beneath
// them, not whatever solid ground happens to sit higher up that column.
export function findSurfaceY(terrain: Terrain, x: number, fromY = 0): number {
  for (let y = Math.max(0, Math.round(fromY)); y < terrain.height; y++) {
    if (isSolid(terrain, x, y)) return y;
  }
  return terrain.height;
}

// Clears both layers - the natural ground and any decoration standing on it
// (see Terrain.decorationMask) - so an explosion erodes a rock/tree/bush
// exactly like the rest of the destructible terrain: only the part actually
// within the blast radius goes, not the whole object at once.
export function carveCircle(terrain: Terrain, cx: number, cy: number, radius: number): void {
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(terrain.width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(terrain.height - 1, Math.ceil(cy + radius));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) {
        const i = y * terrain.width + x;
        terrain.mask[i] = 0;
        terrain.decorationMask[i] = 0;
      }
    }
  }
  terrain.dirty = true;
}
