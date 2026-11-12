// R13.8 / R13.10 (#116): the per-tick pipeline with a fake clock, a fake engine, a fake palette and the real mixer on a
// FakeAudioContext. Gate changes fade without any tick (C1); cached beds play at once (C4); waiting is re-evaluated
// every tick (C7); exceptions fade the sound and keep the weather (C9); strikes are announced ahead of t0 (C8).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioContext } from '@/test/fakeAudio';
import { REFUSAL_TEXT } from './airModel';
import { createAmbienceLoop, SOUND_UNAVAILABLE, type AmbienceUi, type LoopDeps, type PaletteLike } from './ambienceLoop';
import type { GateInputs } from './ambienceState';
import { earthAir, makePlace, makeWind, makeWorld } from './fakeEngine.testutil';
import { AmbienceMixer } from './mixer';
import type { WorldEngineWithSpinup } from './place';
import { FADE_S, REBAKE_DEBOUNCE_MS, STOP_MARGIN_S } from './tuning';
import type { AirModel, BedSpec, Strike } from './types';
import type { WeatherSnapshot } from './weatherBus';

const ON: GateInputs = {
  entered: true, paused: false, hidden: false, artistic: true, failed: false, soundOn: true, ambienceOn: true, audioRunning: true,
};

function fakePalette() {
  const ready = new Set<string>();
  const bufs = new Map<string, AudioBuffer>();
  const requests: BedSpec[][] = [];
  const p: PaletteLike & { ready: Set<string>; requests: BedSpec[][]; bakeAll(): void } = {
    ready,
    requests,
    request: (beds) => void requests.push(beds),
    get: (id, v) => {
      const k = `${id}|${v}`;
      if (!ready.has(k)) return null;
      if (!bufs.has(k)) bufs.set(k, { k } as unknown as AudioBuffer);
      return bufs.get(k)!;
    },
    unavailable: () => [],
    bakeAll() {
      for (const b of requests.at(-1) ?? []) ready.add(`${b.id}|${b.variant}`);
    },
  };
  return p;
}

let ctx: FakeAudioContext;
let mixer: AmbienceMixer;
let clock: number;
let engine: { spinup: number; ps: number } & Record<string, unknown>;
let waiting: boolean;
let airOf: () => AirModel;
let published: (WeatherSnapshot | null)[];
let strikes: { s: Strike; at: number }[];
let uis: AmbienceUi[];

function setup(over: Partial<LoopDeps> = {}, gate: Partial<GateInputs> = ON) {
  const palette = fakePalette();
  const e = {
    spinup: 0,
    ps: 1,
    fly: { alt: 0.05, lon: 0, lat: 0, head: 0, pitch: 0, auto: false },
    state() {
      return { Ps: this.ps, fluid: 'water', gas: false, locked: false, Tstar: 5772, orbit: 1, co2: false };
    },
  };
  engine = e as unknown as typeof engine;
  const idle = vi.fn();
  const loop = createAmbienceLoop(
    {
      engine: () => e as unknown as WorldEngineWithSpinup,
      world: () => makeWorld(),
      palette: () => palette,
      mixer: () => mixer,
      publish: (s) => published.push(s),
      strike: (s) => strikes.push({ s, at: clock }),
      onUi: (u) => uis.push(u),
      clockS: () => clock,
      timers: { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
      idle,
      buildAir: () => {
        const a = airOf();
        return waiting ? { ...a, refusals: [{ source: 'all', reason: REFUSAL_TEXT.waiting }] } : a;
      },
      sample: (_e, a) =>
        makePlace(0.05, ({ bearing }) => ({ cls: bearing > Math.PI / 2 && bearing < 1.5 * Math.PI ? 'sea' : 'land' }), {
          wind: makeWind({ U10: 9, Uz: 9 }),
          cnv: 1,
          cnvRing: 1,
          stormNear: 1,
          rainRate: a.P0 > 0 ? 1 : 0,
          precipPhase: 'rain',
        }),
      ...over,
    },
    gate,
  );
  return { loop, palette, idle };
}

const ticks = (loop: { tick(): void }, n: number, dt = 0.1) => {
  for (let i = 0; i < n; i++) {
    clock += dt;
    loop.tick();
  }
};

beforeEach(() => {
  vi.useFakeTimers();
  ctx = new FakeAudioContext();
  mixer = new AmbienceMixer(ctx.asAudioContext(), ctx.createGain() as unknown as AudioNode, { harmonic: false });
  clock = 100;
  waiting = false;
  airOf = () => earthAir();
  published = [];
  strikes = [];
  uis = [];
});
afterEach(() => vi.useRealTimers());

describe('ambience loop: lifecycle', () => {
  it('spin-up and R12 waiting publish nothing and request nothing; settled → baking → playing', () => {
    const { loop, palette } = setup();
    engine.spinup = 50;
    ticks(loop, 3);
    expect(loop.status()).toBe('waiting');
    expect(published.every((p) => p === null)).toBe(true);
    engine.spinup = 0;
    waiting = true;
    ticks(loop, 2);
    expect(loop.status()).toBe('waiting');
    expect(uis.at(-1)!.caption).toBe(REFUSAL_TEXT.waiting);
    expect(uis.at(-1)!.notHeard).toEqual([]); // R12: no refusal while waiting
    waiting = false; // C7: rebuilt every tick while waiting
    ticks(loop, 1);
    expect(palette.requests).toHaveLength(1);
    expect(loop.status()).toBe('baking');
    palette.bakeAll();
    ticks(loop, 1);
    expect(loop.status()).toBe('playing');
    expect(ctx.sources().length).toBeGreaterThan(0);
  });

  it('bakes before the unlock click (M16) and the weather runs with sound off', () => {
    const { loop, palette } = setup({}, { ...ON, audioRunning: false });
    ticks(loop, 2);
    expect(palette.requests).toHaveLength(1);
    expect(loop.status()).toBe('idle');
    expect(published.at(-1)).not.toBeNull();

    const b = setup({}, { ...ON, soundOn: false });
    ticks(b.loop, 2);
    expect(b.palette.requests).toHaveLength(0);
    expect(published.at(-1)).not.toBeNull();
  });

  it('a gate event fades at once with no further tick, and stops the sources on the wall clock (C1)', () => {
    const { loop, palette } = setup();
    ticks(loop, 1);
    palette.bakeAll();
    ticks(loop, 1);
    const srcs = ctx.sources();
    expect(srcs.length).toBeGreaterThan(0);
    loop.setGate({ paused: true }); // the close-up closes; the rAF loop stops, no more ticks
    expect(loop.status()).toBe('fading');
    expect(published.at(-1)).toBeNull();
    vi.advanceTimersByTime((FADE_S + STOP_MARGIN_S) * 1000 + 5);
    expect(srcs.every((s) => s.stopCalls === 1)).toBe(true);
    expect(loop.status()).toBe('idle');
  });

  it('cached beds play at once after a fade and a return (C4, red H1); no new request', () => {
    const { loop, palette } = setup();
    ticks(loop, 1);
    palette.bakeAll();
    ticks(loop, 1);
    const before = ctx.sources().length;
    loop.setGate({ ambienceOn: false });
    vi.advanceTimersByTime(1000);
    loop.setGate({ ambienceOn: true });
    ticks(loop, 1);
    expect(loop.status()).toBe('playing');
    expect(ctx.sources().length).toBe(2 * before);
    expect(palette.requests).toHaveLength(1);
  });

  it('a physics change is debounced, then crossfades to the new world (C5)', () => {
    const { loop, palette } = setup();
    ticks(loop, 1);
    palette.bakeAll();
    ticks(loop, 1);
    const first = ctx.sources();
    engine.ps = 0.5;
    airOf = () => earthAir({ P0: 50000 });
    ticks(loop, Math.floor(REBAKE_DEBOUNCE_MS / 100) - 2);
    expect(palette.requests).toHaveLength(1);
    ticks(loop, 4);
    expect(palette.requests).toHaveLength(2);
    vi.advanceTimersByTime(2000);
    expect(first.every((s) => s.stopCalls === 1)).toBe(true);
  });

  it('an exception fades the sound, shows "Sound unavailable" and keeps the weather (C9)', () => {
    const log = vi.fn();
    const { loop, palette } = setup({ log });
    ticks(loop, 1);
    palette.bakeAll();
    vi.spyOn(mixer, 'apply').mockImplementation(() => {
      throw new Error('boom');
    });
    ticks(loop, 3);
    expect(loop.status()).toBe('error');
    expect(log).toHaveBeenCalledTimes(1);
    expect(uis.at(-1)!.caption).toBe(SOUND_UNAVAILABLE);
    const n = published.length;
    ticks(loop, 2);
    expect(published.length).toBe(n + 2);
    expect(published.at(-1)).not.toBeNull();
  });

  it('engine failure → noSurface with the data-gap caption', () => {
    const { loop } = setup();
    ticks(loop, 1);
    loop.setGate({ failed: true });
    expect(loop.status()).toBe('noSurface');
    expect(uis.at(-1)!.caption).toBe(REFUSAL_TEXT.dataGap);
  });

  it('dispose fades, publishes null and reports idle', () => {
    const { loop, palette, idle } = setup();
    ticks(loop, 1);
    palette.bakeAll();
    ticks(loop, 1);
    loop.dispose();
    expect(published.at(-1)).toBeNull();
    expect(idle).toHaveBeenLastCalledWith(true);
    vi.advanceTimersByTime(1000);
    expect(ctx.sources().every((s) => s.stopCalls === 1)).toBe(true);
  });
});

describe('ambience loop: weather and captions', () => {
  it('announces each strike at least 150 ms before its t0 (C8)', () => {
    const { loop, palette } = setup();
    ticks(loop, 1);
    palette.bakeAll();
    ticks(loop, 3000); // 5 min at 10 Hz
    expect(strikes.length).toBeGreaterThan(0);
    for (const { s, at } of strikes) expect(s.t0 - at).toBeGreaterThanOrEqual(0.15);
  });

  it('pushes the UI on a state change or at most every 3 s, not per tick', () => {
    const { loop, palette } = setup();
    ticks(loop, 1);
    palette.bakeAll();
    ticks(loop, 1);
    const n = uis.length;
    ticks(loop, 25); // 2.5 s
    expect(uis.length - n).toBeLessThanOrEqual(1);
  });
});

