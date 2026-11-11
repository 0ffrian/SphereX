// Issue #71 (D-37): while an engine draws the body, the three.js viewer builds, steps and draws nothing, and
// it resumes cleanly when the engine stops (failed, or "Measured only" unmounted it).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebGPURenderer } from 'three/webgpu';
import { defaultContext, planRender } from './renderPlan';
import { fixture } from './renderers/fixtures.testutil';
import { ViewerApp } from './ViewerApp';

function make() {
  const render = vi.fn();
  const stub = {
    backend: {},
    setPixelRatio() {},
    setClearColor() {},
    setSize() {},
    render,
    dispose: () => Promise.resolve(),
  } as unknown as WebGPURenderer;
  const Ctor = ViewerApp as unknown as new (c: HTMLCanvasElement, r: WebGPURenderer) => ViewerApp;
  return { v: new Ctor(document.createElement('canvas'), stub), render };
}

afterEach(() => {
  vi.restoreAllMocks();
});

const planOf = (name: string) => {
  const f = fixture(name);
  return planRender(f.card, f.params, defaultContext());
};

describe('ViewerApp.setEngineOwned', () => {
  it('builds nothing, draws nothing and runs no loop while an engine owns the body', () => {
    const { v, render } = make();
    v.setEngineOwned(true);
    render.mockClear();
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame');
    v.showPlan(planOf('asteroid_shape'));
    expect(v.isEngineOwned).toBe(true);
    expect((v as unknown as { onScreen: unknown }).onScreen).toBeNull();
    expect((v as unknown as { built: unknown }).built).toBeNull();
    expect(render).not.toHaveBeenCalled();
    expect(raf).not.toHaveBeenCalled();
    v.dispose();
  });

  it('drops the body already built when an engine takes over', () => {
    const { v } = make();
    v.showPlan(planOf('asteroid_shape'));
    expect((v as unknown as { onScreen: unknown }).onScreen).not.toBeNull();
    v.setEngineOwned(true);
    expect((v as unknown as { onScreen: unknown }).onScreen).toBeNull();
    v.dispose();
  });

  it('resumes: turning it off builds the last plan again and draws', () => {
    const { v, render } = make();
    v.setEngineOwned(true);
    v.showPlan(planOf('asteroid_shape'));
    render.mockClear();
    v.setEngineOwned(false);
    expect(v.isEngineOwned).toBe(false);
    expect((v as unknown as { onScreen: unknown }).onScreen).not.toBeNull();
    expect(render).toHaveBeenCalled();
    v.dispose();
  });

  it('does not stall whenSettled', async () => {
    const { v } = make();
    v.setEngineOwned(true);
    await v.whenSettled();
    v.dispose();
  });
});
