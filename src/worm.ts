import { isSolid } from './terrain.js';
import {
  GRAVITY, WORM_MOVE_ACCEL, WORM_MOVE_SPEED, JUMP_IMPULSE,
  FALL_DAMAGE_VELOCITY_THRESHOLD, FALL_DAMAGE_PER_VELOCITY, STARTING_HP,
  WORM_STEP_HEIGHT, DEATH_ANIM_DURATION_MS,
} from './constants.js';
import type { Terrain, Worm, WormInput } from './types.js';

export function createWorm(x: number, y: number, team: string, name: string): Worm {
  return {
    x, y, vx: 0, vy: 0, hp: STARTING_HP, team, name,
    facing: 1, aimAngle: -Math.PI / 4, alive: true, onGround: false,
    dying: false, deathTimer: null,
  };
}

export function takeDamage(worm: Worm, amount: number): void {
  // Once a worm is already dying, further "damage" is a no-op - hp is
  // already 0 and re-triggering the branch below would otherwise reset
  // deathTimer back to full, restarting the death animation forever.
  if (!worm.alive || worm.dying) return;
  worm.hp = Math.max(0, worm.hp - amount);
  if (worm.hp === 0) {
    worm.dying = true;
    worm.deathTimer = DEATH_ANIM_DURATION_MS;
  }
}

// Ticks a worm's death animation forward. Returns true exactly on the call
// that finalizes it (worm.alive becomes false) - callers use that to know
// this is the moment to record a gravestone at the worm's final position.
export function tickDeathAnimation(worm: Worm, dtMs: number): boolean {
  if (!worm.dying || worm.deathTimer === null) return false;
  worm.deathTimer -= dtMs;
  if (worm.deathTimer <= 0) {
    worm.dying = false;
    worm.deathTimer = null;
    worm.alive = false;
    return true;
  }
  return false;
}

export function adjustAim(worm: Worm, direction: number, dt: number): void {
  const AIM_SPEED = Math.PI / 2; // radians per second
  const LIMIT = Math.PI / 2;
  worm.aimAngle += direction * AIM_SPEED * dt;
  worm.aimAngle = Math.max(-LIMIT, Math.min(LIMIT, worm.aimAngle));
}

export function updateWormPhysics(worm: Worm, terrain: Terrain, input: WormInput, dt: number): void {
  if (!worm.alive) return;
  // A dying worm can't be steered - it just plays out its death wiggle
  // under normal gravity/collision, handled below unchanged.
  const movementInput = worm.dying ? { left: false, right: false, jump: false } : input;

  if (movementInput.left) { worm.vx -= WORM_MOVE_ACCEL * dt; worm.facing = -1; }
  if (movementInput.right) { worm.vx += WORM_MOVE_ACCEL * dt; worm.facing = 1; }
  if (!movementInput.left && !movementInput.right) worm.vx *= 0.8;
  worm.vx = Math.max(-WORM_MOVE_SPEED, Math.min(WORM_MOVE_SPEED, worm.vx));

  if (movementInput.jump && worm.onGround) {
    worm.vy = -JUMP_IMPULSE;
    worm.onGround = false;
  }

  worm.vy += GRAVITY * dt;

  const nextX = worm.x + worm.vx * dt;
  if (isSolid(terrain, nextX, worm.y)) {
    if (worm.onGround && !isSolid(terrain, nextX, worm.y - WORM_STEP_HEIGHT)) {
      // Small slope/step: let the worm climb it instead of stopping dead.
      worm.x = nextX;
      worm.y -= WORM_STEP_HEIGHT;
    } else {
      worm.vx = 0;
    }
  } else {
    worm.x = nextX;
  }

  const nextY = worm.y + worm.vy * dt;
  if (isSolid(terrain, worm.x, nextY)) {
    if (worm.vy > 0) {
      if (worm.vy > FALL_DAMAGE_VELOCITY_THRESHOLD) {
        takeDamage(worm, Math.round((worm.vy - FALL_DAMAGE_VELOCITY_THRESHOLD) * FALL_DAMAGE_PER_VELOCITY));
      }
      worm.onGround = true;
    }
    worm.vy = 0;
  } else {
    worm.y = nextY;
    worm.onGround = false;
  }

  if (worm.y > terrain.height + 50) {
    worm.alive = false;
    worm.hp = 0;
  }
}
