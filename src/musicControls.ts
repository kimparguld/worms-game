import { soundSystem } from './sound.js';

export function muteButtonLabel(muted: boolean): string {
  return muted ? 'Unmute' : 'Mute';
}

export function playButtonLabel(playing: boolean): string {
  return playing ? 'Pause' : 'Play';
}

// A small persistent widget, created once outside of any Phaser scene since
// the background music itself already outlives scene transitions (see
// soundSystem in sound.ts). Mirrors the DOM-overlay pattern GameScene uses
// for its mobile touch controls.
export function createMusicControls(): HTMLDivElement | null {
  const container = document.getElementById('game-container');
  if (!container) return null;

  const controls = document.createElement('div');
  controls.className = 'music-controls';
  controls.innerHTML = `
    <button type="button" data-action="mute" aria-label="Mute background music"></button>
    <button type="button" data-action="play" aria-label="Play background music"></button>
    <button type="button" data-action="next" aria-label="Next song">Next</button>
  `;

  const muteButton = controls.querySelector<HTMLButtonElement>('[data-action="mute"]')!;
  const playButton = controls.querySelector<HTMLButtonElement>('[data-action="play"]')!;
  const nextButton = controls.querySelector<HTMLButtonElement>('[data-action="next"]')!;
  // Disabled rather than hidden, so it reappears with no other wiring
  // changes the day a second background track is added.
  nextButton.disabled = !soundSystem.hasMultipleTracks();

  const refresh = (): void => {
    muteButton.textContent = muteButtonLabel(soundSystem.isMuted());
    playButton.textContent = playButtonLabel(soundSystem.isPlaying());
  };

  controls.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const action = target.dataset.action;
    if (action === 'mute') soundSystem.toggleMute();
    if (action === 'play') soundSystem.togglePlay();
    if (action === 'next') soundSystem.nextTrack();
    // Without this, the clicked button keeps keyboard focus and a later
    // Enter/Space meant for the game (start match, jump, charge weapon)
    // also re-activates it as a native button click.
    target.blur();
  });

  soundSystem.onChange(refresh);
  refresh();

  container.appendChild(controls);
  return controls;
}
