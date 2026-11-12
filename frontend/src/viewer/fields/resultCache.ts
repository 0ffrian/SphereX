// Render-performance roadmap 0.9: generated fields and worlds are pure functions of their params
// (the seed is one of them), so a rebuild with the same params reuses the last result instead of
// generating it again. Rebuilds with unchanged params happen on a quality-level change (every
// shader kind rebuilds then, though no field depends on the octave count), on a slider that is
// moved back, and on going back to an object seen a moment ago. Determinism is untouched: the
// cached value is the value the generator returns for those params.
//
// Results are shared, not copied: callers must not write into the returned arrays (none does;
// they only read them or wrap them in textures).

/** A stable text key for plain data: object keys sorted, typed arrays as plain lists. */
export function stableKey(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (ArrayBuffer.isView(v) && !(v instanceof DataView))
      return Array.from(v as unknown as ArrayLike<number>);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(o)
          .sort()
          .map((k) => [k, o[k]]),
      );
    }
    return v;
  });
}

/**
 * A small least-recently-used map of promises: concurrent requests for the same params share one
 * job, and a failed job is forgotten (the next request tries again).
 */
export class ResultCache<T> {
  private readonly map = new Map<string, Promise<T>>();
  /** Requests answered from the cache (tests and the perf readout). */
  hits = 0;

  constructor(private readonly max: number) {}

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  get(key: string, make: () => Promise<T>): Promise<T> {
    const hit = this.map.get(key);
    if (hit) {
      this.hits++;
      this.map.delete(key);
      this.map.set(key, hit);
      return hit;
    }
    const p = make();
    this.map.set(key, p);
    p.catch(() => {
      if (this.map.get(key) === p) this.map.delete(key);
    });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
    return p;
  }
}
