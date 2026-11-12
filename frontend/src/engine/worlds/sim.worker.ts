// Issue #93 1.10 (PR #101 render-performance roadmap): the world engine's climate, gas flow and river simulation in a
// Web Worker, so its 5 to 14 ms a frame (and the river raster, every 400 cloud steps) leave the main thread. The
// handling is in simWorkerCore.ts; the main-thread side is WorkerSimSource (simSource.ts).
import { makeSimWorker, type WorkerReply, type WorkerRequest } from './simWorkerCore';

// ASSUMPTION: as in rockBuild.worker.ts, the worker scope is typed here (no `webworker` lib), and the guard keeps
// importing this module on the main thread side-effect free.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(msg: WorkerReply, transfer: Transferable[]): void;
};
if (typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined') {
  const handle = makeSimWorker((m, transfer) => scope.postMessage(m, transfer));
  scope.onmessage = (e) => handle(e.data);
}
