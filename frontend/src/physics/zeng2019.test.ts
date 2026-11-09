// Twin test: zeng2019.ts against backend/app/core/classify/zeng2019.py (`radius_on_curve`).
import { describe, expect, it } from 'vitest';
import { EARTHLIKE_ROCKY, rockyMassForRadius, rockyRadiusForMass } from './zeng2019';

/** `radius_on_curve(EARTHLIKE_ROCKY, m)` from the Python module, committed so no Python is needed. */
const PYTHON_RADII: readonly (readonly [number, number])[] = [
  [0.003, 0.1648],
  [0.01, 0.24217954804948844],
  [0.1, 0.5080873029902927],
  [0.5, 0.8192224322803461],
  [1.0, 1.0000947393779458],
  [1.039, 1.010921766532088],
  [1.71, 1.1620902621681666],
  [2.5, 1.2891681937240287],
  [5, 1.5456594441286544],
  [10, 1.8325895652241848],
  [50, 2.5687111570753136],
  [100, 2.8568499154014244],
  [170.6534, 3.0431],
];

describe('Zeng 2019 rocky curve: twin of zeng2019.py', () => {
  it('has the same 49 rows as the backend', () => {
    expect(EARTHLIKE_ROCKY).toHaveLength(49);
    expect(EARTHLIKE_ROCKY[0]).toEqual([0.003, 0.1648]);
    expect(EARTHLIKE_ROCKY[48]).toEqual([170.6534, 3.0431]);
  });

  it.each(PYTHON_RADII)('radius at %f Earth masses matches Python', (m, r) => {
    expect(rockyRadiusForMass(m)).toBeCloseTo(r, 12);
  });

  it('is undefined outside the table (no extrapolation)', () => {
    expect(rockyRadiusForMass(0.0029)).toBeNull();
    expect(rockyRadiusForMass(171)).toBeNull();
    expect(rockyRadiusForMass(0)).toBeNull();
    expect(rockyMassForRadius(0.16)).toBeNull();
    expect(rockyMassForRadius(3.05)).toBeNull();
    expect(rockyMassForRadius(NaN)).toBeNull();
  });

  it('the inverse returns the mass for the radius (round trip)', () => {
    for (const [m] of PYTHON_RADII) {
      const r = rockyRadiusForMass(m)!;
      expect(rockyMassForRadius(r)!).toBeCloseTo(m, 6);
    }
  });

  it('gives the Earth-like mass of the two demo planets', () => {
    // Kepler-186 f, R = 1.17 R_earth: about 1.9 Earth masses on the rocky curve.
    expect(rockyMassForRadius(1.17)!).toBeGreaterThan(1.7);
    expect(rockyMassForRadius(1.17)!).toBeLessThan(2.1);
  });
});
