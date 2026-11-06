// R8.7 calibration logic: minMs, the level set, strictly increasing levels, the tap-along offset
// (sign and maths), persistence across a module reload, validation and corrupt storage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioContext } from '@/test/fakeAudio';
import { FakeClock, fakeVibrate } from '@/test/fakeHaptics';
import {
  CALIBRATION_STORAGE_KEY,
  FOUR_LEVELS,
  THREE_LEVELS,
  applyStoredCalibration,
  beatPlan,
  clearCalibration,
  computeAvOffset,
  defaultCalibration,
  levelSetFromAnswers,
  levelsToVibrate,
  loadCalibration,
  meanTapLag,
  minMsFromAnswer,
  parseCalibration,
  saveCalibration,
  sequenceOnsetsMs,
  sequencePattern,
  soundBeatWindow,
  vibrationBeatPattern,
  type Calibration,
} from './calibration';
import { AudioDriver } from './drivers/audio';
import { WebVibrateDriver } from './drivers/webVibrate';
import { HapticEngine, type HapticOutputs } from './haptics';
import {
  AV_OFFSET_MAX_MS,
  CALIBRATION_GAP_MS,
  CALIBRATION_LEVEL_STEP_MS,
  CALIBRATION_PROBE_MS,
  TAP_BEAT_PERIOD_MS,
  WHISPER_PATTERN,
} from './tuning';

const cal = (over: Partial<Calibration> = {}): Calibration => ({
  version: 1,
  minMs: 10,
  levels: ['soft', 'medium', 'firm'],
  avOffsetMs: 0,
  ...over,
});

function outputs(): HapticOutputs {
  const clock = new FakeClock();
  const ctx = new FakeAudioContext();
  const vibrate = new WebVibrateDriver({ vibrate: fakeVibrate().fn });
  const audio = new AudioDriver({ context: () => ctx.asAudioContext(), supported: true });
  const engine = new HapticEngine([vibrate, audio], {
    clock: clock.clock,
    timers: clock,
    debugTarget: null,
  });
  return { engine, vibrate, audio };
}

describe('step 1: faintest pulse (minMs)', () => {
  it('is the probe picked; none felt keeps the R8.3 soft tick', () => {
    expect(CALIBRATION_PROBE_MS).toEqual([5, 10, 20]);
    expect(minMsFromAnswer(0)).toBe(5);
    expect(minMsFromAnswer(2)).toBe(20);
    expect(minMsFromAnswer(null)).toBe(8);
    expect(minMsFromAnswer(7)).toBe(8);
  });

  it('the probes play as one pattern, 700 ms apart', () => {
    expect(sequencePattern(CALIBRATION_PROBE_MS)).toEqual([5, 700, 10, 700, 20]);
    expect(sequenceOnsetsMs(CALIBRATION_PROBE_MS)).toEqual([0, 705, 1415]);
  });
});

describe('step 2: distinct levels (D-09)', () => {
  it('keeps the whisper only when it is felt and distinct', () => {
    expect(levelSetFromAnswers({ whisperFelt: true, whisperDistinct: true })).toEqual([
      ...FOUR_LEVELS,
    ]);
    expect(levelSetFromAnswers({ whisperFelt: true, whisperDistinct: false })).toEqual([
      ...THREE_LEVELS,
    ]);
    expect(levelSetFromAnswers({ whisperFelt: false, whisperDistinct: true })).toEqual([
      ...THREE_LEVELS,
    ]);
  });

  it('plays whisper, soft, medium and firm in turn, the whisper as its pulse-width pattern', () => {
    const levels = levelsToVibrate(cal({ minMs: 5, levels: [...FOUR_LEVELS] }));
    expect(levels).toEqual([[...WHISPER_PATTERN], 5, 15, 25]);
    const gap = CALIBRATION_GAP_MS;
    expect(sequencePattern(levels)).toEqual([4, 4, 4, 4, 4, gap, 5, gap, 15, gap, 25]);
  });

  it('tick lengths are strictly increasing whatever minMs is, soft = minMs (Q-62)', () => {
    for (const minMs of [1, 5, 8, 10, 14, 15, 20, 24, 30, 50]) {
      const v = levelsToVibrate(cal({ minMs })) as number[];
      expect(v[0]).toBe(minMs);
      expect(v[1]! - v[0]!).toBeGreaterThanOrEqual(CALIBRATION_LEVEL_STEP_MS);
      expect(v[2]! - v[1]!).toBeGreaterThanOrEqual(CALIBRATION_LEVEL_STEP_MS);
    }
    expect(levelsToVibrate(cal({ minMs: 8 }))).toEqual([8, 15, 25]);
    expect(levelsToVibrate(cal({ minMs: 20 }))).toEqual([20, 25, 30]);
  });
});

describe('step 3: tap-along offset (R8.7, R8.9 sign)', () => {
  const plan = beatPlan();
  const beats = (t0: number) => plan.offsetsMs.map((o) => t0 + o);

  it('the beats: firm ticks one period apart, and a measured tone window', () => {
    const pattern = vibrationBeatPattern(plan);
    expect(pattern).toHaveLength(2 * plan.count - 1);
    expect(pattern[0]).toBe(25);
    expect(pattern[1]! + pattern[2]!).toBe(TAP_BEAT_PERIOD_MS);
    const w = soundBeatWindow(plan);
    expect(w.tag).toBe('measured');
    expect(w.pulseOffsetsMs).toEqual(plan.offsetsMs);
    expect(w.resentCount).toBe(0);
  });

  it('mean lag skips warm-up beats, far taps and double taps', () => {
    const b = beats(1000);
    const taps = [
      b[0]! + 300 - 1, // warm-up beat: ignored
      b[1]! + 5, // warm-up beat: ignored
      b[2]! + 40,
      b[2]! + 60, // second tap on beat 2: ignored
      b[3]! + 50,
      b[4]! + 30,
      b[5]! + 40,
      b[6]! + 80,
    ];
    expect(meanTapLag(taps, b)).toBeCloseTo((40 + 50 + 30 + 40 + 80) / 5, 9);
  });

  it('taps before the beat count as negative lag', () => {
    const b = beats(0);
    const taps = [2, 3, 4, 5].map((k) => b[k]! - 20);
    expect(meanTapLag(taps, b)).toBe(-20);
  });

  it('too few taps give no lag, and no offset', () => {
    const b = beats(0);
    expect(meanTapLag([b[2]!, b[3]!, b[4]!], b)).toBeNull();
    expect(meanTapLag([], b)).toBeNull();
    expect(computeAvOffset(null, 10)).toBeNull();
    expect(computeAvOffset(10, null)).toBeNull();
  });

  it('vibration felt later gives a positive offset, which delays the audio', () => {
    const vibLag = meanTapLag(
      [2, 3, 4, 5, 6].map((k) => beats(0)[k]! + 120),
      beats(0),
    );
    const soundLag = meanTapLag(
      [2, 3, 4, 5, 6].map((k) => beats(5000)[k]! + 70),
      beats(5000),
    );
    const off = computeAvOffset(vibLag, soundLag);
    expect(off).toBe(50);
    const o = outputs();
    applyStoredCalibrationFrom(o, cal({ avOffsetMs: off! }));
    expect(o.audio.offsetMs).toBe(50);
    expect(o.vibrate.delayMs).toBe(0);
  });

  it('sound heard later (Bluetooth) gives a negative offset, which delays the vibration', () => {
    const off = computeAvOffset(60, 260);
    expect(off).toBe(-200);
    const o = outputs();
    applyStoredCalibrationFrom(o, cal({ avOffsetMs: off! }));
    expect(o.audio.offsetMs).toBe(0);
    expect(o.vibrate.delayMs).toBe(200);
  });

  it('an offset beyond the limit is a failed run', () => {
    expect(computeAvOffset(AV_OFFSET_MAX_MS + 50, 0)).toBeNull();
    expect(computeAvOffset(0, AV_OFFSET_MAX_MS)).toBe(-AV_OFFSET_MAX_MS);
  });
});

/** Save, then apply what is stored (the path the app takes on load). */
function applyStoredCalibrationFrom(o: HapticOutputs, c: Calibration) {
  expect(saveCalibration(c)).toBe(true);
  expect(applyStoredCalibration(o)).toEqual(c);
}

describe('persistence (R8.7: one key per device)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('saves under the one key and survives a module reload', async () => {
    const c = cal({ minMs: 5, levels: [...FOUR_LEVELS], avOffsetMs: -35 });
    expect(saveCalibration(c)).toBe(true);
    expect(Object.keys(localStorage)).toEqual([CALIBRATION_STORAGE_KEY]);
    vi.resetModules();
    const fresh = await import('./calibration');
    expect(fresh.loadCalibration()).toEqual(c);
    const o = outputs();
    expect(fresh.applyStoredCalibration(o)).toEqual(c);
    expect(o.vibrate.levels).toEqual([[...WHISPER_PATTERN], 5, 15, 25]);
    expect(o.vibrate.delayMs).toBe(35);
  });

  it('nothing saved: null, and the defaults are applied', () => {
    expect(loadCalibration()).toBeNull();
    const o = outputs();
    o.vibrate.setDelayMs(99);
    expect(applyStoredCalibration(o)).toBeNull();
    expect(o.vibrate.levels).toEqual(levelsToVibrate(defaultCalibration()));
    expect(o.vibrate.delayMs).toBe(0);
  });

  it.each([
    ['not JSON', '{oops'],
    ['an array', '[1,2]'],
    ['wrong version', JSON.stringify({ ...cal(), version: 2 })],
    ['minMs too large', JSON.stringify({ ...cal(), minMs: 500 })],
    ['minMs a string', JSON.stringify({ ...cal(), minMs: '10' })],
    ['two levels', JSON.stringify({ ...cal(), levels: ['soft', 'firm'] })],
    ['unknown level', JSON.stringify({ ...cal(), levels: ['soft', 'medium', 'loud'] })],
    ['levels out of order', JSON.stringify({ ...cal(), levels: ['firm', 'medium', 'soft'] })],
    ['offset missing', JSON.stringify({ version: 1, minMs: 10, levels: [...THREE_LEVELS] })],
    ['offset too large', JSON.stringify({ ...cal(), avOffsetMs: 5000 })],
  ])('corrupt storage (%s) loads as null without throwing', (_name, text) => {
    localStorage.setItem(CALIBRATION_STORAGE_KEY, text);
    expect(loadCalibration()).toBeNull();
    const o = outputs();
    expect(() => applyStoredCalibration(o)).not.toThrow();
  });

  it('blocked storage: load is null, save is false, clear does not throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(loadCalibration()).toBeNull();
    expect(saveCalibration(cal())).toBe(false);
    expect(() => clearCalibration()).not.toThrow();
  });

  it('refuses to save an invalid calibration, and clear removes the key', () => {
    expect(saveCalibration(cal({ minMs: Number.NaN }))).toBe(false);
    expect(localStorage.getItem(CALIBRATION_STORAGE_KEY)).toBeNull();
    saveCalibration(cal());
    clearCalibration();
    expect(localStorage.getItem(CALIBRATION_STORAGE_KEY)).toBeNull();
  });

  it('parse copies the levels (no shared array with the input)', () => {
    const input = cal();
    const parsed = parseCalibration(input)!;
    parsed.levels.push('firm');
    expect(input.levels).toHaveLength(3);
  });
});
