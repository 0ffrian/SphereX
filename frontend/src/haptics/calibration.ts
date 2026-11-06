// R8.7 per-device calibration (D-09, D-10): the faintest pulse (`minMs`), the levels the phone
// renders distinctly, and the audio–vibration offset (`avOffsetMs`). Types and the offset rule
// (#9); the maths behind the three wizard steps, the beat patterns and the persistence (#10).
// Pure apart from `localStorage`, which is read only when a function asks for it, never at import.
import type { HapticOutputs, TrainWindow } from './haptics';
import { levelDurationMs, type VibrateLevel } from './drivers/webVibrate';
import { platformEnv, type PlatformEnv } from './platform';
import {
  AV_OFFSET_MAX_MS,
  CALIBRATION_GAP_MS,
  CALIBRATION_LEVEL_STEP_MS,
  CALIBRATION_MIN_MS_CEIL,
  CALIBRATION_MIN_MS_FLOOR,
  CALIBRATION_PROBE_MS,
  STRENGTH_FIRM,
  TAP_BEAT_COUNT,
  TAP_BEAT_PERIOD_MS,
  TAP_MAX_SPREAD_MS,
  TAP_MIN_TAPS,
  TAP_WARMUP_BEATS,
  VIBRATE_LEVELS_MS,
  WHISPER_PATTERN,
} from './tuning';

export type CalibrationLevel = 'whisper' | 'soft' | 'medium' | 'firm';

export const CALIBRATION_VERSION = 1;

/** One `localStorage` key per device for the whole calibration (R8.7). */
export const CALIBRATION_STORAGE_KEY = 'sx.haptics.calibration';

export interface Calibration {
  version: typeof CALIBRATION_VERSION;
  /** R8.7 step 1: the faintest pulse felt, in ms; becomes the soft tick. */
  minMs: number;
  /** R8.7 step 2: the levels the phone renders distinctly, weakest first (3 or 4). */
  levels: CalibrationLevel[];
  /**
   * R8.7 step 3: mean tap lag to vibration minus mean tap lag to sound, in ms. Positive: vibration
   * is felt later than sound is heard, so the audio is delayed (R8.9); negative: the vibration is.
   */
  avOffsetMs: number;
}

/** R8.7: the level sets a calibration can hold. The whisper is kept only when it is distinct. */
export const THREE_LEVELS: readonly CalibrationLevel[] = ['soft', 'medium', 'firm'];
export const FOUR_LEVELS: readonly CalibrationLevel[] = ['whisper', 'soft', 'medium', 'firm'];

/** What an uncalibrated phone uses, and what a skipped step keeps: R8.3's 8/15/25 ms, no offset. */
export function defaultCalibration(): Calibration {
  return {
    version: CALIBRATION_VERSION,
    minMs: VIBRATE_LEVELS_MS[0]!,
    levels: [...THREE_LEVELS],
    avOffsetMs: 0,
  };
}

/**
 * R8.7 "first use, on phones that vibrate": a vibrate API **and** an Android phone with a touch
 * screen (the platform.ts rule, Q-61). Desktop Chrome and Chromebooks have `navigator.vibrate` but
 * no phone motor, so they are not offered calibration.
 */
export function calibrationAvailable(
  vibrateSupported: boolean,
  env: PlatformEnv = platformEnv(),
): boolean {
  return vibrateSupported && env.android && env.coarsePointer;
}

// ------------------------------------------------------------------ levels (R8.3, R8.7, D-09)

/**
 * Vibrate levels for a calibration, weakest first. Whisper → WHISPER_PATTERN; soft → `minMs`;
 * medium and firm → R8.3's 15 and 25 ms, each raised to at least the level below it plus
 * CALIBRATION_LEVEL_STEP_MS, so the tick lengths are strictly increasing whatever `minMs` is (Q-62).
 */
export function levelsToVibrate(cal: Calibration): VibrateLevel[] {
  const soft = cal.minMs;
  const medium = Math.max(VIBRATE_LEVELS_MS[1]!, soft + CALIBRATION_LEVEL_STEP_MS);
  const firm = Math.max(VIBRATE_LEVELS_MS[2]!, medium + CALIBRATION_LEVEL_STEP_MS);
  const ms: Record<Exclude<CalibrationLevel, 'whisper'>, number> = { soft, medium, firm };
  return cal.levels.map((l) => (l === 'whisper' ? [...WHISPER_PATTERN] : ms[l]));
}

/** R8.7 step 1: the probe the user picked as the faintest felt (index into the probes). */
export function minMsFromAnswer(
  faintestIndex: number | null,
  probes: readonly number[] = CALIBRATION_PROBE_MS,
): number {
  const v = faintestIndex === null ? undefined : probes[faintestIndex];
  return v !== undefined && validMinMs(v) ? v : defaultCalibration().minMs;
}

/** R8.7 step 2 answers about the whisper (the only level that may be dropped). */
export interface LevelAnswers {
  /** The whisper was felt at all. */
  whisperFelt: boolean;
  /**
   * It felt weaker than the soft tick. A pulse-width whisper has more on-time than a short soft
   * tick ([4,4,4,4,4] is 12 ms on against `minMs` = 5), so only the user can say which is weaker;
   * one that feels the same or stronger is dropped, so the levels stay weakest first (Q-62).
   */
  whisperWeaker: boolean;
}

/** R8.7 step 2: 4 levels when the whisper is felt and weaker than soft, otherwise 3. */
export function levelSetFromAnswers(a: LevelAnswers): CalibrationLevel[] {
  return a.whisperFelt && a.whisperWeaker ? [...FOUR_LEVELS] : [...THREE_LEVELS];
}

// ------------------------------------------------------------------ vibrate patterns for the wizard

/** Append one level (a length or a pulse-width pattern) to a vibrate pattern. */
function appendLevel(out: number[], level: VibrateLevel): void {
  const parts = typeof level === 'number' ? [level] : level;
  parts.forEach((v, i) => {
    const vibrating = i % 2 === 0;
    const atVibrate = out.length % 2 === 0; // the next entry would be a vibration
    if (vibrating === atVibrate) out.push(v);
    else out[out.length - 1]! += v; // merge with the previous entry of the same kind
  });
}

function appendPause(out: number[], ms: number): void {
  if (out.length % 2 === 1) out.push(ms);
  else if (out.length > 0) out[out.length - 1]! += ms;
}

/**
 * One `navigator.vibrate` pattern that plays each level in turn with `gapMs` between them: R8.7
 * step 1 (the 5/10/20 ms probes) and step 2 (whisper, soft, medium, firm).
 */
export function sequencePattern(
  levels: readonly VibrateLevel[],
  gapMs: number = CALIBRATION_GAP_MS,
): number[] {
  const out: number[] = [];
  levels.forEach((l, i) => {
    if (i > 0) appendPause(out, gapMs);
    appendLevel(out, l);
  });
  return out;
}

/** Start time (ms from the pattern's start) of each level in `sequencePattern`. */
export function sequenceOnsetsMs(
  levels: readonly VibrateLevel[],
  gapMs: number = CALIBRATION_GAP_MS,
): number[] {
  const onsets: number[] = [];
  let t = 0;
  for (const l of levels) {
    onsets.push(t);
    t += levelDurationMs(l) + gapMs;
  }
  return onsets;
}

// ------------------------------------------------------------------ tap-along (R8.7 step 3, Q-63)

export interface BeatPlan {
  periodMs: number;
  count: number;
  /** Beat start times relative to the moment the beat is requested (ms). */
  offsetsMs: number[];
}

export function beatPlan(
  periodMs: number = TAP_BEAT_PERIOD_MS,
  count: number = TAP_BEAT_COUNT,
): BeatPlan {
  const offsetsMs: number[] = [];
  for (let k = 0; k < count; k++) offsetsMs.push(k * periodMs);
  return { periodMs, count, offsetsMs };
}

/** The vibration-only beat: one pattern of firm ticks (R8.3's firm length), one per period. */
export function vibrationBeatPattern(plan: BeatPlan = beatPlan()): number[] {
  const firm = VIBRATE_LEVELS_MS[VIBRATE_LEVELS_MS.length - 1]!;
  const out: number[] = [];
  for (let k = 0; k < plan.count; k++) {
    if (k > 0) out.push(Math.max(0, plan.periodMs - firm));
    out.push(firm);
  }
  return out;
}

/**
 * `trainSeq` of the calibration beat. The engine numbers its trains from 1 and the audio driver's
 * "no anchor" is −1, so after a `stop()` this always starts a fresh audio-clock anchor.
 */
export const CALIBRATION_TRAIN_SEQ = -2;

/**
 * The sound-only beat as one train window for the audio driver: the `measured` clean tone at full
 * strength, scheduled on the audio clock with the driver's own lookahead, exactly as an event
 * emitted at each beat time would be (so the measured lag includes that lookahead). Stop the
 * driver first, so the window anchors at `currentTime` + lookahead.
 */
export function soundBeatWindow(plan: BeatPlan = beatPlan(), atMs = 0): TrainWindow {
  return {
    rateHz: 1000 / plan.periodMs,
    strength: STRENGTH_FIRM,
    tag: 'measured',
    pulseOffsetsMs: plan.offsetsMs,
    resentCount: 0,
    atMs,
    trainSeq: CALIBRATION_TRAIN_SEQ,
  };
}

export type TapLag =
  | {
      ok: true;
      /** Median lag (ms), positive when the taps come after the beats. */ lagMs: number;
      /** Median absolute deviation of the lags (ms). */ spreadMs: number;
      taps: number;
    }
  | { ok: false; reason: 'too-few' | 'irregular'; taps: number };

function median(sorted: readonly number[]): number {
  const n = sorted.length;
  const m = n >> 1;
  return n % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
}

/**
 * How far the taps lag the beats (R8.7 step 3, Q-63). Each tap is matched to the nearest beat;
 * taps on the warm-up beats, beyond the last beat or more than half a period away, and second taps
 * on a beat are ignored. The lag is the **median** of the rest, so a stray tap or one matched to
 * the wrong beat does not move it. A run with fewer than `minTaps` taps, or whose taps scatter
 * more than `maxSpreadMs` (median absolute deviation, e.g. a lag near half a period that wraps
 * between two beats), is refused. Times share one clock (e.g. `performance.now`).
 */
export function tapLag(
  tapTimes: readonly number[],
  beatTimes: readonly number[],
  periodMs: number = TAP_BEAT_PERIOD_MS,
  warmup: number = TAP_WARMUP_BEATS,
  minTaps: number = TAP_MIN_TAPS,
  maxSpreadMs: number = TAP_MAX_SPREAD_MS,
): TapLag {
  if (beatTimes.length === 0 || !(periodMs > 0)) return { ok: false, reason: 'too-few', taps: 0 };
  const used = new Set<number>();
  const lags: number[] = [];
  const first = beatTimes[0]!;
  for (const tap of tapTimes) {
    if (!Number.isFinite(tap)) continue;
    const k = Math.round((tap - first) / periodMs);
    if (k < warmup || k >= beatTimes.length || used.has(k)) continue;
    const lag = tap - beatTimes[k]!;
    if (Math.abs(lag) > periodMs / 2) continue;
    used.add(k);
    lags.push(lag);
  }
  if (lags.length < minTaps) return { ok: false, reason: 'too-few', taps: lags.length };
  lags.sort((x, y) => x - y);
  const lagMs = median(lags);
  const spreadMs = median(lags.map((l) => Math.abs(l - lagMs)).sort((x, y) => x - y));
  if (spreadMs > maxSpreadMs) return { ok: false, reason: 'irregular', taps: lags.length };
  return { ok: true, lagMs, spreadMs, taps: lags.length };
}

/**
 * R8.7 step 3: avOffsetMs = tap lag to the vibration − tap lag to the sound, rounded.
 * Null when either lag is missing or the result is beyond ±AV_OFFSET_MAX_MS (a failed run).
 */
export function computeAvOffset(
  vibrationLagMs: number | null,
  soundLagMs: number | null,
): number | null {
  if (vibrationLagMs === null || soundLagMs === null) return null;
  const off = Math.round(vibrationLagMs - soundLagMs);
  return Number.isFinite(off) && Math.abs(off) <= AV_OFFSET_MAX_MS ? off : null;
}

// ------------------------------------------------------------------ validation and persistence

function validMinMs(v: unknown): v is number {
  return (
    typeof v === 'number' &&
    Number.isFinite(v) &&
    v >= CALIBRATION_MIN_MS_FLOOR &&
    v <= CALIBRATION_MIN_MS_CEIL
  );
}

function sameLevels(a: readonly unknown[], b: readonly CalibrationLevel[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** A stored or given value as a Calibration, or null when anything about it is invalid. */
export function parseCalibration(raw: unknown): Calibration | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== CALIBRATION_VERSION) return null;
  if (!validMinMs(r.minMs)) return null;
  const levels = r.levels;
  if (
    !Array.isArray(levels) ||
    !(sameLevels(levels, THREE_LEVELS) || sameLevels(levels, FOUR_LEVELS))
  )
    return null;
  const off = r.avOffsetMs;
  if (typeof off !== 'number' || !Number.isFinite(off) || Math.abs(off) > AV_OFFSET_MAX_MS)
    return null;
  return {
    version: CALIBRATION_VERSION,
    minMs: r.minMs,
    levels: [...(levels as CalibrationLevel[])],
    avOffsetMs: off,
  };
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // Access can throw (blocked site data).
  }
}

/** The calibration saved on this device, or null (none, corrupt, or storage blocked). Never throws. */
export function loadCalibration(): Calibration | null {
  try {
    const text = storage()?.getItem(CALIBRATION_STORAGE_KEY);
    return text ? parseCalibration(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

/** Save under the one key. Returns false when the value is invalid or storage refuses it. */
export function saveCalibration(cal: Calibration): boolean {
  const valid = parseCalibration(cal);
  if (!valid) return false;
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(valid));
    return true;
  } catch {
    return false; // Quota or blocked storage: the calibration still applies for this session.
  }
}

export function clearCalibration(): void {
  try {
    storage()?.removeItem(CALIBRATION_STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

// ------------------------------------------------------------------ applying

/**
 * Apply a calibration to the web drivers: the vibrate levels, and the R8.9 offset rule. A positive
 * `avOffsetMs` (vibration felt later) delays the audio by it; otherwise the vibration is delayed.
 */
export function applyCalibration(outputs: HapticOutputs, cal: Calibration): void {
  outputs.vibrate.setLevels(levelsToVibrate(cal));
  const off = Number.isFinite(cal.avOffsetMs) ? cal.avOffsetMs : 0;
  outputs.audio.setOffsetMs(off > 0 ? off : 0);
  outputs.vibrate.setDelayMs(off < 0 ? -off : 0);
}

/** Load this device's calibration and apply it; with none saved, apply the defaults. */
export function applyStoredCalibration(outputs: HapticOutputs): Calibration | null {
  const cal = loadCalibration();
  applyCalibration(outputs, cal ?? defaultCalibration());
  return cal;
}
