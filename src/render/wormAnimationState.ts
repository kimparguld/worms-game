import type { Worm } from '../types.js';
import { WORM_MOVE_SPEED } from '../constants.js';

export type WormAnimationState = 'dead' | 'death' | 'jump' | 'fall' | 'walk' | 'idle';

// Below this fraction of top speed, a worm reads as standing still even if
// vx is technically nonzero (e.g. decelerating after releasing a move key).
const WALK_THRESHOLD = WORM_MOVE_SPEED * 0.1;

export function wormAnimationState(worm: Pick<Worm, 'alive' | 'dying' | 'onGround' | 'vx' | 'vy'>): WormAnimationState {
  if (!worm.alive) return 'dead';
  if (worm.dying) return 'death';
  if (!worm.onGround) return worm.vy < 0 ? 'jump' : 'fall';
  return Math.abs(worm.vx) > WALK_THRESHOLD ? 'walk' : 'idle';
}
