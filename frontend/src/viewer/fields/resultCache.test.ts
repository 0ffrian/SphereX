// Roadmap 0.9: generated fields are cached by their params and seed.
import { describe, expect, it, vi } from 'vitest';
import { ResultCache, stableKey } from './resultCache';
import { fieldCache, requestField, requestStats } from './fieldClient';
import { generateField, type FieldParams } from './fieldGenerator';

describe('stableKey', () => {
  it('ignores key order and keeps typed arrays', () => {
    expect(stableKey({ a: 1, b: { c: 2, d: 3 } })).toBe(stableKey({ b: { d: 3, c: 2 }, a: 1 }));
    expect(stableKey({ x: new Float32Array([1, 2]) })).toBe(stableKey({ x: [1, 2] }));
    expect(stableKey({ seed: 1 })).not.toBe(stableKey({ seed: 2 }));
  });
});

describe('ResultCache', () => {
  it('shares one job per key, evicts the least recently used, forgets failures', async () => {
    const c = new ResultCache<number>(2);
    const make = vi.fn((v: number) => Promise.resolve(v));
    await c.get('a', () => make(1));
    await c.get('a', () => make(99));
    expect(make).toHaveBeenCalledTimes(1);
    expect(c.hits).toBe(1);
    await c.get('b', () => make(2));
    await c.get('a', () => make(3)); // a is now the most recent
    await c.get('c', () => make(4)); // evicts b
    expect(c.size).toBe(2);
    expect(await c.get('b', () => make(5))).toBe(5);
    await expect(c.get('x', () => Promise.reject(new Error('no')))).rejects.toThrow('no');
    await Promise.resolve();
    expect(await c.get('x', () => make(6))).toBe(6);
  });
});

describe('requestField cache', () => {
  it('the same params give the same field without generating it again', async () => {
    fieldCache.clear();
    const params: FieldParams = {
      kind: 'gas',
      seed: 12,
      freq: 0,
      seaLevel: 0,
      iceExtent: 0,
      heat: 0,
      bands: 12,
      turbulence: 0.5,
      storms: 5,
    };
    const before = requestStats.worker + requestStats.main;
    const first = await requestField(params);
    const again = await requestField({ ...params });
    expect(again).toBe(first);
    expect(requestStats.worker + requestStats.main - before).toBe(1);
    // A pure function of the params: the cached value equals a fresh generation.
    expect(Array.from(again.a.slice(0, 64))).toEqual(
      Array.from(generateField(params).a.slice(0, 64)),
    );
  });
});
