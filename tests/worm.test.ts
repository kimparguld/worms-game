import { describe, it, expect } from 'vitest';
import {
  createWorm,
  takeDamage,
  adjustAim,
  updateWormPhysics,
  tickDeathAnimation,
  applyExplosionKnockback,
  applyDirectionalKnockback,
} from '../src/worm.js';
import { DEATH_ANIM_DURATION_MS, EXPLOSION_KNOCKBACK_PER_DAMAGE, WORM_MOVE_SPEED } from '../src/constants.js';
import { createTerrain } from '../src/terrain.js';
import type { Terrain, WormInput } from '../src/types.js';

function flatTerrain(width: number, height: number, groundY: number): Terrain {
  const terrain = createTerrain(width, height);
  terrain.mask.fill(0);
  terrain.decorationMask.fill(0);
  for (let x = 0; x < width; x++) {
    for (let y = groundY; y < height; y++) terrain.mask[y * width + x] = 1;
  }
  return terrain;
}

function slopedTerrain(width: number, height: number, startGroundY: number, slopePerX: number): Terrain {
  const terrain = createTerrain(width, height);
  terrain.mask.fill(0);
  terrain.decorationMask.fill(0);
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
  it('reduces HP without killing the worm while HP remains', () => {
    const worm = createWorm(0, 0, 'p1', 'A');
    takeDamage(worm, 30);
    expect(worm.hp).toBe(70);
    expect(worm.alive).toBe(true);
    expect(worm.dying).toBe(false);
  });

  it('starts the death animation at zero HP without marking the worm dead yet', () => {
    const worm = createWorm(0, 0, 'p1', 'A');
    takeDamage(worm, 100);
    expect(worm.hp).toBe(0);
    expect(worm.alive).toBe(true);
    expect(worm.dying).toBe(true);
    expect(worm.deathTimer).toBe(DEATH_ANIM_DURATION_MS);
  });

  it('ignores further damage once a worm is already dying', () => {
    const worm = createWorm(0, 0, 'p1', 'A');
    takeDamage(worm, 100);
    const timerAfterFirstHit = worm.deathTimer;
    takeDamage(worm, 50);
    expect(worm.deathTimer).toBe(timerAfterFirstHit);
  });
});

describe('tickDeathAnimation', () => {
  it('does nothing to a worm that is not dying', () => {
    const worm = createWorm(0, 0, 'p1', 'A');
    expect(tickDeathAnimation(worm, 500)).toBe(false);
    expect(worm.alive).toBe(true);
  });

  it('counts down the death timer without finalizing early', () => {
    const worm = createWorm(0, 0, 'p1', 'A');
    takeDamage(worm, 100);
    const finalized = tickDeathAnimation(worm, DEATH_ANIM_DURATION_MS - 100);
    expect(finalized).toBe(false);
    expect(worm.dying).toBe(true);
    expect(worm.alive).toBe(true);
    expect(worm.deathTimer).toBe(100);
  });

  it('finalizes death once the timer elapses', () => {
    const worm = createWorm(0, 0, 'p1', 'A');
    takeDamage(worm, 100);
    const finalized = tickDeathAnimation(worm, DEATH_ANIM_DURATION_MS);
    expect(finalized).toBe(true);
    expect(worm.dying).toBe(false);
    expect(worm.alive).toBe(false);
    expect(worm.deathTimer).toBeNull();
  });
});

describe('applyExplosionKnockback', () => {
  it('launches the worm upward proportional to the damage dealt', () => {
    const worm = createWorm(0, 0, 'p1', 'A');
    worm.vy = 0;
    applyExplosionKnockback(worm, 30);
    expect(worm.vy).toBeCloseTo(-30 * EXPLOSION_KNOCKBACK_PER_DAMAGE);
  });

  it('adds to any existing vertical velocity rather than replacing it', () => {
    const worm = createWorm(0, 0, 'p1', 'A');
    worm.vy = 50; // already falling
    applyExplosionKnockback(worm, 10);
    expect(worm.vy).toBeCloseTo(50 - 10 * EXPLOSION_KNOCKBACK_PER_DAMAGE);
  });

  it('knocks the worm airborne even if it was standing on the ground', () => {
    const worm = createWorm(0, 0, 'p1', 'A');
    worm.onGround = true;
    applyExplosionKnockback(worm, 20);
    expect(worm.onGround).toBe(false);
  });

  it('leaves horizontal velocity untouched (vx re-clamps every tick regardless of source)', () => {
    const worm = createWorm(0, 0, 'p1', 'A');
    worm.vx = 3;
    applyExplosionKnockback(worm, 40);
    expect(worm.vx).toBe(3);
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
    const input: WormInput = { left: false, right: false, jump: false };
    for (let i = 0; i < 200; i++) updateWormPhysics(worm, terrain, input, 1 / 60);
    expect(worm.onGround).toBe(true);
    expect(worm.vy).toBe(0);
    expect(worm.y).toBeLessThanOrEqual(80);
  });

  it('moves right when the right input is held', () => {
    const terrain = flatTerrain(200, 100, 80);
    const worm = createWorm(50, 79, 'p1', 'A');
    worm.onGround = true;
    const input: WormInput = { left: false, right: true, jump: false };
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
    const input: WormInput = { left: false, right: true, jump: false };
    const startX = worm.x;
    const dt = 1 / 60;
    for (let i = 0; i < 120; i++) updateWormPhysics(worm, terrain, input, dt); // 2 simulated seconds
    expect(worm.x - startX).toBeGreaterThan(50);
  });

  it('marks the worm dead when it falls below the world', () => {
    const terrain = createTerrain(100, 100);
    terrain.mask.fill(0);
    terrain.decorationMask.fill(0);
    const worm = createWorm(50, 0, 'p1', 'A');
    const input: WormInput = { left: false, right: false, jump: false };
    for (let i = 0; i < 300; i++) updateWormPhysics(worm, terrain, input, 1 / 60);
    expect(worm.alive).toBe(false);
  });
});

describe('applyDirectionalKnockback', () => {
  it('sets horizontal velocity in the given direction, a vertical lift, and starts the knockback timer', () => {
    const worm = createWorm(0, 0, 'p1', 'A');
    worm.onGround = true;
    applyDirectionalKnockback(worm, 1, 600, 200, 0.5);
    expect(worm.vx).toBe(600);
    expect(worm.vy).toBe(-200);
    expect(worm.onGround).toBe(false);
    expect(worm.knockbackTimer).toBe(0.5);
  });

  it('shoves in the negative direction when direction is -1', () => {
    const worm = createWorm(0, 0, 'p1', 'A');
    applyDirectionalKnockback(worm, -1, 600, 200, 0.5);
    expect(worm.vx).toBe(-600);
  });
});

describe('updateWormPhysics knockback', () => {
  it('ignores input and skips the usual vx clamp/decay while knocked back', () => {
    const terrain = flatTerrain(2000, 100, 90); // ground far below - worm stays airborne for the test window
    const worm = createWorm(500, 10, 'p1', 'A');
    applyDirectionalKnockback(worm, 1, 600, 0, 0.5);
    const input: WormInput = { left: true, right: false, jump: false }; // tries to fight the shove
    updateWormPhysics(worm, terrain, input, 1 / 60);
    expect(worm.vx).toBeCloseTo(600, 0); // not decayed by the usual 0.8 factor, not overridden by held-left input
  });

  it('resumes normal control and clamping once the knockback timer expires', () => {
    const terrain = flatTerrain(2000, 100, 90);
    const worm = createWorm(500, 10, 'p1', 'A');
    applyDirectionalKnockback(worm, 1, 600, 0, 0.05);
    const input: WormInput = { left: false, right: false, jump: false };
    updateWormPhysics(worm, terrain, input, 0.06); // outlasts the 0.05s knockback window
    expect(worm.knockbackTimer).toBeNull();
    expect(Math.abs(worm.vx)).toBeLessThanOrEqual(WORM_MOVE_SPEED);
  });
});
