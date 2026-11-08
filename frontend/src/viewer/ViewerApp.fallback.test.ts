// Never blank: if the render pipeline cannot be built or its first frame throws, the viewer
// draws with the plain renderer and warns once.
import { describe, expect, it, vi } from 'vitest';
import type { WebGPURenderer } from 'three/webgpu';

const state = { mode: 'ctor' as 'ctor' | 'render' };
const chainRender = vi.fn(() => {
  throw new Error('pipeline render failed');
});
vi.mock('./render/pipeline', async (orig) => {
  const actual = await orig<typeof import('./render/pipeline')>();
  class FakeChain {
    config = actual.chainConfig('low');
    constructor() {
      if (state.mode === 'ctor') throw new Error('pipeline build failed');
    }
    setTier() {}
    render = chainRender;
    dispose() {}
  }
  return { ...actual, RenderChain: FakeChain };
});

import { ViewerApp } from './ViewerApp';

type Pipelined = { initPipeline(): Promise<void>; clearObject(): void; dispose(): void };

function makeStub() {
  const render = vi.fn();
  const stub = {
    backend: {},
    setPixelRatio() {},
    setClearColor() {},
    setSize() {},
    render,
    dispose: () => Promise.resolve(),
  } as unknown as WebGPURenderer;
  return { stub, render };
}

describe('pipeline fallback', () => {
  it('a pipeline that cannot be built leaves plain rendering and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { stub, render } = makeStub();
    const Ctor = ViewerApp as unknown as new (c: HTMLCanvasElement, r: WebGPURenderer) => Pipelined;
    const v = new Ctor(document.createElement('canvas'), stub);
    await v.initPipeline();
    v.clearObject();
    v.clearObject();
    expect(render).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    v.dispose();
    warn.mockRestore();
  });

  it('a pipeline that throws on a frame is dropped and the frame is drawn plainly', async () => {
    state.mode = 'render';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { stub, render } = makeStub();
    const Ctor = ViewerApp as unknown as new (c: HTMLCanvasElement, r: WebGPURenderer) => Pipelined;
    const v = new Ctor(document.createElement('canvas'), stub);
    render.mockClear();
    await v.initPipeline();
    v.clearObject();
    expect(chainRender).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    v.dispose();
    warn.mockRestore();
  });
});
