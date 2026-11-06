// R7.7, D-12 Web Worker for the shared field and the nebula / nova point sets: a thin wrapper, the
// logic is in fieldGenerator.ts and renderers/pointClouds.ts. File name is [verify] (D-12
// confirmation by Moon pending, PR #18). One message in, one out; the arrays are transferred, not
// copied.
import { generateField, type FieldData, type FieldParams } from './fieldGenerator';
import { generatePoints, type PointKind, type PointSets } from '../renderers/pointClouds';

export type FieldRequest =
  | { id: number; kind: 'field'; params: FieldParams }
  | { id: number; kind: 'points'; type: PointKind; seed: number };
export type FieldResponse =
  | { id: number; field: FieldData }
  | { id: number; points: PointSets }
  | { id: number; error: string };

/** The worker's whole job, without the messaging, so it can be tested. */
export function handleFieldRequest(req: FieldRequest): FieldResponse {
  try {
    if (req.kind === 'field') return { id: req.id, field: generateField(req.params) };
    return { id: req.id, points: generatePoints(req.type, req.seed) };
  } catch (err) {
    return { id: req.id, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Distinct ArrayBuffers of a response, for the transfer list. */
export function transferablesOf(res: FieldResponse): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  if ('field' in res) {
    out.add(res.field.a.buffer as ArrayBuffer);
    out.add(res.field.b.buffer as ArrayBuffer);
  } else if ('points' in res) {
    for (const set of Object.values(res.points) as {
      positions: Float32Array;
      colors: Float32Array;
    }[]) {
      out.add(set.positions.buffer as ArrayBuffer);
      out.add(set.colors.buffer as ArrayBuffer);
    }
  }
  return [...out];
}

// ASSUMPTION: the `webworker` lib is not enabled in tsconfig, so the worker scope is typed here.
// The guard keeps importing this module on the main thread (tests, layout check) side-effect free.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<FieldRequest>) => void) | null;
  postMessage(msg: FieldResponse, transfer: Transferable[]): void;
};
if (typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined') {
  scope.onmessage = (e) => {
    const res = handleFieldRequest(e.data);
    scope.postMessage(res, transferablesOf(res));
  };
}
