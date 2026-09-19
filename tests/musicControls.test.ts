import { describe, expect, it } from 'vitest';
import { muteButtonLabel, playButtonLabel } from '../src/musicControls.js';

describe('muteButtonLabel', () => {
  it('reads "Mute" when music is unmuted', () => {
    expect(muteButtonLabel(false)).toBe('Mute');
  });

  it('reads "Unmute" when music is muted', () => {
    expect(muteButtonLabel(true)).toBe('Unmute');
  });
});

describe('playButtonLabel', () => {
  it('reads "Play" when music is stopped', () => {
    expect(playButtonLabel(false)).toBe('Play');
  });

  it('reads "Pause" when music is playing', () => {
    expect(playButtonLabel(true)).toBe('Pause');
  });
});
