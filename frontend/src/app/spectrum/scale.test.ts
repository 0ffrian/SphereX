import { describe, expect, it } from 'vitest';
import {
  extentWithErrors,
  linearScale,
  MAX_TICKS,
  niceStep,
  niceTicks,
  paddedExtent,
} from './scale';

describe('chart scales', () => {
  it('maps domain to range, including inverted ranges', () => {
    const s = linearScale([0, 10], [100, 0]);
    expect(s(0)).toBe(100);
    expect(s(10)).toBe(0);
    expect(s(5)).toBe(50);
  });

  it('puts a flat domain in the middle of the range', () => {
    expect(linearScale([3, 3], [0, 10])(3)).toBe(5);
  });

  it('picks 1, 2 or 5 steps', () => {
    expect(niceStep(4.25, 6)).toBe(1);
    expect(niceStep(10, 5)).toBe(2);
    expect(niceStep(0.3, 6)).toBe(0.05);
  });

  it('gives ticks inside the domain without float noise', () => {
    expect(niceTicks([0.7, 5.1], 6)).toEqual([1, 2, 3, 4, 5]);
    expect(niceTicks([0.1, 0.4], 3)).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it('pads extents and includes error bars', () => {
    expect(paddedExtent([1, 3], 0.5)).toEqual([0, 4]);
    expect(paddedExtent([])).toEqual([0, 1]);
    const [lo, hi] = extentWithErrors(
      [
        { value: 5, error: 1 },
        { value: 10, error: 2 },
      ],
      0,
    );
    expect(lo).toBe(4);
    expect(hi).toBe(12);
  });

  // Review finding 1: a step below half an ulp of the values made `v += step` stop advancing.
  it('terminates on a domain narrower than the float resolution', () => {
    const ticks = niceTicks([1, 1.0000000000000002]);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBeLessThanOrEqual(MAX_TICKS);
    expect(niceTicks([4.25, 4.25 + 1e-15], 6).length).toBeLessThanOrEqual(MAX_TICKS);
    expect(niceTicks([1e300, 1e300 + 1e290], 5).length).toBeLessThanOrEqual(MAX_TICKS);
    expect(niceTicks([0, Number.POSITIVE_INFINITY])).toEqual([]);
    // Re-review item 4: finite endpoints whose difference overflows gave NaN ticks.
    const huge = niceTicks([-1.7e308, 1.7e308]);
    expect(huge.every((t) => Number.isFinite(t))).toBe(true);
  });

  it('never gives more than MAX_TICKS ticks', () => {
    expect(niceTicks([0, 1], 1000).length).toBeLessThanOrEqual(MAX_TICKS);
  });

  // Review finding 8: a flat extent was padded by ±1 in data units.
  it('pads a flat extent relative to its magnitude', () => {
    const [lo, hi] = paddedExtent([0.8]);
    expect(lo).toBeCloseTo(0.76);
    expect(hi).toBeCloseTo(0.84);
    expect(niceTicks([lo, hi], 6)).not.toContain(0);
    const [flo, fhi] = paddedExtent([1e-17]);
    expect(flo).toBeGreaterThan(0);
    expect(fhi).toBeLessThan(2e-17);
    expect(paddedExtent([2, 2])).toEqual([1.9, 2.1]);
    expect(paddedExtent([0, 0])).toEqual([-1, 1]);
    // Near-identical wavelengths count as flat, not as a 2e-16-wide axis.
    const [wlo, whi] = paddedExtent([1, 1.0000000000000002]);
    expect(whi - wlo).toBeGreaterThan(0.09);
    expect(extentWithErrors([{ value: 1e-17, error: 0 }])[0]).toBeGreaterThan(0);
  });
});
