// tests/constants.test.js
import { describe, it, expect } from 'vitest';
import {
  GRAVITY, WORM_MOVE_ACCEL, WORM_MOVE_SPEED, JUMP_IMPULSE,
  TURN_DURATION_MS, STARTING_HP,
} from '../src/constants.js';

describe('constants', () => {
  it('defines positive physics constants', () => {
    expect(GRAVITY).toBeGreaterThan(0);
    expect(WORM_MOVE_ACCEL).toBeGreaterThan(0);
    expect(WORM_MOVE_SPEED).toBeGreaterThan(0);
    expect(JUMP_IMPULSE).toBeGreaterThan(0);
  });

  it('sets a 45 second turn duration', () => {
    expect(TURN_DURATION_MS).toBe(45000);
  });

  it('starts worms at 100 HP', () => {
    expect(STARTING_HP).toBe(100);
  });
});
