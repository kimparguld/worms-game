import { describe, it, expect } from 'vitest';
import { wormAnimationState } from '../src/render/wormAnimationState.js';

const base = { alive: true, dying: false, onGround: true, vx: 0, vy: 0 };

describe('wormAnimationState', () => {
  it('is "dead" once the worm is no longer alive', () => {
    expect(wormAnimationState({ ...base, alive: false })).toBe('dead');
  });

  it('is "death" while dying, even if still alive', () => {
    expect(wormAnimationState({ ...base, dying: true })).toBe('death');
  });

  it('is "jump" when airborne and moving upward (negative vy)', () => {
    expect(wormAnimationState({ ...base, onGround: false, vy: -50 })).toBe('jump');
  });

  it('is "fall" when airborne and falling faster than a normal step-down', () => {
    expect(wormAnimationState({ ...base, onGround: false, vy: 200 })).toBe('fall');
  });

  it('is "walk", not "fall", when a small terrain bump briefly clears onGround', () => {
    // A worm crossing a rough/bumpy edge can have onGround flicker false for
    // a frame or two before gravity settles it back down - that's normal
    // ground-following, not a real fall, so it shouldn't flash the fall pose.
    expect(wormAnimationState({ ...base, onGround: false, vy: 50, vx: 20 })).toBe('walk');
  });

  it('is "idle", not "fall", when stationary and a small terrain bump briefly clears onGround', () => {
    expect(wormAnimationState({ ...base, onGround: false, vy: 50, vx: 0 })).toBe('idle');
  });

  it('is "walk" when grounded and moving faster than the threshold', () => {
    expect(wormAnimationState({ ...base, vx: 20 })).toBe('walk');
    expect(wormAnimationState({ ...base, vx: -20 })).toBe('walk');
  });

  it('is "idle" when grounded and stationary or below the movement threshold', () => {
    expect(wormAnimationState({ ...base, vx: 0 })).toBe('idle');
    expect(wormAnimationState({ ...base, vx: 3 })).toBe('idle');
  });

  it('prioritizes "dead" over every other state', () => {
    expect(wormAnimationState({ alive: false, dying: true, onGround: false, vx: 50, vy: -50 })).toBe('dead');
  });
});
