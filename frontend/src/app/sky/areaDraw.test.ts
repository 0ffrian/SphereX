import { afterEach, describe, expect, it } from 'vitest';
import { regionBox } from '@/app/area/scanGrid';
import { boxToPixels, fitCamera, registerAreaView } from './areaDraw';
import type { SkyCamera } from '@/viewer/sky/skyMath';

let cam: SkyCamera = { ra: 100, dec: 10, fovDeg: 4 };
const access = {
  getView: () => cam,
  getSize: () => ({ width: 1000, height: 600 }),
  setView: (c: SkyCamera) => {
    cam = c;
  },
};
// A region's box, as a selection gives it (issue #157).
const BOX = regionBox({ ra: 100, dec: 10, width_deg: 3, height_deg: 1.5 });

afterEach(() => registerAreaView(null));

describe('areaDraw', () => {
  it('without a view there is no box on screen or fit', () => {
    expect(boxToPixels(BOX)).toBeNull();
    expect(fitCamera(BOX, { l: 0, t: 0, r: 500, b: 300 })).toBeNull();
  });
  it('a box centred on the view maps to pixels around the screen centre', () => {
    cam = { ra: 100, dec: 10, fovDeg: 4 };
    registerAreaView(access);
    const px = boxToPixels(BOX)!;
    expect((px.x0 + px.x1) / 2).toBeCloseTo(500, 0);
    expect((px.y0 + px.y1) / 2).toBeCloseTo(300, 0);
    // East is on the left: the top-left corner is left of and above the bottom-right one.
    expect(px.x0).toBeLessThan(px.x1);
    expect(px.y0).toBeLessThan(px.y1);
  });
  it('fitCamera puts the whole box inside the safe rectangle', () => {
    cam = { ra: 100, dec: 10, fovDeg: 4 };
    registerAreaView(access);
    const safe = { l: 20, t: 60, r: 600, b: 500 };
    const fit = fitCamera(BOX, safe)!;
    cam = fit;
    const px = boxToPixels(BOX)!;
    for (const [x, y] of [
      [px.x0, px.y0],
      [px.x1, px.y1],
    ] as const) {
      expect(x).toBeGreaterThan(safe.l - 2);
      expect(x).toBeLessThan(safe.r + 2);
      expect(y).toBeGreaterThan(safe.t - 2);
      expect(y).toBeLessThan(safe.b + 2);
    }
  });
});
