// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sharedInput } from '../src/inputState.js';

describe('sharedInput', () => {
  it('is wired to window keydown/keyup events', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(sharedInput.left).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft' }));
    expect(sharedInput.left).toBe(false);
  });

  it('starts with weapon 1 selected', () => {
    expect(sharedInput.selectedWeapon).toBe(1);
  });
});
