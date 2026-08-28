import { describe, expect, it } from 'vitest';
import { aimWormAtPoint } from '../src/mobile.js';
import { createWorm } from '../src/worm.js';

describe('aimWormAtPoint', () => {
  it('faces right and aims upward toward a right-side target', () => {
    const worm = createWorm(100, 100, 'p1', 'A');

    aimWormAtPoint(worm, 150, 50);

    expect(worm.facing).toBe(1);
    expect(worm.aimAngle).toBeLessThan(0);
  });

  it('faces left while preserving the upward launch angle for a left-side target', () => {
    const worm = createWorm(100, 100, 'p1', 'A');

    aimWormAtPoint(worm, 50, 50);

    expect(worm.facing).toBe(-1);
    expect(worm.aimAngle).toBeCloseTo(-Math.PI / 4);
  });
});
