import { describe, expect, it } from 'vitest';
import { WorldFieldSampler, bspline } from './fieldSampler';
import type { CpuFields } from './WorldEngine';

// A 8 x 4 terrain: elevation 2 km in column 3, row 2, else -1 km (sea); a 4 x 2 climate grid, left half land.
function fields(): CpuFields {
  const W = 8;
  const H = 4;
  const data = new Float32Array(W * H * 2).fill(-1);
  data[(2 * W + 3) * 2] = 2;
  const land = new Uint8Array([1, 1, 0, 0, 1, 1, 0, 0]);
  return {
    terrain: { W, H, data, plates: 5, stagnant: false },
    climate: {
      NX: 4,
      NY: 2,
      T: new Float32Array([300, 301, 302, 303, 250, 251, 252, 253]),
      rain: new Float32Array(8).fill(0.5),
      u: new Float32Array(8),
      v: new Float32Array(8),
      land,
      elev: new Float32Array(8),
      stats: null,
    },
    hydro: null,
  };
}

describe('WorldFieldSampler', () => {
  it('reads the terrain and the climate where the engine drew them', () => {
    const s = new WorldFieldSampler(fields());
    // Cell (3, 2) of the 8 x 4 terrain: lon = ((3.5)/8 - 0.5) * 2pi, lat = ((2.5)/4 - 0.5) * pi
    const lon = (3.5 / 8 - 0.5) * 2 * Math.PI;
    const lat = (2.5 / 4 - 0.5) * Math.PI;
    const a = s.sampleLonLat(lon, lat);
    // #93 2.7: the cubic B-spline the fly view uses. At the centre of a lone 2 km texel among -1 km ones it gives
    // 2 (2/3)^2 - (1 - (2/3)^2) = 1/3 (a B-spline smooths; it does not pass through the texel values).
    expect(a.elevationKm).toBeCloseTo(1 / 3, 5);
    expect(a.land).toBe(true);
    // between the cooler row (250..253) and the warmer one (300..303), nearer the cooler row it sits in
    expect(a.temperatureK!).toBeGreaterThan(250);
    expect(a.temperatureK!).toBeLessThan(276.5);
    const sea = s.sampleLonLat(-3, -1.2);
    expect(sea.elevationKm).toBeCloseTo(-1, 5);
  });
  it('gives the FieldSample shape the haptic sources use, and no channel it does not have', () => {
    const s = new WorldFieldSampler(fields());
    const f = s.sampleUV(0.3, 0.5);
    expect(Object.keys(f).sort()).toEqual(['band', 'height', 'ice', 'lava', 'ocean', 'storm']);
    expect(f.band).toBe(0);
    expect(f.storm).toBe(0);
    expect(f.height).toBeGreaterThanOrEqual(0);
    expect(f.height).toBeLessThanOrEqual(1);
    expect(s.missing).toContain('band');
  });
  it('reproduces a linear ramp and has no slope break at texel lines (#93 2.7)', () => {
    const W = 16;
    const H = 8;
    const data = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[y * W + x] = 0.5 * y;
    const lat = (y: number) => ((y + 0.5) / H - 0.5) * Math.PI;
    // a linear ramp in latitude, away from the clamped poles, is reproduced exactly
    expect(bspline(data, 1, W, H, 0.3, lat(3.3))).toBeCloseTo(0.5 * 3.3, 6);
    // a step: the slope on either side of a texel line matches (C2 continuity)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[y * W + x] = y >= 4 ? 1 : 0;
    const f = (y: number) => bspline(data, 1, W, H, 0.3, lat(y));
    const e = 1e-4;
    const left = (f(3) - f(3 - e)) / e;
    const right = (f(3 + e) - f(3)) / e;
    expect(Math.abs(left - right)).toBeLessThan(1e-2);
  });
  it('wraps in longitude', () => {
    const s = new WorldFieldSampler(fields());
    const a = s.sampleLonLat(Math.PI - 1e-6, 0.1).elevationKm!;
    const b = s.sampleLonLat(-Math.PI + 1e-6, 0.1).elevationKm!;
    expect(Math.abs(a - b)).toBeLessThan(0.01);
  });
  it('reports nothing when the engine has no arrays yet', () => {
    const s = new WorldFieldSampler({ terrain: null, climate: null, hydro: null });
    expect(s.sampleLonLat(0, 0)).toEqual({
      elevationKm: null,
      temperatureK: null,
      rain: null,
      land: null,
    });
  });
});
