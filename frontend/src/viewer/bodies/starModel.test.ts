// Issue #42, R7.5.3 to R7.5.5: the CPU model of active regions, flares and loops is a pure,
// deterministic function of (seed, rates, t).
import { describe, expect, it } from 'vitest';
import {
  STAR_SURFACE,
  STILL_STAR_RATES,
  bendLoopPoint,
  dipoleLoopPoints,
  discsPerRegion,
  flareProfile,
  flaresAt,
  lifeEnvelope,
  loopApexHeight,
  loopStrands,
  regionAt,
  regionsAt,
  starRatesFrom,
  type StarRates,
} from './starModel';
import { resolveMotion } from '../motion/motion';
import { fixture } from '../renderers/fixtures.testutil';

const rates: StarRates = {
  lifetimeS: 2.6e6,
  omegaEq: (2 * Math.PI) / (600 * 3600),
  k: 0.2,
  flareRatePerS: 0.5 / 86400,
  flareSpeedup: 86400,
};
const len = (v: number[]) => Math.hypot(v[0]!, v[1]!, v[2]!);

describe('regions', () => {
  it('same seed and time give the same state; another seed does not', () => {
    expect(regionsAt(8, 1.2e6, rates)).toEqual(regionsAt(8, 1.2e6, rates));
    expect(regionsAt(9, 1.2e6, rates)).not.toEqual(regionsAt(8, 1.2e6, rates));
  });

  it('every group is on the unit sphere, with leader, follower parts and pores', () => {
    for (const r of regionsAt(8, 3e6, rates)) {
      expect(len(r.center)).toBeCloseTo(1, 9);
      expect(r.discs).toHaveLength(discsPerRegion());
      expect(r.discs.map((d) => d.kind)).toContain('leader');
      for (const d of r.discs) expect(len(d.center)).toBeCloseTo(1, 9);
      // The leader is the larger spot.
      expect(Math.max(...r.discs.map((d) => d.radius))).toBe(r.discs[0]!.radius);
    }
  });

  it('groups age: they start small, grow, and vanish at the end of the life', () => {
    expect(lifeEnvelope(0)).toBe(0);
    expect(lifeEnvelope(0.4)).toBe(1);
    expect(lifeEnvelope(1)).toBe(0);
    const t = (f: number) => (f - 0.1) * rates.lifetimeS; // slot 0 offset is below 0.25
    void t;
    const sizes = [0, 0.2, 0.4].map((dt) => regionAt(8, 0, dt * rates.lifetimeS, rates).size);
    expect(sizes.every(Number.isFinite)).toBe(true);
  });

  it('differential rotation carries a group: higher latitudes lag the equator', () => {
    const slow = regionAt(8, 0, 0.1 * rates.lifetimeS, { ...rates, k: 0 });
    const lag = regionAt(8, 0, 0.1 * rates.lifetimeS, { ...rates, k: 0.3 });
    expect(slow.lat).toBe(lag.lat);
    // Relative to the body frame the longitude grows with k (the body turns at the equator rate).
    const d = ((lag.lon - slow.lon + Math.PI * 3) % (2 * Math.PI)) - Math.PI;
    expect(d).toBeGreaterThan(0);
  });

  it('a still star places mature groups once and keeps them', () => {
    const a = regionsAt(8, 0, STILL_STAR_RATES);
    const b = regionsAt(8, 9e9, STILL_STAR_RATES);
    expect(a).toEqual(b);
    expect(a.every((r) => r.env > 0.9)).toBe(true);
  });

  it('starRatesFrom is still without a spots process, and carries the rates with one', () => {
    const { card, params } = fixture('star');
    const m = resolveMotion(card, params);
    const r = starRatesFrom(m);
    expect(r.frozen).toBeUndefined();
    expect(r.lifetimeS).toBeCloseTo(30 * 86400);
    expect(r.k).toBe(0); // diff_rotation was refused, so the star turns rigidly
    expect(starRatesFrom(resolveMotion(card, { ...params, dynamics: undefined }))).toBe(
      STILL_STAR_RATES,
    );
  });
});

describe('flares', () => {
  it('follow a seeded schedule: the same t gives the same flares', () => {
    const t = 7 * 86400;
    expect(flaresAt(8, t, t, rates)).toEqual(flaresAt(8, t, t, rates));
  });

  it('happen at the stated rate (mean number over many intervals)', () => {
    const spacing = 1 / rates.flareRatePerS;
    const n = 200;
    let t = 0;
    // Count distinct events by scanning flare starts through their ages.
    const seen = new Set<number>();
    for (; t < n * spacing; t += spacing / 40) {
      for (const f of flaresAt(8, t, 1.3e6, { ...rates, lifetimeS: 1e12 })) {
        seen.add(Math.round(t - f.age));
      }
    }
    const events = seen.size;
    // Some events are dropped when their region is not grown enough; the rate cannot be exceeded.
    expect(events).toBeLessThanOrEqual(n);
    expect(events).toBeGreaterThan(n * 0.3);
  });

  it('are bright after a fast rise, then fade; none when the rate is 0', () => {
    expect(flareProfile(0, 100)).toBe(0);
    expect(flareProfile(6, 100)).toBe(1);
    expect(flareProfile(60, 100)).toBeLessThan(0.3);
    expect(flareProfile(100, 100)).toBe(0);
    expect(flaresAt(8, 1e6, 1e6, { ...rates, flareRatePerS: 0 })).toEqual([]);
  });

  it('draw at most maxFlares and sit on an active region', () => {
    for (let t = 0; t < 4e6; t += 1.1e5) {
      const f = flaresAt(8, t, t, rates);
      expect(f.length).toBeLessThanOrEqual(STAR_SURFACE.maxFlares);
      for (const x of f) {
        const r = regionAt(8, x.slot, t, rates);
        expect(x.center).toEqual(r.center);
        expect(r.env).toBeGreaterThanOrEqual(STAR_SURFACE.flareMinEnv);
      }
    }
  });
});

describe('prominence loops', () => {
  it('follow a dipole field line: footpoints on the surface, apex above it', () => {
    const pts = dipoleLoopPoints(41);
    expect(pts[0]![2]).toBeCloseTo(0, 9);
    expect(pts[40]![2]).toBeCloseTo(0, 9);
    expect(Math.abs(pts[0]![0])).toBeCloseTo(1, 9);
    expect(Math.abs(pts[40]![0])).toBeCloseTo(1, 9);
    expect(pts[0]![0] * pts[40]![0]).toBeLessThan(0);
    expect(Math.max(...pts.map((p) => p[2]))).toBeCloseTo(loopApexHeight(), 3);
  });

  it('bend onto the unit sphere at the footpoints, and lift with the flare', () => {
    const r = regionAt(8, 0, 1.2e6, rates);
    const half = 0.6 * r.size;
    const foot = bendLoopPoint(r.center, r.axis, r.north, half, 0, [1, 0, 0]);
    expect(len(foot)).toBeCloseTo(1, 9);
    const apex: [number, number, number] = [0, 0, loopApexHeight()];
    const quiet = len(bendLoopPoint(r.center, r.axis, r.north, half, 0, apex));
    const lifted = len(bendLoopPoint(r.center, r.axis, r.north, half, 1, apex));
    expect(quiet).toBeGreaterThan(1);
    expect(lifted).toBeGreaterThan(quiet);
  });

  it('strands are uneven and deterministic; one strand is a plain arch', () => {
    const a = loopStrands(8, 1, 12);
    expect(loopStrands(8, 1, 12)).toEqual(a);
    expect(new Set(a.map((s) => s.points[20]![2].toFixed(4))).size).toBeGreaterThan(6);
    const one = loopStrands(8, 1, 1)[0]!;
    expect(one.points[20]![1]).toBeCloseTo(0, 9);
  });
});
