import { describe, it, expect } from 'vitest';
import { fireRope, updateRopeSwing, adjustRopeLength } from '../src/rope.js';
import { createTerrain } from '../src/terrain.js';
import { createWorm } from '../src/worm.js';
import { ROPE_MIN_LENGTH, ROPE_MAX_LENGTH } from '../src/constants.js';
import type { Rope } from '../src/types.js';

function ceilingTerrain(width: number, height: number, ceilingY: number) {
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

  it('does not attach at zero length when the worm starts inside terrain', () => {
    const terrain = ceilingTerrain(100, 100, 50);
    const result = fireRope(50, 50, -Math.PI / 2, terrain, 30);

    expect(result.attached).toBe(false);
  });
});

describe('updateRopeSwing', () => {
  it('leaves the worm in a valid position when a rope is attached at zero length', () => {
    const terrain = createTerrain(100, 100);
    terrain.mask.fill(0);
    const worm = createWorm(50, 50, 'p1', 'Alice');
    const rope: Rope = { attached: true, anchorX: 50, anchorY: 50, length: 0 };

    updateRopeSwing(worm, rope, 1 / 60, terrain);

    expect(Number.isFinite(worm.x)).toBe(true);
    expect(Number.isFinite(worm.y)).toBe(true);
  });

  it('keeps the worm at a fixed distance from the anchor while swinging', () => {
    const terrain = createTerrain(200, 200);
    terrain.mask.fill(0); // open air - nothing for the swing to collide with
    const worm = createWorm(50, 70, 'p1', 'A');
    const rope: Rope = { attached: true, anchorX: 50, anchorY: 20, length: 50 };
    worm.vx = 20;
    for (let i = 0; i < 60; i++) updateRopeSwing(worm, rope, 1 / 60, terrain);
    const distance = Math.hypot(worm.x - rope.anchorX!, worm.y - rope.anchorY!);
    expect(distance).toBeCloseTo(rope.length, 0);
  });

  it('stops the swing instead of carrying the worm into solid terrain', () => {
    const terrain = ceilingTerrain(100, 100, 20); // solid from y=0 to y=20
    // Anchored close enough to the ceiling (length 25 reaches up to y=15,
    // inside the solid band) that a hard swing carries the worm's computed
    // position up into it within a single step.
    const worm = createWorm(50, 65, 'p1', 'A');
    const rope: Rope = { attached: true, anchorX: 50, anchorY: 40, length: 25 };
    worm.vx = 5000;

    updateRopeSwing(worm, rope, 1 / 60, terrain);

    expect(terrain.mask[Math.round(worm.y) * 100 + Math.round(worm.x)]).toBe(0);
    expect(worm.vx).toBe(0);
    expect(worm.vy).toBe(0);
  });
});

describe('adjustRopeLength', () => {
  it('shortens the rope when given a negative direction (reeling in)', () => {
    const rope: Rope = { attached: true, anchorX: 50, anchorY: 20, length: 100 };
    adjustRopeLength(rope, -1, 1);
    expect(rope.length).toBeLessThan(100);
  });

  it('lengthens the rope when given a positive direction (paying out)', () => {
    const rope: Rope = { attached: true, anchorX: 50, anchorY: 20, length: 100 };
    adjustRopeLength(rope, 1, 1);
    expect(rope.length).toBeGreaterThan(100);
  });

  it('does not shorten the rope past the minimum length', () => {
    const rope: Rope = { attached: true, anchorX: 50, anchorY: 20, length: ROPE_MIN_LENGTH + 1 };
    adjustRopeLength(rope, -1, 10);
    expect(rope.length).toBe(ROPE_MIN_LENGTH);
  });

  it('does not lengthen the rope past the maximum length', () => {
    const rope: Rope = { attached: true, anchorX: 50, anchorY: 20, length: ROPE_MAX_LENGTH - 1 };
    adjustRopeLength(rope, 1, 10);
    expect(rope.length).toBe(ROPE_MAX_LENGTH);
  });
});
