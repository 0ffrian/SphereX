// Issue #71 (D-37): the rock engine releases its WebGL contexts, checks support once, and reports a lost context.
// Issue #93 wave 1: it pauses off-screen and in a hidden tab (0.3), culls back faces (0.4), copies one pane's picture
// to the other (0.8), builds the height map in a worker, newest request first (1.8), and never releases a context
// whose compile is still running (B7).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lose = vi.fn();
const getContext = vi.fn();
const draws: HTMLCanvasElement[] = [];
/** Set per test: whether the fake engine's programs have finished compiling, or the error they report. */
const compile = { done: true as boolean, error: null as Error | null };

vi.mock('./source', () => {
  const R: Record<string, unknown> = {
    playing: true,
    yaw: 0.6,
    pitch: 0.25,
    drag: null,
    clock: 0,
    spin: 0,
    mode: 'rocky',
    age: 70,
  };
  return {
    R,
    RockGL: class {
      constructor(public canvas: HTMLCanvasElement) {}
      upload() {}
      draw() {
        draws.push(this.canvas);
      }
      poll() {
        if (compile.error) throw compile.error;
        return compile.done;
      }
    },
    buildRock: () => {
      R.built = { data: new Float32Array(8), ext: 1, craters: 3, w: 2, h: 2 };
    },
    rockModel: () => ({
      gv: 1,
      escape: 2,
      lump: 0.1,
      limit: 2,
      kind: 'Solid rock',
      fast: false,
      ax: [1, 1, 1],
    }),
    clamp: (x: number, a: number, b: number) => Math.min(b, Math.max(a, x)),
    radialFn: () => () => 1,
    setReducedMotion: () => undefined,
    setRockBake: () => undefined,
  };
});

import * as E from './source';
import { RockView, ROCK_DISPOSE_POLL_MS, ROCK_DISPOSE_MAX_WAIT_MS } from './RockView';
import type { RockFromCard } from './cardToRock';

const R = E.R as unknown as Record<string, number | boolean | null>;
const rock = { preset: { id: 'x', label: 'X' } } as unknown as RockFromCard;
const realCreate = document.createElement.bind(document);

interface FakeGL {
  enable: ReturnType<typeof vi.fn>;
  cullFace: ReturnType<typeof vi.fn>;
  frontFace: ReturnType<typeof vi.fn>;
  texImage2D: ReturnType<typeof vi.fn>;
}

/** A canvas whose context records culling and copies; `w` x `h` CSS px. */
function canvas(w = 400, h = 250): HTMLCanvasElement & { fake: FakeGL } {
  const c = realCreate('canvas') as HTMLCanvasElement & { fake: FakeGL };
  const fake: FakeGL & Record<string, unknown> = {
    enable: vi.fn(),
    cullFace: vi.fn(),
    frontFace: vi.fn(),
    texImage2D: vi.fn(),
    CULL_FACE: 'CULL_FACE',
    BACK: 'BACK',
    CCW: 'CCW',
    LINK_STATUS: 'LINK_STATUS',
    getExtension: (n: string) => (n === 'WEBGL_lose_context' ? { loseContext: lose } : null),
    createProgram: () => ({}),
    createShader: () => ({}),
    createTexture: () => ({}),
    getProgramParameter: () => true,
    getUniformLocation: () => ({}),
  };
  for (const k of [
    'shaderSource',
    'compileShader',
    'attachShader',
    'linkProgram',
    'bindTexture',
    'texParameteri',
    'bindFramebuffer',
    'viewport',
    'disable',
    'useProgram',
    'bindVertexArray',
    'activeTexture',
    'uniform1i',
    'drawArrays',
  ])
    fake[k] = () => undefined;
  getContext.mockImplementation(() => fake);
  c.getContext = (() => fake) as never;
  Object.defineProperty(c, 'clientWidth', { value: w });
  Object.defineProperty(c, 'clientHeight', { value: h });
  c.fake = fake;
  return c;
}

/** IntersectionObserver stand-in: `ios` holds each observer's callback and target. */
const ios: { cb: (e: { isIntersecting: boolean }[]) => void; target: Element | null }[] = [];
class FakeIO {
  private rec: (typeof ios)[number];
  constructor(cb: (e: { isIntersecting: boolean }[]) => void) {
    this.rec = { cb, target: null };
    ios.push(this.rec);
  }
  observe(t: Element) {
    this.rec.target = t;
  }
  disconnect() {}
}
const seen = (c: Element, on: boolean) => {
  for (const o of ios) if (o.target === c) o.cb([{ isIntersecting: on }]);
};

/** requestAnimationFrame stand-in: `frame(t)` runs the pending callback. */
let rafCb: ((t: number) => void) | null = null;
const frame = (t: number) => {
  const f = rafCb;
  rafCb = null;
  f?.(t);
};

beforeEach(() => {
  compile.done = true;
  compile.error = null;
  draws.length = 0;
  ios.length = 0;
  rafCb = null;
  R.playing = true;
  R.clock = 0;
  vi.stubGlobal('IntersectionObserver', FakeIO);
  vi.stubGlobal('requestAnimationFrame', (f: (t: number) => void) => {
    rafCb = f;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  lose.mockClear();
  getContext.mockClear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});

describe('RockView', () => {
  it('the detach function loses the canvas context', () => {
    const view = new RockView(true);
    const off = view.attach(canvas());
    expect(lose).not.toHaveBeenCalled();
    off();
    expect(lose).toHaveBeenCalledTimes(1);
    view.dispose();
  });

  it('dispose loses the context of every attached canvas', () => {
    const view = new RockView(true);
    view.attach(canvas());
    view.attach(canvas());
    view.dispose();
    expect(lose).toHaveBeenCalledTimes(2);
  });

  it('supported() is checked once and its probe context is released', () => {
    const spy = vi.spyOn(document, 'createElement').mockImplementation(() => canvas());
    const a = RockView.supported();
    const b = RockView.supported();
    const calls = spy.mock.calls.length;
    spy.mockRestore();
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(calls).toBe(1);
    expect(lose).toHaveBeenCalledTimes(1);
  });

  it('a lost context is reported so the old path can draw', () => {
    const view = new RockView(true);
    const cb = vi.fn();
    view.onContextLost(cb);
    const c = canvas();
    view.attach(c);
    c.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(cb).toHaveBeenCalledTimes(1);
    view.dispose();
  });
});

describe('RockView pauses when nothing is on screen (#93 0.3)', () => {
  it('an off-screen canvas is not drawn, and is drawn again when it comes back', () => {
    const view = new RockView(false, { worker: false });
    const c = canvas();
    view.attach(c);
    view.setBody(rock);
    seen(c, false);
    view.draw();
    expect(draws).toHaveLength(0);
    seen(c, true);
    view.draw();
    expect(draws).toEqual([c]);
    view.dispose();
  });

  it('the clock and the spin stop while no canvas is shown or the tab is hidden', () => {
    const view = new RockView(false, { worker: false });
    const c = canvas();
    view.attach(c);
    view.setBody(rock);
    frame(0);
    frame(16);
    const clock = R.clock as number;
    expect(clock).toBeGreaterThan(0);
    seen(c, false);
    frame(32);
    frame(48);
    expect(R.clock).toBe(clock);
    seen(c, true);
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    frame(64);
    expect(R.clock).toBe(clock);
    const n = draws.length;
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    frame(80);
    expect(R.clock as number).toBeGreaterThan(clock);
    expect(draws.length).toBeGreaterThan(n);
    view.dispose();
  });

  it('setVisible(false) pauses as well', () => {
    const view = new RockView(false, { worker: false });
    view.attach(canvas());
    view.setBody(rock);
    view.setVisible(false);
    frame(0);
    frame(16);
    expect(draws).toHaveLength(0);
    view.dispose();
  });
});

describe('RockView culls back faces (#93 0.4)', () => {
  it('turns on CULL_FACE with counter-clockwise front faces on every canvas', () => {
    const view = new RockView(true);
    const c = canvas();
    view.attach(c);
    expect(c.fake.enable).toHaveBeenCalledWith('CULL_FACE');
    expect(c.fake.cullFace).toHaveBeenCalledWith('BACK');
    expect(c.fake.frontFace).toHaveBeenCalledWith('CCW');
    view.dispose();
  });
});

describe('RockView draws a shared body once (#93 0.8)', () => {
  it('the larger canvas draws; a canvas of the same shape copies its picture', () => {
    const view = new RockView(true, { worker: false });
    const small = canvas(320, 200);
    const big = canvas(800, 500);
    view.attach(small);
    view.attach(big);
    view.setBody(rock);
    view.draw();
    expect(draws).toEqual([big]);
    expect(small.fake.texImage2D).toHaveBeenCalledTimes(1);
    expect(small.fake.texImage2D.mock.calls[0]!.at(-1)).toBe(big);
    view.dispose();
  });

  it('a canvas of another shape draws the body itself', () => {
    const view = new RockView(true, { worker: false });
    const a = canvas(800, 500);
    const b = canvas(400, 400);
    view.attach(a);
    view.attach(b);
    view.setBody(rock);
    view.draw();
    expect(draws).toEqual([a, b]);
    expect(b.fake.texImage2D).not.toHaveBeenCalled();
    view.dispose();
  });

  it('with sharing off, each canvas draws', () => {
    RockView.shareCanvases = false;
    try {
      const view = new RockView(true, { worker: false });
      const a = canvas(800, 500);
      const b = canvas(400, 250);
      view.attach(a);
      view.attach(b);
      view.setBody(rock);
      view.draw();
      expect(draws).toEqual([a, b]);
      view.dispose();
    } finally {
      RockView.shareCanvases = true;
    }
  });

  it('whenDrawn resolves once a canvas has a picture, drawn or copied', async () => {
    const view = new RockView(true, { worker: false });
    const a = canvas(800, 500);
    const b = canvas(400, 250);
    view.attach(a);
    view.attach(b);
    view.setBody(rock);
    let got = false;
    void view.whenDrawn(b).then(() => (got = true));
    await Promise.resolve();
    expect(got).toBe(false);
    view.draw();
    await Promise.resolve();
    expect(got).toBe(true);
    view.dispose();
  });
});

describe('RockView compiles in the background (#93 B7)', () => {
  it('whenReady resolves only once the programs are linked, and nothing is drawn before', async () => {
    vi.useFakeTimers();
    compile.done = false;
    const view = new RockView(true, { worker: false });
    const c = canvas();
    view.attach(c);
    view.setBody(rock);
    let ready = false;
    void view.whenReady(c).then(() => (ready = true));
    await vi.advanceTimersByTimeAsync(100);
    view.draw();
    expect(ready).toBe(false);
    expect(draws).toHaveLength(0);
    compile.done = true;
    await vi.advanceTimersByTimeAsync(20);
    expect(ready).toBe(true);
    view.draw();
    // (Fake timers also run the frame loop, which may draw too.)
    expect(draws.length).toBeGreaterThan(0);
    expect(new Set(draws)).toEqual(new Set([c]));
    view.dispose();
  });

  it('whenReady rejects with the compile log (the stage then falls back)', async () => {
    compile.error = new Error('ERROR: 0:1: syntax error');
    const view = new RockView(true, { worker: false });
    const c = canvas();
    view.attach(c);
    await expect(view.whenReady(c)).rejects.toThrow('syntax error');
    view.dispose();
  });

  it('a canvas released mid-compile loses its context only once the compile has finished', async () => {
    vi.useFakeTimers();
    compile.done = false;
    const view = new RockView(true);
    const off = view.attach(canvas());
    off();
    expect(lose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(ROCK_DISPOSE_POLL_MS * 5);
    expect(lose).not.toHaveBeenCalled();
    compile.done = true;
    await vi.advanceTimersByTimeAsync(ROCK_DISPOSE_POLL_MS);
    expect(lose).toHaveBeenCalledTimes(1);
    view.dispose();
  });

  it('gives up without loseContext() when the compile never finishes', async () => {
    vi.useFakeTimers();
    compile.done = false;
    const view = new RockView(true);
    view.attach(canvas());
    view.dispose();
    await vi.advanceTimersByTimeAsync(ROCK_DISPOSE_MAX_WAIT_MS + 10 * ROCK_DISPOSE_POLL_MS);
    expect(lose).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('RockView builds the height map in a worker (#93 1.8)', () => {
  type Msg = { id: number; req: { age: number } };
  const posted: Msg[] = [];
  let worker: {
    onmessage: ((e: { data: unknown }) => void) | null;
    onerror: ((e: unknown) => void) | null;
  } | null;
  class FakeWorker {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    constructor() {
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- the test drives this worker's replies
      worker = this;
    }
    postMessage(m: Msg) {
      posted.push(m);
    }
    terminate() {}
  }
  const reply = (m: Msg) =>
    worker!.onmessage!({
      data: {
        id: m.id,
        RM: { gv: 1, escape: 2, lump: 0.1, limit: 2, kind: 'k', fast: false, ax: [1, 1, 1] },
        built: { data: new Float32Array(8), ext: 1, craters: m.req.age, w: 2, h: 2 },
      },
    });

  beforeEach(() => {
    posted.length = 0;
    worker = null;
    vi.stubGlobal('Worker', FakeWorker);
  });

  it('a newer request replaces one still waiting; each finished build is shown', async () => {
    const view = new RockView(true);
    const stats: number[] = [];
    view.onChange((s) => stats.push(s.craters));
    view.setBody(rock);
    view.setAge(10);
    view.setAge(20);
    view.setAge(30);
    expect(posted.map((m) => m.req.age)).toEqual([70]);
    expect(view.built).toBe(false);
    let done = false;
    void view.whenBuilt().then(() => (done = true));
    reply(posted[0]!);
    expect(posted.map((m) => m.req.age)).toEqual([70, 30]);
    expect(stats).toEqual([70]);
    reply(posted[1]!);
    expect(stats).toEqual([70, 30]);
    await Promise.resolve();
    expect(done).toBe(true);
    expect(view.age).toBe(30);
    view.dispose();
  });

  it('a broken worker falls back to the main thread for the newest request', () => {
    const view = new RockView(true);
    const stats: number[] = [];
    view.onChange((s) => stats.push(s.craters));
    view.setBody(rock);
    view.setAge(40);
    worker!.onerror!({ preventDefault() {} });
    // The mocked engine's build reports 3 craters.
    expect(stats).toEqual([3]);
    expect(view.built).toBe(true);
    view.setAge(50);
    expect(posted).toHaveLength(1);
    expect(stats).toEqual([3, 3]);
    view.dispose();
  });

  it('worker: false builds synchronously (tests, the parity harness)', () => {
    const view = new RockView(true, { worker: false });
    view.setBody(rock);
    expect(view.built).toBe(true);
    expect(posted).toHaveLength(0);
    view.dispose();
  });
});
