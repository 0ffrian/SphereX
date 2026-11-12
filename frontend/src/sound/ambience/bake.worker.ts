// Spec R13 §9.1, §9.5: the ambience bake worker (#113). One bed per message, and the two channel buffers are transferred,
// not copied. The DSP is Moon's prototype, ported in dsp.ts. Same pattern as viewer/fields/worldWorker.ts:
// `handleBakeRequest` is the whole job without the messaging, so it can be tested.
import { BakeRefusedError, bakeBedDetailed } from './dsp';
import type { AirModel, BakeResult, BedSpec } from './types';

export type BakeRequest = { id: number; key: string; spec: BedSpec; air: AirModel };
export type BakeResponse =
  | { id: number; key: string; result: BakeResult; notes: string[]; ffts: number }
  | { id: number; key: string; error: string; refused: boolean };

export function handleBakeRequest(req: BakeRequest): BakeResponse {
  try {
    const out = bakeBedDetailed(req.spec, req.air);
    return { id: req.id, key: req.key, result: out.result, notes: out.notes, ffts: out.ffts };
  } catch (err) {
    return {
      id: req.id,
      key: req.key,
      error: err instanceof Error ? err.message : String(err),
      refused: err instanceof BakeRefusedError,
    };
  }
}

/** The response's channel buffers, for the transfer list. */
export function bakeTransferables(res: BakeResponse): ArrayBuffer[] {
  if (!('result' in res)) return [];
  return [res.result.L.buffer as ArrayBuffer, res.result.R.buffer as ArrayBuffer];
}

// ASSUMPTION: as in worldWorker.ts, the worker scope is typed here (no `webworker` lib), and the guard keeps importing
// this module on the main thread side-effect free.
const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<BakeRequest>) => void) | null;
  postMessage(msg: BakeResponse, transfer: Transferable[]): void;
};
if (typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined') {
  scope.onmessage = (e) => {
    const res = handleBakeRequest(e.data);
    scope.postMessage(res, bakeTransferables(res));
  };
}
