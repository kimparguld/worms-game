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
});
