// §8.5 weather overlay (issue #117): the canvas, frame pacing, idle stop, reduced motion, the drawn deck (H3), the
// small-area rule (H4), bad values (H2), sound off, and cleanup.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSoundSettings } from '@/sound/settings';
import { FlashGate } from '../flashGate';
import type { Strike, WeatherVisualFrame } from '../types';
import {
  getWeather,
  publishStrike,
  publishWeather,
  resetWeatherBus,
  weatherRows,
  type WeatherSnapshot,
} from '../weatherBus';
import { alphaOf, makeBasis, recordingCtx, type Call } from '../weatherDraw.testutil';
import {
  drawWeatherFrame,
  newDrawState,
  WEATHER_CAPTION,
  WeatherOverlay,
  type OverlayEngine,
} from './WeatherOverlay';
import { WeatherDrawnRows } from './WeatherDrawnRows';
import { BOLT_CORE_PX, BOLT_GLOW_PX } from '../tuning';

const W = 800,
  H = 500;

function fakeEngine(
  o: { altKm?: number; head?: number; pitch?: number; gas?: boolean; clouds?: boolean } = {},
): OverlayEngine {
  const basis = makeBasis({ altKm: o.altKm ?? 0.5, head: o.head ?? 0, pitch: o.pitch ?? 0 });
  return {
    fly: { lon: 0, lat: 0, alt: o.altKm ?? 0.5, head: o.head ?? 0 },
    flyCameraBasis: () => basis,
    groundKm: () => 0,
    state: () => ({ gas: !!o.gas, clouds: o.clouds ?? true }),
  };
}

const rainFrame = (
  o: Partial<NonNullable<WeatherVisualFrame['rain']>> = {},
  zc: number | null = 1.5,
): WeatherVisualFrame => ({
  rain: { density: 0.5, vt: 9.2, slantRad: 0.3, tint: [0.4, 0.4, 0.42], snow: false, ...o },
  strikes: [],
  aboveClouds: false,
  zc_km: zc,
});
const snapOf = (frame: WeatherVisualFrame, tS: number): WeatherSnapshot => ({
  frame,
  windDirDeg: 0,
  U10: 4,
  head: 0,
  lightning: { allowed: true, tag: 'measured', reason: null },
  tS,
});
const strike = (t0: number, bearing = 0, d_m = 8000, seed = 11): Strike => ({
  t0,
  d_m,
  bearing,
  seed,
  variant: 2,
  flash: true,
});

const strokes = (calls: Call[]) => calls.filter((c) => c.op === 'stroke');

describe('drawWeatherFrame', () => {
  const frameAt = (
    engine: OverlayEngine,
    snap: WeatherSnapshot | null,
    gate = new FlashGate(),
    t = 10,
  ) => {
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
    expect(strokes(frameAt(fakeEngine({ altKm: 4 }), snapOf(rainFrame(), 10)).calls)).toHaveLength(
      3,
    );
  });

  it('ruling 3: clouds on and zc null: the engine deck at 3.5 km x ex; above it no rain, below it rain', () => {
    const f = rainFrame({}, null);
    // 3.5 km x 3 = 10.5 drawn km; the camera's height is not exaggerated.
    expect(strokes(frameAt(fakeEngine({ altKm: 11 }), snapOf(f, 10)).calls)).toHaveLength(0);
    expect(strokes(frameAt(fakeEngine({ altKm: 12.5 }), snapOf(f, 10)).calls)).toHaveLength(0);
    expect(strokes(frameAt(fakeEngine({ altKm: 4 }), snapOf(f, 10)).calls)).toHaveLength(3);
    // clouds off: no deck drawn, the frame decides
    expect(
      strokes(frameAt(fakeEngine({ altKm: 11, clouds: false }), snapOf(f, 10)).calls),
    ).toHaveLength(3);
  });

  it('red 4: #116 cut the rain at the real cloud base (frame rain null): nothing drawn, even below the drawn deck', () => {
    const f = { ...rainFrame(), rain: null, aboveClouds: true };
    expect(strokes(frameAt(fakeEngine({ altKm: 3 }), snapOf(f, 10)).calls)).toHaveLength(0);
  });

  it('PR #125 review N5: rain is seeded from the world: the same seed draws the same streaks, another seed others', () => {
    const lines = (seed: number) => {
      const { ctx, calls } = recordingCtx();
      const st = newDrawState(seed);
      st.W = W;
      st.H = H;
      drawWeatherFrame(
        ctx as never,
        st,
        fakeEngine({ altKm: 0.5 }),
        snapOf(rainFrame(), 10),
        new FlashGate(),
        10,
        1 / 30,
      );
      return JSON.stringify(
        calls.filter((c) => c.op === 'moveTo' || c.op === 'lineTo').map((c) => c.args),
      );
    };
    expect(lines(101)).toBe(lines(101));
    expect(lines(101)).not.toBe(lines(202));
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

  /** Bolt alpha samples over a group (fine steps), and whether the drawn bolt is over the small-area limit. */
  const boltTrace = (d_m: number, PW = W, PH = H, seed = 3) => {
    const gate = new FlashGate();
    const g = gate.offer(strike(10, 0, d_m, seed), 9.85, false)!;
    const alphas: number[] = [];
    let big: boolean | null = null;
    for (let t = 10; t < 10.3; t += 0.005) {
      const { ctx, calls } = recordingCtx();
      const st = newDrawState();
      st.W = PW;
      st.H = PH;
      drawWeatherFrame(ctx as never, st, fakeEngine({ altKm: 0.5 }), null, gate, t, 0.001);
      const s = strokes(calls);
      if (s.length !== 2) continue;
      alphas.push(alphaOf(s[1]!.style));
      if (big === null) {
        let len = 0;
        let last: number[] | null = null;
        for (const c of calls) {
          if (c.op === 'moveTo') last = c.args as number[];
          else if (c.op === 'lineTo' && last) {
            const p = c.args as number[];
            len += Math.hypot(p[0]! - last[0]!, p[1]! - last[1]!);
            last = p;
          } else if (c.op === 'stroke') break;
        }
        big = len * (BOLT_CORE_PX + BOLT_GLOW_PX) >= (21824 * PW * PH) / (1024 * 768);
      }
    }
    return { alphas, big, n: g.n };
  };

  it('H4: a small (far) bolt restrikes: its alpha dips between strokes', () => {
    const r = boltTrace(10000);
    expect(r.big).toBe(false);
    expect(r.n).toBeGreaterThanOrEqual(2);
    const dipThenRise = r.alphas.some(
      (a, i) =>
        a < 0.95 &&
        r.alphas.slice(0, i).some((x) => x > 0.99) &&
        r.alphas.slice(i).some((x) => x > 0.99),
    );
    expect(dipThenRise).toBe(true);
  });

  it('H4: a big bolt (narrow pane, so the limit is small) never restrikes: no dip then rise', () => {
    const r = boltTrace(1500, 300, 500);
    expect(r.big).toBe(true);
    const dipThenRise = r.alphas.some(
      (a, i) =>
        a < 0.95 &&
        r.alphas.slice(0, i).some((x) => x > 0.99) &&
        r.alphas.slice(i).some((x) => x > 0.99),
    );
    expect(dipThenRise).toBe(false);
  });

  it('red 3: a near bolt is clipped to the pane; its cloud glow is on or near the screen', () => {
    const gate = new FlashGate();
    gate.offer(strike(10, 0, 1500), 9.85, false);
    const { calls } = frameAt(fakeEngine({ altKm: 0.5 }), null, gate, 10.01);
    const rad = calls.find((c) => c.op === 'radial')!;
    const [x, y] = rad.args as number[];
    expect(x!).toBeGreaterThanOrEqual(-0.25 * H - 1e-6);
    expect(x!).toBeLessThanOrEqual(W + 0.25 * H + 1e-6);
    expect(y!).toBeGreaterThanOrEqual(-0.25 * H - 1e-6);
    for (const c of calls.filter((k) => k.op === 'lineTo')) {
      const [px, py] = c.args as number[];
      expect(Math.abs(px!)).toBeLessThan(3 * W);
      expect(Math.abs(py!)).toBeLessThan(3 * H);
    }
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
      for (const c of calls.filter((x) => x.op === 'stop'))
        expect(Number(alphaOf(c.args[1]))).toBeLessThanOrEqual(0.15 + 1e-9);
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
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => W,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => H,
    });
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
    act(() =>
      root.render(<WeatherOverlay engine={engine} active={active} reduced={reduced} seed={101} />),
    );

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
    act(() => tick(40));
    const cap = container.querySelector('[data-testid="weather-caption"]') as HTMLElement | null;
    expect(cap?.textContent).toBe(WEATHER_CAPTION);
    // PR #125 review B2: the design-language class (bottom-left, clear of the Sound chip), no inline styles.
    expect(cap?.className).toBe('sx-wx-cap');
    expect(cap?.getAttribute('style')).toBeNull();
    act(() => publishWeather(null));
    act(() => tick(40));
    expect(rafQ.size).toBe(0);
    expect(container.querySelector('[data-testid="weather-caption"]')).toBeNull();
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

  it('What is drawn: the rows from weatherRows, the bolt colour tagged artistic', () => {
    act(() => publishWeather(snapOf(rainFrame(), now / 1000)));
    act(() =>
      root.render(
        <ul>
          <WeatherDrawnRows />
        </ul>,
      ),
    );
    const rows = [...container.querySelectorAll('[data-testid="weather-row"]')].map(
      (r) => r.textContent ?? '',
    );
    expect(rows.some((r) => /not from data/.test(r))).toBe(true);
    expect(rows.some((r) => /Rain/.test(r))).toBe(true);
    // The bolt-colour row carries the artistic tag (weatherRows is #116's; the badge renders it).
    const bolt = weatherRows(getWeather()).find((r) => /not from data/.test(r.text));
    expect(bolt?.tag).toBe('artistic');
  });

  it('a pause and unpause keeps the 2 s glow spacing (red 5)', () => {
    const engine = fakeEngine();
    mount(engine, true);
    act(() => publishStrike(strike(now / 1000 + 0.15, 0, 8000, 1)));
    for (let i = 0; i < 10; i++) act(() => tick(1000 / 30));
    mount(engine, false);
    mount(engine, true);
    act(() => tick(40));
    const before = rec.calls.filter((c) => c.op === 'radial').length;
    act(() => publishStrike(strike(now / 1000 + 0.15, 0, 8000, 2))); // under 2 s after the first
    for (let i = 0; i < 10; i++) act(() => tick(1000 / 30));
    expect(rec.calls.filter((c) => c.op === 'radial').length).toBe(before);
  });

  it('inactive (close-up closed): nothing runs', () => {
    mount(fakeEngine(), false);
    act(() => publishWeather(snapOf(rainFrame(), now / 1000)));
    act(() => publishStrike(strike(now / 1000 + 0.15)));
    expect(rafQ.size).toBe(0);
  });
});
