import { describe, it, expect } from 'vitest';
import { keyToAction, createInputState } from '../src/input.js';

describe('keyToAction', () => {
  it('maps movement and action keys', () => {
    expect(keyToAction('ArrowLeft')).toBe('left');
    expect(keyToAction('ArrowRight')).toBe('right');
    expect(keyToAction(' ')).toBe('jump');
    expect(keyToAction('Enter')).toBe('fire');
    expect(keyToAction('3')).toBe('weapon3');
  });

  it('returns null for unmapped keys', () => {
    expect(keyToAction('q')).toBeNull();
  });
});

describe('createInputState', () => {
  it('starts with weapon 1 selected and nothing held', () => {
    const state = createInputState();
    expect(state.selectedWeapon).toBe(1);
    expect(state.left).toBe(false);
  });
});
