import { describe, it, expect } from 'vitest';
import {
  GRAVITY, WORM_MOVE_ACCEL, WORM_MOVE_SPEED, JUMP_IMPULSE,
  TURN_DURATION_MS, STARTING_HP, WIND_MAX,
  WORLD_WIDTH, WORLD_HEIGHT,
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

  it('sets a wind strength that meaningfully bends wind-affected projectiles', () => {
    expect(WIND_MAX).toBe(140);
  });
});

describe('world size', () => {
  it('is larger than the 1280x720 viewport and wider than its 16:9 ratio', () => {
    expect(WORLD_WIDTH).toBeGreaterThan(1280);
    expect(WORLD_HEIGHT).toBeGreaterThan(720);
    expect(WORLD_WIDTH / WORLD_HEIGHT).toBeGreaterThan(1280 / 720); // wider than the viewport's aspect - the camera scrolls sideways
  });
});
