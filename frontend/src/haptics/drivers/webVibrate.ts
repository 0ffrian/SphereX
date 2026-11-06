// R8.3, R8.8, D-09: the navigator.vibrate driver (Android Chrome). Durations only, no amplitude
// [verify on phones], so strength is quantised into 3–4 equal bins (D-09); fine detail lives in
// rhythm, rate and spacing. Each call cancels the previous pattern. iPhone, iPad and desktop have
// no navigator.vibrate: `supported` is false there and every call is a silent no-op (R11).
import type { HapticEvent } from '@/contract';
import type { TrainCapableDriver, TrainWindow } from '../haptics';
import {
  DOUBLE_PATTERN,
  HEARTBEAT_PATTERN,
  MAX_PATTERN,
  TRAIN_WINDOW_MS,
  VIBRATE_LEVELS_MS,
} from '../tuning';

/** One strength level: a tick length in ms, or a pulse-width pattern (the whisper, R8.3). */
export type VibrateLevel = number | readonly number[];

/** `navigator.vibrate`. It must copy the pattern (the browser does); the driver reuses its array. */
export type VibrateFn = (pattern: number | number[]) => boolean;

export interface WebVibrateOptions {
  /** Injected for tests. `null` means unsupported. Default: `navigator.vibrate` when it exists. */
  vibrate?: VibrateFn | null;
  /** Default VIBRATE_LEVELS_MS (soft, medium, firm). */
  levels?: readonly VibrateLevel[];
}

function browserVibrate(): VibrateFn | null {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return null;
  return (pattern) => navigator.vibrate(pattern);
}

function validLevel(l: VibrateLevel): boolean {
  if (typeof l === 'number') return Number.isFinite(l) && l > 0;
  return l.length > 0 && l.every((v) => Number.isFinite(v) && v >= 0) && l.some((v) => v > 0);
}

/** Total length in ms of a level. */
export function levelDurationMs(level: VibrateLevel): number {
  return typeof level === 'number' ? level : level.reduce((a, b) => a + b, 0);
}

/** D-09: strength 0–1 → level index, splitting 0–1 into `count` equal bins. */
export function quantise(strength: number, count: number): number {
  if (count <= 1) return 0;
  const s = Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0;
  return Math.min(count - 1, Math.floor(s * count));
}

export class WebVibrateDriver implements TrainCapableDriver {
  readonly supported: boolean;
  private readonly vibrateFn: VibrateFn | null;
  private levelList: VibrateLevel[];
  private delay = 0;
  /** A pattern was sent since the last stop. Stopping is skipped otherwise: a vibrate(0) before
   * the first tap only logs a "blocked" intervention in Chrome. */
  private sent = false;
  /** Reused pattern buffer: even indices vibrate, odd indices pause. */
  private readonly buf: number[] = [];

  constructor(options: WebVibrateOptions = {}) {
    this.vibrateFn = options.vibrate !== undefined ? options.vibrate : browserVibrate();
    this.supported = this.vibrateFn !== null;
    this.levelList = [...VIBRATE_LEVELS_MS];
    if (options.levels) this.setLevels(options.levels);
  }

  /**
   * The levels the phone renders distinctly, weakest first (R8.7 step 2): 3 (soft, medium, firm)
   * or 4 (whisper first). Invalid input is ignored and returns false.
   */
  setLevels(levels: readonly VibrateLevel[]): boolean {
    if (levels.length < 1 || levels.length > 4 || !levels.every(validLevel)) return false;
    this.levelList = levels.map((l) => (typeof l === 'number' ? l : [...l]));
    return true;
  }

  get levels(): readonly VibrateLevel[] {
    return this.levelList;
  }

  levelIndex(strength: number): number {
    return quantise(strength, this.levelList.length);
  }

  /** R8.9 offset: delay every vibration by this many ms (when sound is heard later than felt). */
  setDelayMs(ms: number): void {
    this.delay = Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0;
  }

  get delayMs(): number {
    return this.delay;
  }

  emit(e: HapticEvent): void {
    if (!this.vibrateFn) return;
    switch (e.kind) {
      case 'tick':
        this.begin();
        this.pushLevel(this.levelFor(e.strength));
        this.play();
        break;
      case 'double':
        this.begin();
        this.pushLevel(DOUBLE_PATTERN);
        this.play();
        break;
      case 'heartbeat':
        this.begin();
        this.pushLevel(HEARTBEAT_PATTERN);
        this.play();
        break;
      case 'pulseTrain': {
        // R8.8 fallback, without phase: one window from now. The engine sends playTrain instead.
        const rate = e.rateHz ?? 0;
        if (!(rate > 0)) return;
        const period = 1000 / rate;
        this.begin();
        let cursor = 0;
        for (let t = 0; t < TRAIN_WINDOW_MS; t += period)
          cursor = this.pushPulse(t, cursor, e.strength, period);
        this.play();
        break;
      }
      case 'stop':
        this.stop();
        break;
    }
  }

  playTrain(w: TrainWindow): void {
    if (!this.vibrateFn || w.pulseOffsetsMs.length === 0) return;
    const period = 1000 / w.rateHz;
    this.begin();
    let cursor = 0;
    for (const t of w.pulseOffsetsMs) cursor = this.pushPulse(t, cursor, w.strength, period);
    this.play();
  }

  oneShotBlockMs(e: HapticEvent): number {
    if (!this.vibrateFn) return 0;
    switch (e.kind) {
      case 'tick':
        return this.delay + levelDurationMs(this.levelFor(e.strength));
      case 'double':
        return this.delay + levelDurationMs(DOUBLE_PATTERN);
      case 'heartbeat':
        return this.delay + levelDurationMs(HEARTBEAT_PATTERN);
      default:
        return 0;
    }
  }

  stop(): void {
    if (!this.sent || !this.vibrateFn) return;
    this.sent = false;
    this.vibrateFn(0);
  }

  // ------------------------------------------------------------ pattern building

  private levelFor(strength: number): VibrateLevel {
    return this.levelList[this.levelIndex(strength)]!;
  }

  /** Start a pattern; a delay becomes a leading zero-length vibration and a pause [verify on phones]. */
  private begin(): void {
    this.buf.length = 0;
    if (this.delay > 0) this.pause(this.delay);
  }

  private vib(ms: number): void {
    const b = this.buf;
    if (b.length % 2 === 1) b[b.length - 1]! += ms;
    else b.push(ms);
  }

  private pause(ms: number): void {
    if (!(ms > 0)) return;
    const b = this.buf;
    if (b.length === 0) b.push(0, ms);
    else if (b.length % 2 === 0) b[b.length - 1]! += ms;
    else b.push(ms);
  }

  private pushLevel(level: VibrateLevel): void {
    if (typeof level === 'number') this.vib(level);
    else level.forEach((v, i) => (i % 2 === 0 ? this.vib(v) : this.pause(v)));
  }

  /**
   * One train pulse at `t` ms (after the delay). The pulse is at most half the period long, so
   * pulses stay apart at high rates. Returns the new cursor (end of this pulse).
   */
  private pushPulse(t: number, cursor: number, strength: number, period: number): number {
    const start = Math.max(cursor, Math.round(t));
    this.pause(start - cursor);
    const level = this.levelFor(strength);
    const cap = Math.max(1, Math.floor(period / 2));
    const fitted: VibrateLevel =
      levelDurationMs(level) <= cap
        ? level
        : Math.min(cap, typeof level === 'number' ? level : cap);
    this.pushLevel(fitted);
    return start + levelDurationMs(fitted);
  }

  private play(): void {
    const b = this.buf;
    if (b.length === 0 || !this.vibrateFn) return;
    if (b.length > MAX_PATTERN) b.length = MAX_PATTERN;
    this.sent = true;
    this.vibrateFn(b.length === 1 ? b[0]! : b);
  }
}
