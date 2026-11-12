// Q-414: Discovery's demo answers only inside the prepared Eros area and refuses elsewhere; Known
// objects (issue #130, Q-455) pick the prepared area from /v1/areas and read /known.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AreaBox } from '@/app/shell/areaStore';
import type { ApiClient } from '@/app/api/client';
import { ApiError } from '@/app/api/errors';
import { parseAreaIndex, parseAreaKnown, parseFrames, parseTrackPath } from '@/app/api/validate';
import {
  areaSearch,
  boxOverlapsEros,
  discoverIn,
  erosArea,
  knownObjectsIn,
  mapKnown,
  mergeReal,
  pickArea,
  setAreaApi,
  skyToPx,
  splitDesignation,
  type ErosDemo,
} from './areaService';

const shared = (rel: string): unknown =>
  JSON.parse(readFileSync(`${process.cwd()}/../shared/fixtures/${rel}`, 'utf8'));
const INDEX = parseAreaIndex(shared('area/index.json'));
const KNOWN = parseAreaKnown(shared('area/known.json'));
const erosJson = JSON.parse(
  readFileSync(`${process.cwd()}/public/demo/eros/eros.json`, 'utf8'),
) as ErosDemo;

/** A stub API: only the two area routes; `calls` records the paths and signals. */
function stubApi(over: Partial<ApiClient> = {}): { api: ApiClient; signals: (AbortSignal | undefined)[] } {
  const signals: (AbortSignal | undefined)[] = [];
  const api = {
    areas: async (signal?: AbortSignal) => (signals.push(signal), { data: INDEX, fixture: 'synthetic' as const }),
    areaKnown: async (_id: string, signal?: AbortSignal) => (signals.push(signal), { data: KNOWN, fixture: 'synthetic' as const }),
    ...over,
  } as unknown as ApiClient;
  return { api, signals };
}

// The prepared area of public/demo/eros/eros.json: centre RA 91.118, Dec 13.453, 1280 x 720 px at 0.0015625 deg/px.
const DEMO = {
  object: { name: '433 Eros' },
  wide: { png: '', w: 1280, h: 720, center: [91.118, 13.453], deg_per_px: 0.0015625 },
  track: [],
  hops: [],
} as unknown as ErosDemo;

const box = (ra: number, dec: number, w = 0.6, h = 0.4): AreaBox => ({
  a: { ra: ra - w / 2, dec: dec + h / 2 },
  b: { ra: ra + w / 2, dec: dec - h / 2 },
  widthDeg: w,
  heightDeg: h,
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => structuredClone(DEMO) })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAreaApi(null);
});

describe('prepared Eros area', () => {
  it('is 2 by 1.125 degrees around the image centre', () => {
    const e = erosArea(DEMO)!;
    expect(e.halfW).toBeCloseTo(1.0, 6);
    expect(e.halfH).toBeCloseTo(0.5625, 6);
  });
  it('overlaps a box inside, partly over the edge, and not one far away', () => {
    expect(boxOverlapsEros(box(91.118, 13.453), DEMO)).toBe(true);
    expect(boxOverlapsEros(box(92.2, 13.453), DEMO)).toBe(true);
    expect(boxOverlapsEros(box(200, -30), DEMO)).toBe(false);
    expect(boxOverlapsEros(box(91.118, 20), DEMO)).toBe(false);
  });
  it('has no area when the file lacks the centre', () => {
    const bare = { ...DEMO, wide: { png: '', w: 10, h: 10 } } as ErosDemo;
    expect(erosArea(bare)).toBeNull();
    expect(boxOverlapsEros(box(91.118, 13.453), bare)).toBe(false);
  });
  it('handles a box across RA 0 / 360', () => {
    expect(boxOverlapsEros(box(359.9, 0.1, 0.4, 0.4), DEMO)).toBe(false);
  });
});

describe('Known objects on /v1/areas (issue #130)', () => {
  it('picks the prepared area the box overlaps, the nearest one when several do', () => {
    expect(pickArea(box(150, 10), INDEX.areas)?.area_id).toBe('fixture:area-main');
    expect(pickArea(box(210, -20), INDEX.areas)?.area_id).toBe('fixture:area-multivisit');
    expect(pickArea(box(10, 60), INDEX.areas)).toBeNull();
    expect(pickArea(box(150, 10), [])).toBeNull();
    const wide = { ...INDEX.areas[0]!, area_id: 'wide', ra: 150.4, width_deg: 3, height_deg: 3 };
    expect(pickArea(box(150, 10), [wide, INDEX.areas[0]!])?.area_id).toBe('fixture:area-main');
  });
  it('splits a designation into number and name', () => {
    expect(splitDesignation('433 Eros', 433)).toEqual({ id: '433', name: 'Eros' });
    expect(splitDesignation('C/2026 A1', null)).toEqual({ id: 'C/2026 A1', name: '' });
    expect(splitDesignation('Synthetic fixture A1', null).id).toBe('Synthetic fixture A1');
  });
  it('maps /known to rows: counts, Track it vs Open, SkyBoT date, positions', () => {
    const r = mapKnown('fixture:area-main', KNOWN, true);
    expect(r.demo).toBe(false);
    expect(r.objects).toHaveLength(KNOWN.known.length);
    const [a, b] = r.objects;
    expect(a!.frames).toBe(KNOWN.known[0]!.n_frames);
    expect(a!.visits).toBe(KNOWN.known[0]!.n_visits);
    expect(a!.trackAvailable).toBe(true);
    expect(a!.objectId).toBe('synthetic-mover');
    expect(a!.positions!.length).toBe(KNOWN.known[0]!.positions.length);
    expect(b!.trackAvailable).toBe(false);
    expect(b!.objectId).toBeNull();
    expect(a!.skybotAt).toBe(KNOWN.skybot.map((s) => s.fetched_at).filter(Boolean).sort().at(-1));
    expect(r.fixture).toBe(true);
  });
  it('knownObjectsIn: area from the index, then /known; passes the abort signal', async () => {
    const { api, signals } = stubApi();
    setAreaApi(api);
    const ctl = new AbortController();
    const r = await knownObjectsIn(box(150, 10), ctl.signal);
    expect(r.areaId).toBe('fixture:area-main');
    expect(r.demo).toBe(false);
    expect(signals).toEqual([ctl.signal, ctl.signal]);
  });
  it('a square elsewhere is refused with area:not_prepared and /known is not asked', async () => {
    const known = vi.fn();
    setAreaApi(stubApi({ areaKnown: known }).api);
    await expect(knownObjectsIn(box(10, 60))).rejects.toMatchObject({ code: 'area:not_prepared' });
    expect(known).not.toHaveBeenCalled();
  });
  it('an unknown area id (area_not_found) is a refusal', async () => {
    setAreaApi(
      stubApi({
        areaKnown: async () => {
          throw new ApiError('not_found', 'No such area.', 404, 'area_not_found');
        },
      }).api,
    );
    await expect(knownObjectsIn(box(150, 10))).rejects.toMatchObject({ code: 'area_not_found' });
  });
  it('keeps the skybot and horizons codes of `missing`', async () => {
    const withMissing = { ...KNOWN, missing: ['skybot:2', 'horizons:433 Eros'] };
    setAreaApi(stubApi({ areaKnown: async () => ({ data: withMissing, fixture: null }) }).api);
    const r = await knownObjectsIn(box(150, 10));
    expect(r.missing).toEqual(['skybot:2', 'horizons:433 Eros']);
    expect(r.fixture).toBe(true); // the index reply was a fixture
  });
  it('with the backend down, a box over Eros gets the demo row (flagged), elsewhere the error stands', async () => {
    const down = stubApi({
      areas: async () => {
        throw new ApiError('network', 'down');
      },
    }).api;
    setAreaApi(down);
    const r = await knownObjectsIn(box(91.118, 13.453));
    expect(r.demo).toBe(true);
    expect(r.objects.map((o) => o.id)).toEqual(['433']);
    await expect(knownObjectsIn(box(200, -30))).rejects.toMatchObject({ kind: 'network' });
  });
  it('an aborted request is not turned into the demo answer', async () => {
    setAreaApi(
      stubApi({
        areas: async () => {
          throw new ApiError('aborted', 'Replaced by a newer request.');
        },
      }).api,
    );
    await expect(knownObjectsIn(box(91.118, 13.453))).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe('Eros card on real frames and path (issue #130)', () => {
  const frames = (ids: string[]) =>
    parseFrames({
      id: 'sbdb-20000433',
      frames: ids.map((id, i) => ({
        frame_id: id,
        time: `2026-03-20T08:${String(30 + i).padStart(2, '0')}:00.000Z`,
        wavelength_um: 1 + i * 0.1,
        x: 1,
        y: 1,
        cutout_url: `/c/${id}.png`,
        flags: [],
      })),
      north_up: true,
      stretch: { kind: 'asinh', params: {} },
      data_release: 'spherex_qr2',
      cached_at: null,
      missing: [],
    }).frames;
  it('projects the sky onto the demo image within a pixel of the demo track', () => {
    for (const p of erosJson.track) {
      const px = skyToPx(erosJson, (p as unknown as { ra: number }).ra, (p as unknown as { dec: number }).dec)!;
      expect(Math.abs(px[0] - p.px[0])).toBeLessThan(1);
      expect(Math.abs(px[1] - p.px[1])).toBeLessThan(1);
    }
  });
  it('lists all 18 real frames (the demo has 16); the two extra have no cutout', () => {
    const demoIds = erosJson.hops.map((h) => h.frame_id);
    const ids = [...demoIds, '2026W12_2A_0158_5_D1', '2026W12_2A_0158_5_D4'];
    const merged = mergeReal(erosJson, frames(ids), null);
    expect(merged.hops).toHaveLength(18);
    expect(merged.hops.filter((h) => h.no_cutout).map((h) => h.frame_id).sort()).toEqual([
      '2026W12_2A_0158_5_D1',
      '2026W12_2A_0158_5_D4',
    ]);
    const extra = merged.hops.find((h) => h.frame_id === '2026W12_2A_0158_5_D4')!;
    expect(extra.detector).toBe('D4');
    expect(Number.isNaN(extra.flux)).toBe(true);
    // A frame the demo has keeps its demo cutout.
    expect(merged.hops.find((h) => h.frame_id === demoIds[0])!.png).toBe(erosJson.hops.find((h) => h.frame_id === demoIds[0])!.png);
  });
  it('the sky path is the real Horizons path, projected', () => {
    const path = parseTrackPath(shared('track/eros-2026-03/path.json'));
    const merged = mergeReal(erosJson, frames(['2026W12_2A_0158_1_D1']), path);
    expect(merged.track).toHaveLength(path.points.length);
    expect(merged.track[0]!.t).toBe(path.points[0]!.time);
  });
  it('without the demo file (null) the real frames still list', () => {
    const merged = mergeReal(null, frames(['2026W12_2A_0158_1_D1']), null);
    expect(merged.hops).toHaveLength(1);
    expect(merged.track).toEqual([]);
  });
});

describe('area service', () => {
  it('Discovery answers inside the area with demo-labelled counts', async () => {
    const r = await discoverIn(box(91.118, 13.453));
    expect(r.demo).toBe(true);
    expect(r.steps.length).toBeGreaterThan(0);
    for (const s of r.steps) expect(s.result).toContain('(demo)');
  });
  it('Discovery refuses elsewhere with area:not_prepared', async () => {
    const far = box(200, -30);
    await expect(discoverIn(far)).rejects.toMatchObject({ code: 'area:not_prepared', message: 'No prepared data for this area yet.' });
    setAreaApi(stubApi().api);
    await expect(areaSearch(far, 'known')).rejects.toMatchObject({ code: 'area:not_prepared' });
  });
});
