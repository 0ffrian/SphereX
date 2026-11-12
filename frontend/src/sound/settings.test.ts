// R8.7 / R13.9: settings persistence (one key, corrupt storage → defaults, old haptic fields
// ignored), bindEngine and the shared AudioContext unlock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioContext } from '@/test/fakeAudio';
import { FakeClock } from '@/test/fakeSound';
import {
  getAudioContext,
  getUnlockState,
  setAudioContextFactory,
  subscribeUnlockState,
  unlockAudio,
} from './audioContext';
import { AudioDriver } from './voices';
import { SoundEngine, createSoundEngine, type SoundOutputs } from './engine';
import { DEFAULT_VOLUME } from './tuning';
import {
  SETTINGS_STORAGE_KEY,
  ambienceLevelFor,
  bindEngine,
  defaultSettings,
  SAVE_DEBOUNCE_MS,
  bindPageLifecycle,
  stopWhenHidden,
  ensureLoaded,
  flushSoundSettings,
  getSoundSettings,
  loadSoundSettings,
  useSoundSettings,
} from './settings';

function outputs(): SoundOutputs & { ctx: FakeAudioContext } {
  const clock = new FakeClock();
  const ctx = new FakeAudioContext();
  const audio = new AudioDriver({ context: () => ctx.asAudioContext(), supported: true });
  const engine = new SoundEngine([audio], {
    clock: clock.clock,
    timers: clock,
    debugTarget: null,
  });
  return { engine, audio, ctx };
}

function resetStore() {
  useSoundSettings.setState({ ...defaultSettings(), loaded: false });
}

describe('settings store (R8.7)', () => {
  beforeEach(() => {
    flushSoundSettings(); // no debounced save from an earlier test may land in this one
    localStorage.clear();
    resetStore();
  });

  it('importing the module reads no storage (fresh module)', async () => {
    const read = vi.spyOn(Storage.prototype, 'getItem');
    vi.resetModules();
    const fresh = await import('./settings');
    expect(read).not.toHaveBeenCalled();
    fresh.useSoundSettings.getState();
    expect(read).toHaveBeenCalledTimes(1);
    read.mockRestore();
  });

  it('update() before any read loads first, so it cannot save over the stored settings', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ soundOn: false, volume: 0.2 }));
    useSoundSettings.getState().update({}); // getState() loads
    resetStore(); // and an update straight from the store object, without a read before it
    const { update } = useSoundSettings.getInitialState();
    update({});
    flushSoundSettings();
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!)).toMatchObject({
      soundOn: false,
      volume: 0.2,
    });
  });

  it('debounces saves during a drag and flushes when the page hides', () => {
    vi.useFakeTimers();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    for (let i = 0; i < 30; i++) useSoundSettings.getState().update({ volume: i / 30 });
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(write).toHaveBeenCalledTimes(1);
    useSoundSettings.getState().update({ volume: 0.9 });
    window.dispatchEvent(new Event('pagehide'));
    expect(write).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!).volume).toBe(0.9);
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    expect(write).toHaveBeenCalledTimes(2); // nothing left to save
    write.mockRestore();
    vi.useRealTimers();
  });

  it('loads on the first read, so no consumer sees the unloaded defaults', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ volume: 0.1, soundOn: false }));
    const read = vi.spyOn(Storage.prototype, 'getItem');
    expect(read).not.toHaveBeenCalled(); // nothing read until a consumer asks
    expect(useSoundSettings.getState()).toMatchObject({
      loaded: true,
      volume: 0.1,
      soundOn: false,
    });
    expect(read).toHaveBeenCalledTimes(1);
    useSoundSettings.getState();
    getSoundSettings();
    ensureLoaded();
    expect(read).toHaveBeenCalledTimes(1); // once only
    read.mockRestore();
  });

  it('getSoundSettings loads too', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ soundOn: false }));
    expect(getSoundSettings().soundOn).toBe(false);
  });

  it('saves under one key, clamped, and loads back', () => {
    useSoundSettings.getState().update({ volume: 2 });
    flushSoundSettings();
    const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!);
    expect(saved).toEqual({ ...defaultSettings(), volume: 1 });
    expect(Object.keys(localStorage)).toEqual([SETTINGS_STORAGE_KEY]);
    expect(loadSoundSettings()).toEqual(saved);
  });

  it.each(['{not json', '[1,2]', 'null', '"text"', JSON.stringify({ volume: 'loud', soundOn: 3 })])(
    'corrupt storage %s gives the defaults',
    (text) => {
      localStorage.setItem(SETTINGS_STORAGE_KEY, text);
      expect(loadSoundSettings()).toEqual(defaultSettings());
    },
  );

  it('survives storage that throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(loadSoundSettings()).toEqual(defaultSettings());
    expect(() => useSoundSettings.getState().update({ volume: 0.3 })).not.toThrow();
    expect(useSoundSettings.getState().volume).toBe(0.3);
    spy.mockRestore();
    set.mockRestore();
  });

  it('a pre-D-39 save loads: its volume and sound switch stay, the haptic fields are dropped', () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        hapticsOn: true,
        soundOn: false,
        volume: 0.4,
        strengthMultiplier: 1.4,
        showChannelLabels: false,
      }),
    );
    const s = loadSoundSettings();
    expect(s).toEqual({ ...defaultSettings(), soundOn: false, volume: 0.4 });
    expect(s).not.toHaveProperty('hapticsOn');
    expect(s).not.toHaveProperty('strengthMultiplier');
  });

  it('the R13.9 fields have their defaults, clamp and round-trip through storage', () => {
    expect(defaultSettings()).toEqual({
      soundOn: true,
      volume: DEFAULT_VOLUME,
      ambienceOn: true,
      ambienceVolume: 0.5,
      flashesOn: true,
      readCaptions: false,
    });
    useSoundSettings
      .getState()
      .update({ ambienceOn: false, ambienceVolume: 3, flashesOn: false, readCaptions: true });
    flushSoundSettings();
    resetStore(); // forget the in-memory state: the next read loads from storage
    expect(getSoundSettings()).toMatchObject({
      ambienceOn: false,
      ambienceVolume: 1,
      flashesOn: false,
      readCaptions: true,
    });
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toContain('"ambienceVolume":1');
  });

  it('ambienceLevelFor: ambienceVolume × volume, 0 when sound or the ambience is off', () => {
    const d = defaultSettings();
    expect(ambienceLevelFor({ ...d, volume: 0.8, ambienceVolume: 0.5 })).toBeCloseTo(0.4);
    expect(ambienceLevelFor({ ...d, soundOn: false })).toBe(0);
    expect(ambienceLevelFor({ ...d, ambienceOn: false })).toBe(0);
  });

  it('reset clears the key and restores the defaults', () => {
    useSoundSettings.getState().update({ volume: 0.2 });
    useSoundSettings.getState().reset();
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
    expect(useSoundSettings.getState().volume).toBe(defaultSettings().volume);
  });
});

describe('bindEngine', () => {
  beforeEach(() => {
    flushSoundSettings(); // no debounced save from an earlier test may land in this one
    localStorage.clear();
    resetStore();
  });

  it('applies the settings now and on every change, until unsubscribed', () => {
    const o = outputs();
    const unbind = bindEngine(o);
    expect(o.engine.isDriverEnabled(o.audio)).toBe(true);
    useSoundSettings.getState().update({ soundOn: false, volume: 0.25 });
    expect(o.engine.isDriverEnabled(o.audio)).toBe(false);
    expect(o.audio.volume).toBe(0.25);
    expect(o.engine.strengthMultiplier).toBe(1);
    unbind();
    useSoundSettings.getState().update({ soundOn: true });
    expect(o.engine.isDriverEnabled(o.audio)).toBe(false);
  });
});

describe('page lifecycle (P2)', () => {
  it('stops the engine when the page is hidden or unloaded, until unbound', () => {
    const o = outputs();
    const stop = vi.spyOn(o.engine, 'stop');
    const unbind = bindEngine(o);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(stop).toHaveBeenCalledTimes(1);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(stop).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('pagehide'));
    expect(stop).toHaveBeenCalledTimes(2);
    unbind();
    window.dispatchEvent(new Event('pagehide'));
    expect(stop).toHaveBeenCalledTimes(2);
    const off = bindPageLifecycle(o);
    window.dispatchEvent(new Event('pagehide'));
    expect(stop).toHaveBeenCalledTimes(3);
    off();
    hidden.mockRestore();
  });
});

describe('audio-only outputs and stopWhenHidden (Q-132, R8.8)', () => {
  beforeEach(() => {
    flushSoundSettings();
    localStorage.clear();
    resetStore();
  });
  afterEach(() => {
    setAudioContextFactory(null);
    vi.restoreAllMocks();
    flushSoundSettings();
    localStorage.clear();
    resetStore();
  });

  it('bindEngine takes the audio-only engine and applies sound and volume', () => {
    const ctx = new FakeAudioContext();
    setAudioContextFactory(() => ctx.asAudioContext());
    const o = createSoundEngine({ debugTarget: null });
    const unbind = bindEngine(o);
    expect(o.engine.activeDrivers).toEqual([o.audio]);
    useSoundSettings.getState().update({ soundOn: false, volume: 0.3 });
    expect(o.engine.activeDrivers).toEqual([]);
    expect(o.audio.volume).toBeCloseTo(0.3);
    useSoundSettings.getState().update({ soundOn: true });
    expect(o.engine.activeDrivers).toEqual([o.audio]);
    unbind();
    o.engine.dispose();
  });

  it('stopWhenHidden stops on a hidden visibilitychange and on pagehide, not while visible or after unbind', () => {
    const target = { stop: vi.fn() };
    const off = stopWhenHidden(target);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(target.stop).not.toHaveBeenCalled();
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(target.stop).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('pagehide'));
    expect(target.stop).toHaveBeenCalledTimes(2);
    off();
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
    expect(target.stop).toHaveBeenCalledTimes(2);
  });
});

describe('shared AudioContext (R8.9)', () => {
  afterEach(() => setAudioContextFactory(null));

  it('follows the OS: suspended after unlock, closed → none; an old context is ignored', async () => {
    const first = new FakeAudioContext({ state: 'suspended' });
    const second = new FakeAudioContext({ state: 'suspended' });
    const made = [first, second];
    setAudioContextFactory(() => made.shift()!.asAudioContext());
    await unlockAudio();
    expect(getUnlockState()).toEqual({ unlocked: true, audio: 'running' });
    first.simulateState('suspended'); // an OS interruption
    expect(getUnlockState().audio).toBe('suspended');
    first.simulateState('closed');
    expect(getUnlockState().audio).toBe('none');
    await unlockAudio(); // closed → a new context
    expect(getAudioContext()).toBe(second);
    expect(getUnlockState().audio).toBe('running');
    first.simulateState('running'); // the old context's listener is inert
    first.simulateState('suspended');
    expect(getUnlockState().audio).toBe('running');
  });

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
    const engine = new SoundEngine([], { debugTarget: null });
    expect(engine.unlocked).toBe(true);
    off();
  });

  it('engine.unlock uses it', async () => {
    const ctx = new FakeAudioContext({ state: 'suspended' });
    setAudioContextFactory(() => ctx.asAudioContext());
    const engine = new SoundEngine([], { debugTarget: null });
    expect(await engine.unlock()).toBe(true);
    expect(ctx.state).toBe('running');
  });
});
