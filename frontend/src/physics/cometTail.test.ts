import { describe, expect, it } from 'vitest';
import {
  AU_KM,
  GM_SUN_AU3_DAY2,
  betaOfGrain,
  displayFrame,
  dustGrains,
  stateAt,
  summariseTail,
  sunDirectionAt,
  validTrack,
  type Row,
} from './cometTail';

// A circular orbit at 2 au, sampled every 3 days, in the ecliptic-like plane.
const R = 2;
const W = Math.sqrt(GM_SUN_AU3_DAY2 / R ** 3);
const JD0 = 2460888.5;
const rows: Row[] = Array.from({ length: 60 }, (_, i) => {
  const t = i * 3;
  return [
    JD0 + t,
    R * Math.cos(W * t),
    R * Math.sin(W * t),
    0,
    -R * W * Math.sin(W * t),
    R * W * Math.cos(W * t),
    0,
  ] as const;
});

describe('cometTail', () => {
  it('interpolates the sampled path (Hermite) to far better than a sample step', () => {
    const t = 31.4;
    const s = stateAt(rows, JD0 + t)!;
    expect(s.r[0]).toBeCloseTo(R * Math.cos(W * t), 6);
    expect(s.r[1]).toBeCloseTo(R * Math.sin(W * t), 6);
    expect(s.v[1]).toBeCloseTo(R * W * Math.cos(W * t), 6);
    expect(stateAt(rows, JD0 - 1)).toBeNull();
  });
  it('Sun direction is minus the heliocentric position', () => {
    const d = sunDirectionAt(rows, JD0)!;
    expect(d[0]).toBeCloseTo(-1, 9);
    expect(d[1]).toBeCloseTo(0, 9);
  });
  it('a grain with beta = 0 stays with the comet (same orbit)', () => {
    const frame = displayFrame(rows, JD0)!;
    const g = dustGrains(rows, JD0 + 40, frame, { betas: [0], startJd: JD0, perBeta: 4, seed: 1 });
    for (const x of g) expect(Math.hypot(...x.offsetKm)).toBeLessThan(2e4); // km, vs 3e8 km orbit
  });
  it('larger beta falls farther behind, along the anti-Sun side', () => {
    const frame = displayFrame(rows, JD0)!;
    const sum = (betas: number[]) =>
      summariseTail(rows, JD0 + 60, frame, { betas, startJd: JD0, perBeta: 12, seed: 3 })!;
    const small = sum([0.01]);
    const big = sum([0.1]);
    expect(big.dustLengthKm).toBeGreaterThan(small.dustLengthKm * 5);
    expect(big.dustLengthKm).toBeGreaterThan(0);
    // Known answer: a grain released at rest-ish under beta g travels about 0.5 beta g t^2 along the
    // radial direction. Oldest grain, t = 60 d at 2 au.
    const g = GM_SUN_AU3_DAY2 / R ** 2;
    const expected = 0.5 * 0.1 * g * 60 ** 2 * AU_KM;
    expect(big.dustLengthKm).toBeGreaterThan(expected * 0.5);
    expect(big.dustLengthKm).toBeLessThan(expected * 1.6);
  });
  it('is deterministic and refuses before the first release', () => {
    const frame = displayFrame(rows, JD0)!;
    const o = { startJd: JD0, perBeta: 5, seed: 9 };
    expect(dustGrains(rows, JD0 + 20, frame, o)).toEqual(dustGrains(rows, JD0 + 20, frame, o));
    expect(dustGrains(rows, JD0, frame, o)).toEqual([]);
  });
  it('rejects a bad track and converts grain size to beta (Burns 1979)', () => {
    expect(validTrack([rows[0]!])).toBe(false);
    expect(validTrack([rows[1]!, rows[0]!])).toBe(false);
    expect(betaOfGrain(570)).toBeCloseTo(0.001, 4);
  });
});
