import { describe, expect, it } from 'vitest';
import { raDecToScreen, separationDeg, type SkyCamera } from '@/viewer/sky/skyMath';
import {
  checkSquare,
  formatSideDeg,
  MAX_SQUARE_DEG,
  middleSquare,
  MIN_SQUARE_PX,
  nudgeSquare,
  skySquareFromScreen,
  squareFromDrag,
} from './drawSquare';
import { boxContains, boxCorners, fromPlane, overlapDeg2, toPlane } from './geometry';

const W = 1280;
const H = 720;

describe('geometry (gnomonic plane)', () => {
  it('round-trips a point through the tangent plane, across RA 0/360', () => {
    for (const [ra0, dec0, ra, dec] of [
      [150, 10, 150.4, 9.8],
      [359.9, 0, 0.2, 0.1],
      [0.1, -30, 359.7, -30.2],
      [45, 80, 50, 80.3],
    ] as const) {
      const p = toPlane(ra0, dec0, ra, dec)!;
      const back = fromPlane(ra0, dec0, p.xi, p.eta);
      expect(separationDeg(back.ra, back.dec, ra, dec)).toBeLessThan(1e-9);
    }
  });

  it('puts east (+xi, higher RA) on the left of the box corners', () => {
    const [tl, tr] = boxCorners(150, 10, 1, 0.6);
    expect(tl!.ra).toBeGreaterThan(tr!.ra);
    expect(tl!.dec).toBeGreaterThan(10);
  });

  it('measures width on the sky: a 1° box at Dec 10 spans 1/cos10 in RA', () => {
    const [tl, tr] = boxCorners(150, 10, 1, 0.6);
    expect(tl!.ra - tr!.ra).toBeCloseTo(1 / Math.cos((10 * Math.PI) / 180), 2);
  });

  it('box containment and overlap', () => {
    const box = { ra: 0.1, dec: 0, width_deg: 1, height_deg: 1 };
    expect(boxContains(box, 359.9, 0)).toBe(true);
    expect(boxContains(box, 359.5, 0)).toBe(false);
    expect(overlapDeg2(box, { ra: 0.1, dec: 0, sideDeg: 0.5 })).toBeCloseTo(0.25, 3);
  });
});

describe('drawSquare', () => {
  it('makes a square from a drag in all four directions (side = max)', () => {
    expect(squareFromDrag({ x: 100, y: 100 }, { x: 160, y: 120 })).toEqual({
      x: 100,
      y: 100,
      side: 60,
    });
    expect(squareFromDrag({ x: 100, y: 100 }, { x: 40, y: 90 })).toEqual({
      x: 40,
      y: 40,
      side: 60,
    });
    expect(squareFromDrag({ x: 100, y: 100 }, { x: 110, y: 30 })).toEqual({
      x: 100,
      y: 30,
      side: 70,
    });
    expect(squareFromDrag({ x: 100, y: 100 }, { x: 20, y: 20 })).toEqual({
      x: 20,
      y: 20,
      side: 80,
    });
  });

  it('refuses under 30 px and over 10°', () => {
    expect(checkSquare(MIN_SQUARE_PX - 1, 1)).toBe('square:too_small');
    expect(checkSquare(MIN_SQUARE_PX, 1)).toBeNull();
    expect(checkSquare(200, MAX_SQUARE_DEG)).toBeNull();
    expect(checkSquare(200, MAX_SQUARE_DEG + 0.01)).toBe('square:too_big');
  });

  it('gives the true on-sky side at FOV 3, 30 and 90, centre and off-centre', () => {
    for (const fovDeg of [3, 30, 90]) {
      const cam: SkyCamera = { ra: 150, dec: 10, fovDeg };
      for (const [x, y] of [
        [580, 300],
        [1040, 590],
      ] as const) {
        const sq = skySquareFromScreen({ x, y, side: 120 }, cam, W, H);
        // Round trip: the stored square's centre projects back to the screen square's centre.
        const c = raDecToScreen(cam, sq.ra, sq.dec, W, H);
        expect(c.x).toBeCloseTo(x + 60, 1);
        expect(c.y).toBeCloseTo(y + 60, 1);
        expect(sq.sideDeg).toBeGreaterThan(0);
        // Near the centre the side is close to the linear estimate.
        if (fovDeg === 3 && x === 580) expect(sq.sideDeg).toBeCloseTo((120 * fovDeg) / H, 2);
      }
    }
  });

  it('middle square: 1° at most, else 40 % of the safe rectangle', () => {
    const wide = middleSquare({ ra: 150, dec: 10, fovDeg: 60 }, W, H, { x: 0, y: 0, w: W, h: H });
    expect(wide.sideDeg).toBe(1);
    const tight = middleSquare({ ra: 150, dec: 10, fovDeg: 2 }, W, H, { x: 0, y: 0, w: W, h: H });
    expect(tight.sideDeg).toBeCloseTo(0.8, 1);
  });

  it('nudges by 10 % and resizes within limits, wrapping RA', () => {
    const sq = { ra: 359.95, dec: 0, sideDeg: 1 };
    const left = nudgeSquare(sq, 'ArrowLeft', false, 0.1);
    expect(left.ra).toBeCloseTo(0.05, 3);
    const up = nudgeSquare(sq, 'ArrowUp', false, 0.1);
    expect(up.dec).toBeCloseTo(0.1, 3);
    expect(nudgeSquare(sq, 'ArrowUp', true, 0.1).sideDeg).toBeCloseTo(1.1);
    expect(nudgeSquare(sq, 'ArrowDown', true, 0.95).sideDeg).toBe(0.95);
    expect(nudgeSquare({ ...sq, sideDeg: 9.5 }, 'ArrowRight', true, 0.1).sideDeg).toBe(10);
  });

  it('formats the size', () => {
    expect(formatSideDeg(0.8412)).toBe('0.84°');
  });
});
