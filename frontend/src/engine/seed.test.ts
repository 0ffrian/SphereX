import { describe, expect, it } from 'vitest';
import { SEED_VEC_RANGE, fmix32, hashInt32, hashString32, seedVec } from './seed';

describe('engine seeds (#93 2.1)', () => {
  it('seedVec gives three integers in [0, 256)', () => {
    for (let i = 0; i < 2000; i++) {
      const v = seedVec(hashInt32(i));
      expect(v).toHaveLength(3);
      for (const c of v) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThan(SEED_VEC_RANGE);
      }
    }
  });

  it('is deterministic', () => {
    expect(seedVec(hashString32('simbad-trappist-1e'))).toEqual(
      seedVec(hashString32('simbad-trappist-1e')),
    );
    expect(hashInt32(12345)).toBe(hashInt32(12345));
  });

  it('spreads evenly: each component is close to uniform over 256 bins', () => {
    const N = 25600;
    const bins = [new Array(256).fill(0), new Array(256).fill(0), new Array(256).fill(0)];
    for (let i = 0; i < N; i++) {
      const v = seedVec(hashString32('card-' + i));
      for (let k = 0; k < 3; k++) bins[k]![v[k]!]++;
    }
    // Chi-squared with 255 degrees of freedom: mean 255, sd about 22.6; 400 is beyond 6 sd.
    for (const b of bins) {
      const e = N / 256;
      const chi = b.reduce((s: number, o: number) => s + ((o - e) * (o - e)) / e, 0);
      expect(chi).toBeLessThan(400);
    }
  });

  it('the three components are independent (no diagonal)', () => {
    const N = 20000;
    let sxy = 0;
    let sxz = 0;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let sxx = 0;
    for (let i = 0; i < N; i++) {
      const [x, y, z] = seedVec(hashInt32(i));
      sx += x;
      sy += y;
      sz += z;
      sxy += x * y;
      sxz += x * z;
      sxx += x * x;
    }
    const mx = sx / N;
    const varx = sxx / N - mx * mx;
    expect(Math.abs((sxy / N - mx * (sy / N)) / varx)).toBeLessThan(0.03);
    expect(Math.abs((sxz / N - mx * (sz / N)) / varx)).toBeLessThan(0.03);
  });

  it('collisions follow the birthday bound of 2^24 offsets (none among 2,000 card ids)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(seedVec(hashString32('simbad-star-' + i)).join(','));
    // Expected collisions for 2,000 draws from 2^24: 2000^2 / 2 / 2^24 = 0.12.
    expect(seen.size).toBeGreaterThanOrEqual(1999);
  });

  it('neighbouring seeds land far apart (not shifted copies along one diagonal)', () => {
    let near = 0;
    for (let i = 0; i < 1000; i++) {
      const a = seedVec(hashInt32(i));
      const b = seedVec(hashInt32(i + 1));
      if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 8) near++;
    }
    // Two random points in a 256^3 cube are within 8 of each other with probability about 1e-4.
    expect(near).toBeLessThanOrEqual(2);
  });

  it('fmix32 avalanches: one input bit flips about half the output bits', () => {
    let flips = 0;
    let n = 0;
    for (let i = 0; i < 200; i++)
      for (let b = 0; b < 32; b++) {
        let x = fmix32(i * 7919) ^ fmix32((i * 7919) ^ (1 << b));
        x >>>= 0;
        while (x) {
          flips += x & 1;
          x >>>= 1;
        }
        n++;
      }
    expect(flips / n).toBeGreaterThan(15);
    expect(flips / n).toBeLessThan(17);
  });

  it('hashInt32 keeps the high bits of a seed above 2^32', () => {
    expect(hashInt32(5)).not.toBe(hashInt32(5 + 4294967296));
  });
});
