// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sharedInput } from '../src/inputState.js';

describe('sharedInput', () => {
  // This assertion must run before any other test in this file dispatches
  // a keydown - sharedInput is a module-level singleton shared across every
  // test here, so its initial state is only observable once.
  it('starts with weapon 1 selected before any input is dispatched', () => {
    expect(sharedInput.selectedWeapon).toBe(1);
  });

  it('is wired to window keydown/keyup events', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(sharedInput.left).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft' }));
    expect(sharedInput.left).toBe(false);
  });
});
