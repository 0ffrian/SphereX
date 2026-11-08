// The flipbook's fixed display grid: frames of different sizes and object positions land the
// object on the same screen spot at the same scale, with whole-pixel shifts.
import { describe, expect, it } from 'vitest';
import { parseFrames } from '@/app/api/validate';
import { ApiError } from '@/app/api/errors';
import {
  cutoutPointOnGrid,
  FALLBACK_GRID_PX,
  frameSize,
  markersOnGrid,
  gridSize,
  largestSide,
  NO_DATA_SLIVER_PX,
  noDataKind,
  objectOnGrid,
  oddCeil,
  placeFrame,
  placementStyle,
  registrationFor,
  ringOnGrid,
  uncoveredGaps,
} from './frameGrid';

// The Barnard's Star mix reported on 7 Nov 2026 (sizes and object pixels, test data).
const BARNARD = [
  { w: 58, h: 59, x: 28.0, y: 29.5 },
  { w: 58, h: 58, x: 28.5, y: 28.0 },
  { w: 59, h: 59, x: 29.5, y: 29.0 },
  { w: 59, h: 58, x: 29.0, y: 28.5 },
  { w: 59, h: 36, x: 28.7, y: 6.07 }, // clipped at a detector edge
  { w: 58, h: 46, x: 28.2, y: 17.4 }, // clipped
] as const;

describe('grid size', () => {
  it('is the largest frame side, rounded up to odd', () => {
    expect(oddCeil(58)).toBe(59);
    expect(oddCeil(59)).toBe(59);
    expect(oddCeil(58.5)).toBe(59);
    expect(gridSize(BARNARD.map((f) => ({ w: f.w, h: f.h })))).toBe(59);
    expect(gridSize([{ w: 64, h: 63 }, null])).toBe(65);
    expect(gridSize([null])).toBe(FALLBACK_GRID_PX);
    expect(gridSize([])).toBe(FALLBACK_GRID_PX);
  });

  it('takes the stated size first, the decoded one as a fallback', () => {
    expect(frameSize({ width: 58, height: 59 }, { w: 1, h: 1 })).toEqual({ w: 58, h: 59 });
    expect(frameSize({}, { w: 60, h: 61 })).toEqual({ w: 60, h: 61 });
    expect(frameSize({})).toBeNull();
  });
});

describe('placement registered on the object (native orientation)', () => {
  const grid = 59;
  const placed = BARNARD.map((f) => ({ f, p: placeFrame(grid, f, f, 'object') }));

  it('puts every object within half a source pixel of the grid centre, at one scale', () => {
    for (const { f, p } of placed) {
      const o = objectOnGrid(p, f);
      // Grid centre of pixel (N-1)/2 is at N/2 in edge coordinates.
      expect(Math.abs(o.x - grid / 2), JSON.stringify(f)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(o.y - grid / 2), JSON.stringify(f)).toBeLessThanOrEqual(0.5);
      // Constant scale: one source pixel is always 1/N of the box.
      expect(p.width).toBe(f.w);
      expect(p.height).toBe(f.h);
      // Whole-pixel shifts only (sharp, no shimmer).
      expect(Number.isInteger(p.left) && Number.isInteger(p.top)).toBe(true);
    }
  });

  it('moves a clipped frame down so its object meets the others', () => {
    const clipped = placed[4]!.p;
    expect(clipped.top).toBe(Math.round(29 - 6.07));
    expect(clipped.top).toBe(23);
  });

  it('keeps the ring on one spot whatever the frame', () => {
    const rings = placed.map(({ f, p }) => ringOnGrid(grid, p, f, 'object'));
    expect(new Set(rings.map((r) => `${r.x},${r.y}`)).size).toBe(1);
    expect(rings[0]).toEqual({ x: 29.5, y: 29.5 });
  });

  it('gives percentages of the grid; never a negative zero', () => {
    const p = placeFrame(59, { x: 29.5, y: 29 }, { w: 59, h: 59 }, 'object');
    expect(Object.is(p.top, -0)).toBe(false);
    expect(placementStyle(59, { left: -1, top: 0, width: 59, height: 36 })).toEqual({
      left: `${(-1 / 59) * 100}%`,
      top: '0%',
      width: '100%',
      height: `${(36 / 59) * 100}%`,
    });
  });
});

describe('placement on a shared north-up grid (Rainbow Trails)', () => {
  it('draws every frame at offset 0, so the object moves and the dots use (x, y)', () => {
    expect(registrationFor(true)).toBe('grid');
    expect(registrationFor(false)).toBe('object');
    const a = placeFrame(65, { x: 12, y: 44 }, { w: 64, h: 64 }, 'grid');
    const b = placeFrame(65, { x: 52, y: 22 }, { w: 64, h: 64 }, 'grid');
    expect(a).toEqual({ left: 0, top: 0, width: 64, height: 64 });
    expect(b).toEqual(a);
    expect(ringOnGrid(65, b, { x: 52, y: 22 }, 'grid')).toEqual({ x: 52.5, y: 22.5 });
  });
});

describe('grid area without data (detector edge)', () => {
  const kind = (grid: number, f: { w: number; h: number; x: number; y: number }, full: number) =>
    noDataKind(grid, placeFrame(grid, f, f, 'object'), f, full);

  it('leaves normal 58/59 px frames unmarked (a 1 px sliver stays black)', () => {
    expect(NO_DATA_SLIVER_PX).toBe(1);
    const full = largestSide(BARNARD.map((f) => ({ w: f.w, h: f.h })));
    expect(full).toBe(59);
    for (const f of BARNARD.slice(0, 4)) {
      const g = uncoveredGaps(59, placeFrame(59, f, f, 'object'));
      expect(Math.max(g.left, g.right, g.top, g.bottom), JSON.stringify(f)).toBeLessThanOrEqual(1);
      expect(kind(59, f, full), JSON.stringify(f)).toBe('none');
    }
    // 63 and 64 px fixture frames on their 65 px grid: 1 px each side at most.
    expect(kind(65, { w: 63, h: 63, x: 31.2, y: 30.8 }, 64)).toBe('none');
    expect(kind(65, { w: 64, h: 63, x: 31.7, y: 31 }, 64)).toBe('none');
  });

  it('marks cutouts clipped at a detector edge', () => {
    // Reported: 34×59 with the object at x = 4.3, and 30×59 with x = 0.5.
    const a = { w: 34, h: 59, x: 4.3, y: 29 };
    const b = { w: 30, h: 59, x: 0.5, y: 29 };
    expect(kind(59, a, 59)).toBe('edge');
    expect(kind(59, b, 59)).toBe('edge');
    expect(uncoveredGaps(59, placeFrame(59, a, a, 'object'))).toEqual({
      left: 25,
      right: 0,
      top: 0,
      bottom: 0,
    });
    expect(uncoveredGaps(59, placeFrame(59, b, b, 'object')).left).toBe(29);
    // The clipped rows of the 7 Nov mix, and the fixture's 64×40 frame.
    expect(kind(59, BARNARD[4], 59)).toBe('edge');
    expect(kind(59, BARNARD[5], 59)).toBe('edge');
    expect(kind(65, { w: 64, h: 40, x: 31.6, y: 7.4 }, 64)).toBe('edge');
  });

  it('calls a full-size cutout with the object off centre "outside this cutout"', () => {
    expect(kind(59, { w: 59, h: 59, x: 20, y: 29 }, 59)).toBe('outside');
  });

  it('counts only the shortfall inside the grid (overhang is not a gap)', () => {
    expect(uncoveredGaps(59, { left: -2, top: 3, width: 70, height: 50 })).toEqual({
      left: 0,
      right: 0,
      top: 3,
      bottom: 6,
    });
  });
});

describe('frame width and height in the reply', () => {
  const reply = (extra: Record<string, unknown>) => ({
    id: 'o',
    frames: [
      {
        frame_id: 'f',
        time: '2026-01-01T00:00:00Z',
        wavelength_um: 1,
        x: 1,
        y: 1,
        cutout_url: '/c.png',
        flags: [],
        ...extra,
      },
    ],
    north_up: false,
    stretch: { kind: 'asinh', params: {} },
    data_release: 'x',
    cached_at: null,
    missing: [],
  });

  it('keeps a stated size and refuses a bad or half one', () => {
    expect(parseFrames(reply({ width: 58, height: 36 })).frames[0]).toMatchObject({
      width: 58,
      height: 36,
    });
    expect(parseFrames(reply({})).frames[0]?.width).toBeUndefined();
    for (const bad of [{ width: 0, height: 5 }, { width: 5.5, height: 5 }, { width: 5 }]) {
      expect(() => parseFrames(reply(bad)), JSON.stringify(bad)).toThrow(ApiError);
    }
  });
});

describe('overlay markers on the grid (issue #12 overlays on the fixed grid)', () => {
  const N = 59;
  // A source's sky position seen in each frame's own cutout pixels: the same sky point sits
  // `d` pixels from the object in every frame (north-up-like here, so no rotation), whatever the
  // frame's size or clip.
  const d = { x: 7.25, y: -4.5 };

  it('lands a source on the same grid spot in every frame, as the object does', () => {
    const spots = BARNARD.map((f) => {
      const p = placeFrame(N, f, { w: f.w, h: f.h }, 'object');
      return cutoutPointOnGrid(N, p, f.x + d.x, f.y + d.y);
    });
    for (const [i, s] of spots.entries()) {
      const f = BARNARD[i]!;
      if (f.y + d.y < -0.5) {
        // Clipped frame (y = 6.07): the source is above its top edge, so off the frame.
        expect(s).toBeNull();
        continue;
      }
      expect(s).not.toBeNull();
      // Same whole-pixel shift as the picture: marker − object on the grid = d exactly.
      const p = placeFrame(N, f, { w: f.w, h: f.h }, 'object');
      const obj = objectOnGrid(p, f);
      expect(s!.x + 0.5 - obj.x).toBeCloseTo(d.x, 9);
      expect(s!.y + 0.5 - obj.y).toBeCloseTo(d.y, 9);
      // And within half a pixel of the grid centre + d (the object's own rounding).
      expect(Math.abs(s!.x - ((N - 1) / 2 + d.x))).toBeLessThanOrEqual(0.5);
      expect(Math.abs(s!.y - ((N - 1) / 2 + d.y))).toBeLessThanOrEqual(0.5);
    }
  });

  it('moves a marker by the placement offset of a clipped frame', () => {
    const f = BARNARD[4]!; // 59 × 36, object at y = 6.07
    const p = placeFrame(N, f, { w: f.w, h: f.h }, 'object');
    expect(p.top).toBe(23);
    expect(cutoutPointOnGrid(N, p, 10, 20)).toEqual({ x: 10 + p.left, y: 43 });
  });

  it('drops markers off the frame (no-data hatching) or off the grid', () => {
    const p = { left: 0, top: 23, width: 59, height: 36 };
    expect(cutoutPointOnGrid(N, p, 3, -0.6)).toBeNull(); // above the clipped frame: hatched area
    expect(cutoutPointOnGrid(N, p, 3, 35.6)).toBeNull(); // below its last row
    expect(cutoutPointOnGrid(N, p, -0.5, 0)).toEqual({ x: -0.5, y: 23 }); // edge of pixel 0
    const over = { left: -3, top: -3, width: 64, height: 64 }; // larger than the grid
    expect(cutoutPointOnGrid(N, over, 1, 30)).toBeNull(); // on the frame, cropped off the grid
    expect(cutoutPointOnGrid(N, over, 3, 30)).toEqual({ x: 0, y: 27 });
    expect(cutoutPointOnGrid(N, p, Number.NaN, 3)).toBeNull();
  });

  it('keeps marker fields, never a negative zero, on a shared grid at offset 0', () => {
    const p = placeFrame(N, { x: 12, y: 40 }, { w: 59, h: 59 }, 'grid');
    const out = markersOnGrid(
      [
        { catalog: 'gaia' as const, id: 'a', x: 0, y: 5 },
        { catalog: 'wise' as const, id: 'b', x: 70, y: 5 },
      ],
      N,
      p,
    );
    expect(out).toEqual([{ catalog: 'gaia', id: 'a', x: 0, y: 5 }]);
    expect(Object.is(out[0]!.x, -0)).toBe(false);
  });
});
