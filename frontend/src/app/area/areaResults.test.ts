// Issue #145: the area results' pure parts and stores (Q-466, Q-469; held UI issues 1, 2 and 7).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { placeLabels, type LabelWanted } from '@/app/sky/area/drawLayer';
import { useAreaStore } from '@/app/shell/areaStore';
import { useShellStore } from '@/app/shell/shellStore';
import { planRender, defaultContext } from '@/viewer/renderPlan';
import { matchesKnown } from './areaService';
import { refusalText } from './areaBits';
import { placeholderBody } from './buildFrom';
import { mockLiveAreaApi, setLiveAreaApi } from './liveAreaApi';
import { resetLiveJobs, useLiveJobStore } from './liveJobStore';
import { matchName } from './realArea';
import { visitsLine } from './RealAreaNotes';
import {
  httpTrackJobApi,
  mockTrackJobApi,
  mockTrackStatusAt,
  setTrackJobApi,
  trackMockFromEnv,
} from './trackJobApi';
import {
  middleTime,
  resetTrackJobs,
  trackFailureText,
  trackSteps,
  useTrackJobStore,
  TRACK_MAX_IDLE,
  TRACK_POLL_MS,
} from './trackJobStore';

describe('names (held UI issue 1)', () => {
  it('never doubles the number: "433 Eros", not "433 433 Eros"', () => {
    expect(matchName({ designation: '433 Eros', number: 433 })).toBe('433 Eros');
    expect(matchName({ designation: 'Eros', number: 433 })).toBe('433 Eros');
    expect(matchName({ designation: '4330 Vivaldi', number: 433 })).toBe('433 4330 Vivaldi');
    expect(matchName({ designation: '2015 HW370', number: null })).toBe('2015 HW370');
  });
  it('a match is a known object by id, else number, else designation', () => {
    const k = { designation: '433 Eros', number: 433, object_id: 'sbdb-20000433' };
    expect(matchesKnown({ ...k, object_id: 'sbdb-20000433' }, k)).toBe(true);
    expect(matchesKnown({ ...k, object_id: 'sbdb-1' }, k)).toBe(false);
    expect(matchesKnown({ designation: 'x', number: 433, object_id: null }, k)).toBe(true);
    expect(
      matchesKnown(
        { designation: '433 Eros', number: null, object_id: null },
        { ...k, number: null },
      ),
    ).toBe(true);
  });
});

describe('sky labels never overlap (held UI issue 2)', () => {
  const safe = { x: 0, y: 0, w: 800, h: 600 };
  const at = (id: string, x: number, y: number, rank = 2): LabelWanted => ({
    id,
    x,
    y,
    w: 120,
    h: 14,
    rank,
  });
  const boxes = (ps: { x: number; y: number }[]) =>
    ps.map((p) => ({ x0: p.x, y0: p.y - 14, x1: p.x + 120, y1: p.y }));
  it('moves a label to a free spot, and drops one that fits nowhere', () => {
    const many = Array.from({ length: 12 }, (_, i) => at(`T${i + 1}`, 400 + i, 300 + i));
    const placed = placeLabels(many, safe);
    expect(placed.length).toBeGreaterThan(1);
    expect(placed.length).toBeLessThan(many.length);
    const b = boxes(placed);
    for (let i = 0; i < b.length; i++)
      for (let j = i + 1; j < b.length; j++) {
        const o =
          b[i]!.x0 < b[j]!.x1 && b[j]!.x0 < b[i]!.x1 && b[i]!.y0 < b[j]!.y1 && b[j]!.y0 < b[i]!.y1;
        expect(o).toBe(false);
      }
  });
  it('the selected track (rank 0) is always labelled, and wins its spot', () => {
    const many = [
      ...Array.from({ length: 8 }, (_, i) => at(`T${i + 1}`, 400, 300)),
      at('T9', 400, 300, 0),
    ];
    const placed = placeLabels(many, safe);
    expect(placed[0]!.id).toBe('T9');
  });
  it('far-apart labels all show, at their first spot', () => {
    const placed = placeLabels([at('A', 100, 100), at('B', 500, 400)], safe);
    expect(placed).toEqual([
      { id: 'A', x: 108, y: 92 },
      { id: 'B', x: 508, y: 392 },
    ]);
  });
});

describe('provenance lines and messages', () => {
  it('two visits on one day, then the frames', () => {
    const frames = [
      { visit: 1, time: '2026-06-27T04:48:10Z' },
      { visit: 1, time: '2026-06-27T04:50:00Z' },
      { visit: 2, time: '2026-06-27T06:29:00Z' },
    ] as never;
    expect(visitsLine({ frames, n_frames: 14 })).toBe(
      'Visits 27 Jun 2026, 04:48 and 06:29 UTC · 14 frames',
    );
  });
  it('"No prepared data" gives a way forward (held UI issue 6)', () => {
    const t = refusalText({
      code: 'area:not_prepared',
      message: 'No prepared data for this area yet.',
    });
    expect(t.title).toBe('No data for this area here');
    expect(t.line).toMatch(/Choose a region/);
  });
});

describe('Build it placeholder (Q-469)', () => {
  it('is deterministic and gives a plain unit sphere tagged artistic, size not drawn', () => {
    const a = placeholderBody('live-abc', { track_id: 'T7' }, 'T7 · unexplained track');
    const b = placeholderBody('live-abc', { track_id: 'T7' }, 'T7 · unexplained track');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(placeholderBody('live-abc', { track_id: 'T8' }, 'x').params.seed).not.toBe(
      a.params.seed,
    );
    expect(a.card).toEqual({
      id: 'area:live-abc:T7',
      name: 'T7 · unexplained track',
      type: 'asteroid_procedural',
    });
    const plan = planRender(a.card, a.params, defaultContext({ honesty: 'artistic' }));
    expect(plan.threeD).toBe(true);
    expect(plan.bodies).toHaveLength(1);
    expect(plan.drawn.map((d) => d.id)).toContain('placeholder_shape');
    expect(plan.missing.map((m) => m.id)).toContain('size');
  });
  it('is hidden at "Measured only", like any artistic layer', () => {
    const { card, params } = placeholderBody('live-abc', { track_id: 'T7' }, 'T7');
    const plan = planRender(card, params, defaultContext({ honesty: 'measured' }));
    expect(plan.bodies).toHaveLength(0);
  });
});

describe('Track on demand (Q-468)', () => {
  it('steps from the job stage, with a count and a bar on the frame search', () => {
    expect(trackSteps(null).map((s) => s.state)).toEqual(['todo', 'todo', 'todo', 'todo']);
    const f = trackSteps(mockTrackStatusAt('x', 0.45, 18));
    expect(f.map((s) => s.state)).toEqual(['done', 'running', 'todo', 'todo']);
    expect(f[1]!.count).toBe('9 of 18');
    expect(f[1]!.bar).toBeCloseTo(0.5);
    expect(trackSteps(mockTrackStatusAt('x', 0.9, 18))[1]!.count).toBe('18 frames');
    expect(
      trackSteps({ id: 'x', state: 'done', stage: 'done' }).every((s) => s.state === 'done'),
    ).toBe(true);
  });
  it('middleTime is the middle of the times, to the second', () => {
    expect(middleTime(['2026-06-27T04:48:00Z', '2026-06-27T06:30:00Z'])).toBe(
      '2026-06-27T05:39:00Z',
    );
    expect(middleTime([])).toBeNull();
  });
  it('failures say what happened in a title and one line', () => {
    expect(trackFailureText('track_window_outside').retry).toBe(false);
    expect(trackFailureText('track:failed').retry).toBe(true);
  });
  it('the mock answers only when asked', () => {
    expect(trackMockFromEnv('', undefined)).toBeNull();
    expect(trackMockFromEnv('?track=mock', undefined)).not.toBeNull();
  });
  it('POSTs {around, days} and reads the job; a backend without the route is "unavailable"', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    const api = httpTrackJobApi('/v1', async (url, init) => {
      calls.push([String(url), init]);
      if (String(url).endsWith('/track'))
        return reply(202, { id: 'sbdb-1', state: 'running', stage: 'queued' });
      return reply(200, { id: 'sbdb-1', state: 'done', stage: 'done' });
    });
    expect(await api.start('sbdb-1', '2026-06-27T05:39:00Z', 3)).toMatchObject({ kind: 'started' });
    expect(calls[0]![0]).toBe('/v1/objects/sbdb-1/track');
    expect(JSON.parse(String(calls[0]![1]!.body))).toEqual({
      around: '2026-06-27T05:39:00Z',
      days: 3,
    });
    // The job is the window's (Q-468): without the window the backend answers for the base job.
    expect((await api.status('sbdb-1', { around: '2026-06-27T05:39:00Z', days: 3 })).state).toBe(
      'done',
    );
    expect(calls[1]![0]).toBe('/v1/objects/sbdb-1/job?around=2026-06-27T05%3A39%3A00Z&days=3');
    const none = httpTrackJobApi('/v1', async () => reply(405, { detail: 'Method Not Allowed' }));
    expect(await none.start('sbdb-1', 'x')).toEqual({ kind: 'unavailable' });
    const outside = httpTrackJobApi('/v1', async () =>
      reply(400, { error: 'track_window_outside', detail: 'no' }),
    );
    expect(await outside.start('sbdb-1', 'x')).toMatchObject({
      kind: 'error',
      code: 'track_window_outside',
    });
  });

  describe('the job flow', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      useShellStore.setState({ tool: 'area' });
    });
    afterEach(() => {
      resetTrackJobs();
      setTrackJobApi(null);
      useAreaStore.getState().reset();
      useShellStore.setState({ tool: 'sky' });
      vi.useRealTimers();
    });
    const obj = {
      id: '9532',
      name: 'Abramenko',
      kind: 'asteroid',
      frames: 14,
      visits: 2,
      designation: '9532 Abramenko',
      objectId: 'sbdb-9532',
      trackAvailable: false,
    };
    it('Track it shows the job, then opens the Track view and marks the row Track-available', async () => {
      let t = 0;
      setTrackJobApi(mockTrackJobApi('ok', { durationMs: 4000, now: () => t }));
      const openEros = vi.fn();
      useAreaStore.setState({
        flow: 'known',
        screen: 'list',
        known: { demo: false, real: null, objects: [obj] },
        openEros,
      });
      useAreaStore.getState().openTrack(obj, '2026-06-27T05:39:00Z', 'spherex_dr1');
      expect(useAreaStore.getState().screen).toBe('track');
      await vi.advanceTimersByTimeAsync(0);
      expect(useTrackJobStore.getState().view?.status?.state).toBe('running');
      t = 5000;
      await vi.advanceTimersByTimeAsync(TRACK_POLL_MS + 10);
      expect(useTrackJobStore.getState().view).toBeNull();
      // The Track view reads the window the job computed, not the object's base windows.
      const window = { around: '2026-06-27T05:39:00Z', days: 3 };
      expect(openEros).toHaveBeenCalledWith({ ...obj, trackAvailable: true, trackWindow: window });
      expect(useAreaStore.getState().known?.objects[0]).toMatchObject({
        trackAvailable: true,
        trackWindow: window,
      });
    });
    it('polls the job of its window', async () => {
      const asked: unknown[] = [];
      const api = mockTrackJobApi('ok', { durationMs: 4000, now: () => 0 });
      setTrackJobApi({ ...api, status: async (id, w) => (asked.push(w), api.status(id, w)) });
      useAreaStore.setState({ flow: 'known', screen: 'list', openEros: vi.fn() });
      useAreaStore.getState().openTrack(obj, '2026-06-27T05:39:00Z', 'spherex_dr1');
      await vi.advanceTimersByTimeAsync(TRACK_POLL_MS + 10);
      expect(asked[0]).toEqual({ around: '2026-06-27T05:39:00Z', days: 3 });
    });
    it('a job that ends without a Track says so, and nothing opens', async () => {
      const api = mockTrackJobApi('ok');
      setTrackJobApi({
        ...api,
        status: async (id) => ({
          id,
          state: 'done',
          stage: 'done',
          track_available: false,
          reason: 'frames:empty',
        }),
      });
      const openEros = vi.fn();
      useAreaStore.setState({ flow: 'known', screen: 'list', openEros });
      useAreaStore.getState().openTrack(obj, '2026-06-27T05:39:00Z', 'spherex_dr1');
      await vi.advanceTimersByTimeAsync(TRACK_POLL_MS + 10);
      expect(useTrackJobStore.getState().view?.failed?.code).toBe('track:not_available');
      expect(trackFailureText('track:not_available').retry).toBe(false);
      expect(openEros).not.toHaveBeenCalled();
    });
    it('a job the server no longer has is given up, not polled for good', async () => {
      const api = mockTrackJobApi('ok');
      setTrackJobApi({ ...api, status: async (id) => ({ id, state: 'idle' }) });
      useAreaStore.setState({ flow: 'known', screen: 'list', openEros: vi.fn() });
      useAreaStore.getState().openTrack(obj, '2026-06-27T05:39:00Z', 'spherex_dr1');
      await vi.advanceTimersByTimeAsync(TRACK_MAX_IDLE * TRACK_POLL_MS + 100);
      expect(useTrackJobStore.getState().view?.failed?.code).toBe('track:lost');
      expect(trackFailureText('track:lost').retry).toBe(true);
    });
    it('a refusal shows a message, nothing opens', async () => {
      setTrackJobApi(mockTrackJobApi('outside'));
      const openEros = vi.fn();
      useAreaStore.setState({ flow: 'known', screen: 'list', openEros });
      useAreaStore.getState().openTrack(obj, '2026-06-27T05:39:00Z', 'spherex_dr1');
      await vi.advanceTimersByTimeAsync(0);
      expect(useTrackJobStore.getState().view?.failed?.code).toBe('track_window_outside');
      expect(openEros).not.toHaveBeenCalled();
    });
  });
});

describe('visit pair picker (issue #145, #141 optional pair)', () => {
  afterEach(() => {
    resetLiveJobs();
    setLiveAreaApi(null);
  });
  it('another pair asks the coverage check again with it, and Compute starts that pair', async () => {
    const api = mockLiveAreaApi('ok');
    const plan = vi.spyOn(api, 'plan');
    const start = vi.spyOn(api, 'start');
    setLiveAreaApi(api);
    const box = { a: { ra: 10, dec: 0 }, b: { ra: 11, dec: 1 }, widthDeg: 1, heightDeg: 1 };
    const first = await api.plan({ ra: 10.5, dec: 0.5, width_deg: 1, height_deg: 1 });
    if (first.kind !== 'plan') throw new Error('no plan');
    useLiveJobStore.getState().showPlan(box, 'discovery', first);
    const alt = first.plan.alternatives[0]!.visits;
    await useLiveJobStore.getState().choosePair([alt[0].start, alt[1].start]);
    expect(plan.mock.calls.at(-1)![2]).toEqual([alt[0].start, alt[1].start]);
    const v = useLiveJobStore.getState().view;
    expect(v?.kind === 'offer' && v.plan.visits[0].start).toBe(alt[0].start);
    await useLiveJobStore.getState().compute();
    expect(start.mock.calls.at(-1)![2]).toEqual([alt[0].start, alt[1].start]);
  });
});
