import { describe, it, expect } from 'vitest';
import { fireRope, updateRopeSwing } from '../src/rope.js';
import { createTerrain } from '../src/terrain.js';
import { createWorm } from '../src/worm.js';

function ceilingTerrain(width, height, ceilingY) {
  const terrain = createTerrain(width, height);
  terrain.mask.fill(0);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y <= ceilingY; y++) terrain.mask[y * width + x] = 1;
  }
  return terrain;
}

describe('fireRope', () => {
  it('attaches to the first solid terrain point along the aim angle', () => {
    const terrain = ceilingTerrain(100, 100, 20);
    const result = fireRope(50, 50, -Math.PI / 2, terrain, 80);
    expect(result.attached).toBe(true);
    expect(result.anchorY).toBeCloseTo(20, 0);
  });

  it('fails to attach when nothing solid is in range', () => {
    const terrain = createTerrain(100, 100);
    terrain.mask.fill(0);
    const result = fireRope(50, 50, -Math.PI / 2, terrain, 30);
    expect(result.attached).toBe(false);
  });
});

describe('updateRopeSwing', () => {
  it('keeps the worm at a fixed distance from the anchor while swinging', () => {
    const worm = createWorm(50, 70, 'p1', 'A');
    const rope = { anchorX: 50, anchorY: 20, length: 50 };
    worm.vx = 20;
    for (let i = 0; i < 60; i++) updateRopeSwing(worm, rope, 1 / 60);
    const distance = Math.hypot(worm.x - rope.anchorX, worm.y - rope.anchorY);
    expect(distance).toBeCloseTo(rope.length, 0);
  });
});
