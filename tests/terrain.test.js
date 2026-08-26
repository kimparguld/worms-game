// tests/terrain.test.js
import { describe, it, expect } from 'vitest';
import { createTerrain, generateSilhouetteMask, isSolid, carveCircle } from '../src/terrain.js';

describe('generateSilhouetteMask', () => {
  it('produces empty sky in the upper region and solid ground in the lower region', () => {
    const width = 100, height = 100;
    const mask = generateSilhouetteMask(width, height);
    expect(mask.length).toBe(width * height);
    expect(mask[0 * width + 50]).toBe(0);
    expect(mask[(height - 1) * width + 50]).toBe(1);
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

describe('carveCircle', () => {
  it('clears a circular region of the mask to empty', () => {
    const terrain = createTerrain(20, 20);
    terrain.mask.fill(1);
    carveCircle(terrain, 10, 10, 3);
    expect(isSolid(terrain, 10, 10)).toBe(false);
    expect(isSolid(terrain, 0, 0)).toBe(true);
  });
});
