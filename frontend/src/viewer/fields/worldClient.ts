// Issue #71 stream D (Q-240): main-thread side of the world worker. Never blank: if Workers are
// unavailable or the worker fails, the same function runs on the main thread. Requests with equal
// params are not cached here: the body asks once per build.
import { generateWorld, type WorldData, type WorldParams } from './worldGenerator';
import type { WorldRequest, WorldResponse } from './worldWorker';

/** How many requests each path served (the e2e reads it, like the field worker's counter). */
export const worldStats = { worker: 0, main: 0 };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: WorldResponse) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./worldWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorldResponse>) => {
      const entry = pending.get(e.data.id);
      if (!entry) return;
      pending.delete(e.data.id);
      if ('error' in e.data) entry.reject(new Error(e.data.error));
      else entry.resolve(e.data);
    };
    worker.onerror = () => {
      for (const entry of pending.values()) entry.reject(new Error('world worker failed'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

/** Generates the world in the worker; falls back to the main thread on any failure. Null: refused (an input was unusable). */
export async function requestWorld(params: WorldParams): Promise<WorldData | null> {
  const w = getWorker();
  if (w) {
    const id = nextId++;
    const msg: WorldRequest = { id, params };
    try {
      const res = await new Promise<WorldResponse>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage(msg);
      });
      if ('world' in res) {
        worldStats.worker++;
        return res.world;
      }
    } catch {
      /* fall through to the main thread */
    }
  }
  worldStats.main++;
  return generateWorld(params);
}
