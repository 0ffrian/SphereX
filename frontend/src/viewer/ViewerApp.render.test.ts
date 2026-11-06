// Frame loop, clock bindings, quality hooks and the pipeline fallback, on a stub renderer.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebGPURenderer } from 'three/webgpu';
import { defaultContext, planRender } from './renderPlan';
import { fixture } from './renderers/fixtures.testutil';
import { percentile, ViewerApp } from './ViewerApp';

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

afterEach(() => vi.restoreAllMocks());

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
