import { describe, it, expect } from 'vitest';
import { createTerrain, generateSilhouetteMask, isSolid, carveCircle, findSurfaceY } from '../src/terrain.js';

describe('generateSilhouetteMask', () => {
  it('produces empty sky in the upper region and solid ground in the lower region', () => {
    const width = 100, height = 100;
    const mask = generateSilhouetteMask(width, height);
    expect(mask.length).toBe(width * height);
    expect(mask[0 * width + 50]).toBe(0);
    expect(mask[(height - 1) * width + 50]).toBe(1);
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
  it('never puts solid terrain in the top 15% of the screen', () => {
    const width = 300, height = 200;
    for (let attempt = 0; attempt < 40; attempt++) {
      const mask = generateSilhouetteMask(width, height);
      const clearRows = Math.floor(height * 0.15);
      let solidInClearZone = 0;
      for (let i = 0; i < clearRows * width; i++) {
        if (mask[i] !== 0) solidInClearZone++;
      }
      expect(solidInClearZone).toBe(0);
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

describe('carveCircle', () => {
  it('clears a circular region of the mask to empty', () => {
    const terrain = createTerrain(20, 20);
    terrain.mask.fill(1);
    carveCircle(terrain, 10, 10, 3);
    expect(isSolid(terrain, 10, 10)).toBe(false);
    expect(isSolid(terrain, 0, 0)).toBe(true);
  });
});
