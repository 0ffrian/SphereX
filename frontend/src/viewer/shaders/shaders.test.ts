import { describe, expect, it } from 'vitest';
import { float, positionLocal, vec3 } from 'three/tsl';
import {
  OCTAVES,
  animatedCells,
  domainWarp,
  fbm,
  ridged,
  seedNode,
  seedOffset,
  differentialRotate,
  differentialRotateCpu,
  latLon,
  latLonCpu,
  omegaCpu,
  tangentFrame,
  tangentFrameCpu,
  type V3,
} from './index';

describe('seedOffset', () => {
  it('is deterministic and bounded', () => {
    expect(seedOffset(7)).toEqual(seedOffset(7));
    for (const v of seedOffset(123456789)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(256);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
  it('every bit counts, including bits above 2^32', () => {
    const seen = new Set<string>();
    for (let b = 0; b < 52; b++) seen.add(seedOffset(2 ** b).join());
    seen.add(seedOffset(0).join());
    expect(seen.size).toBe(53);
    expect(seedOffset(2 ** 40).join()).not.toBe(seedOffset(0).join());
  });
  it('treats non-finite as 0 and floors fractions', () => {
    expect(seedOffset(NaN)).toEqual(seedOffset(0));
    expect(seedOffset(3.9)).toEqual(seedOffset(3));
  });
});

describe('sphere CPU reference', () => {
  it('lat/lon of axis points', () => {
    expect(latLonCpu([0, 1, 0]).lat).toBeCloseTo(Math.PI / 2);
    expect(latLonCpu([0, -2, 0]).lat).toBeCloseTo(-Math.PI / 2);
    expect(latLonCpu([1, 0, 0])).toEqual({ lat: 0, lon: 0 });
    expect(latLonCpu([0, 0, 0]).lat).toBe(0);
  });
  it('tangent frame is orthonormal and finite, also at the poles', () => {
    const pts: V3[] = [
      [1, 0, 0],
      [0, 0, 1],
      [0, 1, 0],
      [0, -1, 0],
      [0.6, 0.64, 0.48],
    ];
    for (const n of pts) {
      const { east, north } = tangentFrameCpu(n);
      const d = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      expect(Math.hypot(...east)).toBeCloseTo(1);
      expect(Math.hypot(...north)).toBeCloseTo(1);
      expect(d(east, n)).toBeCloseTo(0);
      expect(d(north, n)).toBeCloseTo(0);
      expect(d(east, north)).toBeCloseTo(0);
    }
    expect(tangentFrameCpu([0, 1, 0]).east).toEqual([1, 0, 0]);
    expect(tangentFrameCpu([1, 0, 0]).north.map((v) => v + 0)).toEqual([0, 1, 0]);
  });
  it('differential rotation', () => {
    expect(omegaCpu(0, 2, 0.3)).toBe(2);
    expect(omegaCpu(Math.PI / 2, 2, 0.3)).toBeCloseTo(1.4);
    const p: V3 = [1, 0, 0];
    expect(differentialRotateCpu(p, 0, 1, 0.5)).toEqual(p);
    const r = differentialRotateCpu(p, Math.PI / 2, 1, 0);
    expect(r[0]).toBeCloseTo(0);
    expect(r[2]).toBeCloseTo(-1);
    // pole is invariant, rotation preserves length
    expect(differentialRotateCpu([0, 1, 0], 5, 1, 0.2).map((v) => v + 0)).toEqual([0, 1, 0]);
    const q = differentialRotateCpu([0.6, 0.64, 0.48], 3, 1, 0.3);
    expect(Math.hypot(...q)).toBeCloseTo(1);
    expect(differentialRotateCpu(p, 2, 1, 0.3)).toEqual(differentialRotateCpu(p, 2, 1, 0.3));
  });
});

describe('TSL builders construct', () => {
  for (const [tier, oct] of Object.entries(OCTAVES)) {
    it(`noise at ${tier} (${oct} octaves)`, () => {
      const p = positionLocal;
      const s = seedNode(7);
      expect(() => fbm(p, oct, s)).not.toThrow();
      expect(() => ridged(p, oct, s)).not.toThrow();
      expect(() => domainWarp(p, float(0.5), oct, s)).not.toThrow();
      expect(() => animatedCells(p, float(1), s)).not.toThrow();
      expect(fbm(p, oct)).toBeDefined();
    });
  }
  it('sphere builders', () => {
    const p = vec3(0.3, 0.5, 0.2);
    expect(() => latLon(p)).not.toThrow();
    expect(() => tangentFrame(p)).not.toThrow();
    expect(() => differentialRotate(p, float(1), 1, 0.3)).not.toThrow();
  });
});
