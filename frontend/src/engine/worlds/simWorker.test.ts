// @vitest-environment node
// Issue #93 1.10: the simulation worker gives the same bytes as the synchronous engine. The worker's message handler
// (simWorkerCore.ts, the code sim.worker.ts runs) is driven in-process; every reply goes through structuredClone with
// its transfer list, as postMessage would send it. The synchronous side is the engine core ticking itself, as the
// prototype does. The worker forms the world back to back (SimHost.spinChunk); after the same 900 (or 420) spin-up
// steps and the same playing ticks (parity virtual clock, 1 ms a performance.now call) the grids must be identical.
import { afterEach, describe, expect, it } from 'vitest';
import { headlessCore, preset } from './coreHarness.testutil';
import { makeSimWorker, type WorkerReply } from './simWorkerCore';
import type { SimHydro } from './simHost';

const real = performance.now.bind(performance);
afterEach(() => {
  performance.now = real;
});
const virtualClock = () => {
  let t = 0;
  performance.now = () => (t += 1);
};

/** Spin-up ticks, then playing ticks (the river raster is built on the first tick after the spin-up). */
const PLAY_TICKS = 12;
const DT = 1 / 60;

interface Result {
  ticks: number;
  spinup: number;
  step: number;
  out: Float32Array | null;
  out2: Float32Array | null;
  T: Float32Array | null;
  rain: Float32Array | null;
  vel: Float32Array | null;
  hydro: Uint8Array | null;
}

const bytes = (a: ArrayBufferView | null) =>
  a ? Buffer.from(a.buffer, a.byteOffset, a.byteLength) : null;

function runSync(id: string): Result {
  virtualClock();
  const core = headlessCore();
  const gl = core.W.gl;
  let vel: Float32Array | null = null,
    hydro: Uint8Array | null = null;
  const up = gl.uploadVel;
  gl.uploadVel = (d: Float32Array) => {
    vel = d.slice();
    return up.call(gl, d);
  };
  const sh = gl.setHydro;
  gl.setHydro = (hd: SimHydro) => {
    hydro = hd.img.slice();
    return sh.call(gl, hd);
  };
  core.setPreset(preset(id));
  const W = core.W;
  let ticks = 0;
  // 5.5 ms a clock read: one climate step a tick, so the spin-up takes exactly its 900 steps (the worker's back-to-back
  // spin-up does too; the prototype's last tick can step past the end, see simBudget.test.ts).
  let t = 0;
  performance.now = () => (t += 5.5);
  while (W.spinup > 0 && ticks < 5000) {
    W.gl.tick(W.m, false, DT);
    ticks++;
  }
  virtualClock();
  for (let i = 0; i < PLAY_TICKS; i++, ticks++) W.gl.tick(W.m, true, DT);
  const EB = core.EB,
    gas = !!W.m.gas;
  return {
    ticks,
    spinup: W.spinup,
    step: W.step,
    out: gas ? null : EB.out.slice(),
    out2: gas ? null : EB.out2.slice(),
    T: gas ? null : EB.T.slice(),
    rain: gas ? null : EB.rain.slice(),
    vel,
    hydro,
  };
}

function runWorker(id: string): Result {
  virtualClock();
  const replies: WorkerReply[] = [];
  const jobs: (() => void)[] = [];
  const handle = makeSimWorker(
    (m, transfer) => replies.push(structuredClone(m, { transfer })),
    (f) => jobs.push(f),
  );
  handle({ t: 'init', preset: preset(id), applied: {}, gen: 1 });
  const r: Result = {
    ticks: 0,
    spinup: Infinity,
    step: 0,
    out: null,
    out2: null,
    T: null,
    rain: null,
    vel: null,
    hydro: null,
  };
  const take = () => {
    for (const m of replies.splice(0)) {
      if (m.t === 'error') throw new Error(m.message);
      for (const op of m.ops) {
        if (op.o === 'eb') {
          r.out = op.out;
          r.out2 = op.out2;
        } else if (op.o === 'vel') r.vel = op.d;
        else if (op.o === 'hydro' && op.hd.RW > 1) r.hydro = op.hd.img;
      }
      r.spinup = m.state.spinup;
      r.step = m.state.step;
      if (m.T) r.T = m.T;
      if (m.rain) r.rain = m.rain;
    }
  };
  take();
  while (r.spinup > 0 && r.ticks < 5000) {
    jobs.shift()?.(); // the worker's own next spin-up chunk
    r.ticks++;
    take();
  }
  for (let i = 0; i < PLAY_TICKS; i++, r.ticks++) {
    handle({ t: 'tick', playing: true, dt: DT });
    take();
  }
  return r;
}

describe('#93 1.10 the simulation worker matches the synchronous engine byte for byte', () => {
  for (const id of ['t1f', 'earth', 'jup', 'hd']) {
    it(
      id,
      () => {
        const a = runSync(id);
        const b = runWorker(id);
        expect(b.spinup).toBe(0);
        for (const k of ['out', 'out2', 'T', 'rain', 'vel'] as const) {
          expect(b[k] === null, k).toBe(a[k] === null);
          if (a[k]) expect(bytes(b[k])!.equals(bytes(a[k])!), k).toBe(true);
        }
        if (a.hydro && a.hydro.some((v) => v !== 0)) {
          expect(b.hydro, 'river raster').not.toBeNull();
          expect(bytes(b.hydro)!.equals(bytes(a.hydro)!), 'river raster').toBe(true);
        }
        if (id === 'jup' || id === 'hd') expect(a.vel).not.toBeNull();
        else expect(a.out).not.toBeNull();
        // Earth's rivers are drawn, so the raster comparison above did run.
        if (id === 'earth') expect(b.hydro?.some((v) => v !== 0)).toBe(true);
      },
      120_000,
    );
  }
});
