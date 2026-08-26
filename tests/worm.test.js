import { describe, it, expect } from 'vitest';
import { createWorm, takeDamage, adjustAim, updateWormPhysics } from '../src/worm.js';
import { createTerrain } from '../src/terrain.js';

function flatTerrain(width, height, groundY) {
  const terrain = createTerrain(width, height);
  terrain.mask.fill(0);
  for (let x = 0; x < width; x++) {
    for (let y = groundY; y < height; y++) terrain.mask[y * width + x] = 1;
  }
  return terrain;
}

function slopedTerrain(width, height, startGroundY, slopePerX) {
  const terrain = createTerrain(width, height);
  terrain.mask.fill(0);
  for (let x = 0; x < width; x++) {
    const groundY = Math.max(0, Math.min(height, Math.round(startGroundY - x * slopePerX)));
    for (let y = groundY; y < height; y++) terrain.mask[y * width + x] = 1;
  }
  return terrain;
}

describe('createWorm', () => {
  it('starts alive at 100 HP facing right', () => {
    const worm = createWorm(50, 50, 'p1', 'Alice');
    expect(worm.hp).toBe(100);
    expect(worm.alive).toBe(true);
    expect(worm.facing).toBe(1);
  });
});

describe('takeDamage', () => {
  it('reduces HP and kills the worm at zero', () => {
    const worm = createWorm(0, 0, 'p1', 'A');
    takeDamage(worm, 30);
    expect(worm.hp).toBe(70);
    expect(worm.alive).toBe(true);
    takeDamage(worm, 100);
    expect(worm.hp).toBe(0);
    expect(worm.alive).toBe(false);
  });
});

describe('adjustAim', () => {
  it('clamps aim angle to +/- 90 degrees', () => {
    const worm = createWorm(0, 0, 'p1', 'A');
    worm.aimAngle = 0;
    adjustAim(worm, 1, 10);
    expect(worm.aimAngle).toBeCloseTo(Math.PI / 2);
    adjustAim(worm, -1, 10);
    expect(worm.aimAngle).toBeCloseTo(-Math.PI / 2);
  });
});

describe('updateWormPhysics', () => {
  it('applies gravity and lands the worm on flat ground', () => {
    const terrain = flatTerrain(100, 100, 80);
    const worm = createWorm(50, 50, 'p1', 'A');
    const input = { left: false, right: false, jump: false };
    for (let i = 0; i < 200; i++) updateWormPhysics(worm, terrain, input, 1 / 60);
    expect(worm.onGround).toBe(true);
    expect(worm.vy).toBe(0);
    expect(worm.y).toBeLessThanOrEqual(80);
  });

  it('moves right when the right input is held', () => {
    const terrain = flatTerrain(200, 100, 80);
    const worm = createWorm(50, 79, 'p1', 'A');
    worm.onGround = true;
    const input = { left: false, right: true, jump: false };
    const startX = worm.x;
    for (let i = 0; i < 30; i++) updateWormPhysics(worm, terrain, input, 1 / 60);
    expect(worm.x).toBeGreaterThan(startX);
  });

  it('climbs a sloped surface instead of getting stuck (step-up allowance)', () => {
    // Ground rises gently (~1px per 10px of x) as x increases -- a walkable slope,
    // not a wall. Start the worm resting on the slope and hold right for a couple
    // of simulated seconds.
    const width = 400, height = 200;
    const terrain = slopedTerrain(width, height, 150, 0.1);
    const worm = createWorm(20, 148, 'p1', 'A');
    worm.onGround = true;
    const input = { left: false, right: true, jump: false };
    const startX = worm.x;
    const dt = 1 / 60;
    for (let i = 0; i < 120; i++) updateWormPhysics(worm, terrain, input, dt); // 2 simulated seconds
    expect(worm.x - startX).toBeGreaterThan(50);
  });

  it('marks the worm dead when it falls below the world', () => {
    const terrain = createTerrain(100, 100);
    terrain.mask.fill(0);
    const worm = createWorm(50, 0, 'p1', 'A');
    const input = { left: false, right: false, jump: false };
    for (let i = 0; i < 300; i++) updateWormPhysics(worm, terrain, input, 1 / 60);
    expect(worm.alive).toBe(false);
  });
});
