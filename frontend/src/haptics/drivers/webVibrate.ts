// R8.3, R8.8, D-09: the navigator.vibrate driver (Android Chrome). Durations only, no amplitude
// [verify on phones], so strength is quantised into 3–4 equal bins (D-09); fine detail lives in
// rhythm, rate and spacing. Each call cancels the previous pattern. iPhone, iPad and desktop have
// no navigator.vibrate: `supported` is false there and every call is a silent no-op (R11).
import type { HapticEvent } from '@/contract';
import type { HapticTimers, TrainCapableDriver, TrainWindow } from '../haptics';
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
  /** Timers for the R8.9 delay. Default: the global timers. */
  timers?: HapticTimers;
}

function browserVibrate(): VibrateFn | null {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return null;
  return (pattern) => navigator.vibrate(pattern);
}

function defaultTimers(): HapticTimers {
  return {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>),
  };
}

/** Total length in ms of a level. */
export function levelDurationMs(level: VibrateLevel): number {
  return typeof level === 'number' ? level : level.reduce((a, b) => a + b, 0);
}

function validPattern(l: readonly number[]): boolean {
  return l.length > 0 && l.every((v) => Number.isFinite(v) && v >= 0) && l.some((v) => v > 0);
}

/**
 * A valid level set, weakest first: 1–4 levels (D-09 uses 3 or 4). Only the first may be a
 * pulse-width pattern (the whisper); the tick lengths after it must be positive and strictly
 * increasing.
 */
export function validLevels(levels: readonly VibrateLevel[]): boolean {
  if (levels.length < 1 || levels.length > 4) return false;
  let prev = 0;
  for (const [i, l] of levels.entries()) {
    if (typeof l !== 'number') {
      if (i !== 0 || !validPattern(l)) return false;
      continue;
    }
    if (!Number.isFinite(l) || l <= prev) return false;
    prev = l;
  }
  return true;
}

/** D-09: strength 0–1 → level index, splitting 0–1 into `count` equal bins. */
export function quantise(strength: number, count: number): number {
  if (count <= 1) return 0;
  const s = Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0;
  return Math.min(count - 1, Math.floor(s * count));
}

/**
 * A level shortened to at most `capMs`. A tick length is clipped; a pulse-width pattern keeps its
 * pulse width and loses its tail, so a whisper never turns into a solid, stronger pulse.
 */
export function fitLevel(level: VibrateLevel, capMs: number): VibrateLevel {
  if (levelDurationMs(level) <= capMs) return level;
  if (typeof level === 'number') return capMs;
  const out: number[] = [];
  let total = 0;
  for (const [i, v] of level.entries()) {
    if (total + v > capMs) break;
    out.push(v);
    total += v;
    if (i % 2 === 1 && total >= capMs) break;
  }
  if (out.length % 2 === 0) out.pop(); // end on a vibration
  return out.length > 0 ? out : Math.min(capMs, level[0] ?? capMs);
}

interface Deferred {
  handle: unknown;
  readonly train: boolean;
}

export class WebVibrateDriver implements TrainCapableDriver {
  readonly supported: boolean;
  private readonly vibrateFn: VibrateFn | null;
  private readonly timers: HapticTimers;
  private levelList: VibrateLevel[];
  private delay = 0;
  /**
   * A pattern was sent since the last stop. Stopping is skipped otherwise: a vibrate(0) before
   * the first tap only logs a "blocked" intervention in Chrome.
   */
  private sent = false;
  /** The last pattern handed to navigator.vibrate was a train window (not a one-shot). */
  private lastWasTrain = false;
  /** Patterns waiting for the R8.9 delay. */
  private readonly deferred = new Set<Deferred>();
  /** Reused pattern buffer: even indices vibrate, odd indices pause. */
  private readonly buf: number[] = [];

  constructor(options: WebVibrateOptions = {}) {
    this.vibrateFn = options.vibrate !== undefined ? options.vibrate : browserVibrate();
    this.supported = this.vibrateFn !== null;
    this.timers = options.timers ?? defaultTimers();
    this.levelList = [...VIBRATE_LEVELS_MS];
    if (options.levels) this.setLevels(options.levels);
  }

  /**
   * The levels the phone renders distinctly, weakest first (R8.7 step 2): 3 (soft, medium, firm)
   * or 4 (whisper first), see `validLevels`. Invalid input is ignored and returns false.
   */
  setLevels(levels: readonly VibrateLevel[]): boolean {
    if (!validLevels(levels)) return false;
    this.levelList = levels.map((l) => (typeof l === 'number' ? l : [...l]));
    return true;
  }

  get levels(): readonly VibrateLevel[] {
    return this.levelList;
  }

  levelIndex(strength: number): number {
    return quantise(strength, this.levelList.length);
  }

  /**
   * R8.9 offset: delay every vibration by this many ms (when sound is heard later than felt).
   * Each pattern is handed to navigator.vibrate by a timer, so patterns keep their relative timing
   * and a later one cannot cancel an earlier one before it has played. Relies on Chrome's sticky
   * user activation for calls made outside the gesture [verify on phones].
   */
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
        this.buf.length = 0;
        this.pushLevel(this.levelFor(e.strength));
        this.play(false);
        break;
      case 'double':
        this.buf.length = 0;
        this.pushLevel(DOUBLE_PATTERN);
        this.play(false);
        break;
      case 'heartbeat':
        this.buf.length = 0;
        this.pushLevel(HEARTBEAT_PATTERN);
        this.play(false);
        break;
      case 'pulseTrain': {
        // R8.8 fallback, without phase: one window from now. The engine sends playTrain instead.
        const rate = e.rateHz ?? 0;
        if (!(rate > 0)) return;
        const period = 1000 / rate;
        this.buf.length = 0;
        let cursor = 0;
        for (let t = 0; t < TRAIN_WINDOW_MS; t += period)
          cursor = this.pushPulse(t, cursor, e.strength, period);
        this.play(true);
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
    this.buf.length = 0;
    let cursor = 0;
    for (const t of w.pulseOffsetsMs) cursor = this.pushPulse(t, cursor, w.strength, period);
    this.play(true);
  }

  /** The delay shifts one-shots and train windows alike, so it does not lengthen the block. */
  oneShotBlockMs(e: HapticEvent): number {
    if (!this.vibrateFn) return 0;
    switch (e.kind) {
      case 'tick':
        return levelDurationMs(this.levelFor(e.strength));
      case 'double':
        return levelDurationMs(DOUBLE_PATTERN);
      case 'heartbeat':
        return levelDurationMs(HEARTBEAT_PATTERN);
      default:
        return 0;
    }
  }

  /** Cancel train windows only; a playing or delayed one-shot is left alone. */
  stopTrain(): void {
    for (const d of this.deferred) {
      if (!d.train) continue;
      this.timers.clearTimeout(d.handle);
      this.deferred.delete(d);
    }
    if (this.sent && this.lastWasTrain) this.halt();
  }

  stop(): void {
    for (const d of this.deferred) this.timers.clearTimeout(d.handle);
    this.deferred.clear();
    if (this.sent) this.halt();
  }

  // ------------------------------------------------------------ pattern building

  private halt(): void {
    this.sent = false;
    this.lastWasTrain = false;
    this.vibrateFn?.(0);
  }

  private levelFor(strength: number): VibrateLevel {
    return this.levelList[this.levelIndex(strength)]!;
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
   * One train pulse at `t` ms. The pulse is at most half the period long, so pulses stay apart at
   * high rates. Returns the new cursor (end of this pulse).
   */
  private pushPulse(t: number, cursor: number, strength: number, period: number): number {
    const start = Math.max(cursor, Math.round(t));
    this.pause(start - cursor);
    const fitted = fitLevel(this.levelFor(strength), Math.max(1, Math.floor(period / 2)));
    this.pushLevel(fitted);
    return start + levelDurationMs(fitted);
  }

  private play(train: boolean): void {
    const b = this.buf;
    if (b.length === 0 || !this.vibrateFn) return;
    if (b.length > MAX_PATTERN) b.length = MAX_PATTERN;
    if (this.delay <= 0) {
      this.call(b.length === 1 ? b[0]! : b, train);
      return;
    }
    const pattern = b.length === 1 ? b[0]! : b.slice();
    const job: Deferred = { handle: null, train };
    job.handle = this.timers.setTimeout(() => {
      this.deferred.delete(job);
      this.call(pattern, train);
    }, this.delay);
    this.deferred.add(job);
  }

  private call(pattern: number | number[], train: boolean): void {
    this.sent = true;
    this.lastWasTrain = train;
    this.vibrateFn!(pattern);
  }
}
