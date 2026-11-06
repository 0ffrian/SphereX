// R8.3, R8.8, R11: the engine's honesty gate, rate cap, strength multiplier, debug hook and the
// phase-continuous train scheduler (Q-59), all on a fake clock and fake drivers.
import { describe, expect, it } from 'vitest';
import type { HapticEvent } from '@/contract';
import { FakeAudioContext } from '@/test/fakeAudio';
import { FakeClock, FakeDriver, PlainDriver, fakeVibrate } from '@/test/fakeHaptics';
import { AudioDriver } from './drivers/audio';
import { WebVibrateDriver } from './drivers/webVibrate';
import {
  HAPTIC_DEBUG_EVENT,
  HapticEngine,
  createHaptics,
  type HapticEngineOptions,
} from './haptics';

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

describe('pulse trains (Q-59)', () => {
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
    expect(driver.stops).toBe(1);
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

  it('createHaptics builds the engine and both drivers without an AudioContext', () => {
    const h = createHaptics({ debugTarget: null });
    expect(h.engine.activeDrivers).toEqual([h.vibrate, h.audio]);
    h.engine.dispose();
  });
});
