// Issue #93 wave 1 (PR #101 roadmap 1.8): builds the rock engine's height map off the main thread (about 0.5 s a
// build, which froze the page on every Surface age step). One message in, one out; the height map is transferred.
import { handleBuild, type BuildMessage, type BuildReply } from './rockBuild';

// ASSUMPTION: as in fieldWorker.ts, the worker scope is typed here (no `webworker` lib), and the guard keeps
// importing this module on the main thread side-effect free.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<BuildMessage>) => void) | null;
  postMessage(msg: BuildReply, transfer: Transferable[]): void;
};
if (typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined') {
  scope.onmessage = (e) => {
    const res = handleBuild(e.data);
    scope.postMessage(res, 'built' in res ? [res.built.data.buffer as ArrayBuffer] : []);
  };
}
