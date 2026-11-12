// §8.5 weather overlay (issue #117): the canvas, frame pacing, idle stop, reduced motion, the drawn deck (H3), the
// small-area rule (H4), bad values (H2), sound off, and cleanup.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSoundSettings } from '@/sound/settings';
import { FlashGate } from '../flashGate';
import type { Strike, WeatherVisualFrame } from '../types';
import { publishStrike, publishWeather, resetWeatherBus, type WeatherSnapshot } from '../weatherBus';
import { alphaOf, makeBasis, recordingCtx, type Call } from '../weatherDraw.testutil';
import { drawWeatherFrame, newDrawState, WeatherOverlay, type OverlayEngine } from './WeatherOverlay';
import { BOLT_CORE_PX, BOLT_GLOW_PX } from '../tuning';

const W = 800, H = 500;

function fakeEngine(o: { altKm?: number; head?: number; pitch?: number; gas?: boolean; clouds?: boolean } = {}): OverlayEngine {
  const basis = makeBasis({ altKm: o.altKm ?? 0.5, head: o.head ?? 0, pitch: o.pitch ?? 0 });
  return {
    fly: { lon: 0, lat: 0, alt: o.altKm ?? 0.5, head: o.head ?? 0 },
    flyCameraBasis: () => basis,
    groundKm: () => 0,
    state: () => ({ gas: !!o.gas, clouds: o.clouds ?? true }),
  };
}

const rainFrame = (o: Partial<NonNullable<WeatherVisualFrame['rain']>> = {}, zc: number | null = 1.5): WeatherVisualFrame => ({
  rain: { density: 0.5, vt: 9.2, slantRad: 0.3, tint: [0.4, 0.4, 0.42], snow: false, ...o },
  strikes: [],
  aboveClouds: false,
  zc_km: zc,
});
const snapOf = (frame: WeatherVisualFrame | null, tS: number): WeatherSnapshot => ({
  frame, windDirDeg: 0, U10: 4, head: 0, lightning: { allowed: true, tag: 'measured', reason: null }, tS,
});
const strike = (t0: number, bearing = 0, d_m = 8000, seed = 11): Strike => ({ t0, d_m, bearing, seed, variant: 2, flash: true });

const strokes = (calls: Call[]) => calls.filter((c) => c.op === 'stroke');

describe('drawWeatherFrame', () => {
  const frameAt = (engine: OverlayEngine, snap: WeatherSnapshot | null, gate = new FlashGate(), t = 10) => {
    const { ctx, calls } = recordingCtx();
    const st = newDrawState();
    st.W = W;
    st.H = H;
    const more = drawWeatherFrame(ctx as never, st, engine, snap, gate, t, 1 / 30);
    return { calls, more };
  };

  it('rain below the drawn deck: three layer strokes of 300 streaks', () => {
    const { calls, more } = frameAt(fakeEngine({ altKm: 0.5 }), snapOf(rainFrame(), 10));
    expect(more).toBe(true);
    expect(strokes(calls)).toHaveLength(3);
    expect(calls.filter((c) => c.op === 'lineTo')).toHaveLength(300);
    expect(alphaOf(strokes(calls)[0]!.style)).toBeCloseTo(0.55);
  });

  it('H3: above the drawn deck (1 + max(zc, 0.3) ex / rkm), no rain, even if the frame has rain', () => {
    // zc 1.5 km x ex 3 = 4.5 km drawn; the camera at 6 km is above it.
    const { calls, more } = frameAt(fakeEngine({ altKm: 6 }), snapOf(rainFrame(), 10));
    expect(strokes(calls)).toHaveLength(0);
    expect(more).toBe(false);
    // ...and below it at 4 km.
    expect(strokes(frameAt(fakeEngine({ altKm: 4 }), snapOf(rainFrame(), 10)).calls)).toHaveLength(3);
  });

  it('blue 16: a stale snapshot is not drawn; idle clears once and reports nothing to do', () => {
    const { calls, more } = frameAt(fakeEngine(), snapOf(rainFrame(), 9));
    expect(more).toBe(false);
    expect(calls.map((c) => c.op)).toEqual(['clearRect']);
  });

  it('snow draws rects, not streaks', () => {
    const { calls } = frameAt(fakeEngine(), snapOf(rainFrame({ snow: true, vt: 1 }), 10));
    expect(calls.filter((c) => c.op === 'rect')).toHaveLength(200);
    expect(strokes(calls)).toHaveLength(0);
  });

  it('a strike ahead draws the cloud glow and a bolt; a strike behind only an edge glow', () => {
    const gate = new FlashGate();
    gate.offer(strike(10), 9.85, false);
    const ahead = frameAt(fakeEngine(), null, gate, 10.01).calls;
    expect(ahead.some((c) => c.op === 'radial')).toBe(true);
    expect(strokes(ahead).length).toBe(2);
    const g2 = new FlashGate();
    g2.offer(strike(10, Math.PI), 9.85, false);
    const behind = frameAt(fakeEngine(), null, g2, 10.01).calls;
    expect(behind.some((c) => c.op === 'linear')).toBe(true);
    expect(strokes(behind)).toHaveLength(0);
  });

  it('H4: a bolt at or above the small-area limit does not restrike (follows the one group pulse)', () => {
    // A very near strike makes a long bolt; check the drawn alpha between strokes matches the group glow (1), not the
    // stroke dip.
    const gate = new FlashGate();
    const g = gate.offer(strike(10, 0, 1200, 3), 9.85, false)!;
    expect(g.n).toBeGreaterThanOrEqual(2);
    const t = 10 + 0.045; // between stroke 1's fade and stroke 2
    const { calls } = (() => {
      const { ctx, calls } = recordingCtx();
      const st = newDrawState();
      st.W = W;
      st.H = H;
      drawWeatherFrame(ctx as never, st, fakeEngine({ altKm: 0.2 }), null, gate, t, 0.001);
      return { calls };
    })();
    const s = strokes(calls);
    expect(s.length).toBe(2);
    // Lit area from the drawn path, then the rule.
    let len = 0;
    let last: [number, number] | null = null;
    for (const c of calls) {
      if (c.op === 'moveTo') last = c.args as [number, number];
      else if (c.op === 'lineTo' && last) {
        const p = c.args as [number, number];
        len += Math.hypot(p[0] - last[0], p[1] - last[1]);
        last = p;
      } else if (c.op === 'stroke') break;
    }
    const big = len * (BOLT_CORE_PX + BOLT_GLOW_PX) >= (21824 * W * H) / (1024 * 768);
    const a = alphaOf(s[1]!.style);
    if (big) expect(a).toBeCloseTo(1, 3);
    else expect(a).toBeLessThan(1);
  });

  it('gas giants: no bolt, only the in-deck glow', () => {
    const gate = new FlashGate();
    gate.offer(strike(10), 9.85, false);
    const { calls } = frameAt(fakeEngine({ gas: true }), null, gate, 10.05);
    expect(strokes(calls)).toHaveLength(0);
    expect(calls.some((c) => c.op === 'radial' || c.op === 'linear')).toBe(true);
  });

  it('safe mode: no bolt strokes, glow alpha at most 0.15', () => {
    const gate = new FlashGate();
    gate.offer(strike(10), 9.85, true);
    for (let t = 10; t < 11.1; t += 1 / 30) {
      const { calls } = frameAt(fakeEngine(), null, gate, t);
      expect(strokes(calls)).toHaveLength(0);
      for (const c of calls.filter((x) => x.op === 'stop')) expect(Number(alphaOf(c.args[1]))).toBeLessThanOrEqual(0.15 + 1e-9);
    }
  });

  it('H2: a strike under a camera looking straight down at it never throws', () => {
    const gate = new FlashGate();
    gate.offer(strike(10, 0, 500), 9.85, false);
    expect(() => frameAt(fakeEngine({ altKm: 0.5, pitch: -1.2 }), null, gate, 10.01)).not.toThrow();
  });
});

describe('WeatherOverlay component', () => {
  let container: HTMLDivElement;
  let root: Root;
  let rafQ: Map<number, FrameRequestCallback>;
  let rafId: number;
  let now: number;
  let rec: ReturnType<typeof recordingCtx>;
  let reduce: boolean;
  let mqListeners: Set<() => void>;

  const tick = (ms: number) => {
    now += ms;
    const q = [...rafQ.entries()];
    rafQ.clear();
    for (const [, cb] of q) cb(now);
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    resetWeatherBus();
    useSoundSettings.getState().update({ flashesOn: true, soundOn: false, ambienceOn: false });
    rafQ = new Map();
    rafId = 0;
    now = 10_000;
    reduce = false;
    mqListeners = new Set();
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQ.set(++rafId, cb);
      return rafId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => rafQ.delete(id));
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('reduce') && reduce,
      media: q,
      addEventListener: (_: string, l: () => void) => mqListeners.add(l),
      removeEventListener: (_: string, l: () => void) => mqListeners.delete(l),
    }));
    rec = recordingCtx();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => rec.ctx as never);
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, get: () => W });
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, get: () => H });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetWeatherBus();
  });

  const mount = (engine: OverlayEngine | null = fakeEngine(), active = true, reduced = false) =>
    act(() => root.render(<WeatherOverlay engine={engine} active={active} reduced={reduced} />));

  it('is aria-hidden and never catches pointer input', () => {
    mount();
    const cv = container.querySelector('canvas')!;
    expect(cv.getAttribute('aria-hidden')).toBe('true');
    expect(cv.style.pointerEvents).toBe('none');
  });

  it('draws at most 30 fps, and with Sound and Ambience off (the bus still publishes)', () => {
    mount();
    act(() => publishWeather(snapOf(rainFrame(), now / 1000)));
    let draws = 0;
    for (let i = 0; i < 60; i++) {
      act(() => publishWeather(snapOf(rainFrame(), now / 1000)));
      const before = rec.calls.filter((c) => c.op === 'clearRect').length;
      tick(1000 / 60);
      if (rec.calls.filter((c) => c.op === 'clearRect').length > before) draws++;
    }
    expect(draws).toBeGreaterThan(20);
    expect(draws).toBeLessThanOrEqual(31);
    expect(strokes(rec.calls).length).toBeGreaterThan(0);
  });

  it('idle: clears once, then the loop stops', () => {
    mount();
    act(() => publishWeather(snapOf(rainFrame(), now / 1000)));
    tick(40);
    act(() => publishWeather(snapOf(null, now / 1000)));
    tick(40);
    expect(rafQ.size).toBe(0);
    const n = rec.calls.length;
    tick(40);
    expect(rec.calls.length).toBe(n);
  });

  it('red M4: an idle overlay starts drawing on a strike', () => {
    mount();
    tick(40); // the first frame after mount (resize) finds nothing and stops
    expect(rafQ.size).toBe(0);
    act(() => publishStrike(strike(now / 1000 + 0.15)));
    expect(rafQ.size).toBe(1);
  });

  it('reduced motion (media query): no bolt strokes during a strike', () => {
    reduce = true;
    mount();
    act(() => publishStrike(strike(now / 1000 + 0.15)));
    for (let i = 0; i < 40; i++) tick(1000 / 30);
    expect(strokes(rec.calls)).toHaveLength(0);
    expect(rec.calls.some((c) => c.op === 'radial')).toBe(true);
  });

  it('Flashes off: no bolt strokes during a strike', () => {
    useSoundSettings.getState().update({ flashesOn: false });
    mount();
    act(() => publishStrike(strike(now / 1000 + 0.15)));
    for (let i = 0; i < 40; i++) tick(1000 / 30);
    expect(strokes(rec.calls)).toHaveLength(0);
  });

  it('unmount cancels the loop and removes every listener', () => {
    mount();
    act(() => publishWeather(snapOf(rainFrame(), now / 1000)));
    expect(mqListeners.size).toBe(1);
    act(() => root.unmount());
    root = createRoot(container);
    expect(rafQ.size).toBe(0);
    expect(mqListeners.size).toBe(0);
    const n = rec.calls.length;
    act(() => publishStrike(strike(now / 1000 + 0.15)));
    act(() => publishWeather(snapOf(rainFrame(), now / 1000)));
    expect(rafQ.size).toBe(0);
    expect(rec.calls.length).toBe(n);
  });

  it('inactive (close-up closed): nothing runs', () => {
    mount(fakeEngine(), false);
    act(() => publishWeather(snapOf(rainFrame(), now / 1000)));
    act(() => publishStrike(strike(now / 1000 + 0.15)));
    expect(rafQ.size).toBe(0);
  });
});
