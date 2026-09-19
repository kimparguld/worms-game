import type { Worm } from '../types.js';
import { WORM_MOVE_SPEED, GRAVITY, WORM_STEP_HEIGHT } from '../constants.js';

export type WormAnimationState = 'dead' | 'death' | 'jump' | 'fall' | 'walk' | 'idle';

// Below this fraction of top speed, a worm reads as standing still even if
// vx is technically nonzero (e.g. decelerating after releasing a move key).
const WALK_THRESHOLD = WORM_MOVE_SPEED * 0.1;

// updateWormPhysics (src/worm.ts) briefly clears onGround for a frame or two
// whenever the worm crosses a small terrain bump - normal ground-following,
// not a real fall - before gravity settles it back down. There's already a
// WORM_STEP_HEIGHT tolerance for stepping *up* over bumps; this mirrors it
// for the downward case by only reading as "fall" once vy exceeds the speed
// a drop of that same height would produce under gravity alone
// (v = sqrt(2 * g * h)), so a normal step-down still reads as walk/idle.
const FALL_THRESHOLD = Math.sqrt(2 * GRAVITY * WORM_STEP_HEIGHT);

export function wormAnimationState(worm: Pick<Worm, 'alive' | 'dying' | 'onGround' | 'vx' | 'vy'>): WormAnimationState {
  if (!worm.alive) return 'dead';
  if (worm.dying) return 'death';
  if (!worm.onGround && worm.vy < 0) return 'jump';
  if (!worm.onGround && worm.vy > FALL_THRESHOLD) return 'fall';
  return Math.abs(worm.vx) > WALK_THRESHOLD ? 'walk' : 'idle';
}
