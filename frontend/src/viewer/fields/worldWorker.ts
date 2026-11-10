// Issue #71 stream D (Q-240): Web Worker for the rocky-world generator (terrain, climate budget,
// shared field). Same pattern as fieldWorker.ts, kept in its own file so the two streams that add
// heavy work (planets here, gas giants in stream E) do not edit one worker. One message in, one out;
// the arrays are transferred, not copied.
import { generateWorld, type WorldData, type WorldParams } from './worldGenerator';

export type WorldRequest = { id: number; params: WorldParams };
export type WorldResponse =
  | { id: number; world: WorldData | null }
  | { id: number; error: string };

/** The worker's whole job, without the messaging, so it can be tested. */
export function handleWorldRequest(req: WorldRequest): WorldResponse {
  try {
    return { id: req.id, world: generateWorld(req.params) };
  } catch (err) {
    return { id: req.id, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Distinct ArrayBuffers of a response, for the transfer list. */
export function worldTransferables(res: WorldResponse): ArrayBuffer[] {
  if (!('world' in res) || !res.world) return [];
  const w = res.world;
  return [
    ...new Set([
      w.terrain.data.buffer,
      w.climate.out.buffer,
      w.field.a.buffer,
      w.field.b.buffer,
    ] as ArrayBuffer[]),
  ];
}

// ASSUMPTION: as in fieldWorker.ts, the worker scope is typed here (no `webworker` lib), and the
// guard keeps importing this module on the main thread side-effect free.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorldRequest>) => void) | null;
  postMessage(msg: WorldResponse, transfer: Transferable[]): void;
};
if (typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined') {
  scope.onmessage = (e) => {
    const res = handleWorldRequest(e.data);
    scope.postMessage(res, worldTransferables(res));
  };
}
