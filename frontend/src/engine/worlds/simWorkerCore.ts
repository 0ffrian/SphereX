// Issue #93 1.10: the simulation worker's message handling, separate from the worker entry (sim.worker.ts) so the tests
// can drive it in Node. It runs a SimHost (the prototype's own simulation code, unchanged) and answers each request
// with the ops the tick made and the state after it. Arrays go back by transfer: the climate grids the tick wrote
// (EB.out, EB.out2) are handed over and replaced by fresh ones (each ebStep rewrites every element of both before
// anything reads them); the temperature and rain grids, the gas velocity field (GasSim reuses its buffer) and a river
// raster are sent as copies or handed over once the tick no longer needs them.
import { SimHost, type SimOp, type SimState } from './simHost';
import type { EngineOverrides, WorldPreset } from './types';

export type WorkerRequest =
  | { t: 'init'; preset: WorldPreset; applied: EngineOverrides; gen: number }
  | { t: 'set'; o: EngineOverrides; gen: number }
  | { t: 'tick'; playing: boolean; dt: number }
  | { t: 'dispose' };

export type WorkerReply =
  | {
      t: 'batch';
      ops: SimOp[];
      state: SimState;
      T: Float32Array | null;
      rain: Float32Array | null;
    }
  | { t: 'error'; message: string };

type Post = (m: WorkerReply, transfer: Transferable[]) => void;

/** True when every byte is zero (a raster with nothing drawn, sent as one texel instead of 8 MB). */
function allZero(a: Uint8Array): boolean {
  const w = new Uint32Array(a.buffer, a.byteOffset, a.byteLength >> 2);
  for (let i = 0; i < w.length; i++) if (w[i] !== 0) return false;
  for (let i = w.length << 2; i < a.length; i++) if (a[i] !== 0) return false;
  return true;
}

/** Message handler of the simulation worker. `post` is the worker's postMessage (or a test's stand-in). */
export function makeSimWorker(post: Post): (m: WorkerRequest) => void {
  let ops: SimOp[] = [];
  let host: SimHost | null = null;
  let gen = 0;
  const sink = (op: SimOp) => {
    // GasSim reuses its export buffer within one tick (an upload every 4 steps of a spin-up): copy it now.
    if (op.o === 'vel') ops.push({ o: 'vel', d: op.d.slice() });
    else ops.push(op);
  };

  const reply = () => {
    if (!host) return;
    const EB = host.core.EB,
      W = host.core.W;
    const transfer: Transferable[] = [];
    const sent: SimOp[] = [];
    let ebSent = false;
    for (const op of ops) {
      if (op.o === 'eb') {
        if (!ebSent) {
          // Hand the grids over and give the core fresh ones (filled again by the next ebStep before any read).
          transfer.push(op.out.buffer, op.out2.buffer);
          EB.out = new Float32Array(op.out.length);
          EB.out2 = new Float32Array(op.out2.length);
          ebSent = true;
          sent.push(op);
        } else sent.push({ o: 'eb', out: op.out, out2: op.out2 });
      } else if (op.o === 'vel') {
        transfer.push(op.d.buffer);
        sent.push(op);
      } else if (op.o === 'hydro') {
        const hd = op.hd;
        if (allZero(hd.img))
          sent.push({ o: 'hydro', hd: { ...hd, img: new Uint8Array(4), RW: 1, RH: 1 } });
        else {
          // The tick has finished with the raster (its aim at the rivers read it already): hand it over.
          const img = hd.img;
          sent.push({ o: 'hydro', hd: { ...hd, img } });
          if (!transfer.includes(img.buffer)) transfer.push(img.buffer);
        }
      } else sent.push(op);
    }
    ops = [];
    const T = EB.ready && !W.m?.gas ? (EB.T as Float32Array).slice() : null;
    const rain = EB.ready && !W.m?.gas ? (EB.rain as Float32Array).slice() : null;
    if (T) transfer.push(T.buffer);
    if (rain) transfer.push(rain.buffer);
    const state = host.state();
    state.gen = gen;
    post({ t: 'batch', ops: sent, state, T, rain }, transfer);
  };

  return (m: WorkerRequest) => {
    try {
      switch (m.t) {
        case 'init':
          gen = m.gen;
          ops = [];
          host = new SimHost(sink);
          host.load(m.preset, m.applied);
          reply();
          return;
        case 'set':
          gen = m.gen;
          host?.setOverrides(m.o);
          reply();
          return;
        case 'tick':
          host?.tick(m.playing, m.dt);
          reply();
          return;
        case 'dispose':
          host = null;
          ops = [];
          return;
      }
    } catch (err) {
      post({ t: 'error', message: err instanceof Error ? err.message : String(err) }, []);
    }
  };
}
