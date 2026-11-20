// PR #125 review B1 (blue 26): the joint test. The REAL producer, #116's ambience loop with the real buildAirModel
// and samplePlace on the fake fly engine (fakeEngine.testutil.ts), publishes on the real weather bus; the mounted
// WeatherOverlay draws the rain it published, and a bolt for a strike it announced (lightning allowed on this world).
// No sound: the loop has no palette and no mixer (Q-448(10): the weather runs without sound).
// Also B2: the caption's CSS slot (bottom-left) never meets the Sound chip's (top-left).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSoundSettings } from '@/sound/settings';
import { createAmbienceLoop, type AmbienceLoop } from '../ambienceLoop';
import { EARTH_MODEL, makeFlyEngine, makeWorld } from '../fakeEngine.testutil';
import type { WorldEngineWithSpinup } from '../place';
import { BOLT_CORE_PX } from '../tuning';
import {
  getWeather,
  onStrike,
  publishStrike,
  publishWeather,
  resetWeatherBus,
} from '../weatherBus';
import { makeBasis, recordingCtx } from '../weatherDraw.testutil';
import { WEATHER_CAPTION, WeatherOverlay, type OverlayEngine } from './WeatherOverlay';

const W = 800,
  H = 500;
/** Water's triple point, K: the place sampler's freezing test needs it (EARTH_MODEL has no F.Tt). Test input. */
const TT_WATER_K = 273.16;

/**
 * The fake fly engine with weather: rain in every cell (out2), and, for `storm`, warm humid air (T 305 K, RH 1) so
 * samplePlace's convection (and so the §8.2 strike rate) is non-zero. The overlay reads the same object, plus a
 * camera basis at the fly position (the fake's own flyCameraBasis returns null).
 */
function weatherEngine(o: { rain: number; storm: boolean }) {
  const fe = makeFlyEngine({ rain: o.rain, fly: { alt: 0.5 } });
  fe.readouts = () => {
    fe.calls++;
    return { model: { ...EARTH_MODEL, F: { Tt: TT_WATER_K } } } as never;
  };
  if (o.storm) {
    const wf = fe.weatherFields();
    for (let k = 0; k < wf.NX * wf.NY; k++) wf.out[k * 4 + 3] = 1;
    fe.cpuFields().climate!.T.fill(305);
  }
  const basis = makeBasis({
    lon: fe.fly.lon,
    lat: fe.fly.lat,
    head: fe.fly.head,
    altKm: fe.fly.alt,
    groundKm: 0.2,
  });
  const overlay: OverlayEngine = {
    fly: fe.fly,
    flyCameraBasis: () => basis,
    groundKm: () => 0.2,
    state: () => ({ gas: false, clouds: true }),
  };
  return { fe, overlay };
}

describe('weather: the ambience loop publishes, the overlay draws (PR #125 review B1)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let rafQ: Map<number, FrameRequestCallback>;
  let rafId: number;
  let now: number;
  let rec: ReturnType<typeof recordingCtx>;
  let loop: AmbienceLoop | null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    resetWeatherBus();
    useSoundSettings.getState().update({ flashesOn: true, soundOn: false, ambienceOn: false });
    rafQ = new Map();
    rafId = 0;
    now = 100_000;
    loop = null;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQ.set(++rafId, cb);
      return rafId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => rafQ.delete(id));
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: false,
      media: q,
      addEventListener() {},
      removeEventListener() {},
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
    loop?.dispose();
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetWeatherBus();
  });

  /** The real loop, publishing on the real bus, on the overlay's clock (performance.now() / 1000). */
  function startLoop(fe: ReturnType<typeof makeFlyEngine>): AmbienceLoop {
    return createAmbienceLoop(
      {
        engine: () => fe as unknown as WorldEngineWithSpinup,
        world: () => makeWorld(),
        palette: () => null,
        mixer: () => null,
        publish: publishWeather,
        strike: publishStrike,
        onUi: () => {},
        clockS: () => performance.now() / 1000,
        timers: {
          set: (fn, ms) => setTimeout(fn, ms),
          clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
        },
      },
      { entered: true, artistic: true },
    );
  }

  /** One 1/30 s overlay frame; the loop ticks every third frame (10 Hz). */
  function frame(i: number) {
    now += 1000 / 30;
    if (i % 3 === 0) act(() => loop!.tick());
    const q = [...rafQ.values()];
    rafQ.clear();
    act(() => {
      for (const cb of q) cb(now);
    });
  }

  it('rain: the loop publishes it and the overlay draws its three layers, with the caption', () => {
    const { fe, overlay } = weatherEngine({ rain: 1.5, storm: false });
    act(() => root.render(<WeatherOverlay engine={overlay} active reduced={false} seed={101} />));
    loop = startLoop(fe);
    for (let i = 0; i < 9; i++) frame(i);
    const snap = getWeather();
    expect(snap?.frame.rain?.snow).toBe(false);
    expect(snap!.frame.rain!.density).toBeGreaterThan(0);
    const rainStrokes = rec.calls.filter((c) => c.op === 'stroke' && c.width !== BOLT_CORE_PX);
    expect(rainStrokes.length).toBeGreaterThanOrEqual(3);
    expect(rec.calls.filter((c) => c.op === 'lineTo').length).toBeGreaterThan(0);
    const cap = container.querySelector('[data-testid="weather-caption"]');
    expect(cap?.textContent).toBe(WEATHER_CAPTION);
    expect(cap?.className).toBe('sx-wx-cap');
  });

  it('lightning: a strike the loop announces reaches the overlay, which draws a glow and a bolt', () => {
    const { fe, overlay } = weatherEngine({ rain: 0, storm: true });
    act(() => root.render(<WeatherOverlay engine={overlay} active reduced={false} seed={101} />));
    loop = startLoop(fe);
    let announced = 0;
    const off = onStrike(() => announced++);
    let bolts = 0;
    let glows = 0;
    // up to 3 min of flight at 30 fps, stopping once a bolt is drawn
    for (let i = 0; i < 30 * 180 && bolts === 0; i++) {
      const n = rec.calls.length;
      frame(i);
      const fresh = rec.calls.slice(n);
      bolts += fresh.filter((c) => c.op === 'stroke' && c.width === BOLT_CORE_PX).length;
      glows += fresh.filter((c) => c.op === 'radial' || c.op === 'linear').length;
      if (rec.calls.length > 50_000) rec.calls.length = 0; // keep memory flat over the long run
    }
    off();
    expect(getWeather()?.lightning.allowed).toBe(true);
    expect(announced).toBeGreaterThan(0);
    expect(glows).toBeGreaterThan(0);
    expect(bolts).toBeGreaterThan(0);
  });
});

describe('weather caption placement (PR #125 review B2)', () => {
  /** The declarations of the first top-level rule for `sel` in index.css. */
  function rule(css: string, sel: string): Record<string, string> {
    const m = new RegExp(`^${sel.replace('.', '\\.')} \\{([^}]*)\\}`, 'm').exec(css);
    expect(m, sel).not.toBeNull();
    const out: Record<string, string> = {};
    for (const d of m![1]!.split(';')) {
      const [k, v] = d.split(':');
      if (k && v) out[k.trim()] = v.trim();
    }
    return out;
  }

  it('sits bottom-left while the Sound chip sits top-left, so the chip never covers it', () => {
    const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8');
    const cap = rule(css, '.sx-wx-cap');
    const chip = rule(css, '.sx-amb');
    expect(chip.top).toBeDefined();
    expect(chip.bottom).toBeUndefined();
    expect(cap.bottom).toBeDefined();
    expect(cap.top).toBeUndefined();
    expect(cap['pointer-events']).toBe('none');
    expect(Number.parseInt(cap['z-index']!, 10)).toBeGreaterThanOrEqual(
      Number.parseInt(chip['z-index']!, 10),
    );
  });
});
