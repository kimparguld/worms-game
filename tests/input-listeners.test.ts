// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createInputState, attachInputListeners } from '../src/input.js';

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
});
