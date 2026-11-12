import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AreaRefused, setAreaApi } from '@/app/area/areaService';
import type { ApiClient } from '@/app/api/client';
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
  setAreaApi(null);
});

describe('area store', () => {
  it('startFlow goes to drawing for that flow', () => {
    useAreaStore.getState().startFlow('known');
    const s = useAreaStore.getState();
    expect(s.flow).toBe('known');
    expect(s.stage).toBe('drawing');
    expect(s.screen).toBe('draw');
    expect(s.box).toBeNull();
  });
  it('Known: setBox starts the island search, and an unprepared area ends in a refusal', async () => {
    // The index lists one prepared area, far from the drawn box.
    const entry = { area_id: 'far', ra: 200, dec: -30, width_deg: 1, height_deg: 1 };
    setAreaApi({
      areas: async () => ({ data: { areas: [entry] }, fixture: null }),
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
    areas: [{ area_id: 'a1', ra: 10.5, dec: 4.5, width_deg: 2, height_deg: 2 }],
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
    setAreaApi({
      areas: async () => ({ data: idx, fixture: null }),
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
    expect(s.known?.missing).toEqual(['skybot:2']);
    expect(s.refusal).toBeNull();
  });
  it('a newer square aborts the request of the older one', async () => {
    const signals: AbortSignal[] = [];
    setAreaApi({
      areas: async (sig?: AbortSignal) => {
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
    setAreaApi({
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
    setAreaApi({
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
  it('another object never borrows the Eros demo, and leaving the card aborts its request', async () => {
    const signals: AbortSignal[] = [];
    setAreaApi({
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
