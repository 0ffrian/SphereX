// R8.3, R8.8, R11: the engine's honesty gate, rate cap, strength multiplier, debug hook and the
// phase-continuous train scheduler (Q-71), all on a fake clock and fake drivers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HapticEvent } from '@/contract';
import { FakeAudioContext, type FakeSource } from '@/test/fakeAudio';
import {
  FakeClock,
  FakeDriver,
  PlainDriver,
  fakeVibrate,
  motorOnsets,
  timedVibrate,
} from '@/test/fakeHaptics';
import { setAudioContextFactory } from './audioContext';
import { AudioDriver } from './drivers/audio';
import { WebVibrateDriver } from './drivers/webVibrate';
import {
  HAPTIC_DEBUG_EVENT,
  HapticEngine,
  createHaptics,
  type HapticEngineOptions,
  type HapticTimers,
} from './haptics';
import { bindEngine, flushHapticSettings, useHapticSettings, defaultSettings } from './settings';

const tick = (over: Partial<HapticEvent> = {}): HapticEvent => ({
  kind: 'tick',
  strength: 0.5,
  tag: 'measured',
  ...over,
});

function setup(options: HapticEngineOptions = {}, blockMs = 0) {
  const clock = new FakeClock();
  const driver = new FakeDriver(clock.clock, true, blockMs);
  const debug = new EventTarget();
  const seen: HapticEvent[] = [];
  debug.addEventListener(HAPTIC_DEBUG_EVENT, (e) =>
    seen.push((e as CustomEvent<HapticEvent>).detail),
  );
  const engine = new HapticEngine([driver], {
    clock: clock.clock,
    timers: clock,
    debugTarget: debug,
    ...options,
  });
  return { clock, driver, engine, seen };
}

describe('rate cap (R8.3, R11)', () => {
  it('a 200 Hz drag plays at most 40 events per second, ticks at least 25 ms apart', () => {
    const { clock, driver, engine } = setup();
    for (let i = 0; i < 600; i++) {
      engine.emit(tick());
      clock.advance(5); // 200 Hz for 3 s
    }
    const times = driver.events.map((e) => e.at);
    for (let i = 1; i < times.length; i++)
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(25);
    for (const t of times)
      expect(times.filter((u) => u > t - 1000 && u <= t).length).toBeLessThanOrEqual(40);
    expect(times.length).toBeGreaterThan(100); // dropped, not silenced
  });

  it('caps a mix of kinds at 40 in any 1 s window, counting train windows', () => {
    const { clock, driver, engine } = setup();
    engine.startTrain('t', { rateHz: 20, strength: 0.5, tag: 'measured' });
    const kinds = ['tick', 'double', 'heartbeat'] as const;
    for (let i = 0; i < 400; i++) {
      engine.emit(tick({ kind: kinds[i % 3]! }));
      clock.advance(5);
    }
    const all = [...driver.events.map((e) => e.at), ...driver.windows.map((w) => w.at)].sort(
      (a, b) => a - b,
    );
    for (const t of all)
      expect(all.filter((u) => u > t - 1000 && u <= t).length).toBeLessThanOrEqual(40);
  });

  it('stop is exempt from the cap and from the honesty gate', () => {
    const { driver, engine, seen } = setup({ honesty: 'measured' });
    const win = { kind: 'pulseTrain', rateHz: 4, strength: 1, tag: 'measured' } as const;
    for (let i = 0; i < 40; i++) expect(engine.emit(win)).toBe(true); // no tick gap for windows
    expect(engine.emit(win)).toBe(false); // the 41st in the same second
    expect(engine.emit({ kind: 'stop', strength: 0, tag: 'artistic' })).toBe(true);
    expect(driver.stops).toBe(1);
    expect(seen.at(-1)?.kind).toBe('stop');
  });
});

describe('honesty gate (D-21, R8.2)', () => {
  it.each([
    ['measured', ['measured']],
    ['derived', ['measured', 'derived', 'model_dependent', 'inferred_from_analog']],
    ['artistic', ['measured', 'derived', 'model_dependent', 'inferred_from_analog', 'artistic']],
  ] as const)('%s plays only %o', (state, shown) => {
    const { clock, driver, engine } = setup({ honesty: state });
    const tags = [
      'measured',
      'derived',
      'model_dependent',
      'inferred_from_analog',
      'artistic',
    ] as const;
    for (const tag of tags) {
      engine.emit(tick({ tag }));
      clock.advance(100);
    }
    expect(driver.events.map((e) => e.tag)).toEqual(shown);
  });

  it('starts at + Estimated', () => {
    const { engine } = setup();
    expect(engine.honesty).toBe('derived');
    expect(engine.emit(tick({ tag: 'artistic' }))).toBe(false);
  });

  it('refuses a hidden train, and setHonesty stops a train whose tag becomes hidden', () => {
    const { clock, driver, engine } = setup();
    expect(engine.startTrain('a', { rateHz: 4, strength: 1, tag: 'artistic' })).toBe(false);
    expect(driver.windows).toHaveLength(0);
    expect(engine.startTrain('d', { rateHz: 4, strength: 1, tag: 'derived' })).toBe(true);
    clock.advance(500);
    const before = driver.windows.length;
    engine.setHonesty('measured');
    expect(engine.activeTrainId).toBeNull();
    clock.advance(2000);
    expect(driver.windows).toHaveLength(before);
    expect(clock.pendingCount).toBe(0);
  });

  it('a hidden event reaches no driver and no debug listener', () => {
    const { driver, engine, seen } = setup({ honesty: 'measured' });
    engine.emit(tick({ tag: 'derived' }));
    expect(driver.events).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });
});

describe('debug event (D-20)', () => {
  it('fires only for events that played, even with no driver', () => {
    const { clock, engine, seen } = setup();
    engine.setDrivers([]);
    expect(engine.emit(tick())).toBe(true);
    expect(engine.emit(tick())).toBe(false); // < 25 ms later
    clock.advance(30);
    engine.emit(tick({ tag: 'artistic' })); // hidden
    expect(seen.map((e) => e.kind)).toEqual(['tick']);
  });

  it('passes the texture/data channel hint through, for one-shots and trains (Q-85)', () => {
    const { clock, driver, engine, seen } = setup();
    engine.emit(tick({ channel: 'texture' }));
    clock.advance(30);
    engine.startTrain('t', { rateHz: 4, strength: 0.5, tag: 'measured', channel: 'data' });
    expect(seen.map((e) => e.channel)).toEqual(['texture', 'data']);
    expect(driver.events[0]!.channel).toBe('texture');
  });

  it('carries a copy with the multiplied strength', () => {
    const { engine, seen } = setup({ strengthMultiplier: 1.5 });
    engine.emit(tick({ strength: 0.8, pitch: 0.3, pan: -1 }));
    expect(seen[0]).toMatchObject({ kind: 'tick', strength: 1, pitch: 0.3, pan: -1 });
  });
});

describe('strength multiplier (R8.7)', () => {
  it('is applied once in the engine and clamped to 1', () => {
    const { clock, driver, engine } = setup();
    engine.setStrengthMultiplier(0.5);
    engine.emit(tick({ strength: 0.8 }));
    engine.setStrengthMultiplier(9); // clamped to 1.5
    clock.advance(30);
    engine.emit(tick({ strength: 0.8 }));
    expect(driver.events.map((e) => e.strength)).toEqual([0.4, 1]);
    expect(engine.strengthMultiplier).toBe(1.5);
  });
});

describe('pulse trains (Q-71)', () => {
  it.each([
    [1, 3],
    [2, 6],
    [4, 12],
    [12, 36],
    [20, 60],
  ])('%i Hz gives %i pulses in 3 s, evenly spaced, none extra at window re-issue', (rate, n) => {
    const { clock, driver, engine } = setup();
    engine.startTrain('t', { rateHz: rate, strength: 0.5, tag: 'measured' });
    clock.advance(3000);
    const pulses = driver.freshPulseTimes().filter((t) => t < 3000);
    expect(pulses).toHaveLength(n);
    const period = 1000 / rate;
    pulses.forEach((t, i) => expect(t).toBeCloseTo(i * period, 6));
    for (const w of driver.windows) {
      expect(Math.max(...w.pulseOffsetsMs)).toBeLessThan(270);
    }
  });

  it('keeps the phase when the timer fires late', () => {
    const clock = new FakeClock();
    const driver = new FakeDriver(clock.clock);
    // Every timer fires 7 ms late.
    const late = {
      setTimeout: (fn: () => void, ms: number) => clock.setTimeout(fn, ms + 7),
      clearTimeout: (h: unknown) => clock.clearTimeout(h),
    };
    const engine = new HapticEngine([driver], {
      clock: clock.clock,
      timers: late,
      debugTarget: null,
    });
    engine.startTrain('t', { rateHz: 2, strength: 0.5, tag: 'measured' });
    clock.advance(3000);
    const pulses = driver.freshPulseTimes().filter((t) => t < 3000);
    expect(pulses).toEqual([0, 500, 1000, 1500, 2000, 2500]);
  });

  it('a new id replaces the train; the same id updates it from the next window', () => {
    const { clock, driver, engine } = setup();
    engine.startTrain('a', { rateHz: 4, strength: 0.5, tag: 'measured' });
    clock.advance(1000);
    engine.startTrain('a', { rateHz: 8, strength: 0.5, tag: 'measured' });
    expect(engine.activeTrainId).toBe('a');
    clock.advance(1000);
    const later = driver.freshPulseTimes().filter((t) => t >= 1300 && t < 2000);
    for (let i = 1; i < later.length; i++) expect(later[i]! - later[i - 1]!).toBeCloseTo(125, 6);
    engine.startTrain('b', { rateHz: 1, strength: 0.5, tag: 'measured' });
    expect(engine.activeTrainId).toBe('b');
    expect(driver.trainStops).toBe(1); // train output only
    expect(driver.stops).toBe(0);
  });

  it('updateTrain to a hidden tag stops it; stopTrain ignores another id', () => {
    const { engine } = setup();
    engine.startTrain('a', { rateHz: 4, strength: 0.5, tag: 'measured' });
    engine.stopTrain('other');
    expect(engine.activeTrainId).toBe('a');
    expect(engine.updateTrain('a', { tag: 'artistic' })).toBe(false);
    expect(engine.activeTrainId).toBeNull();
  });

  it('a one-shot cancels the vibration window; the train re-sends from its phase after it', () => {
    const { clock, driver, engine } = setup({}, 25); // the driver's one-shots block for 25 ms
    engine.startTrain('t', { rateHz: 20, strength: 0.5, tag: 'measured' });
    clock.advance(60); // pulses at 0, 50, 100, 150, 200 were sent at t = 0
    engine.emit(tick()); // cancels 100, 150, 200 on the motor until t = 85
    clock.advance(1000);
    const resend = driver.windows.find((w) => w.resentCount > 0)!;
    expect(resend.at).toBe(85);
    expect(resend.pulseOffsetsMs.slice(0, resend.resentCount).map((o) => o + resend.at)).toEqual([
      100, 150, 200,
    ]);
    // Every pulse still sits on the 50 ms grid, and none is new twice.
    const fresh = driver.freshPulseTimes();
    expect(new Set(fresh).size).toBe(fresh.length);
    for (const t of fresh) expect(t % 50).toBeCloseTo(0, 6);
    expect(fresh.filter((t) => t < 1000)).toHaveLength(20);
  });

  it('a non-train driver gets one R8.8 pulseTrain event per window', () => {
    const clock = new FakeClock();
    const plain = new PlainDriver();
    const engine = new HapticEngine([plain], {
      clock: clock.clock,
      timers: clock,
      debugTarget: null,
    });
    engine.startTrain('t', { rateHz: 8, strength: 0.4, tag: 'derived' });
    clock.advance(999);
    expect(plain.events.length).toBe(5); // windows at 0, 230, 480, 730, 980
    expect(plain.events[0]).toMatchObject({
      kind: 'pulseTrain',
      rateHz: 8,
      strength: 0.4,
      tag: 'derived',
    });
  });

  it('emit(pulseTrain) plays a single window', () => {
    const { clock, driver, engine } = setup();
    expect(engine.emit({ kind: 'pulseTrain', rateHz: 8, strength: 1, tag: 'measured' })).toBe(true);
    clock.advance(1000);
    expect(driver.windows).toHaveLength(1);
    expect(driver.windows[0]!.pulseOffsetsMs).toEqual([0, 125]);
  });

  it('disabling a driver stops it and it gets nothing more', () => {
    const { clock, driver, engine } = setup();
    engine.startTrain('t', { rateHz: 4, strength: 0.5, tag: 'measured' });
    engine.setDriverEnabled(driver, false);
    expect(driver.stops).toBe(1);
    const n = driver.windows.length;
    clock.advance(1000);
    engine.emit(tick());
    expect(driver.windows).toHaveLength(n);
    expect(driver.events).toHaveLength(0);
    expect(engine.isDriverEnabled(driver)).toBe(false);
  });
});

describe('web drivers together (D-08, D-10, R11)', () => {
  it('iPhone: no navigator.vibrate → vibrate unsupported, audio still plays', () => {
    const clock = new FakeClock();
    const ctx = new FakeAudioContext();
    const vibrate = new WebVibrateDriver({ vibrate: null });
    const audio = new AudioDriver({ context: () => ctx.asAudioContext(), supported: true });
    const engine = new HapticEngine([vibrate, audio], {
      clock: clock.clock,
      timers: clock,
      debugTarget: null,
    });
    expect(vibrate.supported).toBe(false);
    expect(engine.emit(tick())).toBe(true);
    expect(ctx.sources()).toHaveLength(1);
  });

  it('Android: both drivers get the same event', () => {
    const clock = new FakeClock();
    const ctx = new FakeAudioContext();
    const v = fakeVibrate();
    const vibrate = new WebVibrateDriver({ vibrate: v.fn });
    const audio = new AudioDriver({ context: () => ctx.asAudioContext(), supported: true });
    const engine = new HapticEngine([vibrate, audio], {
      clock: clock.clock,
      timers: clock,
      debugTarget: null,
    });
    engine.emit(tick({ strength: 1 }));
    expect(v.calls).toEqual([25]);
    expect(ctx.sources()).toHaveLength(1);
  });

  describe('createHaptics (Q-132, R8.8.1 item 1)', () => {
    afterEach(() => {
      setAudioContextFactory(null);
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      flushHapticSettings();
      localStorage.clear();
      useHapticSettings.setState({
        ...defaultSettings({ hapticsOn: false, soundOn: true }),
        loaded: false,
      });
    });

    it('builds the audio driver only by default, with no WebVibrateDriver', () => {
      const fake = new FakeAudioContext();
      setAudioContextFactory(() => fake.asAudioContext());
      const h = createHaptics({ debugTarget: null });
      expect(h.engine.activeDrivers).toEqual([h.audio]);
      expect(h.engine.activeDrivers.some((d) => d instanceof WebVibrateDriver)).toBe(false);
      expect(h).not.toHaveProperty('vibrate');
      h.engine.dispose();
    });

    it('never calls navigator.vibrate, even with hapticsOn, but still sounds', async () => {
      const fake = new FakeAudioContext();
      setAudioContextFactory(() => fake.asAudioContext());
      const vibrate = vi.fn(() => true);
      Object.defineProperty(navigator, 'vibrate', {
        value: vibrate,
        configurable: true,
        writable: true,
      });
      try {
        useHapticSettings.getState().update({ hapticsOn: true });
        const h = createHaptics({ debugTarget: null });
        const unbind = bindEngine(h);
        await h.engine.unlock();
        expect(h.engine.emit(tick({ strength: 1 }))).toBe(true);
        expect(vibrate).not.toHaveBeenCalled();
        expect(fake.sources().length).toBeGreaterThanOrEqual(1);
        unbind();
        h.engine.dispose();
      } finally {
        delete (navigator as { vibrate?: unknown }).vibrate;
      }
    });

    it('adds the vibrate driver only with { vibrate: true } (dev page, after the event)', () => {
      const fake = new FakeAudioContext();
      setAudioContextFactory(() => fake.asAudioContext());
      const h = createHaptics({ debugTarget: null, vibrate: true });
      expect(h.engine.activeDrivers).toEqual([h.vibrate, h.audio]);
      expect(h.vibrate).toBeInstanceOf(WebVibrateDriver);
      h.engine.dispose();
    });
  });
});

/** Real web drivers on a fake clock, fake navigator.vibrate and fake AudioContext. */
function web(timers?: HapticTimers) {
  const clock = new FakeClock();
  const t = timers ?? clock;
  const v = timedVibrate(clock.clock);
  const ctx = new FakeAudioContext();
  const vibrate = new WebVibrateDriver({ vibrate: v.fn, timers: t });
  const audio = new AudioDriver({ context: () => ctx.asAudioContext(), supported: true });
  const engine = new HapticEngine([vibrate, audio], {
    clock: clock.clock,
    timers: t,
    debugTarget: null,
  });
  return { clock, v, ctx, vibrate, audio, engine };
}

/** Timers that fire `ms` late. */
const lateBy = (clock: FakeClock, ms: number): HapticTimers => ({
  setTimeout: (fn, d) => clock.setTimeout(fn, d + ms),
  clearTimeout: (h) => clock.clearTimeout(h),
});

describe('review fixes', () => {
  it('a vibration delay (R8.9 offset) loses no train pulse and no tick (finding 1)', () => {
    const { clock, v, vibrate, engine } = web();
    vibrate.setDelayMs(40);
    engine.startTrain('t', { rateHz: 20, strength: 0.5, tag: 'measured' });
    clock.advance(1100);
    const alone = motorOnsets(v.calls).filter((t) => t < 1040);
    expect(alone).toEqual(Array.from({ length: 20 }, (_, i) => 40 + 50 * i));

    const b = web();
    b.vibrate.setDelayMs(40);
    b.engine.startTrain('t', { rateHz: 20, strength: 0.5, tag: 'measured' });
    b.clock.advance(310);
    for (let i = 0; i < 3; i++) {
      expect(b.engine.emit(tick({ strength: 1 }))).toBe(true);
      b.clock.advance(25);
    }
    b.clock.advance(800);
    const ticks = [350, 375, 400];
    const onsets = motorOnsets(b.v.calls);
    for (const t of ticks) expect(onsets).toContain(t); // every tick plays
    const train = onsets.filter((t) => !ticks.includes(t) && t < 1040);
    for (const t of train) expect((t - 40) % 50).toBe(0); // on the delayed grid
    expect(train.length).toBeGreaterThanOrEqual(17); // only pulses under the ticks are lost
  });

  it('stopTrain leaves a just-played one-shot alone in both channels (finding 2)', () => {
    const { clock, v, ctx, engine } = web();
    engine.startTrain('ocean', { rateHz: 2, strength: 0.5, tag: 'measured' });
    clock.advance(100);
    const trainSources = ctx.sources().length;
    expect(trainSources).toBe(1);
    engine.emit(tick({ strength: 1, voice: 'chime' })); // a coastline tick that rings on
    engine.stopTrain('ocean');
    expect(v.calls.at(-1)!.pattern).toBe(25); // no vibrate(0) after the tick
    const sources = ctx.sources();
    for (const s of sources.slice(0, trainSources)) expect(s.stopCalls).toBe(2); // cancelled
    for (const s of sources.slice(trainSources)) expect(s.stopCalls).toBe(1); // still ringing
  });

  it('stopTrain silences the motor when a train window is what plays (finding 2)', () => {
    const { clock, v, engine } = web();
    engine.startTrain('t', { rateHz: 20, strength: 0.5, tag: 'measured' });
    clock.advance(10);
    engine.stopTrain('t');
    expect(v.calls.at(-1)!.pattern).toBe(0);
  });

  it('refuses non-finite strengths; strength 0 plays in both channels (finding 3)', () => {
    const { clock, v, ctx, engine } = web();
    expect(engine.emit(tick({ strength: NaN }))).toBe(false);
    expect(engine.emit(tick({ strength: Infinity }))).toBe(false);
    expect(engine.startTrain('t', { rateHz: 4, strength: NaN, tag: 'measured' })).toBe(false);
    expect(engine.startTrain('t', { rateHz: 4, strength: 0.5, tag: 'measured' })).toBe(true);
    expect(engine.updateTrain('t', { strength: NaN })).toBe(false);
    expect(engine.activeTrainId).toBe('t'); // refused, still playing
    engine.stopTrain();
    const before = ctx.sources().length;
    clock.advance(100);
    v.calls.length = 0;
    expect(engine.emit(tick({ strength: 0 }))).toBe(true);
    expect(v.calls.map((c) => c.pattern)).toEqual([8]);
    expect(ctx.sources().length).toBe(before + 1);
  });

  it('a timer later than the lead does not shift the phase (finding 5)', () => {
    const clock = new FakeClock();
    const driver = new FakeDriver(clock.clock);
    const engine = new HapticEngine([driver], {
      clock: clock.clock,
      timers: lateBy(clock, 30),
      debugTarget: null,
    });
    engine.startTrain('t', { rateHz: 2, strength: 0.5, tag: 'measured' });
    clock.advance(3000);
    const pulses = driver.freshPulseTimes().filter((t) => t < 3000);
    expect(pulses).toHaveLength(6);
    pulses.forEach((t, i) => {
      expect(t).toBeGreaterThanOrEqual(i * 500);
      expect(t).toBeLessThanOrEqual(i * 500 + 10); // 10 ms late at most, never accumulating
    });
  });

  it('a re-send-only window takes no rate-cap slot (finding 7)', () => {
    const { clock, driver, engine } = setup({}, 25);
    const single = { kind: 'pulseTrain', rateHz: 4, strength: 1, tag: 'measured' } as const;
    for (let i = 0; i < 38; i++) engine.emit(single);
    engine.startTrain('t', { rateHz: 5, strength: 0.5, tag: 'measured' }); // slot 39: [0, 200]
    clock.advance(10);
    expect(engine.emit(tick())).toBe(true); // slot 40; cancels 200 until t = 35
    clock.advance(30);
    const resend = driver.windows.at(-1)!;
    expect(resend.at).toBe(35);
    expect(resend.resentCount).toBe(resend.pulseOffsetsMs.length);
    expect(resend.pulseOffsetsMs.map((o) => o + resend.at)).toEqual([200]);
  });

  it('a late re-send timer still re-sends the cancelled pulses (finding 7)', () => {
    const clock = new FakeClock();
    const driver = new FakeDriver(clock.clock, true, 25);
    const engine = new HapticEngine([driver], {
      clock: clock.clock,
      timers: lateBy(clock, 30),
      debugTarget: null,
    });
    engine.startTrain('t', { rateHz: 20, strength: 0.5, tag: 'measured' }); // 0..200 at t = 0
    clock.advance(60);
    engine.emit(tick()); // cancels 100, 150, 200 until 85; the timer fires at 115
    clock.advance(100);
    const resend = driver.windows.find((w) => w.resentCount > 0)!;
    expect(resend.at).toBe(115);
    expect(resend.pulseOffsetsMs.slice(0, resend.resentCount).map((o) => o + resend.at)).toEqual([
      115, 150, 200,
    ]);
  });

  it('emit(pulseTrain) over a running train cancels the old train sound (finding 8)', () => {
    const { clock, ctx, engine } = web();
    engine.startTrain('t', { rateHz: 20, strength: 0.5, tag: 'measured' });
    clock.advance(10);
    const old: FakeSource[] = ctx.sources();
    expect(old.length).toBe(5);
    engine.emit({ kind: 'pulseTrain', rateHz: 8, strength: 1, tag: 'measured' });
    for (const s of old) expect(s.stopCalls).toBe(2);
    const fresh = ctx.sources().slice(old.length);
    expect(fresh).toHaveLength(2);
    for (const s of fresh) expect(s.stopCalls).toBe(1);
    expect(engine.activeTrainId).toBeNull();
  });
});

describe('updateTrain in the hot path (review P3)', () => {
  it('changes the train in place and only moves the timer when the fire time moves > 5 ms', () => {
    const clock = new FakeClock();
    const driver = new FakeDriver(clock.clock);
    let sets = 0;
    const timers: HapticTimers = {
      setTimeout: (fn, ms) => {
        sets++;
        return clock.setTimeout(fn, ms);
      },
      clearTimeout: (h) => clock.clearTimeout(h),
    };
    const engine = new HapticEngine([driver], { clock: clock.clock, timers, debugTarget: null });
    engine.startTrain('t', { rateHz: 10, strength: 0.5, tag: 'measured', pitch: 0.2 });
    clock.advance(10);
    const before = sets;
    for (let i = 1; i <= 10; i++) engine.updateTrain('t', { rateHz: 10 + i * 0.01 }); // tiny moves
    expect(sets).toBe(before);
    engine.updateTrain('t', { rateHz: 20 }); // a real change
    expect(sets).toBe(before + 1);
    expect(engine.updateTrain('t', { strength: undefined, pitch: undefined })).toBe(true);
    clock.advance(500);
    const w = driver.windows.at(-1)!;
    expect(w.strength).toBe(0.5); // an undefined strength keeps the old one
    expect(w.rateHz).toBe(20);
  });
});
