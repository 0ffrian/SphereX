// Issue #71 stream E: Web Worker that holds the gas-giant solver (physics/gasDynamics.ts) so the
// vorticity steps never block the frame loop. Same pattern as fieldWorker.ts: a thin wrapper, the
// logic is in the physics module. One worker per solver; the state (a function of input, seed and
// step count) lives here, and only the velocity field is sent back, transferred not copied.
import {
  createGasSim,
  gasModel,
  gasProfile,
  type GasInput,
  type GasModel,
  type GasSim,
} from '@/physics/gasDynamics';

export type GasRequest =
  | { id: number; kind: 'init'; input: GasInput }
  | { id: number; kind: 'advance'; steps: number };
export type GasResponse =
  | { id: number; ok: true; steps: number; field: Float32Array }
  | { id: number; ok: false; error: string };

export interface GasHost {
  model: GasModel;
  sim: GasSim;
}

/** Builds the solver for an input, or null when the model refuses (a missing input). */
export function initGasHost(input: GasInput): GasHost | null {
  const model = gasModel(input);
  if (!model) return null;
  return { model, sim: createGasSim(model, input.seed, gasProfile(model, input)) };
}

/** The worker's whole job without the messaging, so it can be tested. `host` is replaced by `init`. */
export function handleGasRequest(
  state: { host: GasHost | null },
  req: GasRequest,
): GasResponse {
  try {
    if (req.kind === 'init') {
      state.host = initGasHost(req.input);
      if (!state.host) return { id: req.id, ok: false, error: 'the gas model has a missing input' };
      return { id: req.id, ok: true, steps: 0, field: state.host.sim.exportField(true).slice() };
    }
    const host = state.host;
    if (!host) return { id: req.id, ok: false, error: 'not initialised' };
    for (let i = 0; i < req.steps; i++) host.sim.step();
    return { id: req.id, ok: true, steps: host.sim.steps, field: host.sim.exportField().slice() };
  } catch (err) {
    return { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ASSUMPTION: the `webworker` lib is not enabled in tsconfig, so the worker scope is typed here.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<GasRequest>) => void) | null;
  postMessage(msg: GasResponse, transfer: Transferable[]): void;
};
if (typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined') {
  const state: { host: GasHost | null } = { host: null };
  scope.onmessage = (e) => {
    const res = handleGasRequest(state, e.data);
    scope.postMessage(res, res.ok ? [res.field.buffer as ArrayBuffer] : []);
  };
}
