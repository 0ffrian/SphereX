// Issue #42, A7.2, D-12, D-34: the CPU twin of the moving gas giant. The storms the shader draws
// and the storm id the finger feels are the same numbers at the same time.
import { describe, expect, it } from 'vitest';
import {
  FieldSampler,
  generateField,
  zonalWind,
  pixelDirection,
  stormIdAt,
  stormsFor,
  type FieldParams,
} from './fieldGenerator';
import {
  cloudAngularRate,
  flowAngularRate,
  invCosLat,
  MIN_COS_LAT,
  peakAngularRate,
  stormsAt,
  type JetRates,
} from './flowModel';

const fp: FieldParams = {
  kind: 'gas',
  seed: 12,
  freq: 0,
  seaLevel: 0,
  iceExtent: 0,
  heat: 0,
  bands: 8,
  turbulence: 0.5,
  storms: 5,
};
const jets: JetRates = { windMs: 100, radiusM: 6.991e7 };
const T = 5e6;

describe('stormsAt', () => {
  it('at t = 0, or with no winds, storms stand where the field put them', () => {
    const still = stormsFor(fp.seed, fp.storms);
    for (const s of [stormsAt(fp, jets, 0), stormsAt(fp, null, 9e9)]) {
      s.forEach((m, i) => {
        m.center.forEach((c, k) => expect(c).toBeCloseTo(still[i]!.center[k]!, 12));
        expect(m.size).toBe(still[i]!.size);
        expect(m.id).toBe(still[i]!.id);
      });
    }
  });

  it('are deterministic in (seed, rates, t)', () => {
    expect(stormsAt(fp, jets, T)).toEqual(stormsAt(fp, jets, T));
  });

  it('drift at the zonal wind of their latitude and keep their latitude', () => {
    const a = stormsAt(fp, jets, 0);
    const b = stormsAt(fp, jets, T);
    a.forEach((s, i) => {
      expect(b[i]!.center[1]).toBeCloseTo(s.center[1], 12);
      expect(Math.hypot(...b[i]!.center)).toBeCloseTo(1, 12);
      expect(s.driftRate).toBeCloseTo(flowAngularRate(s.center, fp, jets), 15);
    });
    // Counter-flowing jets: not every storm drifts the same way.
    const signs = new Set(a.map((s) => Math.sign(s.driftRate)));
    expect(signs.size).toBeGreaterThan(1);
  });

  it('time is wrapped, so a very long run stays accurate (Q-68)', () => {
    const s = stormsAt(fp, jets, 1e15)[0]!;
    expect(Math.hypot(...s.center)).toBeCloseTo(1, 12);
    expect(s.swirl).toBeGreaterThanOrEqual(0);
    expect(s.swirl).toBeLessThan(2 * Math.PI);
  });

  it('turn about their own centre at about U / L, opposite ways in the two hemispheres', () => {
    for (const s of stormsAt(fp, jets, 0)) {
      const expected = jets.windMs / (s.size * jets.radiusM);
      expect(Math.abs(s.spinRate)).toBeCloseTo(expected, 12);
      expect(Math.sign(s.spinRate)).toBe(s.center[1] >= 0 ? -1 : 1);
    }
  });
});

describe('touch matches sight (D-34)', () => {
  const field = generateField(fp, 128, 64);

  it('the sampler given the storms at t returns the storm id the shader would draw', () => {
    const sampler = new FieldSampler(field);
    const storms = stormsAt(fp, jets, T);
    sampler.setStorms(storms);
    let moved = 0;
    for (let r = 0; r < 64; r += 3) {
      for (let c = 0; c < 128; c += 3) {
        const d = pixelDirection(c, r, 128, 64);
        const got = sampler.sampleDirection(d);
        expect(got.storm).toBe(stormIdAt(d, storms));
        // Height and band are the field's: the band structure is fixed in the body frame.
        const still = new FieldSampler(field).sampleDirection(d);
        expect(got.band).toBe(still.band);
        expect(got.height).toBe(still.height);
        if (got.storm !== still.storm) moved++;
      }
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('at t = 0 the moving sampler equals the static field exactly', () => {
    const moving = new FieldSampler(field);
    moving.setStorms(stormsAt(fp, jets, 0));
    const still = new FieldSampler(field);
    for (let r = 0; r < 64; r += 2) {
      for (let c = 0; c < 128; c += 2) {
        const d = pixelDirection(c, r, 128, 64);
        expect(moving.sampleDirection(d)).toEqual(still.sampleDirection(d));
      }
    }
  });
});

describe('rates', () => {
  it('jets peak at U / R; planet clouds follow a three-cell wind profile', () => {
    expect(peakAngularRate(jets)).toBeCloseTo(100 / 6.991e7, 15);
    expect(cloudAngularRate(0, jets)).toBeCloseTo(peakAngularRate(jets), 15);
    expect(Math.sign(cloudAngularRate(0.3, jets))).not.toBe(Math.sign(cloudAngularRate(0.8, jets)));
  });
});

describe('streaks and storms drift together (twin parity, review #9)', () => {
  it('the streak shear and the storm drift share 1 / cos(lat), floored at MIN_COS_LAT', () => {
    for (const lat of [0, 0.4, 0.75, 1.2, 1.55]) {
      const d: [number, number, number] = [Math.cos(lat), Math.sin(lat), 0];
      expect(invCosLat(d)).toBeCloseTo(1 / Math.max(Math.cos(lat), MIN_COS_LAT), 12);
      // The GPU shears by (peak * profile * invCosLat); the CPU storm drift is the same product.
      expect(flowAngularRate(d, fp, jets)).toBeCloseTo(
        zonalWind(d, fp) * peakAngularRate(jets) * invCosLat(d),
        15,
      );
    }
    // The ratio of drift rates at two latitudes is the ratio of the shaders' shear factors.
    const a: [number, number, number] = [Math.cos(0.75), Math.sin(0.75), 0];
    expect(invCosLat(a) / invCosLat([1, 0, 0])).toBeCloseTo(1 / Math.cos(0.75), 12);
  });

  it('a storm follows the wind where it is: it never moves against the flow of its band', () => {
    const fp2: FieldParams = { ...fp, bands: 14, turbulence: 1, storms: 8 };
    const born = stormsAt(fp2, jets, 0);
    for (const t of [1e5, 1e6, 1e7, 1e8, 3e9]) {
      const now = stormsAt(fp2, jets, t);
      now.forEach((s, i) => {
        const b = born[i]!;
        expect(s.center[1]).toBeCloseTo(b.center[1], 12);
        expect(Math.hypot(...s.center)).toBeCloseTo(1, 12);
        // Still in a band whose wind blows the way it was born moving (or where the wind is calm).
        const w0 = Math.sign(zonalWind(b.center, fp2));
        const w1 = zonalWind(s.center, fp2);
        expect(Math.sign(w1) * w0).toBeGreaterThanOrEqual(0);
      });
    }
  });

  it('is deterministic and a long run is bounded (loops or stops, never runs away)', () => {
    const fp2: FieldParams = { ...fp, bands: 14, turbulence: 1, storms: 8 };
    expect(stormsAt(fp2, jets, 7e8)).toEqual(stormsAt(fp2, jets, 7e8));
    const far = stormsAt(fp2, jets, 1e15);
    far.forEach((s) => expect(Number.isFinite(s.center[0] + s.center[1] + s.center[2])).toBe(true));
  });
});
