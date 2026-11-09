// Cached-position markers (/v1/sky/cached): the reply check, the dedupe against the target
// markers, the search a marker runs, and when the list is loaded again.
import { describe, expect, it } from 'vitest';
import { handleFixtureRequest } from '../../../fixtures/handler';
import { ApiError } from '@/app/api/errors';
import type { SkyCachedObject } from '@/app/api/types';
import { parseSkyCached } from '@/app/api/validate';
import { initialSkyState, type SkyState } from '@/state/store';
import {
  CACHED_DEDUPE_DEG,
  cachedMarkerDescription,
  cachedMarkerLabel,
  cachedMarkerQuery,
  cachedMarkersToShow,
} from './cachedMarkers';
import { framesJustCompleted } from './useCachedMarkers';

// Test data only, not physical claims.
const measured = { tag: 'measured', source: 'test catalogue' };
const typed = { tag: 'derived', formula: 'typed coordinates' };
const named: SkyCachedObject = {
  id: 'simbad-twa-27',
  name: 'TWA 27',
  query: 'TWA 27',
  ra: 181.8,
  dec: -39.5,
  resolver: 'simbad',
  frames: 421,
  provenance: { ra: { tag: 'measured', source: 'test catalogue' } },
};
const spot: SkyCachedObject = {
  id: 'radec-285.78828+4.98215',
  name: null,
  query: null,
  ra: 285.78828,
  dec: 4.98215,
  resolver: 'coords',
  frames: 18,
  provenance: {},
};

describe('parseSkyCached', () => {
  const raw = {
    objects: [
      { ...named, provenance: { ra: measured, dec: measured } },
      { ...spot, provenance: { ra: typed, dec: typed } },
    ],
    data_release: 'spherex_qr2',
    provenance: { frames: { tag: 'derived', formula: 'count' } },
  };

  it('accepts the backend shape', () => {
    const r = parseSkyCached(raw);
    expect(r.objects).toHaveLength(2);
    expect(r.objects[1]).toMatchObject({ name: null, query: null, resolver: 'coords' });
    expect(r.objects[1]?.provenance.ra).toEqual(typed);
    expect(parseSkyCached({ objects: [], data_release: 'x' }).objects).toEqual([]);
  });

  it('refuses a bad position, count, resolver or tag', () => {
    const bad = (patch: Record<string, unknown>) => ({
      ...raw,
      objects: [{ ...raw.objects[0], ...patch }],
    });
    for (const patch of [
      { ra: 360 },
      { dec: -91 },
      { frames: 0 },
      { frames: 1.5 },
      { resolver: 'guess' },
      { provenance: { ra: { tag: 'derived' } } }, // derived needs a formula
      { provenance: { ra: { tag: 'made_up' } } },
    ]) {
      expect(() => parseSkyCached(bad(patch)), JSON.stringify(patch)).toThrow(ApiError);
    }
    expect(() => parseSkyCached({ data_release: 'x' })).toThrow(ApiError);
  });

  it('the fixture list passes the same checks and is marked synthetic', () => {
    const r = handleFixtureRequest('GET', '/v1/sky/cached')!;
    expect(r.headers['x-sx-fixture']).toBe('synthetic');
    const parsed = parseSkyCached(JSON.parse(r.body as string));
    expect(parsed.objects.map((o) => o.id)).toEqual([
      'eps-indi-b',
      'r-dra',
      'synthetic-cached-spot',
      // Issue #60: the searchable water planet with a 3D model (fixtures/targets.ts).
      'aqua-prime',
    ]);
  });
});

describe('cachedMarkersToShow', () => {
  it('drops a target already marked, by id or by position, and duplicates', () => {
    const targets = [
      { id: 'simbad-twa-27', name: 'TWA 27', ra: 181.8, dec: -39.5 },
      { id: 'other-id', name: 'Near', ra: 285.78828, dec: 4.98215 + CACHED_DEDUPE_DEG / 2 },
    ];
    expect(cachedMarkersToShow([named, spot, named], targets)).toEqual([]);
    expect(cachedMarkersToShow([named, spot, named], [])).toEqual([named, spot]);
    const far = [{ id: 'x', name: 'Far', ra: 285.78828, dec: 4.98215 + 3 * CACHED_DEDUPE_DEG }];
    expect(cachedMarkersToShow([spot], far)).toEqual([spot]);
  });
});

describe('cachedMarkerQuery', () => {
  it('searches a name by the text the backend resolved, a spot by its id coordinates', () => {
    expect(cachedMarkerQuery({ ...named, query: 'TWA 27 (query)' })).toEqual({
      q: 'TWA 27 (query)',
      kind: 'name',
      origin: 'sky',
    });
    expect(cachedMarkerQuery({ ...named, query: null })).toMatchObject({ q: 'TWA 27' });
    expect(cachedMarkerQuery(spot)).toEqual({
      q: '285.78828,4.98215',
      kind: 'coords',
      origin: 'sky',
    });
    expect(cachedMarkerQuery({ ...spot, ra: 0.00001, dec: -0.5 }).q).toBe('0.00001,-0.50000');
  });

  it('labels and describes the marker', () => {
    expect(cachedMarkerLabel(named)).toBe('TWA 27');
    expect(cachedMarkerLabel(spot)).toBe('RA 285.78828°, Dec +4.98215°');
    expect(cachedMarkerDescription(spot)).toBe(
      'RA 285.78828°, Dec +4.98215°: cached, 18 frames, loads instantly. Open it',
    );
    expect(cachedMarkerDescription({ ...named, frames: 1 })).toMatch(/cached, 1 frame,/);
  });
});

describe('framesJustCompleted', () => {
  const resolved = {
    id: 'radec-1',
    name: null,
    ra: 1,
    dec: 1,
    moving: false,
    resolver: 'coords' as const,
    cached_at: null,
  };
  const frames = {
    id: 'radec-1',
    frames: [
      {
        frame_id: 'f',
        time: '2026-01-01T00:00:00Z',
        wavelength_um: 1,
        x: 1,
        y: 1,
        cutout_url: '/c.png',
        flags: [],
      },
    ],
    north_up: false,
    stretch: { kind: 'asinh', params: {} },
    data_release: 'x',
    cached_at: null,
    missing: [],
  };
  const progress = {
    phase: 'fetching' as const,
    replies: 1,
    retry: null,
    error: null,
    pendingFrameId: null,
  };
  const loading: SkyState = { ...initialSkyState, status: 'ready', resolved, frames, progress };
  const done: SkyState = { ...loading, progress: null };

  it('fires when a progressive load finishes, once, for a spot not listed yet', () => {
    expect(framesJustCompleted(done, loading, new Set())).toBe(true);
    expect(framesJustCompleted(done, done, new Set())).toBe(false);
    expect(framesJustCompleted(done, loading, new Set(['radec-1']))).toBe(false);
  });

  it('fires for a list that loaded complete in one go, not for an empty one', () => {
    const before: SkyState = { ...initialSkyState, status: 'loading_frames', resolved };
    expect(framesJustCompleted(done, before, new Set())).toBe(true);
    const empty: SkyState = { ...done, frames: { ...frames, frames: [] } };
    expect(framesJustCompleted(empty, before, new Set())).toBe(false);
  });
});
