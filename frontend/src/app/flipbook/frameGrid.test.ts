// The flipbook's fixed display grid: frames of different sizes and object positions land the
// object on the same screen spot at the same scale, with whole-pixel shifts.
import { describe, expect, it } from 'vitest';
import { parseFrames } from '@/app/api/validate';
import { ApiError } from '@/app/api/errors';
import {
  FALLBACK_GRID_PX,
  frameSize,
  gridSize,
  objectOnGrid,
  oddCeil,
  placeFrame,
  placementStyle,
  registrationFor,
  ringOnGrid,
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
