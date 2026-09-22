import { describe, it, expect } from 'vitest';
import { keyToAction, createInputState, resetInputState } from '../src/input.js';

describe('keyToAction', () => {
  it('maps movement and action keys', () => {
    expect(keyToAction('ArrowLeft')).toBe('left');
    expect(keyToAction('ArrowRight')).toBe('right');
    expect(keyToAction(' ')).toBe('fire');
    expect(keyToAction('Enter')).toBe('jump');
    expect(keyToAction('3')).toBe('weapon3');
  });

  it('maps WASD as an alternate to the arrow keys', () => {
    expect(keyToAction('a')).toBe('left');
    expect(keyToAction('A')).toBe('left');
    expect(keyToAction('d')).toBe('right');
    expect(keyToAction('D')).toBe('right');
    expect(keyToAction('w')).toBe('aimUp');
    expect(keyToAction('W')).toBe('aimUp');
    expect(keyToAction('s')).toBe('aimDown');
    expect(keyToAction('S')).toBe('aimDown');
  });

  it('maps the 6-9 and 0 keys to the five new weapon slots', () => {
    expect(keyToAction('6')).toBe('weapon6');
    expect(keyToAction('7')).toBe('weapon7');
    expect(keyToAction('8')).toBe('weapon8');
    expect(keyToAction('9')).toBe('weapon9');
    expect(keyToAction('0')).toBe('weapon10');
  });

  it('maps "[" and "]" to weapon-cycle actions', () => {
    expect(keyToAction('[')).toBe('prevWeapon');
    expect(keyToAction(']')).toBe('nextWeapon');
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

describe('resetInputState', () => {
  it('clears all held/requested flags and resets weapon selection to 1', () => {
    const state = createInputState();
    state.left = true;
    state.right = true;
    state.aimUp = true;
    state.aimDown = true;
    state.jump = true;
    state.firing = true;
    state.endTurnRequested = true;
    state.selectedWeapon = 4;

    resetInputState(state);

    expect(state.left).toBe(false);
    expect(state.right).toBe(false);
    expect(state.aimUp).toBe(false);
    expect(state.aimDown).toBe(false);
    expect(state.jump).toBe(false);
    expect(state.firing).toBe(false);
    expect(state.endTurnRequested).toBe(false);
    expect(state.selectedWeapon).toBe(1);
  });
});
