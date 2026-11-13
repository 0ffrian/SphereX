import { describe, expect, it } from 'vitest';
import type { Frame, SpectrumPoint } from '@/app/api/types';
import {
  countedCode,
  FRAME_REASONS,
  groupMissing,
  parseMissing,
  summarizeSpectrum,
  trackRefusal,
} from './refusals';

// Test data only, not physical claims. Real backend frame IDs look like `2026W17_1B_0634_4_D3`.
const ids = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(3, '0')}`);
const codes = (reason: string, frameIds: readonly string[]) =>
  frameIds.map((id) => `${reason}:${id}`);
const point = (wl: number, frameId: string, flagged = false): SpectrumPoint => ({
  wavelength_um: wl,
  flux: 1,
  error: 0.1,
  flagged,
  frame_id: frameId,
});
const frame = (wl: number, frameId: string): Frame => ({
  frame_id: frameId,
  time: '2025-05-03T00:00:00Z',
  wavelength_um: wl,
  x: 1,
  y: 1,
  cutout_url: `/c/${frameId}.png`,
  flags: [],
});

describe('parseMissing', () => {
  it.each(FRAME_REASONS)('%s:<id> is a known per-frame refusal', (reason) => {
    expect(parseMissing(`${reason}:2026W17_1B_0634_4_D3`)).toEqual({
      kind: 'frame',
      reason,
      frameId: '2026W17_1B_0634_4_D3',
      known: true,
    });
  });

  it('reads whole-result codes as notes', () => {
    for (const c of [
      'frames:truncated',
      'frames:ephemeris',
      'frames:moving_window',
      'spectrum:saturated',
    ]) {
      expect(parseMissing(c)).toEqual({ kind: 'note', code: c, known: true, count: 1 });
    }
    expect(parseMissing('cutouts:deferred:7')).toEqual({
      kind: 'note',
      code: 'cutouts:deferred:7',
      known: true,
      count: 7,
    });
  });

  it('keeps unknown codes as unknown notes or unknown reasons, never drops them', () => {
    expect(parseMissing('cutouts:deferred:x')).toMatchObject({ kind: 'note', known: false });
    expect(parseMissing('spectrum:new_thing')).toMatchObject({ kind: 'note', known: false });
    expect(parseMissing('frames:other')).toMatchObject({ kind: 'note', known: false });
    expect(parseMissing('no_colon_here')).toMatchObject({ kind: 'note', known: false });
    expect(parseMissing('Bad Reason:x')).toMatchObject({ kind: 'note', known: false });
    expect(parseMissing('saturated:')).toMatchObject({ kind: 'note', known: false });
    expect(parseMissing('zzz_new:abc')).toEqual({
      kind: 'frame',
      reason: 'zzz_new',
      frameId: 'abc',
      known: false,
    });
  });

  it('splits on the first colon, so a frame id may contain one', () => {
    expect(parseMissing('cutout:a:b')).toMatchObject({
      kind: 'frame',
      reason: 'cutout',
      frameId: 'a:b',
    });
  });
});

describe('groupMissing', () => {
  it('is empty for no codes', () => {
    expect(groupMissing([])).toEqual([]);
  });

  it('counts each reason, sorts IDs, merges duplicates and puts notes first', () => {
    const groups = groupMissing([
      'saturated:f2',
      'aperture_flags:f9',
      'saturated:f0',
      'saturated:f1',
      'saturated:f0',
      'frames:truncated',
      'aperture_edge:f5',
    ]);
    expect(groups.map((g) => [g.kind, g.reason, g.count])).toEqual([
      ['note', 'frames:truncated', 1],
      ['frames', 'saturated', 3],
      ['frames', 'aperture_edge', 1],
      ['frames', 'aperture_flags', 1],
    ]);
    expect(groups[1]!.frameIds).toEqual(['f0', 'f1', 'f2']);
    expect(groups[0]!.frameIds).toEqual([]);
  });

  it('groups an unknown reason with known: false, and keeps an unknown note raw', () => {
    const groups = groupMissing(['zzz_new:abc', 'zzz_new:abd', 'spectrum:new_thing']);
    expect(groups).toEqual([
      {
        key: 'note:spectrum:new_thing',
        kind: 'note',
        reason: 'spectrum:new_thing',
        known: false,
        count: 1,
        frameIds: [],
      },
      {
        key: 'frames:zzz_new',
        kind: 'frames',
        reason: 'zzz_new',
        known: false,
        count: 2,
        frameIds: ['abc', 'abd'],
      },
    ]);
  });

  it('places every distinct code in exactly one group', () => {
    const input = [
      ...codes('saturated', ids('a', 50)),
      ...codes('aperture_edge', ids('b', 3)),
      'cutouts:deferred:4',
      'odd',
      'odd',
      'cutout:a000',
    ];
    const groups = groupMissing(input);
    const placed = groups.reduce((n, g) => n + (g.kind === 'frames' ? g.frameIds.length : 1), 0);
    expect(placed).toBe(new Set(input).size);
    expect(groups.find((g) => g.reason === 'cutouts:deferred:4')?.count).toBe(4);
  });
});

describe('summarizeSpectrum', () => {
  it('Barnard-like: nothing measured, mostly saturated', () => {
    const missing = [...codes('saturated', ids('s', 239)), 'aperture_flags:x000'];
    const o = summarizeSpectrum([], missing);
    expect(o).toMatchObject({
      points: 0,
      refused: 240,
      total: 240,
      saturated: 239,
      largestReason: 'saturated',
      incomplete: false,
      measuredRange: null,
    });
  });

  it('R Dra-like: Stage 1 refusals of unlisted frames count in the total', () => {
    const missing = [
      ...codes('saturated', ids('s', 530)),
      ...codes('aperture_edge', ids('e', 6)),
      'outside_cutout:o000',
    ];
    const o = summarizeSpectrum([], missing);
    expect(o.total).toBe(537);
    expect(o.groups.map((g) => g.count)).toEqual([530, 6, 1]);
  });

  it('all saturated with the flag: the flag is kept out of the list', () => {
    const missing = [...codes('saturated', ids('s', 5)), 'spectrum:saturated'];
    const o = summarizeSpectrum([], missing);
    expect(o.saturated).toBe(5);
    expect(o.total).toBe(5);
    expect(o.groups.map((g) => g.reason)).toEqual(['saturated']);
  });

  it('keeps spectrum:saturated as a line when no frame is listed as saturated', () => {
    const o = summarizeSpectrum([], ['aperture_edge:a', 'spectrum:saturated']);
    expect(o.saturated).toBe(0);
    expect(o.groups.map((g) => g.reason)).toEqual(['spectrum:saturated', 'aperture_edge']);
  });

  it('RW Aur-like partial: measured range is narrower than the frames span', () => {
    const points = [point(0.74, 'p0'), point(1.09, 'p1', true)];
    const frames = [frame(0.74, 'p0'), frame(1.09, 'p1'), frame(4.9, 's000')];
    const missing = [...codes('saturated', ['s000', 's001']), 'aperture_flags:f000'];
    const o = summarizeSpectrum(points, missing, frames);
    expect(o).toMatchObject({ points: 2, flagged: 1, refused: 3, total: 5 });
    expect(o.measuredRange).toEqual([0.74, 1.09]);
    expect(o.framesRange).toEqual([0.74, 4.9]);
  });

  it('fully measured: nothing refused', () => {
    const o = summarizeSpectrum([point(1, 'a'), point(2, 'b')], []);
    expect(o).toMatchObject({ points: 2, refused: 0, total: 2, largestReason: null });
    expect(o.groups).toEqual([]);
  });

  it('a refused mover: no frames, one note', () => {
    const o = summarizeSpectrum([], ['frames:moving_window']);
    expect(o).toMatchObject({ points: 0, refused: 0, total: 0 });
    expect(o.groups).toHaveLength(1);
  });

  it('marks a deferred or truncated list as incomplete', () => {
    expect(summarizeSpectrum([], ['saturated:a', 'cutouts:deferred:3']).incomplete).toBe(true);
    expect(summarizeSpectrum([], ['saturated:a', 'frames:truncated']).incomplete).toBe(true);
    expect(summarizeSpectrum([], ['saturated:a', 'cutouts:deferred:x']).incomplete).toBe(false);
  });
});

describe('moving-object path search codes', () => {
  it('reads counted codes as notes with their count', () => {
    expect(parseMissing('frames:cone_cap:12')).toEqual({
      kind: 'note',
      code: 'frames:cone_cap:12',
      known: true,
      count: 12,
    });
    expect(countedCode('frames:search_deferred:4')).toEqual({
      prefix: 'frames:search_deferred',
      count: 4,
    });
    expect(countedCode('frames:cone_cap:x')).toBeNull();
    expect(parseMissing('frames:cone_cap:x')).toMatchObject({ kind: 'note', known: false });
  });

  it('reads the per-frame codes as known frame refusals', () => {
    expect(parseMissing('no_footprint:f1')).toEqual({
      kind: 'frame',
      reason: 'no_footprint',
      frameId: 'f1',
      known: true,
    });
    expect(parseMissing('ephemeris:f2')).toMatchObject({ kind: 'frame', known: true });
  });

  it('marks a capped, lossy or still running path search as incomplete', () => {
    for (const c of [
      'frames:search_deferred:2',
      'frames:cone_cap:9',
      'frames:cone_failed:1',
      'frames:cone_maxrec:1',
      'frames:sparse_path:3',
      'frames:ephemeris',
    ]) {
      expect(summarizeSpectrum([], ['saturated:a', c]).incomplete, c).toBe(true);
    }
    expect(summarizeSpectrum([], ['saturated:a', 'frames:outside_window:291']).incomplete).toBe(
      false,
    );
  });
});

describe('trackRefusal (A19.2)', () => {
  it('refuses an object that does not move and lets a mover through', () => {
    expect(trackRefusal({ moving: false })).toBe('track:not_moving');
    expect(trackRefusal({ moving: true })).toBeNull();
    const [group] = groupMissing([trackRefusal({ moving: false })!]);
    expect(group?.known).toBe(true);
  });
});
