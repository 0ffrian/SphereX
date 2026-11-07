// Frame loop, clock bindings, quality hooks and the pipeline fallback, on a stub renderer.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebGPURenderer } from 'three/webgpu';
import { defaultContext, planRender } from './renderPlan';
import { fixture } from './renderers/fixtures.testutil';
import { COMPILE_TIMEOUT_MS, IDLE_PAUSE_MS, percentile, ViewerApp } from './ViewerApp';
import type { PauseReason } from './render/clock';

function make(extra: Record<string, unknown> = {}) {
  const render = vi.fn();
  const stub = {
    backend: {},
    setPixelRatio() {},
    setClearColor() {},
    setSize() {},
    render,
    dispose: () => Promise.resolve(),
    ...extra,
  } as unknown as WebGPURenderer;
  const Ctor = ViewerApp as unknown as new (c: HTMLCanvasElement, r: WebGPURenderer) => ViewerApp;
  return { v: new Ctor(document.createElement('canvas'), stub), render };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Private state the never-blank tests read (no public getter is worth adding for them). */
function internals(v: ViewerApp) {
  return v as unknown as {
    onScreen: unknown;
    built: unknown;
    lights: unknown[];
    placeholder: { visible: boolean };
    clock: { pauseReasons(): PauseReason[] };
  };
}

/** A stub renderer whose `compileAsync` calls resolve only when the test says so. */
function makeCompiling() {
  const resolvers: (() => void)[] = [];
  const compileAsync = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  return { ...make({ compileAsync }), resolvers, compileAsync };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
/** `compile` calls `compileAsync` a microtask later; finish the oldest call, then let swap run. */
async function finish(resolvers: (() => void)[]) {
  await flush();
  resolvers.shift()!();
  await flush();
}

function planOf(name: string) {
  const f = fixture(name);
  return planRender(f.card, f.params, defaultContext());
}

describe('percentile', () => {
  it('nearest rank, 0 when empty', () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
  });
});

describe('ViewerApp render hooks', () => {
  it('stub renderer on webgl2 starts on the low tier; setQualityTier changes it and is announced', () => {
    const { v } = make();
    const seen: unknown[] = [];
    v.setQualityChangeHandler((e) => seen.push(e));
    expect(v.renderStats()).toMatchObject({ tier: 'low', backend: 'webgl2', drops: 0 });
    v.setQualityTier('high');
    expect(v.renderStats().tier).toBe('high');
    expect(seen).toEqual([{ from: 'low', to: 'high', auto: false }]);
    v.dispose();
  });

  it('draws with the plain renderer when there is no pipeline, and counts frames', () => {
    const { v, render } = make();
    const before = v.renderStats().frames;
    v.clearObject();
    expect(render).toHaveBeenCalled();
    expect(v.renderStats().frames).toBeGreaterThan(before);
    v.dispose();
  });

  it('a body with no spin has no time-lapse; whenSettled resolves at once', async () => {
    const { v } = make();
    expect(v.timeLapses()).toEqual([]);
    await v.whenSettled();
    v.dispose();
  });

  it('the spin is a time-lapse on the clock, and freezeClock sets its sim time and settles', async () => {
    const { v } = make();
    const f = fixture('asteroid_shape');
    const plan = planRender(f.card, f.params, defaultContext());
    expect(plan.spin).not.toBeNull();
    if (!plan.spin) return;
    v.showPlan(plan);
    expect(v.timeLapses()).toEqual([{ id: 'spin', label: 'Spin', speedup: plan.spin.speedup }]);
    await v.freezeClock(5);
    expect(v.isSpinPaused()).toBe(false);
    await v.whenSettled();
    v.dispose();
  });
});

describe('ViewerApp never blank: compile, then swap (R5.5)', () => {
  it('keeps the old content and its lights on screen until the new content has compiled', async () => {
    const { v, resolvers } = makeCompiling();
    const a = planOf('asteroid_procedural');
    v.showPlan(a);
    expect(internals(v).onScreen).toBeNull();
    expect(internals(v).placeholder.visible).toBe(true);
    await finish(resolvers);
    const first = internals(v).onScreen;
    expect(first).not.toBeNull();
    expect(internals(v).placeholder.visible).toBe(false);
    const lightsA = internals(v).lights;

    v.showPlan(planOf('star_mira'));
    expect(internals(v).onScreen).toBe(first);
    expect(internals(v).lights).toBe(lightsA);
    await finish(resolvers);
    expect(internals(v).onScreen).not.toBe(first);
    expect(internals(v).onScreen).toBe(internals(v).built);
    expect(internals(v).lights).not.toBe(lightsA);
    v.dispose();
  });

  it('a build replaced before it finished compiling never reaches the screen', async () => {
    const { v, resolvers } = makeCompiling();
    v.showPlan(planOf('asteroid_procedural'));
    v.showPlan(planOf('star_mira'));
    const latest = internals(v).built;
    await finish(resolvers); // the first, stale compile finishes
    expect(internals(v).onScreen).toBeNull();
    await finish(resolvers);
    expect(internals(v).onScreen).toBe(latest);
    v.dispose();
  });

  it('shows the new content after COMPILE_TIMEOUT_MS even if the compile never finishes', async () => {
    vi.useFakeTimers();
    const { v } = makeCompiling();
    v.showPlan(planOf('asteroid_procedural'));
    await vi.advanceTimersByTimeAsync(COMPILE_TIMEOUT_MS - 1);
    expect(internals(v).onScreen).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(internals(v).onScreen).toBe(internals(v).built);
    v.dispose();
  });

  it('the spin starts with the content it belongs to, not while it compiles', async () => {
    const { v, resolvers } = makeCompiling();
    v.showPlan(planOf('asteroid_shape'));
    expect(v.timeLapses()).toEqual([]);
    await finish(resolvers);
    expect(v.timeLapses().map((t) => t.id)).toEqual(['spin']);
    v.dispose();
  });
});

describe('ViewerApp clock pauses (R5.7, R9)', () => {
  it('pauses for a hidden tab and resumes when it is shown', () => {
    const { v } = make();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(internals(v).clock.pauseReasons()).toContain('hidden');
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(internals(v).clock.pauseReasons()).not.toContain('hidden');
    v.dispose();
  });

  it('pauses while the canvas is off screen', () => {
    let report: ((e: { isIntersecting: boolean }[]) => void) | null = null;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: (e: { isIntersecting: boolean }[]) => void) {
          report = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    const { v } = make();
    report!([{ isIntersecting: false }]);
    expect(internals(v).clock.pauseReasons()).toContain('offscreen');
    report!([{ isIntersecting: true }]);
    expect(internals(v).clock.pauseReasons()).not.toContain('offscreen');
    v.dispose();
  });

  it('on a coarse pointer, pauses after a minute without interaction and resumes on input', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q === '(pointer: coarse)',
      addEventListener() {},
      removeEventListener() {},
    }));
    const canvas = document.createElement('canvas');
    const stub = {
      backend: {},
      setPixelRatio() {},
      setClearColor() {},
      setSize() {},
      render() {},
      dispose: () => Promise.resolve(),
    } as unknown as WebGPURenderer;
    const Ctor = ViewerApp as unknown as new (c: HTMLCanvasElement, r: WebGPURenderer) => ViewerApp;
    const v = new Ctor(canvas, stub);
    vi.advanceTimersByTime(IDLE_PAUSE_MS - 1);
    expect(internals(v).clock.pauseReasons()).not.toContain('idle');
    vi.advanceTimersByTime(1);
    expect(internals(v).clock.pauseReasons()).toContain('idle');
    canvas.dispatchEvent(new Event('keydown'));
    expect(internals(v).clock.pauseReasons()).not.toContain('idle');
    v.dispose();
  });

  it('a fine pointer never idles', () => {
    vi.useFakeTimers();
    const { v } = make();
    vi.advanceTimersByTime(IDLE_PAUSE_MS * 2);
    expect(internals(v).clock.pauseReasons()).not.toContain('idle');
    v.dispose();
  });
});

describe('ViewerApp quality tier from the URL', () => {
  it('?quality=high starts on high', () => {
    window.history.replaceState(null, '', '?quality=high');
    try {
      const { v } = make();
      expect(v.renderStats().tier).toBe('high');
      v.dispose();
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });
});
