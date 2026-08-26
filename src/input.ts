import type { InputState } from './types.js';

type Action =
  | 'left' | 'right' | 'aimUp' | 'aimDown' | 'jump' | 'fire' | 'endTurn'
  | 'weapon1' | 'weapon2' | 'weapon3' | 'weapon4' | 'weapon5';

const KEY_MAP: Record<string, Action> = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'aimUp', ArrowDown: 'aimDown',
  ' ': 'jump', Enter: 'fire', Backspace: 'endTurn', Escape: 'endTurn',
  '1': 'weapon1', '2': 'weapon2', '3': 'weapon3', '4': 'weapon4', '5': 'weapon5',
};

export function keyToAction(key: string): Action | null {
  return KEY_MAP[key] ?? null;
}

export function createInputState(): InputState {
  return {
    left: false, right: false, aimUp: false, aimDown: false,
    jump: false, firing: false, endTurnRequested: false, selectedWeapon: 1,
  };
}

const WEAPON_NUMBERS: Partial<Record<Action, number>> = {
  weapon1: 1, weapon2: 2, weapon3: 3, weapon4: 4, weapon5: 5,
};

export function attachInputListeners(inputState: InputState, target: EventTarget = window): void {
  target.addEventListener('keydown', (e) => {
    const action = keyToAction((e as KeyboardEvent).key);
    if (!action) return;
    if (action === 'left') inputState.left = true;
    else if (action === 'right') inputState.right = true;
    else if (action === 'aimUp') inputState.aimUp = true;
    else if (action === 'aimDown') inputState.aimDown = true;
    else if (action === 'jump') inputState.jump = true;
    else if (action === 'fire') inputState.firing = true;
    else if (action === 'endTurn') inputState.endTurnRequested = true;
    else if (WEAPON_NUMBERS[action]) inputState.selectedWeapon = WEAPON_NUMBERS[action]!;
  });

  target.addEventListener('keyup', (e) => {
    const action = keyToAction((e as KeyboardEvent).key);
    if (!action) return;
    if (action === 'left') inputState.left = false;
    else if (action === 'right') inputState.right = false;
    else if (action === 'aimUp') inputState.aimUp = false;
    else if (action === 'aimDown') inputState.aimDown = false;
    else if (action === 'jump') inputState.jump = false;
    else if (action === 'fire') inputState.firing = false;
  });
}
