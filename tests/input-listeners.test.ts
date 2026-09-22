// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createInputState, attachInputListeners } from '../src/input.js';
import { WEAPON_KEYS } from '../src/matchLoop.js';

describe('attachInputListeners', () => {
  it('sets and clears movement flags on keydown/keyup', () => {
    const state = createInputState();
    attachInputListeners(state, window);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(state.right).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' }));
    expect(state.right).toBe(false);
  });

  it('selects a weapon on number key press', () => {
    const state = createInputState();
    attachInputListeners(state, window);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4' }));
    expect(state.selectedWeapon).toBe(4);
  });

  it('sets fire (not jump) on Space, and jump (not fire) on Enter', () => {
    const state = createInputState();
    attachInputListeners(state, window);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(state.firing).toBe(true);
    expect(state.jump).toBe(false);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(state.jump).toBe(true);
  });

  it('selects weapon 10 on the "0" key press', () => {
    const state = createInputState();
    attachInputListeners(state, window);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }));
    expect(state.selectedWeapon).toBe(10);
  });

  it('cycles the selected weapon forward and backward with the bracket keys, wrapping at the ends', () => {
    const state = createInputState();
    attachInputListeners(state, window);
    expect(state.selectedWeapon).toBe(1);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '[' }));
    expect(state.selectedWeapon).toBe(WEAPON_KEYS.length); // wraps backward from 1

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ']' }));
    expect(state.selectedWeapon).toBe(1); // forward again, back to 1

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ']' }));
    expect(state.selectedWeapon).toBe(2);
  });
});
