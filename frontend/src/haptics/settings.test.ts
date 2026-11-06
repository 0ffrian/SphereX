// R8.7: settings persistence (one key, corrupt storage → defaults), platform defaults,
// bindEngine, the shared AudioContext unlock, and applyCalibration's offset sign (R8.9).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioContext } from '@/test/fakeAudio';
import { FakeClock, fakeVibrate } from '@/test/fakeHaptics';
import {
  getAudioContext,
  getUnlockState,
  setAudioContextFactory,
  subscribeUnlockState,
  unlockAudio,
} from './audioContext';
import { applyCalibration, levelsToVibrate, type Calibration } from './calibration';
import { AudioDriver } from './drivers/audio';
import { WebVibrateDriver } from './drivers/webVibrate';
import { HapticEngine, type HapticOutputs } from './haptics';
import { defaultOutputs, deviceVibrates } from './platform';
import {
  SETTINGS_STORAGE_KEY,
  bindEngine,
  defaultSettings,
  ensureLoaded,
  getHapticSettings,
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

  it.each([
    [true, true, true, true],
    [true, true, false, false], // Android without a touch screen
    [true, false, true, false], // desktop Chrome: navigator.vibrate exists, no motor
    [false, true, true, false],
  ])('deviceVibrates(supported %s, android %s, coarse %s) → %s', (sup, android, coarse, out) => {
    expect(deviceVibrates(sup, { android, coarsePointer: coarse })).toBe(out);
  });

  it('desktop (jsdom) never vibrates, even with navigator.vibrate', () => {
    expect(deviceVibrates(true)).toBe(false);
  });
});

describe('settings store (R8.7)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
  });

  it('loads on the first read, so no consumer sees the unloaded defaults', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ volume: 0.1, soundOn: false }));
    const read = vi.spyOn(Storage.prototype, 'getItem');
    expect(read).not.toHaveBeenCalled(); // nothing read until a consumer asks
    expect(useHapticSettings.getState()).toMatchObject({
      loaded: true,
      volume: 0.1,
      soundOn: false,
    });
    expect(read).toHaveBeenCalledTimes(1);
    useHapticSettings.getState();
    getHapticSettings();
    ensureLoaded();
    expect(read).toHaveBeenCalledTimes(1); // once only
    read.mockRestore();
  });

  it('getHapticSettings loads too', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ soundOn: false }));
    expect(getHapticSettings().soundOn).toBe(false);
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

  it('makes a new context when the shared one was closed', async () => {
    const first = new FakeAudioContext();
    const second = new FakeAudioContext();
    const made = [first, second];
    setAudioContextFactory(() => made.shift()!.asAudioContext());
    await unlockAudio();
    expect(getAudioContext()).toBe(first);
    await first.close();
    expect(getAudioContext()).toBeNull();
    expect(await unlockAudio()).toBe(true);
    expect(getAudioContext()).toBe(second);
  });

  it('reports false where Web Audio is missing', async () => {
    setAudioContextFactory(() => null);
    expect(await unlockAudio()).toBe(false);
    expect(getUnlockState()).toEqual({ unlocked: true, audio: 'none' });
  });

  it('shares the unlock state with every subscriber', async () => {
    const ctx = new FakeAudioContext({ state: 'suspended' });
    setAudioContextFactory(() => ctx.asAudioContext());
    expect(getUnlockState()).toEqual({ unlocked: false, audio: 'suspended' });
    const seen: string[] = [];
    const off = subscribeUnlockState(() => seen.push(getUnlockState().audio));
    const before = getUnlockState();
    expect(getUnlockState()).toBe(before); // stable until it changes
    await unlockAudio();
    expect(getUnlockState()).toEqual({ unlocked: true, audio: 'running' });
    expect(seen).toEqual(['running']);
    const engine = new HapticEngine([], { debugTarget: null });
    expect(engine.unlocked).toBe(true);
    off();
  });

  it('engine.unlock uses it', async () => {
    const ctx = new FakeAudioContext({ state: 'suspended' });
    setAudioContextFactory(() => ctx.asAudioContext());
    const engine = new HapticEngine([], { debugTarget: null });
    expect(await engine.unlock()).toBe(true);
    expect(ctx.state).toBe('running');
  });
});
