// Scan geometry (issue #157; #156 Q-470): the equal split, the order, the pointer's region and label.
import { describe, expect, it } from 'vitest';
import { raDecToScreen, separationDeg } from '@/viewer/sky/skyMath';
import {
  aboutTime,
  gridShape,
  deproject,
  inQuad,
  selectionAt,
  selectionLabel,
  splitCount,
  splitRegion,
  squareCentre,
} from './scanGrid';

describe('splitRegion (equal split, #156)', () => {
  it('as the backend (scan.split): 4° × 2° is 3 × 2; 3° × 3° is 2 × 2 of 1.5°; 9.6° × 6° is 6 × 4; 9° × 5.4° is 5 × 3', () => {
    expect(splitRegion({ ra: 30, dec: 10, width_deg: 4, height_deg: 2 })).toMatchObject({
      cols: 3,
      rows: 2,
    });
    const g = splitRegion({ ra: 30, dec: 10, width_deg: 3, height_deg: 3 });
    expect(g).toMatchObject({ cols: 2, rows: 2, cellW: 1.5, cellH: 1.5 });
    expect(splitRegion({ ra: 30, dec: 10, width_deg: 9.6, height_deg: 6 })).toMatchObject({
      cols: 6,
      rows: 4,
    });
    expect(splitRegion({ ra: 30, dec: 10, width_deg: 9, height_deg: 5.4 })).toMatchObject({
      cols: 5,
      rows: 3,
    });
    // Too many squares with their overlap: scan:too_large.
    expect(gridShape({ ra: 30, dec: 10, width_deg: 12, height_deg: 12 })).toBeNull();
    expect(splitRegion({ ra: 30, dec: 10, width_deg: 1.9, height_deg: 1.2 }).squares).toHaveLength(
      1,
    );
  });

  it('a side a hair over a whole number of squares is not a new square', () => {
    expect(splitCount(4.0000001)).toBe(2);
    expect(splitCount(4.01)).toBe(3);
    expect(splitCount(0.3)).toBe(1);
  });

  it('numbers 1..N from the top row, left to right (east to west), row by row', () => {
    const g = splitRegion({ ra: 100, dec: 20, width_deg: 5.4, height_deg: 3.6 });
    expect(g.squares.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(g.squares.map((s) => [s.row, s.col])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
    ]);
    const c = g.squares.map((s) => squareCentre(s));
    // Left on screen is east (larger RA); the top row is north.
    expect(c[0]!.ra).toBeGreaterThan(c[1]!.ra);
    expect(c[1]!.ra).toBeGreaterThan(c[2]!.ra);
    expect(c[0]!.dec).toBeGreaterThan(c[3]!.dec);
    // Equal squares: neighbours' centres are a cell apart.
    expect(separationDeg(c[0]!.ra, c[0]!.dec, c[1]!.ra, c[1]!.dec)).toBeCloseTo(1.8, 1);
  });

  it('squares tile the region: shared corners, the outer corners at the region edge', () => {
    const g = splitRegion({ ra: 10, dec: -30, width_deg: 4, height_deg: 4 });
    const [a, b] = g.squares;
    expect(a!.corners[1]).toEqual(b!.corners[0]);
    expect(a!.corners[2]).toEqual(b!.corners[3]);
    const mid = deproject(10, -30, 0, 0);
    expect(mid.ra).toBeCloseTo(10, 9);
    expect(mid.dec).toBeCloseTo(-30, 9);
  });

  it('a square is straight on a gnomonic view centred on the region (corners project to a rectangle)', () => {
    const region = { ra: 50, dec: 40, width_deg: 8, height_deg: 5 };
    const cam = { ra: 50, dec: 40, fovDeg: 5 };
    const g = splitRegion(region);
    const tl = raDecToScreen(
      cam,
      g.squares[0]!.corners[0].ra,
      g.squares[0]!.corners[0].dec,
      1280,
      800,
    );
    const br = raDecToScreen(
      cam,
      g.squares.at(-1)!.corners[2].ra,
      g.squares.at(-1)!.corners[2].dec,
      1280,
      800,
    );
    expect(Math.abs(tl.x)).toBeLessThan(1);
    expect(tl.y).toBeCloseTo(0, 0);
    expect(Math.abs(br.x - 1280)).toBeLessThan(1);
    expect(br.y).toBeCloseTo(800, 0);
  });
});

describe('selectionAt (state 1)', () => {
  it('covers the screen shape; zooming the sky resizes it; 12° a side is the limit', () => {
    const near = selectionAt({ ra: 30, dec: 10, fovDeg: 3 }, 640, 400, 1280, 800);
    expect(near.region.width_deg / near.region.height_deg).toBeCloseTo(1.6, 2);
    expect(near.cols * near.rows).toBe(1);
    expect(near.held).toBe(false);
    expect(near.hPx).toBeCloseTo(280, 0);
    expect(near.target).toMatchObject({ fovDeg: 2 }); // the sky's 2° minimum
    const mid = selectionAt({ ra: 30, dec: 10, fovDeg: 20 }, 640, 400, 1280, 800);
    expect(mid.region.height_deg).toBeGreaterThan(near.region.height_deg);
    const wide = selectionAt({ ra: 30, dec: 10, fovDeg: 90 }, 640, 400, 1280, 800);
    expect(wide.held).toBe(true);
    expect(wide.region.width_deg).toBeLessThanOrEqual(12);
    expect(wide.cols * wide.rows).toBeLessThanOrEqual(36);
    expect(wide.hPx).toBeLessThan(800 * 0.35);
    // A square screen at the limit: 6 × 6 = 36 squares.
    const sq = selectionAt({ ra: 30, dec: 10, fovDeg: 90 }, 400, 400, 800, 800);
    expect(sq.cols * sq.rows).toBe(36);
  });

  it('labels size, squares and rough time, and says when it is held', () => {
    expect(
      selectionLabel({
        region: { ra: 0, dec: 0, width_deg: 9.6, height_deg: 6 },
        cols: 5,
        rows: 3,
        held: false,
      }),
    ).toBe('9.6° × 6.0° · 15 squares · about 12 h');
    expect(
      selectionLabel({
        region: { ra: 0, dec: 0, width_deg: 12, height_deg: 7.5 },
        cols: 7,
        rows: 5,
        held: true,
      }),
    ).toBe('12.0° × 7.5° · 35 squares · about 22 h · 12° max');
    expect(
      selectionLabel({
        region: { ra: 0, dec: 0, width_deg: 1.6, height_deg: 1 },
        cols: 1,
        rows: 1,
        held: false,
      }),
    ).toBe('1.6° × 1.0° · 1 square · about 28 min');
  });

  it('times: minutes, hours and minutes, rough hours', () => {
    expect(aboutTime(540)).toBe('about 9 min');
    expect(aboutTime(7800)).toBe('about 2 h 10 min');
    expect(aboutTime(7800, true)).toBe('about 2 h');
    expect(aboutTime(3600)).toBe('about 1 h');
  });
});

describe('inQuad', () => {
  it('hit-tests a convex quad', () => {
    const q = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(inQuad(q, 5, 5)).toBe(true);
    expect(inQuad(q, 11, 5)).toBe(false);
  });
});
