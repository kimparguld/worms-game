import { describe, it, expect } from 'vitest';
import { createTerrain, generateSilhouetteMask, isSolid, carveCircle, findSurfaceY } from '../src/terrain.js';

describe('generateSilhouetteMask', () => {
  it('produces empty sky in the upper region and solid ground in the lower region', () => {
    const width = 100, height = 100;
    const mask = generateSilhouetteMask(width, height);
    expect(mask.length).toBe(width * height);
    expect(mask[0 * width + 50]).toBe(0);
    // Checked across the whole row, not one fixed column: a lake or building
    // can legitimately leave any single column non-ground at this depth.
    let hasGroundAtRow85 = false;
    for (let x = 0; x < width; x++) {
      if (mask[85 * width + x] === 1) { hasGroundAtRow85 = true; break; }
    }
    expect(hasGroundAtRow85).toBe(true);
  });

  it('reserves the bottom band for water, regardless of the generated ground height', () => {
    const width = 100, height = 100;
    const mask = generateSilhouetteMask(width, height);
    for (let x = 0; x < width; x++) {
      expect(mask[(height - 1) * width + x]).toBe(0);
    }
  });
});

describe('generateSilhouetteMask cliffs', () => {
  // Repeated because the cliff rise is randomized and then clamped to the
  // ground-height cap: this asserts the clamp can never eat the whole rise.
  it('carves at least one near-vertical wall face for the ninja rope to grapple', () => {
    const width = 200, height = 200;
    for (let attempt = 0; attempt < 40; attempt++) {
      const mask = generateSilhouetteMask(width, height);
      let maxJump = 0;
      for (let x = 1; x < width; x++) {
        let prevHeight = 0;
        for (let y = 0; y < height; y++) {
          if (mask[y * width + (x - 1)] === 1) { prevHeight = height - y; break; }
        }
        let curHeight = 0;
        for (let y = 0; y < height; y++) {
          if (mask[y * width + x] === 1) { curHeight = height - y; break; }
        }
        maxJump = Math.max(maxJump, Math.abs(curHeight - prevHeight));
      }
      expect(maxJump).toBeGreaterThan(height * 0.15);
    }
  });
});

describe('generateSilhouetteMask mountains', () => {
  it('produces a different silhouette on repeated calls (randomized, not fixed)', () => {
    const width = 300, height = 200;
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

describe('generateSilhouetteMask height budget', () => {
  // Nothing may reach the top of the screen: a cliff or building clipped by
  // the top edge looks broken, and a worm spawned on one lands behind the HUD.
  // The code's documented budget guarantees clear space up to y = 0.20 *
  // height (see the comment atop terrain.ts); this pins that to 0.19 rather
  // than a looser 0.15, leaving only a hair of margin for float rounding, so
  // a regression that eats into the true 0.20 budget doesn't pass unnoticed.
  it('never puts solid terrain in the top 19% of the screen', () => {
    const width = 300, height = 200;
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
  // The four worm spawn X columns are fixed in matchLoop.ts's
  // createMatchRuntime (150, 200, 760, 810 at the game's real 960x540
  // resolution). Neither a cliff nor a building may ever land on or hug one
  // of these columns: a building would put mask value 2 (not walkable
  // ground) at the spawn point, and a cliff face landing there would wall a
  // worm in on one side, or leave a bare pixel-thin ledge to spawn on.
  it('never puts a cliff face or a building at any of the four spawn X columns', () => {
    const width = 960, height = 540;
    const spawnColumns = [150, 200, 760, 810];
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
      const mask = generateSilhouetteMask(width, height);
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

describe('isSolid', () => {
  it('returns true where the mask is non-zero (ground or building)', () => {
    const terrain = createTerrain(10, 10);
    terrain.mask.fill(0);
    terrain.mask[5 * 10 + 5] = 1;
    expect(isSolid(terrain, 5, 5)).toBe(true);
    expect(isSolid(terrain, 6, 5)).toBe(false);
  });

  it('treats mask value 2 (building) as solid too', () => {
    const terrain = createTerrain(10, 10);
    terrain.mask.fill(0);
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
    const width = 50, height = 50, groundY = 30;
    const terrain = createTerrain(width, height);
    terrain.mask.fill(0);
    for (let x = 0; x < width; x++) {
      for (let y = groundY; y < height; y++) terrain.mask[y * width + x] = 1;
    }
    expect(findSurfaceY(terrain, 25)).toBe(groundY);
  });

  it('returns terrain.height when the column is never solid (e.g. a carved hole)', () => {
    const terrain = createTerrain(20, 20);
    terrain.mask.fill(0);
    expect(findSurfaceY(terrain, 10)).toBe(terrain.height);
  });
});

describe('generateSilhouetteMask always has two cliffs', () => {
  it('carves two separated near-vertical wall faces, not just one', () => {
    const width = 200, height = 200;
    for (let attempt = 0; attempt < 40; attempt++) {
      const mask = generateSilhouetteMask(width, height);
      const jumps: number[] = [];
      let prevHeight = 0;
      for (let y = 0; y < height; y++) { if (mask[y * width + 0] === 1) { prevHeight = height - y; break; } }
      for (let x = 1; x < width; x++) {
        let curHeight = 0;
        for (let y = 0; y < height; y++) { if (mask[y * width + x] === 1) { curHeight = height - y; break; } }
        if (Math.abs(curHeight - prevHeight) > height * 0.15) jumps.push(x);
        prevHeight = curHeight;
      }
      // The two cliffs are sampled from disjoint fraction ranges (0.15-0.45
      // and 0.55-0.85), fully on either side of the map's midpoint, so a
      // jump found in each half confirms two distinct walls rather than one
      // wall's two edges (which sit only CLIFF_WIDTH_FRACTION apart, well
      // within one half).
      const leftHalfJump = jumps.some((x) => x < width * 0.5);
      const rightHalfJump = jumps.some((x) => x >= width * 0.5);
      expect(leftHalfJump).toBe(true);
      expect(rightHalfJump).toBe(true);
    }
  });
});

describe('generateSilhouetteMask has more buildings', () => {
  it('marks at least 3 separate building spans across a handful of attempts', () => {
    const width = 300, height = 200;
    let sawThreeOrMoreBuildings = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const mask = generateSilhouetteMask(width, height);
      let spans = 0;
      let inSpan = false;
      for (let x = 0; x < width; x++) {
        let isBuilding = false;
        for (let y = 0; y < height; y++) { if (mask[y * width + x] === 2) { isBuilding = true; break; } }
        if (isBuilding && !inSpan) spans++;
        inSpan = isBuilding;
      }
      if (spans >= 3) sawThreeOrMoreBuildings = true;
    }
    expect(sawThreeOrMoreBuildings).toBe(true);
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
