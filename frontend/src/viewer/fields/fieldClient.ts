// R7.7, D-12: main-thread side of the field worker. Never blank: if Workers are unavailable (or
// the worker fails) the result is generated on the main thread with the same function.
import { generateField, type FieldData, type FieldParams } from './fieldGenerator';
import { generatePoints, type PointKind, type PointSets } from '../renderers/pointClouds';
import type { FieldRequest, FieldResponse } from './fieldWorker';
import { ResultCache, stableKey } from './resultCache';

/**
 * Roadmap 0.9: fields (about 4 MB each at 512 x 256) and point sets by their params and seed. A
 * quality-level change or a slider moved back reuses them instead of generating them again.
 */
export const fieldCache = new ResultCache<FieldData>(4);
export const pointCache = new ResultCache<PointSets>(4);

/** How many requests each path served. The e2e reads it to prove the worker is really used. */
export const requestStats = { worker: 0, main: 0 };
if (import.meta.env.MODE === 'fixtures') {
  (globalThis as { __sxFieldStats?: typeof requestStats }).__sxFieldStats = requestStats;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (r: FieldResponse) => void; reject: (e: Error) => void }
>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./fieldWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<FieldResponse>) => {
      const entry = pending.get(e.data.id);
      if (!entry) return;
      pending.delete(e.data.id);
      if ('error' in e.data) entry.reject(new Error(e.data.error));
      else entry.resolve(e.data);
    };
    worker.onerror = () => {
      for (const entry of pending.values()) entry.reject(new Error('field worker failed'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

type RequestBody =
  { kind: 'field'; params: FieldParams } | { kind: 'points'; type: PointKind; seed: number };

/** Null when there is no worker or it failed; the caller then computes on the main thread. */
async function viaWorker(body: RequestBody): Promise<FieldResponse | null> {
  const w = getWorker();
  if (!w) return null;
  const id = nextId++;
  const msg = { id, ...body } as FieldRequest;
  try {
    return await new Promise<FieldResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage(msg);
    });
  } catch {
    return null;
  }
}

/**
 * Generates the field in the worker; falls back to the main thread on any failure. The same params
 * give the cached result (roadmap 0.9): the field is a pure function of them.
 */
export function requestField(params: FieldParams): Promise<FieldData> {
  return fieldCache.get(stableKey(params), () => makeField(params));
}

async function makeField(params: FieldParams): Promise<FieldData> {
  const res = await viaWorker({ kind: 'field', params });
  if (res && 'field' in res) {
    requestStats.worker++;
    return res.field;
  }
  requestStats.main++;
  return generateField(params);
}

/** Generates nebula / nova points in the worker (N8); same fallback, cached by type and seed. */
export function requestPoints(type: PointKind, seed: number): Promise<PointSets> {
  return pointCache.get(`${type}|${seed}`, () => makePoints(type, seed));
}

async function makePoints(type: PointKind, seed: number): Promise<PointSets> {
  const res = await viaWorker({ kind: 'points', type, seed });
  if (res && 'points' in res) {
    requestStats.worker++;
    return res.points;
  }
  requestStats.main++;
  return generatePoints(type, seed);
}
