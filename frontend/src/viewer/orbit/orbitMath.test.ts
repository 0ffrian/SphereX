import { describe, expect, it } from 'vitest';
import {
  ALT_RANGE_KM,
  aimAtPeak,
  aimDefault,
  altToSlider,
  applyDrag,
  dot3,
  flyCamera,
  flyMove,
  horizonDip,
  latLonOf,
  nrm3,
  pickPlace,
  sliderToAlt,
  upOf,
  wheelAlt,
  type FlyState,
  type HeightGrid,
} from './orbitMath';

const body = { radiusKm: 6371, exaggeration: 3, groundKm: () => 0 };
const base: FlyState = { lon: 0.4, lat: 0.3, head: 0.6, pitch: 0, altKm: 400 };

describe('camera', () => {
  it('pitch 0 looks at the horizon dip: the view direction is tangent-ish below the level by acos(1/r)', () => {
    const c = flyCamera(base, body);
    const below = -Math.asin(dot3(c.fwd, c.localUp));
    expect(below).toBeCloseTo(horizonDip(c.r), 6);
    expect(horizonDip(1)).toBe(0);
  });
  it('the basis is orthonormal', () => {
    const c = flyCamera({ ...base, pitch: -0.3 }, body);
    expect(Math.abs(dot3(c.fwd, c.right))).toBeLessThan(1e-9);
    expect(Math.abs(dot3(c.up, c.right))).toBeLessThan(1e-9);
    expect(dot3(c.up, c.up)).toBeCloseTo(1, 9);
  });
  it('flyMove stays on the sphere and moves the right distance', () => {
    const s = flyMove(base, 500, 0, body.radiusKm);
    const a = upOf(base.lon, base.lat);
    const b = upOf(s.lon, s.lat);
    expect(Math.hypot(...b)).toBeCloseTo(1, 9);
    const km = Math.acos(Math.min(1, dot3(a, b))) * body.radiusKm;
    expect(km).toBeGreaterThan(495);
    expect(km).toBeLessThan(505);
  });
  it('a straight flight keeps its heading on a great circle (move there and back)', () => {
    const there = flyMove(base, 800, 0, body.radiusKm);
    const back = flyMove({ ...there, head: there.head + Math.PI }, 800, 0, body.radiusKm);
    expect(back.lon).toBeCloseTo(base.lon, 2);
    expect(back.lat).toBeCloseTo(base.lat, 2);
  });
  it('ground height raises the camera', () => {
    const hi = flyCamera(base, { ...body, groundKm: () => 5 });
    expect(hi.r).toBeGreaterThan(flyCamera(base, body).r);
  });
  it('drag clamps the pitch', () => {
    expect(applyDrag(base, 0, -1e6).pitch).toBeCloseTo(0.6);
    expect(applyDrag(base, 0, 1e6).pitch).toBeCloseTo(-1.2);
  });
});

describe('altitude mapping', () => {
  for (const kind of ['rocky', 'gas'] as const) {
    it(`${kind}: ends and round trip`, () => {
      const [lo, hi] = ALT_RANGE_KM[kind];
      expect(sliderToAlt(kind, 0)).toBeCloseTo(lo);
      expect(sliderToAlt(kind, 1000)).toBeCloseTo(hi);
      for (const a of [lo * 2, Math.sqrt(lo * hi), hi / 3]) {
        expect(sliderToAlt(kind, altToSlider(kind, a)) / a).toBeGreaterThan(0.99);
        expect(sliderToAlt(kind, altToSlider(kind, a)) / a).toBeLessThan(1.01);
      }
    });
  }
  it('the wheel is clamped and multiplicative', () => {
    expect(wheelAlt('rocky', 1, -1e9)).toBe(0.3);
    expect(wheelAlt('rocky', 1000, 1e9)).toBe(3000);
    expect(wheelAlt('rocky', 100, 100)).toBeCloseTo(100 * Math.exp(0.15));
  });
});

describe('picking', () => {
  it('round trip: a place, seen along a ray from +z, is picked back', () => {
    for (const [lon, lat] of [
      [0, 0],
      [0.5, 0.4],
      [-0.7, -0.3],
      [1.2, 0.1],
    ] as const) {
      const p = upOf(lon, lat);
      if (p[2] <= 0) continue; // near side only
      const o: [number, number, number] = [0, 0, 5];
      const d = nrm3([p[0] - o[0], p[1] - o[1], p[2] - o[2]]);
      const got = pickPlace(o, d)!;
      expect(got.lon).toBeCloseTo(lon, 6);
      expect(got.lat).toBeCloseTo(lat, 6);
    }
  });
  it('a miss returns null, the far side is not picked', () => {
    expect(pickPlace([0, 3, 5], [0, 0, -1])).toBeNull();
    expect(latLonOf([0, 1, 0]).lat).toBeCloseTo(Math.PI / 2);
  });
});

describe('entry', () => {
  const grid: HeightGrid = { width: 36, height: 18, stride: 1, data: new Float32Array(36 * 18) };
  it('no land high enough: no peak, default aim', () => {
    expect(aimAtPeak(grid, nrm3([0, 0, 1]), 400, 6371)).toBeNull();
    expect(aimAtPeak(null, [0, 0, 1], 400, 6371)).toBeNull();
    const s = aimDefault([0, 0, 1], [0, 0, 1], 'rocky', 400);
    expect(s.pitch).toBe(-0.3);
    expect(aimDefault([0, 0, 1], [0, 0, 1], 'gas', 6000).pitch).toBe(-0.42);
  });
  it('finds the highest sunlit peak', () => {
    const g = { ...grid, data: new Float32Array(36 * 18) };
    const sun = nrm3([1, 0, 1]);
    // a 5 km peak near lon 0.3, lat 0.2 (sun elevation there ~ 0.7)
    const i = Math.floor((0.3 / (2 * Math.PI) + 0.5) * 36);
    const j = Math.floor((0.2 / Math.PI + 0.5) * 18);
    g.data[j * 36 + i - (i % 2)] = 5;
    const jj = j - (j % 2);
    g.data[jj * 36 + i - (i % 2)] = 5;
    const s = aimAtPeak(g, sun, 400, 6371);
    expect(s).not.toBeNull();
  });
});
