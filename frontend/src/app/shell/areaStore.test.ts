import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AreaRefused } from '@/app/area/areaService';
import { createApiClient, type ApiClient } from '@/app/api/client';
import { setSkyApi } from '@/state/store';
import { ApiError } from '@/app/api/errors';
import { erosList, formatAreaDims, formatAreaSize, refusalOf, useAreaStore, type AreaBox } from './areaStore';

const box: AreaBox = { a: { ra: 10, dec: 5 }, b: { ra: 11, dec: 4 }, widthDeg: 1, heightDeg: 1 };

beforeEach(() => {
  vi.useFakeTimers();
  useAreaStore.getState().reset();
});
afterEach(() => {
  useAreaStore.getState().reset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setSkyApi(createApiClient());
});

describe('area store', () => {
  it('startFlow aims for that flow, and picking the patch goes to drawing (issue #144)', () => {
    useAreaStore.getState().startFlow('known');
    const s = useAreaStore.getState();
    expect(s.flow).toBe('known');
    expect(s.stage).toBe('aiming');
    useAreaStore.getState().pickPatch();
    expect(useAreaStore.getState().stage).toBe('drawing');
    expect(s.screen).toBe('draw');
    expect(s.box).toBeNull();
  });
  it('Known: setBox starts the island search, and an unprepared area ends in a refusal', async () => {
    // The index lists one prepared area, far from the drawn box.
    const entry = { area_id: 'far', ra: 200, dec: -30, width_deg: 1, height_deg: 1, data_release: 'qr2' };
    setSkyApi({
      areaIndex: async () => ({ data: { areas: [entry] }, fixture: null }),
    } as unknown as ApiClient);
    useAreaStore.getState().startFlow('known');
    useAreaStore.getState().setBox(box);
    expect(useAreaStore.getState().screen).toBe('search');
    expect(useAreaStore.getState().say?.kind).toBe('searching');
    await vi.advanceTimersByTimeAsync(2000);
    expect(useAreaStore.getState().say?.text).toBe('No prepared data for this area yet.');
    await vi.advanceTimersByTimeAsync(1100);
    const s = useAreaStore.getState();
    expect(s.screen).toBe('list');
    expect(s.known).toBeNull();
    expect(s.refusal?.code).toBe('area:not_prepared');
  });
  it('redraw and reset clear the box and the refusal but keep the last area', () => {
    useAreaStore.setState({ refusal: { code: 'area:not_prepared', message: 'x' } });
    useAreaStore.getState().startFlow('discovery');
    useAreaStore.getState().setBox(box);
    useAreaStore.getState().redraw();
    const s = useAreaStore.getState();
    expect(s.box).toBeNull();
    expect(s.refusal).toBeNull();
    expect(s.last).toEqual(box);
  });
  it('setMinimised and toggleOv flip their flags', () => {
    useAreaStore.getState().setMinimised(true);
    expect(useAreaStore.getState().minimised).toBe(true);
    const before = useAreaStore.getState().ov.flags;
    useAreaStore.getState().toggleOv('flags');
    expect(useAreaStore.getState().ov.flags).toBe(!before);
  });
  it('setIndex ignores an empty exposure list', () => {
    useAreaStore.getState().setIndex(3);
    expect(useAreaStore.getState().index).toBe(0);
    expect(erosList(null, null)).toEqual([]);
  });
});

describe('Known flow on the API (issue #130)', () => {
  const idx = {
    areas: [{ area_id: 'a1', ra: 10.5, dec: 4.5, width_deg: 2, height_deg: 2, data_release: 'qr2' }],
  };
  const known = {
    known: [
      {
        designation: '433 Eros', number: 433, object_id: 'sbdb-20000433', kind: 'asteroid', v_mag: 11.5,
        n_frames: 18, n_visits: 2, positions: [], track_available: false,
      },
    ],
    skybot: [{ visit: 1, fetched_at: '2026-11-12T08:59:01.899Z' }],
    missing: ['skybot:2'],
    provenance: {},
  };
  it('lists the object from /known and says so on the island', async () => {
    setSkyApi({
      areaIndex: async () => ({ data: idx, fixture: null }),
      areaKnown: async () => ({ data: known, fixture: null }),
    } as unknown as ApiClient);
    useAreaStore.getState().startFlow('known');
    useAreaStore.getState().setBox(box);
    await vi.advanceTimersByTimeAsync(2000);
    expect(useAreaStore.getState().say?.text).toBe('1 known object: 433 Eros');
    await vi.advanceTimersByTimeAsync(1100);
    const s = useAreaStore.getState();
    expect(s.screen).toBe('list');
    expect(s.known?.demo).toBe(false);
    // The stub serves no summary or tracks: those are named as missing too (issue #145).
    expect(s.known?.real?.missing).toEqual(['skybot:2', 'area:summary_unavailable', 'area:detections_unavailable']);
    expect(s.refusal).toBeNull();
  });
  it('a newer square aborts the request of the older one', async () => {
    const signals: AbortSignal[] = [];
    setSkyApi({
      areaIndex: async (sig?: AbortSignal) => {
        signals.push(sig!);
        return { data: idx, fixture: null };
      },
      areaKnown: async () => ({ data: known, fixture: null }),
    } as unknown as ApiClient);
    useAreaStore.getState().startFlow('known');
    useAreaStore.getState().setBox(box);
    useAreaStore.getState().setBox({ ...box, widthDeg: 0.9 });
    expect(signals).toHaveLength(2);
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
    useAreaStore.getState().reset();
    expect(signals[1]!.aborted).toBe(true);
  });
  it('Track it reads /frames and /path of the object; the frame list is the backend\'s', async () => {
    const frame = (id: string, m: number) => ({
      frame_id: id, time: `2026-03-20T08:${m}:00.000Z`, wavelength_um: 1, x: 1, y: 1, cutout_url: '', flags: [],
    });
    setSkyApi({
      frames: async () => ({ data: { frames: [frame('2026W12_2A_0158_1_D1', 30), frame('2026W12_2A_0158_1_D4', 30), frame('2026W12_2A_0158_2_D1', 31)] }, fixture: null }),
      path: async () => { throw new ApiError('not_found', null, 404); },
    } as unknown as ApiClient);
    const obj = { id: '433', name: 'Eros', kind: 'asteroid', frames: 3, visits: 1, objectId: 'sbdb-20000433', trackAvailable: true };
    useAreaStore.getState().openEros(obj);
    await vi.advanceTimersByTimeAsync(50);
    const s = useAreaStore.getState();
    expect(s.screen).toBe('eros');
    expect(s.focus).toBe(obj);
    expect(s.trackSource).toBe('real');
    expect(s.trackPath).toBe(false); // /path failed: no sky path, the card still shows
    expect(erosList(s.eros, null)).toHaveLength(3);
  });
  it('never blank: 433 Eros falls back to the demo when the API fails, another object says it failed', async () => {
    setSkyApi({
      frames: async () => { throw new ApiError('network', 'down'); },
      path: async () => { throw new ApiError('network', 'down'); },
    } as unknown as ApiClient);
    const eros = { id: '433', name: 'Eros', kind: 'asteroid', frames: 16, visits: 2, objectId: 'sbdb-20000433', trackAvailable: true };
    useAreaStore.getState().openEros(eros);
    await vi.advanceTimersByTimeAsync(50);
    expect(useAreaStore.getState().trackSource).toBe('demo');
    useAreaStore.getState().openEros({ ...eros, id: '9', objectId: 'sbdb-9' });
    await vi.advanceTimersByTimeAsync(50);
    const s = useAreaStore.getState();
    expect(s.erosFailed).toBe(true);
    expect(s.eros).toBeNull();
  });
  it('the fallback row of an unreachable backend (no id) opens the demo Eros, not a failed card', async () => {
    const hop = { frame_id: 'd_1_D1', exposure: 1, detector: 'D1', mjd_avg: 61119.36, flux: 1, stars: [], seg: [] };
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ object: { name: 'Eros' }, wide: { png: '', w: 10, h: 10 }, track: [], hops: [hop] }),
    }));
    useAreaStore.getState().openEros({ id: '433', name: 'Eros', kind: 'asteroid', frames: 16, visits: 2, trackAvailable: true });
    await vi.advanceTimersByTimeAsync(50);
    const s = useAreaStore.getState();
    expect(s.erosFailed).toBe(false);
    expect(s.trackSource).toBe('demo');
    expect(erosList(s.eros, null)).toHaveLength(1);
  });
  it('a /path reply with no points is no path: the card does not claim one', async () => {
    setSkyApi({
      frames: async () => ({
        data: { frames: [{ frame_id: 'x_1_D1', time: '2026-03-20T08:30:00.000Z', wavelength_um: 1, x: 1, y: 1, cutout_url: '', flags: [] }] },
        fixture: null,
      }),
      path: async () => ({ data: { points: [], frame_points: [], missing: ['path:not_cached'] }, fixture: null }),
    } as unknown as ApiClient);
    useAreaStore.getState().openEros({ id: '9', name: 'Other', kind: 'asteroid', frames: 1, visits: 1, objectId: 'sbdb-9', trackAvailable: true });
    await vi.advanceTimersByTimeAsync(50);
    expect(useAreaStore.getState().trackSource).toBe('real');
    expect(useAreaStore.getState().trackPath).toBe(false);
  });
  it('a /path that is not ready yet (path:deferred) says so instead of "no path"', async () => {
    setSkyApi({
      frames: async () => ({
        data: { frames: [{ frame_id: 'x_1_D1', time: '2026-03-20T08:30:00.000Z', wavelength_um: 1, x: 1, y: 1, cutout_url: '', flags: [] }] },
        fixture: null,
      }),
      path: async () => ({ data: { points: [], frame_points: [], windows: [], missing: ['path:deferred'] }, fixture: null }),
    } as unknown as ApiClient);
    useAreaStore.getState().openEros({ id: '9', name: 'Other', kind: 'asteroid', frames: 1, visits: 1, objectId: 'sbdb-9', trackAvailable: true });
    await vi.advanceTimersByTimeAsync(50);
    expect(useAreaStore.getState().trackPath).toBe(false);
    expect(useAreaStore.getState().pathPending).toBe(true);
  });
  it('never blank: the demo Eros shows the demo frames at once, then the real frames replace them', async () => {
    const hop = { frame_id: 'd_1_D1', exposure: 1, detector: 'D1', mjd_avg: 61119.36, flux: 1, stars: [], seg: [] };
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ object: { name: 'Eros' }, wide: { png: '', w: 10, h: 10 }, track: [], hops: [hop] }),
    }));
    let answer!: (v: unknown) => void;
    const frames = new Promise((r) => { answer = r; });
    setSkyApi({
      frames: async () => frames,
      path: async () => { throw new ApiError('not_found', null, 404); },
    } as unknown as ApiClient);
    // The committed pack says track_available: false for Eros (backend #129 pending).
    useAreaStore.getState().openEros({ id: '433', name: 'Eros', kind: 'asteroid', frames: 3, visits: 1, objectId: 'sbdb-20000433', trackAvailable: false });
    await vi.advanceTimersByTimeAsync(50);
    let s = useAreaStore.getState();
    expect(s.eros).not.toBeNull(); // not "Loading the frames…" while /frames is slow
    expect(s.trackSource).toBe('demo');
    expect(s.erosFailed).toBe(false);
    const f = (id: string) => ({ frame_id: id, time: '2026-03-20T08:30:00.000Z', wavelength_um: 1, x: 1, y: 1, cutout_url: '', flags: [] });
    answer({ data: { frames: [f('r_1_D1'), f('r_1_D2'), f('r_2_D1')] }, fixture: null });
    await vi.advanceTimersByTimeAsync(50);
    s = useAreaStore.getState();
    expect(s.trackSource).toBe('real');
    expect(erosList(s.eros, null)).toHaveLength(3);
  });
  it('a late real answer for an Eros card that was left does not overwrite the new card', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ object: { name: 'Eros' }, wide: { png: '', w: 10, h: 10 }, track: [], hops: [] }),
    }));
    let answer!: (v: unknown) => void;
    const slow = new Promise((r) => { answer = r; });
    setSkyApi({
      frames: async (id: string) =>
        id === 'sbdb-20000433'
          ? slow
          : { data: { frames: [{ frame_id: 'x_1_D1', time: '2026-03-20T08:30:00.000Z', wavelength_um: 1, x: 1, y: 1, cutout_url: '', flags: [] }] }, fixture: null },
      path: async () => { throw new ApiError('not_found', null, 404); },
    } as unknown as ApiClient);
    useAreaStore.getState().openEros({ id: '433', name: 'Eros', kind: 'asteroid', frames: 3, visits: 1, objectId: 'sbdb-20000433' });
    await vi.advanceTimersByTimeAsync(10);
    useAreaStore.getState().openEros({ id: '9', name: 'Other', kind: 'asteroid', frames: 1, visits: 1, objectId: 'sbdb-9', trackAvailable: true });
    await vi.advanceTimersByTimeAsync(50);
    answer({ data: { frames: [] }, fixture: null });
    await vi.advanceTimersByTimeAsync(50);
    const s = useAreaStore.getState();
    expect(s.focus?.objectId).toBe('sbdb-9');
    expect(s.trackSource).toBe('real');
    expect(erosList(s.eros, null)).toHaveLength(1);
  });
  it('another object never borrows the Eros demo, and leaving the card aborts its request', async () => {
    const signals: AbortSignal[] = [];
    setSkyApi({
      frames: async (_id: string, sig?: AbortSignal) => {
        signals.push(sig!);
        return { data: { frames: [{ frame_id: 'x_1_D1', time: '2026-03-20T08:30:00.000Z', wavelength_um: 1, x: 1, y: 1, cutout_url: '', flags: [] }] }, fixture: null };
      },
      path: async () => { throw new ApiError('not_found', null, 404); },
    } as unknown as ApiClient);
    useAreaStore.getState().openEros({ id: '9', name: 'Other', kind: 'asteroid', frames: 1, visits: 1, objectId: 'sbdb-9', trackAvailable: true });
    await vi.advanceTimersByTimeAsync(50);
    const e = useAreaStore.getState().eros!;
    expect(e.wide.png).toBe('');
    expect(e.track).toEqual([]);
    useAreaStore.getState().openEros({ id: '9', name: 'Other', kind: 'asteroid', frames: 1, visits: 1, objectId: 'sbdb-9', trackAvailable: true });
    await vi.advanceTimersByTimeAsync(50);
    useAreaStore.getState().openList();
    expect(signals[signals.length - 1]!.aborted).toBe(true);
  });
});

describe('area helpers', () => {
  it('maps a refusal and any other error', () => {
    expect(refusalOf(new AreaRefused()).code).toBe('area:not_prepared');
    expect(refusalOf(new Error('x')).code).toBe('area:failed');
  });
  it('formats sizes', () => {
    expect(formatAreaSize(3.21)).toBe('3.2°');
    expect(formatAreaSize(0.5)).toBe('30′');
    expect(formatAreaDims({ widthDeg: 1.27, heightDeg: 0.77 })).toBe('1.27° × 0.77°');
  });
});
