import { createInputState, attachInputListeners } from './input.js';
import type { InputState } from './types.js';

export const sharedInput: InputState = createInputState();
attachInputListeners(sharedInput, window);
