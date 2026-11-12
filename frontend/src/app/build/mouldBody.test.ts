import { describe, expect, it } from 'vitest';
import { rng } from './mouldBody';

describe('mould PRNG (mulberry32)', () => {
  const take = (seed: number, n = 8) => {
    const r = (rng as (s: number) => () => number)(seed);
    return Array.from({ length: n }, () => r());
  };
  it('is deterministic for a seed', () => {
    expect(take(42)).toEqual(take(42));
  });
  it('differs between seeds and stays in [0, 1)', () => {
    expect(take(1)).not.toEqual(take(2));
    for (const v of take(7, 200)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
