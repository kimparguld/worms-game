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
// generator builds ever reaches the top of the screen: a branch or building
// that runs off the top edge looks broken, and a worm spawned on top of one
// ends up behind the HUD (or clipped away entirely). The budget is:
//
//   natural ground  <= BASE + sum(max amplitudes) = 0.37 + 0.18 = 0.55
//   building roofs  <= MAX_BUILDING_ROOF_FRACTION            = 0.80
//
// which leaves the top 20% of the screen clear for the HUD and life bars.
// See applyBranch below for how branches stay inside this same budget.
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

const BRANCH_COUNT_MIN = 3;
const BRANCH_COUNT_MAX = 5;
const BRANCH_BASE_RADIUS_MIN_FRACTION = 0.025; // fraction of width
const BRANCH_BASE_RADIUS_MAX_FRACTION = 0.04;
const BRANCH_TIP_RADIUS_FRACTION = 0.4; // tip radius, as a fraction of the base radius
// Chosen well above the 0.15 rope-grapple threshold the tests require (see
// "generateSilhouetteMask branches" in terrain.test.ts) - the same
// margin-above-the-requirement principle the old cliff-rise constants used,
// so random variation within this range can never produce a wall too short
// to grapple.
const BRANCH_HEIGHT_MIN_FRACTION = 0.28; // fraction of height climbed above the branch's own start point
const BRANCH_HEIGHT_MAX_FRACTION = 0.42;
const BRANCH_STEP_FRACTION = 0.35; // vertical step per walk iteration, as a fraction of the *current* radius
const BRANCH_WANDER_FRACTION = 0.5; // max sideways drift per step, as a fraction of the current radius
const BRANCH_MAX_WANDER_FRACTION_OF_WIDTH = 0.06; // hard cap on total drift from the branch's own start X
const BRANCH_CAP_RADIUS_MULTIPLIER = 1.8; // tip cap size, relative to the radius at the tip
const BRANCH_CAP_SQUASH = 0.85; // same vertical squash floating islands use, for a rounded-chunk cap instead of a perfect circle

// ~38px at 960 width - wide enough to keep a building's edge, not just
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
  const lakeRanges = applyLakes(heights, width, height, spawnFractions);
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

// Topmost solid row in column x of the mask as it stands right now - reads
// off *any* solid material (ground value 1 or building value 2), since a
// branch is fine launching from either. Mirrors terrainDecorations.ts's
// surfaceAt, but only needs the row, not which value it was.
function surfaceYAt(mask: Uint8Array, width: number, height: number, x: number): number {
  for (let y = 0; y < height; y++) {
    if (mask[y * width + x] !== 0) return y;
  }
  return height;
}

// Runs of columns whose current surface is building material (mask value 2),
// as [lo, hi] fractions of width - a branch should never sprout out of a
// building's flat roof, since that would read as artificial rather than a
// natural growth. Mirrors terrainDecorations.ts's computeBadGroundIntervals
// (same run-collapsing column scan), but keyed on mask===2 specifically
// rather than "anything that isn't plantable ground" - unlike that function,
// a branch is fine starting from a lake's shallow edge (see applyBranches),
// so the two predicates can't be shared.
function buildingColumnRanges(mask: Uint8Array, width: number, height: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let runStart: number | null = null;
  for (let x = 0; x <= width; x++) {
    const isBuilding =
      x < width &&
      (() => {
        const y = surfaceYAt(mask, width, height, x);
        return y < height && mask[y * width + x] === 2;
      })();
    if (isBuilding && runStart === null) {
      runStart = x;
    } else if (!isBuilding && runStart !== null) {
      ranges.push([runStart / width, x / width]);
      runStart = null;
    }
  }
  return ranges;
}

// Fills every mask cell inside the ellipse centered at (cx, cy) with radii
// (radiusX, radiusY) - the basic unit applyBranch stamps repeatedly along its
// walk to build up a tapering tube, and applyFloatingIslands already uses the
// same squashed-ellipse technique for its lobes.
function stampCircle(
  mask: Uint8Array,
  width: number,
  cx: number,
  cy: number,
  radiusX: number,
  radiusY: number,
  topClearanceRow: number,
  bottomClearanceRow: number,
): void {
  const minX = Math.max(0, Math.floor(cx - radiusX));
  const maxX = Math.min(width - 1, Math.ceil(cx + radiusX));
  const minY = Math.max(topClearanceRow, Math.floor(cy - radiusY));
  const maxY = Math.min(bottomClearanceRow, Math.ceil(cy + radiusY));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (((x - cx) / radiusX) ** 2 + ((y - cy) / radiusY) ** 2 <= 1) mask[y * width + x] = 1;
    }
  }
}

// Grows one winding, tapering branch up from startXFraction's own current
// surface: a constrained random walk that shrinks its radius as it climbs,
// drifts sideways within a bounded band to create overhangs, and finishes
// with a wider, squashed landing cap a worm can stand on. Small step size
// relative to the current radius (BRANCH_STEP_FRACTION) keeps consecutive
// stamped circles overlapping enough to read as one continuous tube rather
// than a string of separate blobs.
function applyBranch(mask: Uint8Array, width: number, height: number, startXFraction: number): void {
  const topClearanceRow = Math.ceil(height * 0.19) + 2; // same budget every other feature respects
  const bottomClearanceRow = Math.floor(height * (1 - WATER_BAND_HEIGHT_FRACTION)) - 1;
  const startX = Math.round(startXFraction * width);
  let y = surfaceYAt(mask, width, height, startX);
  const climbHeight = randomBetween(BRANCH_HEIGHT_MIN_FRACTION, BRANCH_HEIGHT_MAX_FRACTION) * height;
  const topY = Math.max(topClearanceRow, y - climbHeight);
  const startY = y;

  const baseRadius = randomBetween(BRANCH_BASE_RADIUS_MIN_FRACTION, BRANCH_BASE_RADIUS_MAX_FRACTION) * width;
  const tipRadius = baseRadius * BRANCH_TIP_RADIUS_FRACTION;
  const maxWander = BRANCH_MAX_WANDER_FRACTION_OF_WIDTH * width;

  let x = startX;
  let radius = baseRadius;
  while (y > topY) {
    stampCircle(mask, width, x, y, radius, radius, topClearanceRow, bottomClearanceRow);
    const progress = Math.min(1, Math.max(0, (startY - y) / (startY - topY)));
    radius = baseRadius + (tipRadius - baseRadius) * progress;
    y -= Math.max(1, radius * BRANCH_STEP_FRACTION);
    x = Math.min(
      startX + maxWander,
      Math.max(startX - maxWander, x + randomBetween(-1, 1) * radius * BRANCH_WANDER_FRACTION),
    );
  }
  // Landing cap: wider and squashed, same technique applyFloatingIslands
  // uses for its lobes, for a rounded chunk instead of a bare tube end.
  const capRadius = radius * BRANCH_CAP_RADIUS_MULTIPLIER;
  stampCircle(mask, width, x, y, capRadius, capRadius * BRANCH_CAP_SQUASH, topClearanceRow, bottomClearanceRow);
}

// True only if sampleExcludingSpawnColumns would find a safe point without
// falling through to its 3rd-tier fallback (pointFarthestFromSpawnColumns),
// which gives no minimum-distance guarantee at all - fine for lakes (soft,
// sine-blended edges, safe to land close to a spawn column under it) but
// not for branches (sharp, hard-edged - the whole point of the feature).
// Mirrors sampleExcludingSpawnColumns's own tier-2 check (spawn columns
// alone, no extraForbiddenFractions) so this predicts the real call's
// behavior exactly, not approximately.
function hasSafeSpawnClearance(
  rangeMin: number,
  rangeMax: number,
  halfWidthFraction: number,
  spawnFractions: number[],
): boolean {
  const spawnForbidden: Array<[number, number]> = spawnFractions.map((spawnFraction) => [
    spawnFraction - halfWidthFraction - SPAWN_EXCLUSION_MARGIN_FRACTION,
    spawnFraction + halfWidthFraction + SPAWN_EXCLUSION_MARGIN_FRACTION,
  ]);
  return computeAllowedIntervals(rangeMin, rangeMax, spawnForbidden).length > 0;
}

// Grows BRANCH_COUNT_MIN-MAX branches, each from its own slot of the map's
// width (the same slot-per-feature pattern pickSpawnFractions uses for
// worms) so they spread out rather than clumping. halfWidthFraction is the
// branch's own max wander, used to inset each slot's own [slotMin, slotMax]
// bounds - widening this would shrink every slot toward zero width at
// BRANCH_COUNT_MAX, so it stays narrow. Spawn-column safety instead gets its
// own wider spawnExclusionHalfWidthFraction (wander plus the branch's own
// worst-case painted radius - the cap's effective radius is smaller than
// this, so the base radius alone covers both body and cap), passed only to
// sampleExcludingSpawnColumns so it widens the spawn exclusion zone without
// touching slot sizing. Lakes are deliberately not excluded (a branch
// starting near a lake's shallow edge matches the reference art); building
// roofs are, via buildingColumnRanges, since a branch sprouting out of a
// flat roof would look artificial.
function applyBranches(mask: Uint8Array, width: number, height: number, spawnFractions: number[]): void {
  const count = randomInt(BRANCH_COUNT_MIN, BRANCH_COUNT_MAX);
  const halfWidthFraction = BRANCH_MAX_WANDER_FRACTION_OF_WIDTH;
  const spawnExclusionHalfWidthFraction = BRANCH_MAX_WANDER_FRACTION_OF_WIDTH + BRANCH_BASE_RADIUS_MAX_FRACTION;
  const slotFraction = 1 / count;
  const buildingForbidden = buildingColumnRanges(mask, width, height);

  for (let i = 0; i < count; i++) {
    const slotMin = i * slotFraction + halfWidthFraction;
    const slotMax = (i + 1) * slotFraction - halfWidthFraction;
    if (slotMin >= slotMax) continue; // slot too narrow for this map size - skip rather than sample garbage
    if (!hasSafeSpawnClearance(slotMin, slotMax, spawnExclusionHalfWidthFraction, spawnFractions)) continue;
    const startXFraction = sampleExcludingSpawnColumns(
      slotMin,
      slotMax,
      spawnExclusionHalfWidthFraction,
      spawnFractions,
      buildingForbidden,
    );
    applyBranch(mask, width, height, startXFraction);
  }
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
  applyBranches(mask, width, height, spawnFractions);
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
