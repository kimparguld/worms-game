import type { InputState } from './types.js';

type Action =
  | 'left'
  | 'right'
  | 'aimUp'
  | 'aimDown'
  | 'jump'
  | 'fire'
  | 'endTurn'
  | 'weapon1'
  | 'weapon2'
  | 'weapon3'
  | 'weapon4'
  | 'weapon5'
  | 'weapon6'
  | 'weapon7'
  | 'weapon8'
  | 'weapon9'
  | 'weapon10';

const KEY_MAP: Record<string, Action> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'aimUp',
  ArrowDown: 'aimDown',
  a: 'left',
  A: 'left',
  d: 'right',
  D: 'right',
  w: 'aimUp',
  W: 'aimUp',
  s: 'aimDown',
  S: 'aimDown',
  ' ': 'fire',
  Enter: 'jump',
  Backspace: 'endTurn',
  Escape: 'endTurn',
  '1': 'weapon1',
  '2': 'weapon2',
  '3': 'weapon3',
  '4': 'weapon4',
  '5': 'weapon5',
  '6': 'weapon6',
  '7': 'weapon7',
  '8': 'weapon8',
  '9': 'weapon9',
  '0': 'weapon10',
};

export function keyToAction(key: string): Action | null {
  return KEY_MAP[key] ?? null;
}

export function createInputState(): InputState {
  return {
    left: false,
    right: false,
    aimUp: false,
    aimDown: false,
    jump: false,
    firing: false,
    endTurnRequested: false,
    selectedWeapon: 1,
  };
}

const WEAPON_NUMBERS: Partial<Record<Action, number>> = {
  weapon1: 1,
  weapon2: 2,
  weapon3: 3,
  weapon4: 4,
  weapon5: 5,
  weapon6: 6,
  weapon7: 7,
  weapon8: 8,
  weapon9: 9,
  weapon10: 10,
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

export function resetInputState(state: InputState): void {
  state.left = false;
  state.right = false;
  state.aimUp = false;
  state.aimDown = false;
  state.jump = false;
  state.firing = false;
  state.endTurnRequested = false;
  state.selectedWeapon = 1;
}
