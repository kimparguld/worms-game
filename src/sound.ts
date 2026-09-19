export type SoundEffect = 'fire' | 'shotgun' | 'explosion' | 'splash' | 'turn' | 'charge' | 'heal';

type AudioContextFactory = () => AudioContext;
type EffectSettings = { startFrequency: number; endFrequency: number; duration: number; volume: number };

const EFFECT_SETTINGS: Record<SoundEffect, EffectSettings> = {
  fire: { startFrequency: 180, endFrequency: 70, duration: 0.18, volume: 0.12 },
  shotgun: { startFrequency: 120, endFrequency: 45, duration: 0.12, volume: 0.16 },
  explosion: { startFrequency: 90, endFrequency: 35, duration: 0.5, volume: 0.2 },
  splash: { startFrequency: 420, endFrequency: 90, duration: 0.3, volume: 0.14 },
  turn: { startFrequency: 440, endFrequency: 660, duration: 0.18, volume: 0.08 },
  charge: { startFrequency: 220, endFrequency: 440, duration: 0.28, volume: 0.07 },
  heal: { startFrequency: 500, endFrequency: 900, duration: 0.22, volume: 0.1 },
};

// One entry today, but nextTrack() below already cycles through the whole
// list - adding a second video ID is enough to make "next song" do
// something.
const BACKGROUND_VIDEO_IDS = ['ruuMCgS6VLk'];
const BACKGROUND_VOLUME = 18;

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
  private backgroundFrame: HTMLIFrameElement | null = null;
  private musicMuted = false;
  private musicPlaying = false;
  private videoIndex = 0;
  private readonly changeListeners = new Set<() => void>();

  constructor(createContext: AudioContextFactory = createAudioContext) {
    this.createContext = createContext;
  }

  isMuted(): boolean {
    return this.musicMuted;
  }

  isPlaying(): boolean {
    return this.musicPlaying;
  }

  hasMultipleTracks(): boolean {
    return BACKGROUND_VIDEO_IDS.length > 1;
  }

  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  toggleMute(): void {
    this.musicMuted = !this.musicMuted;
    this.sendPlayerCommand(this.musicMuted ? 'mute' : 'unMute');
    this.notifyChange();
  }

  togglePlay(): void {
    if (!this.backgroundFrame) {
      this.unlock();
      this.startBackgroundMusic();
      return;
    }
    if (this.musicPlaying) {
      this.sendPlayerCommand('pauseVideo');
      this.musicPlaying = false;
    } else {
      this.sendPlayerCommand('playVideo');
      this.musicPlaying = true;
    }
    this.notifyChange();
  }

  // A no-op with today's single-video playlist - BACKGROUND_VIDEO_IDS.length
  // is 1, so the index wraps straight back to itself.
  nextTrack(): void {
    if (!this.hasMultipleTracks()) return;
    this.videoIndex = (this.videoIndex + 1) % BACKGROUND_VIDEO_IDS.length;
    this.musicPlaying = true;
    if (this.backgroundFrame) {
      this.sendPlayerCommand('loadVideoById', [BACKGROUND_VIDEO_IDS[this.videoIndex]]);
    } else {
      this.unlock();
      this.startBackgroundMusic();
    }
    this.notifyChange();
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

  // Idempotent entry point used by scenes on first user interaction - safe
  // to call repeatedly, only creates the player iframe once.
  startBackgroundMusic(): void {
    if (!this.unlocked || this.backgroundFrame) return;
    const frame = document.createElement('iframe');
    const videoId = BACKGROUND_VIDEO_IDS[this.videoIndex];
    const parameters = new URLSearchParams({
      autoplay: '1',
      controls: '0',
      enablejsapi: '1',
      loop: '1',
      modestbranding: '1',
      mute: '1',
      origin: window.location.origin,
      playlist: videoId,
      playsinline: '1',
      rel: '0',
    });
    frame.src = `https://www.youtube.com/embed/${videoId}?${parameters}`;
    frame.title = 'Background music';
    frame.allow = 'autoplay';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.position = 'fixed';
    frame.style.width = '1px';
    frame.style.height = '1px';
    frame.style.opacity = '0';
    frame.style.pointerEvents = 'none';
    frame.addEventListener('load', () => {
      this.sendPlayerCommand(this.musicMuted ? 'mute' : 'unMute');
      this.sendPlayerCommand('setVolume', [BACKGROUND_VOLUME]);
      this.sendPlayerCommand('playVideo');
      this.musicPlaying = true;
      this.notifyChange();
    });
    document.body.appendChild(frame);
    this.backgroundFrame = frame;
  }

  private sendPlayerCommand(functionName: string, args: unknown[] = []): void {
    if (!this.backgroundFrame?.contentWindow) return;
    this.backgroundFrame.contentWindow.postMessage(
      JSON.stringify({
        event: 'command',
        func: functionName,
        args,
        id: 'worms-background-player',
      }),
      'https://www.youtube.com',
    );
  }

  private notifyChange(): void {
    this.changeListeners.forEach((listener) => listener());
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
