// Twin test: starlight.ts against backend/app/core/render/blackbody.py (issue #68 Part 2).
import { describe, expect, it } from 'vitest';
import { starlightColour, teffToRgbMax1 } from './starlight';

/**
 * Output of `teff_to_rgb` (backend/app/core/render/blackbody.py), committed so the test needs no
 * Python. Regenerate by calling that function for each Teff (the module has no dependencies; load
 * it by path if `app.core.render` cannot import numpy). Linear sRGB, brightest channel 1, 4 decimals.
 */
const PYTHON_TABLE: readonly (readonly [number, readonly [number, number, number]])[] = [
  [1500, [1.0, 0.1452, 0.0]],
  [2300, [1.0, 0.3359, 0.0401]],
  [2566, [1.0, 0.3946, 0.0778]],
  [3000, [1.0, 0.484, 0.1545]],
  [3755, [1.0, 0.62, 0.3197]],
  [4000, [1.0, 0.659, 0.3787]],
  [5000, [1.0, 0.7954, 0.6296]],
  [5772, [1.0, 0.8791, 0.8211]],
  [6500, [1.0, 0.9443, 0.9922]],
  [8000, [0.7664, 0.8022, 1.0]],
  [10000, [0.611, 0.6955, 1.0]],
  [15000, [0.4623, 0.582, 1.0]],
  [30000, [0.3635, 0.4973, 1.0]],
];

describe('starlight colour: twin of blackbody.py', () => {
  it.each(PYTHON_TABLE)('matches the Python helper at %i K', (teff, expected) => {
    const rgb = teffToRgbMax1(teff)!;
    // Same maths and the same rounding; one unit in the 4th decimal is allowed for libm differences.
    for (let i = 0; i < 3; i++)
      expect(Math.abs(rgb[i]! - expected[i]!)).toBeLessThanOrEqual(1.5e-4);
  });

  it('refuses a temperature that is not usable', () => {
    for (const t of [0, -5, NaN, Infinity]) {
      expect(teffToRgbMax1(t)).toBeNull();
      expect(starlightColour(t)).toBeNull();
    }
  });

  it('is deterministic', () => {
    expect(starlightColour(2566)).toEqual(starlightColour(2566));
  });
});

describe('starlight colour at unit luminance', () => {
  it('has luminance 1 and keeps the chromaticity', () => {
    for (const [teff, expected] of PYTHON_TABLE) {
      const c = starlightColour(teff)!;
      expect(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]).toBeCloseTo(1, 10);
      // Ratios survive the scaling.
      expect(c[1] / c[0]).toBeCloseTo(expected[1] / expected[0], 3);
    }
  });

  it('an M dwarf is orange-red: no white balance', () => {
    const [r, g, b] = starlightColour(2566)!;
    expect(r).toBeGreaterThan(1.5);
    expect(r).toBeGreaterThan(g * 2);
    expect(b).toBeLessThan(0.2);
  });

  it('is nearly neutral at the Sun, and blue above 8000 K', () => {
    const sun = starlightColour(5772)!;
    expect(Math.max(...sun) / Math.min(...sun)).toBeLessThan(1.4);
    const hot = starlightColour(10000)!;
    expect(hot[2]).toBeGreaterThan(hot[0]);
  });
});
