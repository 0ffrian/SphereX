// R7.7, D-12: main-thread side of the field worker. Never blank: if Workers are unavailable (or
// the worker fails) the field is generated on the main thread with the same function.
import { generateField, type FieldData, type FieldParams } from './fieldGenerator';
import type { FieldRequest, FieldResponse } from './fieldWorker';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (f: FieldData) => void; reject: (e: Error) => void }>();

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
      else entry.resolve(e.data.field);
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

/** Generates the field in the worker; falls back to the main thread on any failure. */
export async function requestField(params: FieldParams): Promise<FieldData> {
  const w = getWorker();
  if (!w) return generateField(params);
  const id = nextId++;
  const msg: FieldRequest = { id, params };
  try {
    return await new Promise<FieldData>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage(msg);
    });
  } catch {
    return generateField(params);
  }
}
