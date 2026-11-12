// R8.9, D-10, D-12, D-39: the audio driver ("voices"), the app's only output (haptics are cut,
// D-39). It plays into the events bus and holds the ambience duck while it sounds (R13.9).
// Strength is continuous gain (× volume), `pitch` sets the frequency, `pan` a StereoPannerNode, and the provenance `tag` the timbre. Every sound is scheduled
// on the shared AudioContext's clock (currentTime + lookahead), never with timers.
import type { HapticEvent, HapticVoice, Tag } from '@/contract';
import { audioContextSupported, getAudioContext } from './audioContext';
import { getBus, holdDuck, playBell, type DuckHold } from './audioGraph';
import type { TrainCapableDriver, TrainWindow } from './engine';
import { clamp01, pitchToHz } from './pitch';
import {
  AUDIO_FLOOR_STRENGTH,
  AUDIO_LOOKAHEAD_S,
  AUDIO_PEAK_GAIN,
  AUDIO_REANCHOR_TOLERANCE_S,
  CHIME_DECAY_S,
  DUCK_SAFETY_S,
  MAX_AUDIO_VOICES,
  DEFAULT_VOLUME,
  DOUBLE_ONSETS_PATTERN_MS,
  GRAIN_BANDPASS_Q,
  HEARTBEAT_ONSETS_PATTERN_MS,
  HIGH_OUTPUT_LATENCY_S,
  NOISE_BURST_S,
  NOISE_DECAY_S,
  SOFT_TONE_ATTACK_S,
  SOFT_TONE_GAIN,
  SURF_DURATION_S,
  SURF_LOWPASS_HZ,
  TONE_ATTACK_S,
  TONE_BLIP_S,
  TRAIN_MAX_RATE_HZ,
  TRAIN_MIN_RATE_HZ,
  TRAIN_WINDOW_MS,
} from './tuning';

/** A train's rate clamped to the R8.3 range; null for a missing, non-finite or non-positive rate. */
export function clampTrainRate(rateHz: number | undefined): number | null {
  if (rateHz === undefined || !Number.isFinite(rateHz) || rateHz <= 0) return null;
  return Math.min(TRAIN_MAX_RATE_HZ, Math.max(TRAIN_MIN_RATE_HZ, rateHz));
}

/** What makes the sound: a tone, a bell, a noise grain or low-passed noise (surf). */
export type AudioSource = 'tone' | 'bell' | 'grain' | 'surf';

export interface Timbre {
  readonly source: AudioSource;
  /** R8.9 "softer tone" for the Estimated tags: slower attack, lower gain. */
  readonly soft: boolean;
}

const TIMBRES = {
  tone: { source: 'tone', soft: false },
  softTone: { source: 'tone', soft: true },
  bell: { source: 'bell', soft: false },
  softBell: { source: 'bell', soft: true },
  grain: { source: 'grain', soft: false },
  surf: { source: 'surf', soft: false },
} as const satisfies Record<string, Timbre>;

/**
 * R8.9 provenance by timbre, refined by the D-12 `voice` hint (Q-72). The tag decides the family:
 * `artistic` is always noise (grain, or surf for the ocean), so it keeps its grainy character
 * whatever the voice says; the other tags are always tones (a bell for `chime`), never noise.
 */
export function selectTimbre(tag: Tag, voice?: HapticVoice): Timbre {
  if (tag === 'artistic') return voice === 'surf' ? TIMBRES.surf : TIMBRES.grain;
  const soft = tag !== 'measured';
  if (voice === 'chime') return soft ? TIMBRES.softBell : TIMBRES.bell;
  return soft ? TIMBRES.softTone : TIMBRES.tone;
}

/** Start times (ms) of the vibrating segments of a pattern: double and heartbeat sound in step. */
export function patternOnsetsMs(pattern: readonly number[]): number[] {
  const onsets: number[] = [];
  let t = 0;
  pattern.forEach((v, i) => {
    if (i % 2 === 0) onsets.push(t);
    t += v;
  });
  return onsets;
}

const DOUBLE_ONSETS = patternOnsetsMs(DOUBLE_ONSETS_PATTERN_MS);
const HEARTBEAT_ONSETS = patternOnsetsMs(HEARTBEAT_ONSETS_PATTERN_MS);
const SINGLE_ONSET: readonly number[] = [0];

/** Deterministic noise (no Math.random): a 32-bit LCG. */
function fillNoise(data: Float32Array, seed: number): void {
  let x = seed >>> 0;
  for (let i = 0; i < data.length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    data[i] = x / 2147483648 - 1;
  }
}
const NOISE_SEED = 0x5eed;

export interface AudioDriverOptions {
  /** Where the context comes from. Default: the shared one (audioContext.ts), once unlocked. */
  context?: () => AudioContext | null;
  /** Default: a context can be made here (`audioContextSupported()`). */
  supported?: boolean;
}

/**
 * Gain of one sound at volume 1, before the soft-tone scale. Continuous in strength (R8.9), with an
 * audible floor so the lowest level sounds whenever it vibrates: a quiet dip is silent because the
 * source emits nothing, never because the gain is 0.
 */
export function audioGain(strength: number): number {
  return Math.max(AUDIO_FLOOR_STRENGTH, clamp01(strength)) * AUDIO_PEAK_GAIN;
}

interface Voice {
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  /** Part of a pulse train: `stopTrain` cancels it, one-shots are left alone. */
  train: boolean;
  /** Start time on the context clock (s). */
  when: number;
}

/** What one sound needs from a HapticEvent or a TrainWindow. */
interface SoundSpec {
  strength: number;
  tag: Tag;
  pitch?: number;
  pan?: number;
  voice?: HapticVoice;
}

export class AudioDriver implements TrainCapableDriver {
  readonly supported: boolean;
  private readonly getContext: () => AudioContext | null;
  private vol = DEFAULT_VOLUME;
  // Reused across sounds, per context.
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly live = new Set<Voice>();
  /** R13.9: this driver's one hold on the ambience duck while any of its voices lives. */
  private duck: DuckHold | null = null;
  /** Engine time ↔ audio time of the running train (`seq` −1: none yet). */
  private readonly anchor = { seq: -1, engineMs: 0, audioS: 0 };

  constructor(options: AudioDriverOptions = {}) {
    this.getContext = options.context ?? getAudioContext;
    this.supported = options.supported ?? audioContextSupported();
  }

  /** R8.7 volume, 0–1. */
  setVolume(v: number): void {
    this.vol = clamp01(v);
    if (this.master && this.ctx) {
      // A slider drag calls this often: replace the scheduled value instead of piling events up.
      const g = this.master.gain;
      const t = this.ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(this.vol, t);
    }
  }

  get volume(): number {
    return this.vol;
  }

  /**
   * `AudioContext.outputLatency` in seconds, or null where it is missing (R12 #10). Its old UI
   * (UnlockButton) went with D-39; kept for the sound-check page (#116, R13.9).
   */
  outputLatency(): number | null {
    const ctx = this.getContext();
    const v = (ctx as { outputLatency?: number } | null)?.outputLatency;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  /** R8.9: high output latency (likely Bluetooth): suggest the phone speaker or wired earphones. */
  isHighLatency(): boolean {
    const l = this.outputLatency();
    return l !== null && l > HIGH_OUTPUT_LATENCY_S;
  }

  emit(e: HapticEvent): void {
    switch (e.kind) {
      case 'tick':
        this.playEvent(SINGLE_ONSET, e);
        break;
      case 'double':
        this.playEvent(DOUBLE_ONSETS, e);
        break;
      case 'heartbeat':
        this.playEvent(HEARTBEAT_ONSETS, e);
        break;
      case 'pulseTrain': {
        // R8.8 fallback, without phase: one window from now. The engine sends playTrain instead.
        const rate = clampTrainRate(e.rateHz);
        if (rate === null) return;
        const onsets: number[] = [];
        for (let t = 0; t < TRAIN_WINDOW_MS; t += 1000 / rate) onsets.push(t);
        this.playEvent(onsets, e);
        break;
      }
      case 'stop':
        this.stop();
        break;
    }
  }

  /**
   * Train pulses are scheduled from one engine-time → audio-time anchor per train, set by its
   * first window, so pulses stay sample-accurate across windows (R8.9). The anchor is reset when
   * the audio clock has drifted from it by more than AUDIO_REANCHOR_TOLERANCE_S (a glitch, or a
   * suspended context).
   */
  playTrain(w: TrainWindow): void {
    if (!this.supported || w.pulseOffsetsMs.length <= w.resentCount) return;
    const ctx = this.ready();
    if (!ctx) return;
    const a = this.anchor;
    const predicted = a.audioS + (w.atMs - a.engineMs) / 1000;
    if (
      a.seq !== w.trainSeq ||
      Math.abs(predicted - (ctx.currentTime + AUDIO_LOOKAHEAD_S)) > AUDIO_REANCHOR_TOLERANCE_S
    ) {
      a.seq = w.trainSeq;
      a.engineMs = w.atMs;
      a.audioS = ctx.currentTime + AUDIO_LOOKAHEAD_S;
    }
    const base = a.audioS + (w.atMs - a.engineMs) / 1000;
    this.playOnsets(ctx, base, w.pulseOffsetsMs, w.resentCount, w, true);
  }

  /** Sound is never cancelled by a one-shot. */
  oneShotBlockMs(): number {
    return 0;
  }

  /** Cancel train sounds only; one-shots (a firm coastline tick, a ringing chime) play on. */
  stopTrain(): void {
    for (const v of this.live) {
      if (!v.train) continue;
      this.release(v, true);
      this.live.delete(v);
    }
    this.anchor.seq = -1;
    this.syncDuck();
  }

  /** Cancel every scheduled and playing sound. */
  stop(): void {
    for (const v of this.live) this.release(v, true);
    this.live.clear();
    this.anchor.seq = -1;
    this.syncDuck();
  }

  /** Whether this driver holds the ambience duck now (tests). */
  get ducking(): boolean {
    return this.duck !== null && !this.duck.released;
  }

  // ------------------------------------------------------------ graph

  private ready(): AudioContext | null {
    const ctx = this.getContext();
    if (!ctx || ctx.state !== 'running') return null;
    if (ctx !== this.ctx) {
      // Sounds of a previous (closed) context never end there: drop and disconnect them.
      for (const v of this.live) this.release(v, true);
      this.live.clear();
      this.syncDuck();
      this.ctx = ctx;
      this.anchor.seq = -1;
      // The driver's volume, into the events bus, the master and its limiter (audioGraph.ts).
      this.master = ctx.createGain();
      this.master.gain.value = this.vol;
      this.master.connect(getBus(ctx, 'events'));
      const length = Math.max(1, Math.ceil(ctx.sampleRate * SURF_DURATION_S));
      this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
      fillNoise(this.noise.getChannelData(0), NOISE_SEED);
    }
    return ctx;
  }

  private playEvent(onsetsMs: readonly number[], e: SoundSpec): void {
    if (!this.supported) return;
    const ctx = this.ready();
    if (!ctx) return;
    const base = ctx.currentTime + AUDIO_LOOKAHEAD_S;
    this.playOnsets(ctx, base, onsetsMs, 0, e, false);
  }

  private playOnsets(
    ctx: AudioContext,
    baseS: number,
    onsetsMs: readonly number[],
    skip: number,
    e: SoundSpec,
    train: boolean,
  ): void {
    const timbre = selectTimbre(e.tag, e.voice);
    const gain = audioGain(e.strength) * (timbre.soft ? SOFT_TONE_GAIN : 1);
    if (!(gain > 0)) return;
    for (let i = skip; i < onsetsMs.length; i++) {
      const when = Math.max(ctx.currentTime, baseS + onsetsMs[i]! / 1000);
      this.sound(ctx, when, gain, timbre, e.pitch, e.pan, train);
    }
  }

  private sound(
    ctx: AudioContext,
    when: number,
    gain: number,
    timbre: Timbre,
    pitch: number | undefined,
    pan: number | undefined,
    train: boolean,
  ): void {
    const voice: Voice = { sources: [], nodes: [], train, when };
    let out: AudioNode = this.master!;
    if (pan !== undefined && Number.isFinite(pan) && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      p.connect(out);
      voice.nodes.push(p);
      out = p;
    }

    if (timbre.source === 'bell') {
      // The shared bell (audioGraph.ts), also used by the Listen sweep.
      const bell = playBell(ctx, out, {
        freqHz: pitchToHz(pitch),
        when,
        gain,
        attackS: timbre.soft ? SOFT_TONE_ATTACK_S : TONE_ATTACK_S,
      });
      voice.sources.push(...bell.sources);
      voice.nodes.push(...bell.nodes);
      this.track(voice);
      return;
    }

    const env = ctx.createGain();
    voice.nodes.push(env);
    env.connect(out);
    const g = env.gain;
    g.setValueAtTime(0, when);
    let end: number;

    switch (timbre.source) {
      case 'tone': {
        const attack = timbre.soft ? SOFT_TONE_ATTACK_S : TONE_ATTACK_S;
        end = when + Math.max(TONE_BLIP_S, attack * 2);
        g.linearRampToValueAtTime(gain, when + attack);
        g.linearRampToValueAtTime(0, end);
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = pitchToHz(pitch);
        osc.connect(env);
        voice.sources.push(osc);
        break;
      }
      case 'grain': {
        // R8.9: a 4 ms noise burst with a 2 ms decay; with a pitch, band-passed there (Q-72).
        end = when + NOISE_BURST_S + NOISE_DECAY_S;
        g.setValueAtTime(gain, when);
        g.setValueAtTime(gain, when + NOISE_BURST_S);
        g.linearRampToValueAtTime(0, end);
        const src = this.noiseSource(ctx);
        if (pitch !== undefined && Number.isFinite(pitch)) {
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = pitchToHz(pitch);
          bp.Q.value = GRAIN_BANDPASS_Q;
          src.connect(bp);
          bp.connect(env);
          voice.nodes.push(bp);
        } else {
          src.connect(env);
        }
        voice.sources.push(src);
        break;
      }
      case 'surf': {
        // D-12 ocean: low-passed noise that swells and fades.
        end = when + SURF_DURATION_S;
        g.linearRampToValueAtTime(gain, when + SURF_DURATION_S / 2);
        g.linearRampToValueAtTime(0, end);
        const src = this.noiseSource(ctx);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = SURF_LOWPASS_HZ;
        src.connect(lp);
        lp.connect(env);
        voice.sources.push(src);
        voice.nodes.push(lp);
        break;
      }
    }

    for (const src of voice.sources) {
      src.start(when);
      src.stop(end + 0.01);
    }
    this.track(voice);
  }

  /** Keep a sound until it ends (then disconnect it), so `stop` / `stopTrain` can cancel it. */
  /**
   * Keep a sound until all its sources have ended (then disconnect it), so `stop` / `stopTrain`
   * can cancel it. At most MAX_AUDIO_VOICES live at once: the oldest is cut first.
   */
  private track(voice: Voice): void {
    let playing = voice.sources.length;
    const ended = () => {
      if (--playing === 0 && this.live.delete(voice)) {
        this.release(voice, false);
        this.syncDuck();
      }
    };
    for (const src of voice.sources) src.onended = ended;
    while (this.live.size >= MAX_AUDIO_VOICES) {
      const oldest = this.live.values().next().value as Voice;
      this.live.delete(oldest);
      this.release(oldest, true);
    }
    this.live.add(voice);
    this.syncDuck(voice.when);
  }

  /**
   * Hold the ambience duck while any voice lives and let go when the last one ends or is cut
   * (R13.9). Each new voice re-arms the safety timeout: its start + the longest voice (the bell)
   * + DUCK_SAFETY_S, so a missed `onended` (a suspended context) cannot keep the duck.
   */
  private syncDuck(whenS?: number): void {
    if (this.live.size === 0 || !this.ctx) {
      this.duck?.release();
      this.duck = null;
      return;
    }
    if (!this.duck || this.duck.released) this.duck = holdDuck(this.ctx);
    if (whenS !== undefined) {
      this.duck.extend(Math.max(0, whenS - this.ctx.currentTime) + CHIME_DECAY_S + DUCK_SAFETY_S);
    }
  }

  private noiseSource(ctx: AudioContext): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    return src;
  }

  /** Stop (when cancelling) and disconnect every node of a sound, so nothing leaks. */
  private release(v: Voice, cancel: boolean): void {
    for (const s of v.sources) {
      if (cancel) {
        s.onended = null;
        try {
          s.stop();
        } catch {
          // Already stopped.
        }
      }
      s.disconnect();
    }
    for (const n of v.nodes) n.disconnect();
  }
}
