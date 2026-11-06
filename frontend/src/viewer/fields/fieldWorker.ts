// R7.7, D-12 Web Worker for the shared field: a thin wrapper, the logic is in fieldGenerator.ts.
// File name is [verify] (D-12 confirmation by Moon pending, PR #18). One message in, one out; the
// arrays are transferred, not copied.
import { generateField, type FieldData, type FieldParams } from './fieldGenerator';

export interface FieldRequest {
  id: number;
  params: FieldParams;
}
export type FieldResponse = { id: number; field: FieldData } | { id: number; error: string };

/** The worker's whole job, without the messaging, so it can be tested. */
export function handleFieldRequest({ id, params }: FieldRequest): FieldResponse {
  try {
    return { id, field: generateField(params) };
  } catch (err) {
    return { id, error: err instanceof Error ? err.message : String(err) };
  }
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
    scope.postMessage(res, 'field' in res ? [res.field.a.buffer, res.field.b.buffer] : []);
  };
}
