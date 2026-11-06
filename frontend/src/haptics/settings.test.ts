// R8.7: settings persistence (one key, corrupt storage → defaults), platform defaults,
// bindEngine, the shared AudioContext unlock, and applyCalibration's offset sign (R8.9).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioContext } from '@/test/fakeAudio';
import { FakeClock, fakeVibrate } from '@/test/fakeHaptics';
import { getAudioContext, setAudioContextFactory, unlockAudio } from './audioContext';
import { applyCalibration, levelsToVibrate, type Calibration } from './calibration';
import { AudioDriver } from './drivers/audio';
import { WebVibrateDriver } from './drivers/webVibrate';
import { HapticEngine, type HapticOutputs } from './haptics';
import { defaultOutputs } from './platform';
import {
  SETTINGS_STORAGE_KEY,
  bindEngine,
  defaultSettings,
  ensureLoaded,
  loadHapticSettings,
  useHapticSettings,
} from './settings';
import { WHISPER_PATTERN } from './tuning';

function outputs(): HapticOutputs & { ctx: FakeAudioContext } {
  const clock = new FakeClock();
  const ctx = new FakeAudioContext();
  const vibrate = new WebVibrateDriver({ vibrate: fakeVibrate().fn });
  const audio = new AudioDriver({ context: () => ctx.asAudioContext(), supported: true });
  const engine = new HapticEngine([vibrate, audio], {
    clock: clock.clock,
    timers: clock,
    debugTarget: null,
  });
  return { engine, vibrate, audio, ctx };
}

function resetStore() {
  useHapticSettings.setState({
    ...defaultSettings({ hapticsOn: false, soundOn: true }),
    loaded: false,
  });
}

describe('platform defaults (R8.7, D-08)', () => {
  it.each([
    [true, true, { hapticsOn: true, soundOn: true }],
    [true, false, { hapticsOn: false, soundOn: true }],
    [false, true, { hapticsOn: false, soundOn: true }],
    [false, false, { hapticsOn: false, soundOn: true }],
  ])('android %s, coarse pointer %s → %o', (android, coarsePointer, expected) => {
    expect(defaultOutputs({ android, coarsePointer })).toEqual(expected);
  });

  it('jsdom (desktop) defaults to sound only', () => {
    expect(defaultOutputs()).toEqual({ hapticsOn: false, soundOn: true });
  });
});

describe('settings store (R8.7)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
  });

  it('does not read storage until first use', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ volume: 0.1 }));
    expect(useHapticSettings.getState().loaded).toBe(false);
    ensureLoaded();
    expect(useHapticSettings.getState()).toMatchObject({ loaded: true, volume: 0.1 });
  });

  it('saves under one key, clamped, and loads back', () => {
    useHapticSettings.getState().update({ volume: 2, strengthMultiplier: 0.1, hapticsOn: true });
    const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!);
    expect(saved).toEqual({
      hapticsOn: true,
      soundOn: true,
      volume: 1,
      strengthMultiplier: 0.5,
      showChannelLabels: true,
    });
    expect(Object.keys(localStorage)).toEqual([SETTINGS_STORAGE_KEY]);
    expect(loadHapticSettings()).toEqual(saved);
  });

  it.each(['{not json', '[1,2]', 'null', '"text"', JSON.stringify({ volume: 'loud', soundOn: 3 })])(
    'corrupt storage %s gives the defaults',
    (text) => {
      localStorage.setItem(SETTINGS_STORAGE_KEY, text);
      expect(loadHapticSettings()).toEqual(defaultSettings());
    },
  );

  it('survives storage that throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(loadHapticSettings()).toEqual(defaultSettings());
    expect(() => useHapticSettings.getState().update({ volume: 0.3 })).not.toThrow();
    expect(useHapticSettings.getState().volume).toBe(0.3);
    spy.mockRestore();
    set.mockRestore();
  });

  it('reset clears the key and restores the defaults', () => {
    useHapticSettings.getState().update({ volume: 0.2 });
    useHapticSettings.getState().reset();
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
    expect(useHapticSettings.getState().volume).toBe(defaultSettings().volume);
  });
});

describe('bindEngine', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
  });

  it('applies the settings now and on every change, until unsubscribed', () => {
    const o = outputs();
    const unbind = bindEngine(o);
    // jsdom: sound only by default.
    expect(o.engine.isDriverEnabled(o.vibrate)).toBe(false);
    expect(o.engine.isDriverEnabled(o.audio)).toBe(true);
    useHapticSettings
      .getState()
      .update({ hapticsOn: true, soundOn: false, volume: 0.25, strengthMultiplier: 1.2 });
    expect(o.engine.isDriverEnabled(o.vibrate)).toBe(true);
    expect(o.engine.isDriverEnabled(o.audio)).toBe(false);
    expect(o.audio.volume).toBe(0.25);
    expect(o.engine.strengthMultiplier).toBe(1.2);
    unbind();
    useHapticSettings.getState().update({ soundOn: true });
    expect(o.engine.isDriverEnabled(o.audio)).toBe(false);
  });
});

describe('applyCalibration (R8.7, R8.9 offset rule)', () => {
  const cal = (
    avOffsetMs: number,
    levels: Calibration['levels'] = ['soft', 'medium', 'firm'],
  ): Calibration => ({
    version: 1,
    minMs: 10,
    levels,
    avOffsetMs,
  });

  it('vibration felt later (positive offset) delays the audio', () => {
    const o = outputs();
    applyCalibration(o, cal(80));
    expect(o.audio.offsetMs).toBe(80);
    expect(o.vibrate.delayMs).toBe(0);
  });

  it('sound heard later (negative offset) delays the vibration', () => {
    const o = outputs();
    applyCalibration(o, cal(-60));
    expect(o.audio.offsetMs).toBe(0);
    expect(o.vibrate.delayMs).toBe(60);
  });

  it('sets the levels, soft = minMs, whisper as its pattern', () => {
    const o = outputs();
    applyCalibration(o, cal(0, ['whisper', 'soft', 'medium', 'firm']));
    expect(o.vibrate.levels).toEqual([[...WHISPER_PATTERN], 10, 15, 25]);
    expect(levelsToVibrate(cal(0))).toEqual([10, 15, 25]);
  });
});

describe('shared AudioContext (R8.9)', () => {
  afterEach(() => setAudioContextFactory(null));

  it('is created only by unlock, once, and resumed', async () => {
    const ctx = new FakeAudioContext({ state: 'suspended' });
    const factory = vi.fn(() => ctx.asAudioContext());
    setAudioContextFactory(factory);
    expect(getAudioContext()).toBeNull();
    expect(await unlockAudio()).toBe(true);
    expect(await unlockAudio()).toBe(true);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(ctx.resumes).toBe(1);
    expect(getAudioContext()).toBe(ctx);
  });

  it('reports false where Web Audio is missing', async () => {
    setAudioContextFactory(() => null);
    expect(await unlockAudio()).toBe(false);
  });

  it('engine.unlock uses it', async () => {
    const ctx = new FakeAudioContext({ state: 'suspended' });
    setAudioContextFactory(() => ctx.asAudioContext());
    const engine = new HapticEngine([], { debugTarget: null });
    expect(await engine.unlock()).toBe(true);
    expect(ctx.state).toBe('running');
  });
});
