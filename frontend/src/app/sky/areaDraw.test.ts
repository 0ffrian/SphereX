import { afterEach, describe, expect, it } from 'vitest';
import { boxFromPixels, boxToPixels, centreRect, fitCamera, rectOf, registerAreaView } from './areaDraw';
import type { SkyCamera } from '@/viewer/sky/skyMath';

let cam: SkyCamera = { ra: 100, dec: 10, fovDeg: 4 };
const access = {
  getView: () => cam,
  getSize: () => ({ width: 1000, height: 600 }),
  setView: (c: SkyCamera) => {
    cam = c;
  },
};

afterEach(() => registerAreaView(null));

describe('areaDraw', () => {
  it('rectOf keeps the corners as given', () => {
    expect(rectOf(1, 2, 3, 4)).toEqual({ x0: 1, y0: 2, x1: 3, y1: 4 });
  });
  it('without a view there is no box, centre or fit', () => {
    expect(centreRect()).toBeNull();
    expect(boxFromPixels({ x0: 0, y0: 0, x1: 10, y1: 10 })).toBeNull();
    expect(fitCamera({ a: { ra: 1, dec: 1 }, b: { ra: 2, dec: 0 }, widthDeg: 1, heightDeg: 1 }, { l: 0, t: 0, r: 500, b: 300 })).toBeNull();
  });
  it('centreRect is a wide box around the view centre', () => {
    cam = { ra: 100, dec: 10, fovDeg: 4 };
    registerAreaView(access);
    const b = centreRect()!;
    expect(b.widthDeg).toBeGreaterThan(b.heightDeg);
    expect((b.a.ra + b.b.ra) / 2).toBeCloseTo(100, 1);
    expect((b.a.dec + b.b.dec) / 2).toBeCloseTo(10, 1);
  });
  it('a box maps to pixels and back to the same corners', () => {
    cam = { ra: 100, dec: 10, fovDeg: 4 };
    registerAreaView(access);
    const b = boxFromPixels({ x0: 300, y0: 200, x1: 700, y1: 400 })!;
    const px = boxToPixels(b)!;
    expect(px.x0).toBeCloseTo(300, 3);
    expect(px.y1).toBeCloseTo(400, 3);
  });
  it('fitCamera puts the whole box inside the safe rectangle', () => {
    cam = { ra: 100, dec: 10, fovDeg: 4 };
    registerAreaView(access);
    const b = boxFromPixels({ x0: 100, y0: 100, x1: 900, y1: 500 })!;
    const safe = { l: 20, t: 60, r: 600, b: 500 };
    const fit = fitCamera(b, safe)!;
    cam = fit;
    const px = boxToPixels(b)!;
    for (const [x, y] of [[px.x0, px.y0], [px.x1, px.y1]] as const) {
      expect(x).toBeGreaterThan(safe.l - 2);
      expect(x).toBeLessThan(safe.r + 2);
      expect(y).toBeGreaterThan(safe.t - 2);
      expect(y).toBeLessThan(safe.b + 2);
    }
  });
});
