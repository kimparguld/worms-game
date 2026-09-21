import { describe, it, expect } from 'vitest';
import { createTerrain, generateSilhouetteMask, isSolid, carveCircle, findSurfaceY } from '../src/terrain.js';

describe('generateSilhouetteMask', () => {
  it('produces empty sky in the upper region and solid ground in the lower region', () => {
    const width = 100,
      height = 100;
    const mask = generateSilhouetteMask(width, height);
    expect(mask.length).toBe(width * height);
    expect(mask[0 * width + 50]).toBe(0);
    // Checked across the whole row, not one fixed column: a lake or building
    // can legitimately leave any single column non-ground at this depth.
    let hasGroundAtRow85 = false;
    for (let x = 0; x < width; x++) {
      if (mask[85 * width + x] === 1) {
        hasGroundAtRow85 = true;
        break;
      }
    }
    expect(hasGroundAtRow85).toBe(true);
  });

  it('reserves the bottom band for water, regardless of the generated ground height', () => {
    const width = 100,
      height = 100;
    const mask = generateSilhouetteMask(width, height);
    for (let x = 0; x < width; x++) {
      expect(mask[(height - 1) * width + x]).toBe(0);
    }
  });
});

describe('generateSilhouetteMask branches', () => {
  it('carves at least one near-vertical wall face for the ninja rope to grapple', () => {
    const width = 200,
      height = 200;
    for (let attempt = 0; attempt < 40; attempt++) {
      const mask = generateSilhouetteMask(width, height);
      let maxJump = 0;
      for (let x = 1; x < width; x++) {
        let prevHeight = 0;
        for (let y = 0; y < height; y++) {
          if (mask[y * width + (x - 1)] === 1) {
            prevHeight = height - y;
            break;
          }
        }
        let curHeight = 0;
        for (let y = 0; y < height; y++) {
          if (mask[y * width + x] === 1) {
            curHeight = height - y;
            break;
          }
        }
        maxJump = Math.max(maxJump, Math.abs(curHeight - prevHeight));
      }
      expect(maxJump).toBeGreaterThan(height * 0.15);
    }
  });

  it('spreads branches across the map: at least 2 distinct wall clusters show up in some attempt', () => {
    const width = 300,
      height = 200;
    // Wide enough to fold a single branch's own left/right edges (bounded by
    // its max sideways wander plus its own radius, see
    // BRANCH_MAX_WANDER_FRACTION_OF_WIDTH in terrain.ts) into one cluster,
    // but narrower than the gap between two different branches, which
    // applyBranches keeps in separate 1/count-wide slots across the map.
    const clusterWindow = width * 0.15;
    let sawTwoOrMoreClusters = false;
    for (let attempt = 0; attempt < 40 && !sawTwoOrMoreClusters; attempt++) {
      const mask = generateSilhouetteMask(width, height);
      const jumpXs: number[] = [];
      let prevHeight = 0;
      for (let y = 0; y < height; y++) {
        if (mask[y * width + 0] === 1) {
          prevHeight = height - y;
          break;
        }
      }
      for (let x = 1; x < width; x++) {
        let curHeight = 0;
        for (let y = 0; y < height; y++) {
          if (mask[y * width + x] === 1) {
            curHeight = height - y;
            break;
          }
        }
        if (Math.abs(curHeight - prevHeight) > height * 0.15) jumpXs.push(x);
        prevHeight = curHeight;
      }
      const clusters: number[] = [];
      for (const x of jumpXs) {
        if (clusters.length === 0 || x - clusters[clusters.length - 1] > clusterWindow) clusters.push(x);
      }
      if (clusters.length >= 2) sawTwoOrMoreClusters = true;
    }
    expect(sawTwoOrMoreClusters).toBe(true);
  });

  it('never lands a branch cap above the shared top-clearance line', () => {
    const width = 200,
      height = 200;
    for (let attempt = 0; attempt < 40; attempt++) {
      const mask = generateSilhouetteMask(width, height);
      const clearRows = Math.floor(height * 0.19);
      for (let i = 0; i < clearRows * width; i++) {
        expect(mask[i]).toBe(0);
      }
    }
  });
});

describe('generateSilhouetteMask mountains', () => {
  it('produces a different silhouette on repeated calls (randomized, not fixed)', () => {
    const width = 300,
      height = 200;
    const maskA = generateSilhouetteMask(width, height);
    const maskB = generateSilhouetteMask(width, height);
    let differences = 0;
    for (let i = 0; i < maskA.length; i++) {
      if (maskA[i] !== maskB[i]) differences++;
    }
    expect(differences).toBeGreaterThan(0);
  });
});

describe('generateSilhouetteMask buildings', () => {
  it('marks at least one column as building material (mask value 2)', () => {
    const mask = generateSilhouetteMask(300, 200);
    expect(Array.from(mask)).toContain(2);
  });
});

describe('generateSilhouetteMask floating islands', () => {
  it('produces at least one column with a solid island above open sky above the main terrain', () => {
    const width = 300,
      height = 200;
    let sawFloatingIsland = false;
    for (let attempt = 0; attempt < 40 && !sawFloatingIsland; attempt++) {
      const mask = generateSilhouetteMask(width, height);
      for (let x = 0; x < width && !sawFloatingIsland; x++) {
        let sawSolid = false;
        let sawGapAfterSolid = false;
        for (let y = 0; y < height; y++) {
          const solid = mask[y * width + x] !== 0;
          if (solid && !sawSolid) sawSolid = true;
          else if (!solid && sawSolid) sawGapAfterSolid = true;
          else if (solid && sawGapAfterSolid) sawFloatingIsland = true;
        }
      }
    }
    expect(sawFloatingIsland).toBe(true);
  });

  it('never places a floating island in the top clearance zone', () => {
    const width = 300,
      height = 200;
    for (let attempt = 0; attempt < 40; attempt++) {
      const mask = generateSilhouetteMask(width, height);
      const clearRows = Math.floor(height * 0.19);
      for (let i = 0; i < clearRows * width; i++) {
        expect(mask[i]).toBe(0);
      }
    }
  });
});

describe('generateSilhouetteMask height budget', () => {
  // Nothing may reach the top of the screen: a cliff or building clipped by
  // the top edge looks broken, and a worm spawned on one lands behind the HUD.
  // The code's documented budget guarantees clear space up to y = 0.20 *
  // height (see the comment atop terrain.ts); this pins that to 0.19 rather
  // than a looser 0.15, leaving only a hair of margin for float rounding, so
  // a regression that eats into the true 0.20 budget doesn't pass unnoticed.
  it('never puts solid terrain in the top 19% of the screen', () => {
    const width = 300,
      height = 200;
    for (let attempt = 0; attempt < 40; attempt++) {
      const mask = generateSilhouetteMask(width, height);
      const clearRows = Math.floor(height * 0.19);
      let solidInClearZone = 0;
      for (let i = 0; i < clearRows * width; i++) {
        if (mask[i] !== 0) solidInClearZone++;
      }
      expect(solidInClearZone).toBe(0);
    }
  });
});

describe('generateSilhouetteMask spawn columns', () => {
  // Spawn columns are randomized per match (see terrain.ts's
  // pickSpawnFractions), but generateSilhouetteMask still accepts an
  // explicit set so this can pin down a fixed set of columns and assert the
  // exclusion guarantee holds for whatever columns it's given. Neither a
  // cliff nor a building may ever land on or hug one of these columns: a
  // building would put mask value 2 (not walkable ground) at the spawn
  // point, and a cliff face landing there would wall a worm in on one side,
  // or leave a bare pixel-thin ledge to spawn on.
  it('never puts a cliff face or a building at any of the four spawn X columns', () => {
    const width = 960,
      height = 540;
    const spawnColumns = [150, 200, 760, 810];
    const spawnFractions = spawnColumns.map((x) => x / width);
    // Natural mountain terrain is smooth sine-wave silhouette: adjacent
    // columns shift by a couple of pixels at most. A cliff, by contrast, is
    // required elsewhere in this file to jump by at least 0.15 * height. Use
    // a bound well below that (but comfortably above the natural slope) so
    // this only trips on an actual cliff face landing on the spawn column.
    const maxNaturalSlope = height * 0.05;

    function surfaceHeightAndMask(mask: Uint8Array, x: number): { height: number; maskValue: number } {
      for (let y = 0; y < height; y++) {
        const value = mask[y * width + x];
        if (value !== 0) return { height: height - y, maskValue: value };
      }
      return { height: 0, maskValue: 0 };
    }

    for (let attempt = 0; attempt < 40; attempt++) {
      const mask = generateSilhouetteMask(width, height, spawnFractions);
      for (const x of spawnColumns) {
        const here = surfaceHeightAndMask(mask, x);
        expect(here.maskValue).toBe(1); // never building material (2) at a spawn column

        const left = surfaceHeightAndMask(mask, x - 1);
        const right = surfaceHeightAndMask(mask, x + 1);
        expect(Math.abs(here.height - left.height)).toBeLessThan(maxNaturalSlope);
        expect(Math.abs(here.height - right.height)).toBeLessThan(maxNaturalSlope);
      }
    }
  });
});

describe('createTerrain honors its own random spawn columns even under lake pressure', () => {
  // Regression coverage for the two-tier fallback in
  // sampleExcludingSpawnColumns: now that spawn columns are randomized
  // across the whole map (see pickSpawnFractions) instead of two fixed
  // pairs near the edges, their exclusion zones can combine with a lake's to
  // leave no position that satisfies both. When that happens, the harder
  // guarantee below (never on a spawn column) must still hold - it's the
  // softer lake-depth guarantee (see the "building depth" describe block)
  // that's allowed to give way instead.
  it('never leaves a spawn column covered by a building or hugged by a cliff face, across many random layouts', () => {
    const width = 300,
      height = 200;
    const maxNaturalSlope = height * 0.05;

    function surfaceHeightAndMask(mask: Uint8Array, x: number): { height: number; maskValue: number } {
      for (let y = 0; y < height; y++) {
        const value = mask[y * width + x];
        if (value !== 0) return { height: height - y, maskValue: value };
      }
      return { height: 0, maskValue: 0 };
    }

    for (let attempt = 0; attempt < 60; attempt++) {
      const terrain = createTerrain(width, height);
      for (const fraction of terrain.spawnFractions) {
        const x = Math.round(fraction * width);
        const here = surfaceHeightAndMask(terrain.mask, x);
        expect(here.maskValue).toBe(1);
        const left = surfaceHeightAndMask(terrain.mask, Math.max(0, x - 1));
        const right = surfaceHeightAndMask(terrain.mask, Math.min(width - 1, x + 1));
        expect(Math.abs(here.height - left.height)).toBeLessThan(maxNaturalSlope);
        expect(Math.abs(here.height - right.height)).toBeLessThan(maxNaturalSlope);
      }
    }
  });
});

describe('isSolid', () => {
  it('returns true where the mask is non-zero (ground or building)', () => {
    const terrain = createTerrain(10, 10);
    terrain.mask.fill(0);
    terrain.decorationMask.fill(0);
    terrain.mask[5 * 10 + 5] = 1;
    expect(isSolid(terrain, 5, 5)).toBe(true);
    expect(isSolid(terrain, 6, 5)).toBe(false);
  });

  it('treats mask value 2 (building) as solid too', () => {
    const terrain = createTerrain(10, 10);
    terrain.mask.fill(0);
    terrain.decorationMask.fill(0);
    terrain.mask[5 * 10 + 5] = 2;
    expect(isSolid(terrain, 5, 5)).toBe(true);
  });

  it('treats out-of-bounds coordinates as not solid', () => {
    const terrain = createTerrain(10, 10);
    expect(isSolid(terrain, -1, 5)).toBe(false);
    expect(isSolid(terrain, 5, 100)).toBe(false);
  });
});

describe('findSurfaceY', () => {
  it('returns the known ground height for flat terrain', () => {
    const width = 50,
      height = 50,
      groundY = 30;
    const terrain = createTerrain(width, height);
    terrain.mask.fill(0);
    terrain.decorationMask.fill(0);
    for (let x = 0; x < width; x++) {
      for (let y = groundY; y < height; y++) terrain.mask[y * width + x] = 1;
    }
    expect(findSurfaceY(terrain, 25)).toBe(groundY);
  });

  it('returns terrain.height when the column is never solid (e.g. a carved hole)', () => {
    const terrain = createTerrain(20, 20);
    terrain.mask.fill(0);
    terrain.decorationMask.fill(0);
    expect(findSurfaceY(terrain, 10)).toBe(terrain.height);
  });

  it('finds the nearest solid row at or below a given start row, not the world-topmost one - a tunnel dug under an overhang (e.g. a building) has its own floor below the overhang, not at the overhang itself', () => {
    const width = 10,
      height = 40;
    const terrain = createTerrain(width, height);
    terrain.mask.fill(0);
    terrain.decorationMask.fill(0);
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < 5; y++) terrain.mask[y * width + x] = 1; // overhang/building roof, rows 0-4
      for (let y = 25; y < height; y++) terrain.mask[y * width + x] = 1; // tunnel floor, rows 25+
      // rows 5-24 are the dug-out tunnel: open air
    }
    expect(findSurfaceY(terrain, 5)).toBe(0); // default: topmost surface in the column
    expect(findSurfaceY(terrain, 5, 12)).toBe(25); // starting inside the tunnel: its own floor, not the roof above
  });
});

describe('generateSilhouetteMask building depth', () => {
  // A building's facade is drawn down to its own column's natural
  // (pre-building) ground height. That can legitimately go quite deep when a
  // building straddles one of the map's cliffs - but never past the
  // mountain's own worst-case natural trough (MOUNTAIN_BASE_FRACTION minus
  // every octave's max amplitude in terrain.ts, ~0.15 of the height), since
  // cliffs only ever raise ground, never lower it. A lake is the one thing
  // that lowers ground further, down to ~0.05 near the water line - if a
  // building's footprint ever overlapped one, its facade for that column
  // would stretch almost down to the water line instead: a visible "spike"
  // of building texture cutting deep into what should be plain dirt. This
  // pins the boundary between those two cases (0.12, comfortably between the
  // lake's ~0.05 and the mountain's ~0.15) to catch a regression in
  // pickBuildingStartX's lake exclusion without flagging the legitimate
  // cliff case.
  // Pins an explicit, clustered-near-the-edges spawnFractions set (the same
  // shape the old fixed SPAWN_EXCLUSION_FRACTIONS used) rather than relying
  // on the default random pickSpawnFractions(): this test is specifically
  // about pickBuildingStartX's lake exclusion, a separate concern from
  // where spawn columns land (covered by the "spawn columns" describe block
  // above). With spawn columns now randomized across the *whole* map, they
  // can occasionally spread widely enough to combine with a lake's own
  // exclusion zone and leave no position that satisfies both - when that
  // happens, sampleExcludingSpawnColumns deliberately keeps the harder
  // guarantee (never on a spawn column) and lets this softer one slip
  // instead (see its own comment), which would make this assertion flaky
  // under the default random spawn layout without saying anything new about
  // lake exclusion itself.
  it('never draws a building facade down into lake-depth territory', () => {
    const width = 300,
      height = 200;
    const spawnFractions = [150, 200, 760, 810].map((x) => x / 960);
    const deepestAllowedRow = height * (1 - 0.12);
    for (let attempt = 0; attempt < 60; attempt++) {
      const mask = generateSilhouetteMask(width, height, spawnFractions);
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          if (mask[y * width + x] === 2) {
            expect(y).toBeLessThan(deepestAllowedRow);
          }
        }
      }
    }
  });
});

describe('generateSilhouetteMask has more buildings', () => {
  it('marks at least 3 separate building spans across a handful of attempts', () => {
    const width = 300,
      height = 200;
    let sawThreeOrMoreBuildings = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const mask = generateSilhouetteMask(width, height);
      let spans = 0;
      let inSpan = false;
      for (let x = 0; x < width; x++) {
        let isBuilding = false;
        for (let y = 0; y < height; y++) {
          if (mask[y * width + x] === 2) {
            isBuilding = true;
            break;
          }
        }
        if (isBuilding && !inSpan) spans++;
        inSpan = isBuilding;
      }
      if (spans >= 3) sawThreeOrMoreBuildings = true;
    }
    expect(sawThreeOrMoreBuildings).toBe(true);
  });
});

describe('createTerrain spawn/decoration metadata', () => {
  it('picks 4 spawn fractions spread across the map, clear of the edges', () => {
    const terrain = createTerrain(960, 540);
    expect(terrain.spawnFractions).toHaveLength(4);
    for (const f of terrain.spawnFractions) {
      expect(f).toBeGreaterThan(0.05);
      expect(f).toBeLessThan(0.95);
    }
  });

  it('varies the spawn fractions across matches (not a fixed layout)', () => {
    const a = createTerrain(960, 540).spawnFractions;
    const b = createTerrain(960, 540).spawnFractions;
    expect(a).not.toEqual(b);
  });

  it('picks one of the three ground texture keys', () => {
    const terrain = createTerrain(960, 540);
    expect(['terrain_ground', 'terrain_ground_2', 'terrain_ground_3']).toContain(terrain.groundTextureKey);
  });

  it('scatters at least a few decorations, all within bounds and off building roofs', () => {
    // Counts are deliberately light (halved from this feature's first pass -
    // see terrainDecorations.ts's CATEGORIES) since each one is now a solid
    // obstacle, not just cosmetic - so this only checks that scattering
    // reliably places *something*, not a specific density.
    const terrain = createTerrain(960, 540);
    expect(terrain.decorations.length).toBeGreaterThan(0);
    for (const d of terrain.decorations) {
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x).toBeLessThanOrEqual(terrain.width);
      expect(d.scale).toBeGreaterThan(0);
      const column = Math.max(0, Math.min(terrain.width - 1, Math.round(d.x)));
      expect(terrain.mask[d.y * terrain.width + column]).toBe(1);
    }
  });

  it('stamps a decorationMask footprint above the surface under each decoration, so it is a real climbable/diggable obstacle - without touching the ground mask itself', () => {
    const terrain = createTerrain(960, 540);
    expect(terrain.decorations.length).toBeGreaterThan(0);
    for (const d of terrain.decorations) {
      const column = Math.max(0, Math.min(terrain.width - 1, Math.round(d.x)));
      // The row immediately above the original ground surface should now be
      // solid in decorationMask - stampFootprint always raises at least a
      // little collision at a decoration's own anchor column (its
      // footprint's tallest point) - but the ground's own mask is never
      // touched by a decoration (see Terrain.decorationMask's comment).
      expect(terrain.decorationMask[(d.y - 1) * terrain.width + column]).not.toBe(0);
      expect(terrain.mask[(d.y - 1) * terrain.width + column]).toBe(0);
      expect(isSolid(terrain, column, d.y - 1)).toBe(true);
    }
  });

  it('keeps decorations clear of every spawn column', () => {
    const terrain = createTerrain(960, 540);
    const spawnColumnsPx = terrain.spawnFractions.map((f) => f * terrain.width);
    for (const d of terrain.decorations) {
      for (const spawnX of spawnColumnsPx) {
        expect(Math.abs(d.x - spawnX)).toBeGreaterThan(40);
      }
    }
  });
});

describe('carveCircle', () => {
  it('clears a circular region of the mask to empty', () => {
    const terrain = createTerrain(20, 20);
    terrain.mask.fill(1);
    carveCircle(terrain, 10, 10, 3);
    expect(isSolid(terrain, 10, 10)).toBe(false);
    expect(isSolid(terrain, 0, 0)).toBe(true);
  });
});
