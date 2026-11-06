/**
 * Generic worker pool (issue #39, WP3). Determinism: a task's result depends only on its request,
 * never on which worker ran it, so workers must be stateless between tasks (D-12, R11).
 */

/** Cap so phones do not spawn a worker per core; extra workers only add memory and contention. */
export const MAX_POOL_SIZE = 4;

/** cores - 1 (leave the main thread a core), at least 1, at most MAX_POOL_SIZE. */
export function poolSize(cores: number | undefined | null): number {
  const c = Number.isFinite(cores) && cores ? Math.floor(cores as number) : 2;
  return Math.min(MAX_POOL_SIZE, Math.max(1, c - 1));
}

export interface PoolRequest<Req> {
  id: number;
  payload: Req;
}
export type PoolResponse<Res> =
  | { id: number; ok: true; payload: Res; transfer?: Transferable[] }
  | { id: number; ok: false; error: string };

/** Minimal worker surface (the real Worker and test fakes both satisfy it). */
export interface PoolWorkerLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

export interface WorkerPoolOptions<Req, Res> {
  /** Creates one worker. Omit (or return undefined) when Worker is unavailable. */
  createWorker?: () => PoolWorkerLike | undefined;
  /** Used when no worker can be created (jsdom/tests): same results, run on this thread. */
  inline: (req: Req) => Res | Promise<Res>;
  size?: number;
}

export interface RunOptions {
  transfer?: Transferable[];
  signal?: AbortSignal;
}

interface Task<Res> {
  resolve(v: Res): void;
  reject(e: unknown): void;
  worker: number;
  cleanup(): void;
}

function abortError(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

export class WorkerPool<Req, Res> {
  private readonly workers: PoolWorkerLike[] = [];
  private readonly busy: number[] = [];
  private readonly tasks = new Map<number, Task<Res>>();
  private nextId = 1;
  private disposed = false;
  private readonly inline: (req: Req) => Res | Promise<Res>;

  constructor(opts: WorkerPoolOptions<Req, Res>) {
    this.inline = opts.inline;
    const n =
      opts.size ??
      poolSize(typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined);
    for (let i = 0; i < n; i++) {
      const w = opts.createWorker?.();
      if (!w) break;
      const idx = this.workers.length;
      w.onmessage = (e) => this.onMessage(idx, e.data as PoolResponse<Res>);
      w.onerror = (e) => this.onCrash(idx, e);
      this.workers.push(w);
      this.busy.push(0);
    }
  }

  get size(): number {
    return this.workers.length;
  }

  run(payload: Req, opts: RunOptions = {}): Promise<Res> {
    const { signal, transfer } = opts;
    if (this.disposed) return Promise.reject(new Error('WorkerPool disposed'));
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.workers.length === 0) return this.runInline(payload, signal);

    let w = 0;
    for (let i = 1; i < this.busy.length; i++) if (this.busy[i]! < this.busy[w]!) w = i;
    const id = this.nextId++;
    return new Promise<Res>((resolve, reject) => {
      const onAbort = () => {
        if (!this.tasks.delete(id)) return;
        this.busy[w]!--; // worker is free for new tasks; its late reply is ignored
        cleanup();
        reject(abortError());
      };
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.tasks.set(id, { resolve, reject, worker: w, cleanup });
      this.busy[w]!++;
      const msg: PoolRequest<Req> = { id, payload };
      this.workers[w]!.postMessage(msg, transfer ?? []);
    });
  }

  private runInline(payload: Req, signal?: AbortSignal): Promise<Res> {
    return new Promise<Res>((resolve, reject) => {
      const onAbort = () => reject(abortError());
      signal?.addEventListener('abort', onAbort, { once: true });
      Promise.resolve()
        .then(() => this.inline(payload))
        .then(resolve, reject)
        .finally(() => signal?.removeEventListener('abort', onAbort));
    });
  }

  private onMessage(idx: number, r: PoolResponse<Res>): void {
    const t = this.tasks.get(r.id);
    if (!t) return; // aborted: ignore
    this.tasks.delete(r.id);
    this.busy[idx]!--;
    t.cleanup();
    if (r.ok) t.resolve(r.payload);
    else t.reject(new Error(r.error)); // per-task error: pool keeps running
  }

  /** A worker-level error rejects that worker's in-flight tasks only. */
  private onCrash(idx: number, e: unknown): void {
    for (const [id, t] of this.tasks) {
      if (t.worker !== idx) continue;
      this.tasks.delete(id);
      this.busy[idx]!--;
      t.cleanup();
      t.reject(e instanceof Error ? e : new Error('Worker error'));
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const w of this.workers) w.terminate();
    for (const t of this.tasks.values()) {
      t.cleanup();
      t.reject(new Error('WorkerPool disposed'));
    }
    this.tasks.clear();
    this.workers.length = 0;
    this.busy.length = 0;
  }
}
