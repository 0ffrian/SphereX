import { describe, expect, it } from 'vitest';
import { srgbToLinear } from './linearColour';

describe('srgbToLinear (review #6: the star tint is converted once)', () => {
  it('maps sRGB to linear light, with the sRGB curve', () => {
    const [r, g, b] = srgbToLinear([1, 0.5, 0.25]);
    expect(r).toBeCloseTo(1, 6);
    expect(g).toBeCloseTo(0.214, 3);
    expect(b).toBeCloseTo(0.0509, 3);
    expect(srgbToLinear([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('is darker than the input for mid values, so passing it twice would be a bug', () => {
    const once = srgbToLinear([1, 0.502, 0.251]);
    expect(once[1]).toBeLessThan(0.502);
  });
});
