// Issue #93 1.9 and 1.10 (PR #101 render-performance roadmap): one planet simulation for both views, off the main
// thread when a Web Worker is available. A SimHost is an engine core that only simulates: the prototype's own core.js
// (createCore, the verbatim WorldGL.tick: climate, gas flow, rivers) on a stub WebGL context that draws nothing. It
// records what the tick would have sent to the GPU (the climate grids, a cloud-advection step, a gas velocity field and
// gas tracer step, the river raster, the gas band profile) as SimOps; every WorldEngine that draws the world replays
// them in its own GL context (simFollow.ts). The simulation code and its float64 maths are the prototype's, unchanged:
// a SimHost on the main thread (synchronous mode) and one in a worker (sim.worker.ts) give the same bytes.
import { createCore, type Core } from './core.js';
import { applyOverrides, loadPreset, resetsWorld, simKey } from './engineControls';
import type { EngineOverrides, WorldPreset } from './types';

/** A cyclone the cloud-advection pass stirs in (core.js ebCyclones). */
export interface SimCyclone {
  lon: number;
  lat: number;
  r: number;
  s: number;
  born: number;
  drift: number;
}

/** The river or lava raster (core.js hydroRaster): RGBA image plus counts the readouts show. */
export interface SimHydro {
  img: Uint8Array;
  RW: number;
  RH: number;
  [k: string]: unknown;
}

/** One GPU-side call of the prototype's tick, replayed by every engine that draws the world. */
export type SimOp =
  | { o: 'eb'; out: Float32Array; out2: Float32Array }
  | { o: 'cloud'; relax: number; step: number; cyc: SimCyclone[]; cycAt: number }
  | { o: 'vel'; d: Float32Array }
  | { o: 'gas'; dt: number; init: boolean }
  | { o: 'hydro'; hd: SimHydro }
  | { o: 'band'; d: Float32Array };

/** The simulation's scalar state after a tick (what the drawing engines show or read). */
export interface SimState {
  gen: number;
  key: string;
  gas: boolean;
  spinup: number;
  step: number;
  season: number;
  dt93: number;
  aimed: boolean;
  spin: number;
  pitch: number;
  stats: unknown;
  rainMax: number;
  /** Simulated gas time since the tracer was last initialised (sum of the gas steps' dt). */
  gasT: number;
}

/** Everything a drawing engine needs to catch up with the simulation at once (a late or long-paused view). */
export interface SimSnapshot {
  state: SimState;
  /** Climate grids: surface temperature and rain (haptics, readouts), and the two RGBA grids the shaders read. */
  T: Float32Array | null;
  rain: Float32Array | null;
  out: Float32Array | null;
  out2: Float32Array | null;
  cyc: SimCyclone[];
  cycAt: number;
  /** The raster last uploaded (the blank one while a world forms). */
  hydro: SimHydro | null;
  /** The gas velocity field last uploaded. */
  vel: Float32Array | null;
}

/** A canvas whose WebGL context accepts every call and draws nothing (the core's GL half is not used here). */
export function stubCanvas(): HTMLCanvasElement {
  const gl = new Proxy(
    {},
    {
      get(_t, k) {
        if (k === 'getProgramParameter')
          return (_p: unknown, q: unknown) => (q === 'AU' ? 0 : true);
        if (k === 'ACTIVE_UNIFORMS') return 'AU';
        if (k === 'getShaderParameter') return () => true;
        if (k === 'getExtension') return () => ({});
        if (k === 'getUniformLocation') return () => null;
        if (typeof k === 'string' && /^[A-Z_0-9]+$/.test(k)) return 1;
        return () => ({});
      },
    },
  );
  return {
    getContext: () => gl,
    width: 1,
    height: 1,
    clientWidth: 1,
    clientHeight: 1,
    addEventListener() {},
    style: {},
  } as unknown as HTMLCanvasElement;
}

type Sink = (op: SimOp) => void;

export class SimHost {
  readonly core: Core;
  /** Bumped on every load and every world rebuild a control asks for (fluid, spin, crust). */
  gen = 0;
  private sink: Sink;
  private gasT = 0;
  private hydroUp: SimHydro | null = null;
  private velUp: Float32Array | null = null;

  /**
   * `sink` receives each op as the tick makes it. Ops hold the core's own arrays (no copies): the synchronous source
   * replays them at once; the worker copies what it must before the next tick overwrites it (simWorkerCore.ts).
   */
  constructor(sink: Sink) {
    this.sink = sink;
    this.core = createCore(stubCanvas(), { role: 'globe' });
    const gl = this.core.W.gl,
      W = this.core.W,
      EB = this.core.EB;
    const wrap = (name: string, after: (args: unknown[]) => void, before?: () => unknown) => {
      const f = gl[name];
      gl[name] = function (...args: unknown[]) {
        before?.();
        const r = f.apply(gl, args);
        after(args);
        return r;
      };
    };
    wrap('uploadEb', () => this.sink({ o: 'eb', out: EB.out, out2: EB.out2 }));
    let step0 = 0;
    wrap(
      'cloudStep',
      (a) =>
        this.sink({ o: 'cloud', relax: a[1] as number, step: step0, cyc: EB.cyc, cycAt: EB.cycAt }),
      () => (step0 = W.step),
    );
    wrap('uploadVel', (a) => {
      this.velUp = a[0] as Float32Array;
      this.sink({ o: 'vel', d: this.velUp });
    });
    wrap('gasStep', (a) => {
      const dt = a[0] as number,
        init = !!a[1];
      this.gasT = init ? 0 : this.gasT + dt;
      this.sink({ o: 'gas', dt, init });
    });
    wrap('setHydro', (a) => {
      this.hydroUp = a[0] as SimHydro;
      this.sink({ o: 'hydro', hd: this.hydroUp });
    });
    wrap('setBand', (a) => this.sink({ o: 'band', d: a[0] as Float32Array }));
  }

  setSink(sink: Sink): void {
    this.sink = sink;
  }

  /** Load a world (the same loader as WorldEngine.setPreset), then the controls already applied to its views. */
  load(p: WorldPreset | string, applied?: EngineOverrides): void {
    this.gen++;
    loadPreset(this.core, p);
    if (applied && Object.keys(applied).length) applyOverrides(this.core, applied);
  }

  /** A control change (the same handlers as WorldEngine.setOverrides); a rebuild starts a new generation. */
  setOverrides(o: EngineOverrides): void {
    if (resetsWorld(o)) this.gen++;
    applyOverrides(this.core, o);
  }

  /** One frame of the prototype's simulation (WorldGL.tick): the climate or gas steps its budget allows. */
  tick(playing: boolean, dt: number): void {
    const W = this.core.W;
    if (!W.m) return;
    W.gl.tick(W.m, playing, Math.min(0.06, dt || 0));
  }

  get spinup(): number {
    return this.core.W.spinup;
  }

  state(): SimState {
    const W = this.core.W,
      EB = this.core.EB;
    return {
      gen: this.gen,
      key: simKey(this.core),
      gas: !!(W.m && W.m.gas),
      spinup: W.spinup,
      step: W.step,
      season: W.season,
      dt93: W.dt93 || 0,
      aimed: !!W.aimed,
      spin: W.spin,
      pitch: W.pitch,
      stats: EB.stats,
      rainMax: EB.rainMax || 0,
      gasT: this.gasT,
    };
  }

  /** The whole state as references to the core's arrays (copy before the next tick if they must outlive it). */
  snapshot(): SimSnapshot {
    const EB = this.core.EB;
    const gas = !!(this.core.W.m && this.core.W.m.gas);
    return {
      state: this.state(),
      T: EB.ready ? EB.T : null,
      rain: EB.ready ? EB.rain : null,
      out: !gas && EB.ready ? EB.out : null,
      out2: !gas && EB.ready ? EB.out2 : null,
      cyc: EB.cyc || [],
      cycAt: EB.cycAt ?? -1,
      hydro: this.hydroUp,
      vel: gas ? this.velUp : null,
    };
  }
}
