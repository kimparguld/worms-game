import { describe, expect, it } from 'vitest';
import { SoundSystem } from '../src/sound.js';

function makeAudioContextMock(): { context: AudioContext; oscillatorCount: () => number } {
  let createdOscillators = 0;
  const context = {
    currentTime: 0,
    sampleRate: 44100,
    state: 'suspended',
    destination: {},
    resume: async () => undefined,
    createBuffer: (_channels: number, sampleCount: number) => ({
      getChannelData: () => new Float32Array(sampleCount),
    }),
    createBufferSource: () =>
      ({
        buffer: null,
        connect: () => undefined,
        start: () => undefined,
        stop: () => undefined,
      }) as unknown as AudioBufferSourceNode,
    createBiquadFilter: () =>
      ({
        type: 'lowpass',
        frequency: { setValueAtTime: () => undefined },
        connect: () => undefined,
      }) as unknown as BiquadFilterNode,
    createOscillator: () => {
      createdOscillators += 1;
      return {
        type: 'triangle',
        frequency: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
        connect: () => undefined,
        start: () => undefined,
        stop: () => undefined,
      } as unknown as OscillatorNode;
    },
    createGain: () =>
      ({
        gain: {
          setValueAtTime: () => undefined,
          exponentialRampToValueAtTime: () => undefined,
          linearRampToValueAtTime: () => undefined,
        },
        connect: () => undefined,
      }) as unknown as GainNode,
  } as unknown as AudioContext;
  return { context, oscillatorCount: () => createdOscillators };
}

describe('SoundSystem', () => {
  it('does not create sounds until a user gesture unlocks audio', () => {
    const mock = makeAudioContextMock();
    const sound = new SoundSystem(() => mock.context);

    sound.play('fire');
    expect(mock.oscillatorCount()).toBe(0);

    sound.unlock();
    sound.play('fire');
    expect(mock.oscillatorCount()).toBe(2);
  });

  it('reuses the audio context for successive effects', () => {
    const mock = makeAudioContextMock();
    let contextCreations = 0;
    const sound = new SoundSystem(() => {
      contextCreations += 1;
      return mock.context;
    });

    sound.unlock();
    sound.play('explosion');
    sound.play('splash');

    expect(contextCreations).toBe(1);
    expect(mock.oscillatorCount()).toBe(2);
  });
});

describe('SoundSystem background music', () => {
  it('toggles muted state without requiring audio to be unlocked first', () => {
    const mock = makeAudioContextMock();
    const sound = new SoundSystem(() => mock.context);

    expect(sound.isMuted()).toBe(false);

    sound.toggleMute();
    expect(sound.isMuted()).toBe(true);

    sound.toggleMute();
    expect(sound.isMuted()).toBe(false);
  });

  it('starts with playback stopped', () => {
    const mock = makeAudioContextMock();
    const sound = new SoundSystem(() => mock.context);

    expect(sound.isPlaying()).toBe(false);
  });

  it('does nothing when asked for the next track and only one background track is configured', () => {
    const mock = makeAudioContextMock();
    const sound = new SoundSystem(() => mock.context);

    sound.nextTrack();

    expect(sound.isPlaying()).toBe(false);
  });

  it('notifies subscribers when mute is toggled', () => {
    const mock = makeAudioContextMock();
    const sound = new SoundSystem(() => mock.context);
    let notifications = 0;
    sound.onChange(() => {
      notifications += 1;
    });

    sound.toggleMute();
    expect(notifications).toBe(1);

    sound.toggleMute();
    expect(notifications).toBe(2);
  });
});
