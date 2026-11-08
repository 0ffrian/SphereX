// The steady no-data line for a whole object, and the per-frame caption only while paused (R9).
import { describe, expect, it } from 'vitest';
import { countNoData, noDataCaptionVisible, noDataSummary } from './noData';

// Barnard's Star, 7 Nov 2026 mix: full cutouts and two clipped at a detector edge.
const full = { w: 59, h: 59, x: 29, y: 29 };
const clipped = { w: 34, h: 59, x: 4.3, y: 29 };

describe('countNoData', () => {
  it('counts the frames that leave part of the grid without data, by kind', () => {
    const frames = [full, clipped, full, clipped, { w: 59, h: 59, x: 20, y: 29 }];
    expect(countNoData(frames, frames, 'object')).toEqual({ edge: 2, outside: 1, known: 5 });
  });

  it('counts only frames whose size is known', () => {
    const frames = [full, clipped, full];
    expect(countNoData(frames, [full, clipped, null], 'object')).toEqual({
      edge: 1,
      outside: 0,
      known: 2,
    });
    expect(countNoData(frames, [null, null, null], 'object')).toEqual({
      edge: 0,
      outside: 0,
      known: 0,
    });
  });

  it('marks nothing on an object whose frames differ by a pixel', () => {
    const sizes = [
      { w: 58, h: 58 },
      { w: 59, h: 58 },
      { w: 58, h: 59 },
      { w: 59, h: 59 },
    ];
    const frames = sizes.map((s) => ({ x: (s.w - 1) / 2, y: (s.h - 1) / 2 }));
    expect(countNoData(frames, sizes, 'object')).toEqual({ edge: 0, outside: 0, known: 4 });
  });

  it('counts 2 of 240 for an object like the reported one', () => {
    const frames = Array.from({ length: 240 }, (_, i) => (i === 204 || i === 221 ? clipped : full));
    const c = countNoData(frames, frames, 'object');
    expect(c).toEqual({ edge: 2, outside: 0, known: 240 });
    expect(noDataSummary(c)).toBe(
      '2 of 240 frames are at a detector edge; their missing part is hatched.',
    );
  });
});

describe('noDataSummary', () => {
  it('is null when no frame is hatched', () => {
    expect(noDataSummary({ edge: 0, outside: 0, known: 24 })).toBeNull();
  });

  it('uses the singular for one frame', () => {
    expect(noDataSummary({ edge: 1, outside: 0, known: 24 })).toBe(
      '1 of 24 frames is at a detector edge; its missing part is hatched.',
    );
    expect(noDataSummary({ edge: 0, outside: 1, known: 24 })).toBe(
      '1 of 24 frames covers only part of the picture; the rest is hatched.',
    );
  });

  it('names both kinds when both occur', () => {
    expect(noDataSummary({ edge: 2, outside: 3, known: 30 })).toBe(
      '2 of 30 frames are at a detector edge; their missing part is hatched. ' +
        '3 of 30 frames cover only part of the picture; the rest is hatched.',
    );
  });
});

describe('noDataCaptionVisible', () => {
  it('shows the per-frame caption only while paused or stopped, on a hatched frame', () => {
    expect(noDataCaptionVisible(false, 'edge')).toBe(true);
    expect(noDataCaptionVisible(false, 'outside')).toBe(true);
    expect(noDataCaptionVisible(true, 'edge')).toBe(false);
    expect(noDataCaptionVisible(true, 'outside')).toBe(false);
    expect(noDataCaptionVisible(false, 'none')).toBe(false);
    expect(noDataCaptionVisible(true, 'none')).toBe(false);
  });
});
