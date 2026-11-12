// Issue #93 W1: the star engine with a stand-in WebGL 2 context (jsdom has none). Checks the background compile (B7),
// the plasma pass skipped while it can only draw black (render notes 1.2), the surface close-up's inert overlays
// (0.5) and that the other mode's inert canvases no longer log "no webgl2".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StarEngine } from './StarEngine';

const COMPLETION = 0x91b1;
const LINK_STATUS = 0x8b82;
const COMPILE_STATUS = 0x8b81;

interface FakeGL {
  canvas: HTMLCanvasElement;
  calls: string[];
  done: boolean;
  lost: number;
  draws: number;
  /** Status reads that would wait for the driver (COMPILE_STATUS, LINK_STATUS). */
  waits: number;
}

let gls: FakeGL[] = [];
let compiled = false;
let parallel = true;

/** A WebGL 2 context that records what it is asked; the driver finishes compiling when `compiled` is set. */
function fakeGL(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const st: FakeGL = { canvas, calls: [], done: false, lost: 0, draws: 0, waits: 0 };
  gls.push(st);
  const ext: Record<string, unknown> = {
    KHR_parallel_shader_compile: { COMPLETION_STATUS_KHR: COMPLETION },
    WEBGL_lose_context: { loseContext: () => st.lost++ },
    EXT_color_buffer_float: {},
  };
  const known: Record<string, unknown> = {
    canvas,
    COMPILE_STATUS,
    LINK_STATUS,
    getExtension: (n: string) => (parallel || n !== 'KHR_parallel_shader_compile' ? ext[n] : null),
    getProgramParameter: (_p: unknown, k: number) => {
      if (k === COMPLETION) return compiled;
      if (k === LINK_STATUS) st.waits++;
      return true;
    },
    getShaderParameter: (_s: unknown, k: number) => {
      if (k === COMPILE_STATUS) st.waits++;
      return true;
    },
    drawArrays: () => st.draws++,
    drawArraysInstanced: () => st.draws++,
  };
  return new Proxy(known, {
    get(t, k: string) {
      if (k in t) return t[k];
      if (/^[A-Z0-9_]+$/.test(k)) return 1;
      return (...a: unknown[]) => {
        st.calls.push(k);
        return k.startsWith('create') || k === 'getUniformLocation' ? { k, a } : null;
      };
    },
  }) as unknown as WebGL2RenderingContext;
}

/** A 2D context that takes every call and property (the overlays' lines). */
function fake2d(): CanvasRenderingContext2D {
  const props: Record<string, unknown> = {};
  return new Proxy(props, {
    get: (t, k: string) => (k in t ? t[k] : () => fake2d()),
    set: (t, k: string, v) => {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const sun = { id: 'g', label: 'Sun', T: 5772, R: 1, M: 1, P: 25.4, dwarf: true };

describe('StarEngine with a WebGL 2 context (issue #93 W1)', () => {
  let errors: unknown[][];
  beforeEach(() => {
    gls = [];
    compiled = false;
    parallel = true;
    errors = [];
    const ctxs = new WeakMap<HTMLCanvasElement, WebGL2RenderingContext>();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
      t: string,
    ) {
      if (t === '2d') return fake2d();
      if (t !== 'webgl2') return null;
      let g = ctxs.get(this);
      if (!g) ctxs.set(this, (g = fakeGL(this)));
      return g;
    } as never);
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      errors.push(a);
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 400,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 300,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).clientWidth;
    delete (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).clientHeight;
    vi.useRealTimers();
  });

  it('submits the star shader without waiting for the driver, and draws once it is linked (B7)', async () => {
    const e = new StarEngine(document.createElement('div'), { mode: 'globe', light: 3 });
    const surface = gls[0]!;
    expect(e.supported).toBe(true);
    expect(e.ready).toBe(false);
    expect(surface.waits).toBe(0);
    e.setStar(sun);
    e.tick(1 / 60);
    // Nothing reads the status (which would wait for the compile), and the surface draws nothing yet.
    expect(surface.waits).toBe(0);
    expect(surface.draws).toBe(0);
    compiled = true;
    await e.whenReady();
    expect(e.ready).toBe(true);
    expect(surface.waits).toBeGreaterThan(0);
    expect(surface.draws).toBeGreaterThan(0);
    e.dispose();
  });

  it('without the parallel-compile extension links at once, as the prototype did', () => {
    parallel = false;
    const e = new StarEngine(document.createElement('div'), { mode: 'globe' });
    expect(e.ready).toBe(true);
    e.dispose();
  });

  it('never calls loseContext while the compile is still running; does once it has finished', () => {
    vi.useFakeTimers();
    const e = new StarEngine(document.createElement('div'), { mode: 'globe' });
    const live = [...gls];
    e.dispose();
    expect(live.every((g) => g.lost === 0)).toBe(true);
    vi.advanceTimersByTime(500);
    expect(live.every((g) => g.lost === 0)).toBe(true);
    compiled = true;
    vi.advanceTimersByTime(200);
    expect(live.every((g) => g.lost === 1)).toBe(true);
  });

  it('rejects whenReady when disposed before the shader is ready', async () => {
    const e = new StarEngine(document.createElement('div'), { mode: 'closeup' });
    const p = e.whenReady();
    e.dispose();
    await expect(p).rejects.toThrow(/disposed/);
  });

  it('runs the plasma pass once to clear it, then not again while it can only be black (1.2)', () => {
    compiled = true;
    const e = new StarEngine(document.createElement('div'), { mode: 'globe', light: 3 });
    e.setStar(sun);
    const plasma = gls[1]!;
    e.tick(1 / 60);
    const drawing = plasma.draws;
    expect(drawing).toBeGreaterThan(0); // the Observatory view draws the plasma
    e.setLight(0); // true colour: black plasma
    const cleared = plasma.draws;
    expect(cleared).toBeGreaterThan(drawing); // cleared once on leaving the Observatory view
    for (let i = 0; i < 10; i++) e.tick(1 / 60);
    expect(plasma.draws).toBe(cleared);
    e.setLight(3);
    e.tick(1 / 60);
    expect(plasma.draws).toBeGreaterThan(cleared);
    e.dispose();
  });

  it('the surface close-up has one canvas and no plasma context (0.5), and logs no "no webgl2"', () => {
    compiled = true;
    const host = document.createElement('div');
    const e = new StarEngine(host, { mode: 'globe', surface: true });
    e.setStar(sun);
    e.setScale('close');
    e.tick(1 / 60);
    expect(e.layers).toHaveLength(1);
    expect(host.querySelectorAll('canvas')).toHaveLength(1);
    expect(e.layers[0]!.getAttribute('aria-label')).toMatch(/surface/);
    expect(gls).toHaveLength(1);
    expect(gls[0]!.draws).toBeGreaterThan(0);
    expect(errors.filter((a) => String(a.join(' ')).includes('no webgl2'))).toEqual([]);
    e.dispose();
  });

  it('the inert canvases of the other mode no longer log "no webgl2"; a live canvas without GL still does', () => {
    compiled = true;
    const a = new StarEngine(document.createElement('div'), { mode: 'globe' });
    const b = new StarEngine(document.createElement('div'), { mode: 'closeup' });
    expect(errors).toEqual([]);
    a.dispose();
    b.dispose();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(() => null);
    const c = new StarEngine(document.createElement('div'), { mode: 'globe' });
    expect(c.supported).toBe(false);
    expect(errors.some((x) => x[0] === '[star engine]' && String(x[1]).includes('no webgl2'))).toBe(
      true,
    );
    c.dispose();
  });
});
