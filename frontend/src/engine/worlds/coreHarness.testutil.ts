// Issue #93 (physics): load the verbatim world engine core headless, with a WebGL stub, so its CPU model
// (worldModel, the energy budget, worldUi) can be tested in Node. Nothing is drawn.
import { createCore, type Core } from './core.js';
import { WP } from './presets.js';
import type { WorldPreset } from './types';

const glStub = new Proxy(
  {},
  {
    get(_t, k) {
      if (k === 'getProgramParameter') return (_p: unknown, q: unknown) => (q === 'AU' ? 0 : true);
      if (k === 'ACTIVE_UNIFORMS') return 'AU';
      if (k === 'getShaderParameter') return () => true;
      if (k === 'getExtension') return () => ({});
      if (k === 'getUniformLocation') return () => null;
      if (typeof k === 'string' && /^[A-Z_0-9]+$/.test(k)) return 1;
      return () => ({});
    },
  },
);

/** A fresh engine core on a stub canvas. */
export function headlessCore(): Core {
  const canvas = {
    getContext: () => glStub,
    width: 64,
    height: 64,
    addEventListener() {},
    style: {},
  } as unknown as HTMLCanvasElement;
  return createCore(canvas);
}

/** A prototype preset by id. */
export function preset(id: string): WorldPreset {
  const p = (WP as WorldPreset[]).find((q) => q.id === id);
  if (!p) throw new Error('no preset ' + id);
  return p;
}

/** Sets the model state the way setPreset does, without building terrain or stepping the budget. */
export function loadModelOnly(core: Core, p: WorldPreset): void {
  const W = core.W;
  const ob = (p as { ob?: { e?: number; obl?: number } }).ob ?? core.ORB[p.id] ?? { e: 0, obl: 0 };
  W.ecc = ob.e ?? 0;
  W.obl = ob.obl ?? 0;
  W.spinMode = 'auto';
  W.base = p;
  W.p = core.applySpin(p);
  W.fluid = p.fluid;
  W.Tstar = p.Ts;
  W.orbit = 1;
  W.Ps = p.Ps;
}
