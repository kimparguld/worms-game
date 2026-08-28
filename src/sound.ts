export type SoundEffect = 'fire' | 'shotgun' | 'explosion' | 'splash' | 'turn' | 'charge';

type AudioContextFactory = () => AudioContext;
type EffectSettings = { startFrequency: number; endFrequency: number; duration: number; volume: number };

const EFFECT_SETTINGS: Record<SoundEffect, EffectSettings> = {
  fire: { startFrequency: 180, endFrequency: 70, duration: 0.18, volume: 0.12 },
  shotgun: { startFrequency: 120, endFrequency: 45, duration: 0.12, volume: 0.16 },
  explosion: { startFrequency: 90, endFrequency: 35, duration: 0.5, volume: 0.2 },
  splash: { startFrequency: 420, endFrequency: 90, duration: 0.3, volume: 0.14 },
  turn: { startFrequency: 440, endFrequency: 660, duration: 0.18, volume: 0.08 },
  charge: { startFrequency: 220, endFrequency: 440, duration: 0.28, volume: 0.07 },
};

const THEME_NOTES = [261.63, 329.63, 392, 523.25, 392, 329.63, 293.66, 349.23];
const THEME_NOTE_DURATION = 0.42;
const THEME_VOLUME = 0.035;
const THEME_BASS_VOLUME = 0.022;

function randomBetween(minimum: number, maximum: number): number {
  return minimum + Math.random() * (maximum - minimum);
}

function createAudioContext(): AudioContext {
  const AudioContextConstructor =
    window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) throw new Error('Web Audio is not supported');
  return new AudioContextConstructor();
}

export class SoundSystem {
  private context: AudioContext | null = null;
  private unlocked = false;
  private readonly createContext: AudioContextFactory;
  private themeTimer: ReturnType<typeof setTimeout> | null = null;
  private themeNoteIndex = 0;

  constructor(createContext: AudioContextFactory = createAudioContext) {
    this.createContext = createContext;
  }

  unlock(): void {
    if (!this.context) {
      try {
        this.context = this.createContext();
      } catch {
        return;
      }
    }
    this.unlocked = true;
    if (this.context.state === 'suspended') void this.context.resume();
  }

  play(effect: SoundEffect): void {
    if (!this.unlocked || !this.context) return;

    const baseSettings = EFFECT_SETTINGS[effect];
    const pitch = randomBetween(0.9, 1.1);
    const settings = {
      ...baseSettings,
      startFrequency: baseSettings.startFrequency * pitch,
      endFrequency: baseSettings.endFrequency * pitch,
      duration: baseSettings.duration * randomBetween(0.9, 1.08),
    };
    this.playTone(settings, effect === 'explosion' ? 'square' : 'square');
    if (effect === 'fire') {
      this.playTone(
        {
          ...settings,
          startFrequency: settings.startFrequency * 2,
          endFrequency: settings.endFrequency * 2,
          volume: settings.volume * 0.4,
        },
        'triangle',
      );
    }
    if (effect === 'fire' || effect === 'shotgun' || effect === 'explosion') {
      this.playNoise(settings.duration, settings.volume * 0.55);
    }
  }

  startTheme(): void {
    if (!this.unlocked || !this.context || this.themeTimer !== null) return;
    this.playThemeNote();
  }

  private playThemeNote(): void {
    if (!this.unlocked || !this.context) return;
    const note = THEME_NOTES[this.themeNoteIndex];
    this.playTone(
      { startFrequency: note, endFrequency: note, duration: THEME_NOTE_DURATION, volume: THEME_VOLUME },
      'square',
    );
    this.playTone(
      { startFrequency: note / 2, endFrequency: note / 2, duration: THEME_NOTE_DURATION, volume: THEME_BASS_VOLUME },
      'triangle',
    );
    this.themeNoteIndex = (this.themeNoteIndex + 1) % THEME_NOTES.length;
    this.themeTimer = setTimeout(() => {
      this.themeTimer = null;
      this.playThemeNote();
    }, THEME_NOTE_DURATION * 1000);
  }

  private playTone(settings: EffectSettings, oscillatorType: OscillatorType): void {
    if (!this.context) return;
    const startTime = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = oscillatorType;
    oscillator.frequency.setValueAtTime(settings.startFrequency, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(settings.endFrequency, startTime + settings.duration);
    gain.gain.setValueAtTime(settings.volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + settings.duration);
    oscillator.connect(gain);
    gain.connect(this.context.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + settings.duration);
  }

  private playNoise(duration: number, volume: number): void {
    if (!this.context) return;
    const sampleCount = Math.ceil(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, sampleCount, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i += 1) samples[i] = Math.random() * 2 - 1;

    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, this.context.currentTime);
    gain.gain.setValueAtTime(volume, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.context.destination);
    source.start();
    source.stop(this.context.currentTime + duration);
  }
}

export const soundSystem = new SoundSystem();
