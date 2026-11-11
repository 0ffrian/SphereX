// Issue #71 stream E: main-thread side of the gas solver worker. Never blank: if Workers are
// unavailable (or the worker fails) the same solver runs on the main thread, a few steps per call.
import type { GasInput, PlacedStorm } from '@/physics/gasDynamics';
import { handleGasRequest, type GasHost, type GasRequest, type GasResponse } from './gasWorker';

export interface GasFrame {
  /** Solver steps taken so far (the simulation state is a function of this and the input). */
  steps: number;
  /** Velocity field for the tracer pass, GAS_NX x GAS_NY RGBA floats. */
  field: Float32Array;
  /** Where the storms are at this step (the picture and the haptics read the same list). */
  storms: PlacedStorm[];
}

export interface GasSolver {
  /** Takes `steps` more solver steps and returns the field. Calls are served in order. */
  advance(steps: number): Promise<GasFrame>;
  /** False when the worker could not start and the solver runs on the main thread. */
  readonly threaded: boolean;
  dispose(): void;
}

/** How many solvers ran in a worker or on the main thread (tests and the e2e read it). */
export const gasStats = { worker: 0, main: 0 };

/**
 * Starts a solver. Rejects when the model refuses the input (nothing is guessed). The first frame
 * is the initial field at step 0.
 */
export async function startGasSolver(input: GasInput): Promise<GasSolver & { first: GasFrame }> {
  const viaWorker = await tryWorker(input);
  if (viaWorker) {
    gasStats.worker++;
    return viaWorker;
  }
  gasStats.main++;
  const state: { host: GasHost | null } = { host: null };
  const init = handleGasRequest(state, { id: 0, kind: 'init', input });
  if (!init.ok) throw new Error(init.error);
  let id = 1;
  let queue: Promise<unknown> = Promise.resolve();
  return {
    first: { steps: 0, field: init.field, storms: init.storms },
    threaded: false,
    advance(steps) {
      const run = queue.then(async () => {
        // Yield so a long run does not freeze the page.
        await new Promise<void>((r) => setTimeout(r, 0));
        const res = handleGasRequest(state, { id: id++, kind: 'advance', steps });
        if (!res.ok) throw new Error(res.error);
        return { steps: res.steps, field: res.field, storms: res.storms };
      });
      queue = run.catch(() => undefined);
      return run;
    },
    dispose() {
      state.host = null;
    },
  };
}

async function tryWorker(input: GasInput): Promise<(GasSolver & { first: GasFrame }) | null> {
  if (typeof Worker === 'undefined') return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL('./gasWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (r: GasResponse) => void; reject: (e: Error) => void }
  >();
  let dead = false;
  worker.onmessage = (e: MessageEvent<GasResponse>) => {
    const entry = pending.get(e.data.id);
    if (!entry) return;
    pending.delete(e.data.id);
    entry.resolve(e.data);
  };
  worker.onerror = () => {
    dead = true;
    for (const entry of pending.values()) entry.reject(new Error('gas worker failed'));
    pending.clear();
    worker.terminate();
  };
  const call = (req: GasRequest) =>
    new Promise<GasResponse>((resolve, reject) => {
      if (dead) return reject(new Error('gas worker failed'));
      pending.set(req.id, { resolve, reject });
      worker.postMessage(req);
    });
  let init: GasResponse;
  try {
    init = await call({ id: nextId++, kind: 'init', input });
  } catch {
    worker.terminate();
    return null;
  }
  if (!init.ok) {
    worker.terminate();
    throw new Error(init.error);
  }
  return {
    first: { steps: 0, field: init.field, storms: init.storms },
    threaded: true,
    async advance(steps) {
      const res = await call({ id: nextId++, kind: 'advance', steps });
      if (!res.ok) throw new Error(res.error);
      return { steps: res.steps, field: res.field, storms: res.storms };
    },
    dispose() {
      dead = true;
      worker.terminate();
      pending.clear();
    },
  };
}
