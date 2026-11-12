// Issue #93 CPU timings of the world engine in Node, with a stub WebGL context (no GPU, no browser):
//
//   node scripts/engine-bench/bench-cpu.js [preset id, default t1f] [engine module folder, default src/engine/worlds]
//
// Prints createCore, the first setPreset (terrain build and routing), the second engine's setPreset (the shared
// terrain of #93 1.5), and per-step costs of the climate or gas solver.
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const id = process.argv[2] || 't1f';
const dir = path.resolve(process.argv[3] || path.join(here, '..', '..', 'src', 'engine', 'worlds'));
const mod = (f) => import(pathToFileURL(path.join(dir, f)).href);
globalThis.window = globalThis;
globalThis.devicePixelRatio = 1;

const { createCore } = await mod('core.js');
const { WP } = await mod('presets.js');

function stubGL() {
  const fn = () => {};
  return new Proxy(
    {},
    {
      get(t, k) {
        if (k === 'getExtension') return () => ({});
        if (k === 'getProgramParameter') return (p, e) => (e === 'ACTIVE_UNIFORMS' ? 0 : true);
        if (k === 'getShaderParameter') return () => true;
        if (typeof k === 'string' && /^create/.test(k)) return () => ({});
        if (typeof k === 'string' && /^[A-Z_0-9]+$/.test(k)) return k;
        return fn;
      },
    },
  );
}
const canvas = () => ({
  clientWidth: 800,
  clientHeight: 600,
  width: 0,
  height: 0,
  getContext: () => stubGL(),
});
const T = (label, f, n = 1) => {
  const t0 = performance.now();
  let r;
  for (let i = 0; i < n; i++) r = f();
  console.log(label.padEnd(44), ((performance.now() - t0) / n).toFixed(1), 'ms');
  return r;
};
const p = WP.find((q) => q.id === id);
if (!p) throw new Error('no preset ' + id);
T('createCore (warm-up)', () => createCore(canvas()));
const a = T('createCore', () => createCore(canvas(), { role: 'globe' }));
T('setPreset ' + id + ', first engine', () => a.setPreset(p));
const b = createCore(canvas(), { role: 'fly' });
T('setPreset ' + id + ', second engine', () => b.setPreset(p));
console.log('second engine shares the terrain:', a.W.terr === b.W.terr && a.W.terr != null);
const m = a.W.m;
if (m.gas) {
  const GS = a.getGS();
  T('GasSim.step', () => GS.step(), 50);
} else {
  T('W.gl.tick (spin-up, 14 ms budget)', () => a.W.gl.tick(m, false, 1 / 60), 10);
}
T('worldModel', () => a.worldModel(), 50);
