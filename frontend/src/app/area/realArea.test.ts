// Issue #96: the dock's square reads a prepared area's stored replies when one holds it (Q-205),
// keeps the demo otherwise, and lists what is missing instead of drawing it (refuse, never invent).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient, ApiResult } from '@/app/api/client';
import { ApiError } from '@/app/api/errors';
import type { AreaBox } from '@/app/shell/areaStore';
import { areaMiniTitle, demoPlayerOn } from '@/app/shell/areaStore';
import { createApiClient } from '@/app/api/client';
import { setSkyApi } from '@/state/store';
import { areaFixture, areaIndexFixture } from '@/test/areaFixtures';
import { AreaRefused, discoverIn, knownObjectsIn, type ErosDemo } from './areaService';
import { areaTrackLabel, missingText, squareOf, unmatchedDotIds } from './realArea';

const box = (ra: number, dec: number, w = 0.3, h = 0.3): AreaBox => ({
  a: { ra: ra - w / 2, dec: dec + h / 2 },
  b: { ra: ra + w / 2, dec: dec - h / 2 },
  widthDeg: w,
  heightDeg: h,
});

const ok = <T>(data: T): Promise<ApiResult<T>> => Promise.resolve({ data, fixture: 'synthetic' });

function fixtureApi(over: Partial<ApiClient> = {}): ApiClient {
  const f = areaFixture('main');
  return {
    ...createApiClient(),
    areaIndex: () => ok(areaIndexFixture()),
    area: () => ok(f.summary),
    areaDots: () => ok(f.dots),
    areaTracks: () => ok(f.tracks),
    areaKnown: () => ok(f.known),
    ...over,
  };
}

const ERO: ErosDemo = {
  object: { name: '433 Eros' },
  wide: { png: '', w: 1280, h: 720, center: [91.118, 13.453], deg_per_px: 0.0015625 },
  track: [],
  hops: [],
} as unknown as ErosDemo;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => structuredClone(ERO) })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  setSkyApi(createApiClient());
});

describe('real area first', () => {
  it('reads the prepared area that holds the square, as stored', async () => {
    setSkyApi(fixtureApi());
    const r = await discoverIn(box(150, 10));
    expect(r.demo).toBe(false);
    expect(r.real?.entry.area_id).toBe('fixture:area-main');
    expect(r.real?.synthetic).toBe(true);
    const n = areaFixture('main').summary.steps;
    expect(r.steps[0]!.result).toBe(`${n.n_dots} in 16 frames`);
    expect(r.steps.every((s) => !s.result.includes('demo'))).toBe(true);
    expect(r.movers.map((m) => m.id)).toEqual(
      areaFixture('main').tracks.tracks.map((t) => t.track_id),
    );
  });

  it('keeps the demo when no prepared area holds the square', async () => {
    setSkyApi(fixtureApi());
    const r = await discoverIn(box(91.118, 13.453));
    expect(r.demo).toBe(true);
    expect(r.real).toBeNull();
  });

  it('keeps the demo when the index cannot be read (no backend)', async () => {
    setSkyApi(fixtureApi({ areaIndex: () => Promise.reject(new ApiError('network', 'down')) }));
    expect((await knownObjectsIn(box(91.118, 13.453))).demo).toBe(true);
  });

  it('refuses outside both a prepared area and the demo area', async () => {
    setSkyApi(fixtureApi());
    await expect(discoverIn(box(300, -60))).rejects.toMatchObject({ code: 'area:not_prepared' });
  });

  it('refuses when the area summary fails, and never shows the demo instead', async () => {
    setSkyApi(fixtureApi({ area: () => Promise.reject(new ApiError('server', 'boom', 500)) }));
    const p = discoverIn(box(150, 10));
    await expect(p).rejects.toBeInstanceOf(AreaRefused);
    await expect(p).rejects.toMatchObject({ code: 'area:failed' });
  });

  it('lists a part that did not load and does not draw it', async () => {
    setSkyApi(
      fixtureApi({ areaTracks: () => Promise.reject(new ApiError('server', 'boom', 500)) }),
    );
    const r = await discoverIn(box(150, 10));
    expect(r.real?.tracks).toBeNull();
    expect(r.movers).toEqual([]);
    expect(r.real?.missing).toContain('area:tracks_unavailable');
  });

  it("carries the replies' own missing codes", async () => {
    setSkyApi(fixtureApi());
    const r = await discoverIn(box(150, 10));
    const f = areaFixture('main');
    for (const c of [...f.summary.missing, ...f.dots.missing, ...f.tracks.missing])
      expect(r.real?.missing).toContain(c);
  });

  it('lists the known objects of a prepared area as stored', async () => {
    setSkyApi(fixtureApi());
    const r = await knownObjectsIn(box(150, 10));
    expect(r.demo).toBe(false);
    expect(r.objects).toHaveLength(areaFixture('main').known.known.length);
  });
});

describe('real area helpers', () => {
  it('snaps by the box centre, across RA 0/360', () => {
    const sq = squareOf({
      a: { ra: 359.8, dec: 1 },
      b: { ra: 0.2, dec: 0.6 },
      widthDeg: 0.4,
      heightDeg: 0.4,
    });
    expect(sq.ra).toBeCloseTo(0, 9);
    expect(sq.dec).toBeCloseTo(0.8, 9);
  });

  it('counts track points missing from the dots reply', () => {
    const f = areaFixture('main');
    expect(unmatchedDotIds(f.dots, f.tracks)).toEqual([]);
    const t = f.tracks.tracks[0]!;
    t.tracklets[0]!.dot_ids.push('nowhere');
    expect(unmatchedDotIds(f.dots, f.tracks)).toEqual(['nowhere']);
  });

  it('words every namespace and shows an unknown code as it is', () => {
    expect(missingText('skybot:2')).toContain('visit 2');
    expect(missingText('area:tracks_unavailable')).toContain('not');
    expect(missingText('area:unmatched_dots:3')).toContain('3 track points');
    expect(missingText('weird')).toBe('weird');
  });

  it('never says asteroid, new or discover in a track label (Q-205)', () => {
    for (const t of areaFixture('multivisit').tracks.tracks.concat(
      areaFixture('main').tracks.tracks,
    ))
      expect(areaTrackLabel(t)).not.toMatch(/asteroid|\bnew\b|discover/i);
  });

  it('keeps the demo player off a prepared area mover', () => {
    const eros = ERO;
    expect(demoPlayerOn({ screen: 'mover', sel: 0, eros, disc: null })).toBe(true);
    expect(
      demoPlayerOn({
        screen: 'mover',
        sel: 0,
        eros,
        disc: { real: {} } as never,
      }),
    ).toBe(false);
  });

  it('tags only a known demo answer "(demo)" in the minimised pill', () => {
    const base = { screen: 'disc' as const, sel: -1, known: null };
    expect(areaMiniTitle({ ...base, disc: { demo: true } as never })).toBe('Discovery (demo)');
    expect(areaMiniTitle({ ...base, disc: { demo: false } as never })).toBe('Discovery');
    expect(areaMiniTitle({ ...base, disc: null })).toBe('Discovery');
  });

  it('counts a track point missing from the dots once', () => {
    const f = areaFixture('main');
    const t = f.tracks.tracks[0]!;
    t.tracklets[0]!.dot_ids.push('nowhere', 'nowhere');
    expect(unmatchedDotIds(f.dots, f.tracks)).toEqual(['nowhere']);
  });
});
