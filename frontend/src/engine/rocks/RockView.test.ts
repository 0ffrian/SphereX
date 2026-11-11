// Issue #71 (D-37): the rock engine releases its WebGL contexts, checks support once, and reports a lost context.
import { afterEach, describe, expect, it, vi } from 'vitest';

const lose = vi.fn();
const getContext = vi.fn();

vi.mock('./source', () => ({
  R: { playing: true, yaw: 0.6, pitch: 0.25, drag: null },
  RockGL: class {
    constructor(public canvas: HTMLCanvasElement) {}
    upload() {}
    draw() {}
  },
  buildRock: () => undefined,
  rockModel: () => ({}),
  clamp: (x: number, a: number, b: number) => Math.min(b, Math.max(a, x)),
  radialFn: () => () => 1,
  setReducedMotion: () => undefined,
}));

import { RockView } from './RockView';

afterEach(() => {
  lose.mockClear();
  getContext.mockClear();
});

const realCreate = document.createElement.bind(document);

function canvas(): HTMLCanvasElement {
  const c = realCreate('canvas');
  getContext.mockImplementation(() => ({ getExtension: () => ({ loseContext: lose }) }));
  c.getContext = getContext as never;
  return c;
}

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
