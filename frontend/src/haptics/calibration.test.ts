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
  tapLag,
  CALIBRATION_TRAIN_SEQ,
  calibrationAvailable,
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
import { WebVibrateDriver, validLevels } from './drivers/webVibrate';
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

describe('where calibration runs (R8.7 "phones that vibrate")', () => {
  it('needs vibrate, Android and a touch screen', () => {
    expect(calibrationAvailable(true, { android: true, coarsePointer: true })).toBe(true);
    expect(calibrationAvailable(false, { android: true, coarsePointer: true })).toBe(false);
    expect(calibrationAvailable(true, { android: false, coarsePointer: true })).toBe(false);
    expect(calibrationAvailable(true, { android: true, coarsePointer: false })).toBe(false);
  });
});

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
  it('keeps the whisper only when it is felt and weaker than soft (Q-74)', () => {
    expect(levelSetFromAnswers({ whisperFelt: true, whisperWeaker: true })).toEqual([
      ...FOUR_LEVELS,
    ]);
    expect(levelSetFromAnswers({ whisperFelt: true, whisperWeaker: false })).toEqual([
      ...THREE_LEVELS,
    ]);
    expect(levelSetFromAnswers({ whisperFelt: false, whisperWeaker: true })).toEqual([
      ...THREE_LEVELS,
    ]);
  });

  it('every level set it makes is one the vibrate driver accepts (validLevels)', () => {
    for (const minMs of [1, 5, 8, 10, 20, 50]) {
      for (const levels of [THREE_LEVELS, FOUR_LEVELS]) {
        const v = levelsToVibrate(cal({ minMs, levels: [...levels] }));
        expect(validLevels(v), `${minMs} ms, ${levels.length} levels`).toBe(true);
        expect(new WebVibrateDriver({ vibrate: null }).setLevels(v)).toBe(true);
        if (levels.length === 4) expect(Array.isArray(v[0])).toBe(true); // whisper first
      }
    }
  });

  it('plays whisper, soft, medium and firm in turn, the whisper as its pulse-width pattern', () => {
    const levels = levelsToVibrate(cal({ minMs: 5, levels: [...FOUR_LEVELS] }));
    expect(levels).toEqual([[...WHISPER_PATTERN], 5, 15, 25]);
    const gap = CALIBRATION_GAP_MS;
    expect(sequencePattern(levels)).toEqual([4, 4, 4, 4, 4, gap, 5, gap, 15, gap, 25]);
  });

  it('tick lengths are strictly increasing and never above R8.3 25 ms, soft = minMs (Q-74)', () => {
    for (const minMs of [1, 5, 8, 10, 14, 15, 20, 23, 24, 30, 50]) {
      const v = levelsToVibrate(cal({ minMs })) as number[];
      expect(v[0]).toBe(Math.min(minMs, 23));
      expect(v[1]!).toBeGreaterThan(v[0]!);
      expect(v[2]!).toBeGreaterThan(v[1]!);
      expect(v[2]).toBe(25);
    }
    // The 5 ms step is kept where it fits under the cap.
    for (const minMs of [1, 5, 8, 10, 15]) {
      const v = levelsToVibrate(cal({ minMs })) as number[];
      expect(v[1]! - v[0]!).toBeGreaterThanOrEqual(CALIBRATION_LEVEL_STEP_MS);
    }
    expect(levelsToVibrate(cal({ minMs: 8 }))).toEqual([8, 15, 25]);
    expect(levelsToVibrate(cal({ minMs: 20 }))).toEqual([20, 22, 25]);
  });
});

describe('step 3: tap-along offset (R8.7, R8.9 sign)', () => {
  const plan = beatPlan();
  const beats = (t0: number) => plan.offsetsMs.map((o) => t0 + o);

  it('the beats: firm ticks one period apart, and a measured tone window on a fresh anchor', () => {
    const pattern = vibrationBeatPattern(plan);
    expect(pattern).toHaveLength(2 * plan.count - 1);
    expect(pattern[0]).toBe(25);
    expect(pattern[1]! + pattern[2]!).toBe(TAP_BEAT_PERIOD_MS);
    const w = soundBeatWindow(plan, 1234);
    expect(w.tag).toBe('measured');
    expect(w.pulseOffsetsMs).toEqual(plan.offsetsMs);
    expect(w.resentCount).toBe(0);
    expect(w.atMs).toBe(1234);
    expect(w.trainSeq).toBe(CALIBRATION_TRAIN_SEQ);
    expect(CALIBRATION_TRAIN_SEQ).toBeLessThan(-1);
  });

  it('the lag is the median: warm-up beats, far taps and double taps are skipped', () => {
    const b = beats(1000);
    const taps = [
      b[0]! + 300, // warm-up beat: ignored
      b[1]! + 5, // warm-up beat: ignored
      b[2]! + 40,
      b[2]! + 60, // second tap on beat 2: ignored
      b[3]! + 50,
      b[4]! + 30,
      b[5]! + 40,
      b[6]! + 80,
      b[7]! + 45,
    ];
    expect(tapLag(taps, b)).toEqual({ ok: true, lagMs: 42.5, spreadMs: 5, taps: 6 });
  });

  it('one stray tap does not move the median', () => {
    const b = beats(0);
    const taps = [2, 3, 4, 5, 6].map((k) => b[k]! + 100);
    taps.push(b[7]! - 350); // a wild early tap
    const r = tapLag(taps, b);
    expect(r.ok && r.lagMs).toBe(100);
  });

  it('taps before the beat count as negative lag', () => {
    const b = beats(0);
    const taps = [2, 3, 4, 5].map((k) => b[k]! - 20);
    expect(tapLag(taps, b)).toMatchObject({ ok: true, lagMs: -20 });
  });

  it('a lag near half a period wraps between beats and is refused as irregular', () => {
    const b = beats(0);
    const half = TAP_BEAT_PERIOD_MS / 2;
    // True lag ≈ half a period: half the taps land just before the midpoint (+385 ms, matched to
    // their beat), half just after it (matched to the next beat, −385 ms). A mean would say 0 ms.
    const taps = [
      ...[2, 3, 4].map((k) => b[k]! + half - 15),
      ...[5, 7, 8].map((k) => b[k]! + half + 15),
    ];
    expect(tapLag(taps, b)).toMatchObject({ ok: false, reason: 'irregular' });
    // Lags around ±300 ms are well inside the 800 ms period and measured.
    const late = [2, 3, 4, 5, 6].map((k) => b[k]! + 300);
    expect(tapLag(late, b)).toMatchObject({ ok: true, lagMs: 300 });
    const early = [2, 3, 4, 5, 6].map((k) => b[k]! - 300);
    expect(tapLag(early, b)).toMatchObject({ ok: true, lagMs: -300 });
  });

  it('scattered taps are refused; too few taps give no lag and no offset', () => {
    const b = beats(0);
    const scattered = [2, 3, 4, 5, 6, 7].map((k, i) => b[k]! + [0, 200, -150, 180, -100, 90][i]!);
    expect(tapLag(scattered, b)).toMatchObject({ ok: false, reason: 'irregular' });
    expect(tapLag([b[2]!, b[3]!, b[4]!], b)).toEqual({ ok: false, reason: 'too-few', taps: 3 });
    expect(tapLag([], b)).toMatchObject({ ok: false, reason: 'too-few' });
    expect(computeAvOffset(null, 10)).toBeNull();
    expect(computeAvOffset(10, null)).toBeNull();
  });

  it('vibration felt later gives a positive offset, which delays the audio', () => {
    const vib = tapLag(
      [2, 3, 4, 5, 6].map((k) => beats(0)[k]! + 120),
      beats(0),
    );
    const sound = tapLag(
      [2, 3, 4, 5, 6].map((k) => beats(9000)[k]! + 70),
      beats(9000),
    );
    const off = computeAvOffset(vib.ok ? vib.lagMs : null, sound.ok ? sound.lagMs : null);
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
