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
  it('carves at least one near-vertical wall face for the ninja rope to grapple', () => {
    const width = 200, height = 200;
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
  });
});

describe('isSolid', () => {
  it('returns true only where the mask is 1', () => {
    const terrain = createTerrain(10, 10);
    terrain.mask.fill(0);
    terrain.mask[5 * 10 + 5] = 1;
    expect(isSolid(terrain, 5, 5)).toBe(true);
    expect(isSolid(terrain, 6, 5)).toBe(false);
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
