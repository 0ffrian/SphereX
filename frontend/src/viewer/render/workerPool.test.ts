import { describe, expect, it } from 'vitest';
import { MAX_POOL_SIZE, poolSize, WorkerPool, type PoolWorkerLike } from './workerPool';

class FakeWorker implements PoolWorkerLike {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  posted: { id: number; payload: unknown }[] = [];
  terminated = false;
  postMessage(msg: unknown) {
    this.posted.push(msg as { id: number; payload: unknown });
  }
  terminate() {
    this.terminated = true;
  }
  reply(id: number, payload: unknown) {
    this.onmessage?.({ data: { id, ok: true, payload } });
  }
  fail(id: number, error: string) {
    this.onmessage?.({ data: { id, ok: false, error } });
  }
}

function make(n: number) {
  const ws: FakeWorker[] = [];
  const pool = new WorkerPool<number, number>({
    size: n,
    createWorker: () => {
      const w = new FakeWorker();
      ws.push(w);
      return w;
    },
    inline: (x) => x,
  });
  return { pool, ws };
}

describe('poolSize', () => {
  it('is cores-1, min 1, capped', () => {
    expect(poolSize(1)).toBe(1);
    expect(poolSize(2)).toBe(1);
    expect(poolSize(4)).toBe(3);
    expect(poolSize(64)).toBe(MAX_POOL_SIZE);
    expect(poolSize(undefined)).toBe(1);
    expect(poolSize(0)).toBe(1);
  });
});

describe('WorkerPool', () => {
  it('dispatches to the least busy worker', () => {
    const { pool, ws } = make(2);
    void pool.run(1);
    void pool.run(2);
    void pool.run(3);
    expect(ws[0]!.posted.length).toBe(2);
    expect(ws[1]!.posted.length).toBe(1);
    ws[0]!.reply(ws[0]!.posted[0]!.id, 9);
    void pool.run(4); // worker 0 now has 1, worker 1 has 1 -> worker 0 (first)
    expect(ws[0]!.posted.length).toBe(3);
  });

  it('resolves, and a task error rejects only that task', async () => {
    const { pool, ws } = make(1);
    const a = pool.run(1);
    const b = pool.run(2);
    ws[0]!.fail(ws[0]!.posted[0]!.id, 'boom');
    ws[0]!.reply(ws[0]!.posted[1]!.id, 42);
    await expect(a).rejects.toThrow('boom');
    await expect(b).resolves.toBe(42);
    const c = pool.run(3);
    ws[0]!.reply(ws[0]!.posted[2]!.id, 7);
    await expect(c).resolves.toBe(7);
  });

  it('abort rejects with AbortError and frees the worker', async () => {
    const { pool, ws } = make(2);
    const ac = new AbortController();
    const p = pool.run(1, { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    ws[0]!.reply(ws[0]!.posted[0]!.id, 1); // late reply ignored
    void pool.run(2);
    expect(ws[0]!.posted.length).toBe(2); // worker 0 free again, chosen first
    await expect(pool.run(3, { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('worker crash rejects its tasks only', async () => {
    const { pool, ws } = make(2);
    const a = pool.run(1);
    const b = pool.run(2);
    ws[0]!.onerror?.(new Error('crash'));
    await expect(a).rejects.toThrow('crash');
    ws[1]!.reply(ws[1]!.posted[0]!.id, 5);
    await expect(b).resolves.toBe(5);
  });

  it('runs inline without Worker', async () => {
    const pool = new WorkerPool<number, number>({ inline: (x) => x * 2 });
    expect(pool.size).toBe(0);
    await expect(pool.run(4)).resolves.toBe(8);
    const ac = new AbortController();
    const p = pool.run(1, { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('dispose terminates workers and rejects pending', async () => {
    const { pool, ws } = make(1);
    const p = pool.run(1);
    pool.dispose();
    await expect(p).rejects.toThrow('disposed');
    expect(ws[0]!.terminated).toBe(true);
    await expect(pool.run(2)).rejects.toThrow('disposed');
  });
});
