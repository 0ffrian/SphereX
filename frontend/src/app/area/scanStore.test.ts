// The scan store (issue #157): plan -> offer, start -> run, pause/resume/stop, the end with the
// merged results, refusals, and a reload mid-scan that redraws every square from GET /v1/runs/{id}.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpScanApi, parseScanPlan, setScanApi, type RunRecord } from './scanApi';
import { mockScanApi } from './scanMock';
import { resetScans, scanFailureText, skippedText, useScanStore } from './scanStore';

// 5 × 3 squares, as the mock-up draws (#156's split: 1.8° parts stay under 2° when padded and snapped).
const REGION = { ra: 30, dec: 10, width_deg: 9, height_deg: 5.4 };
const n = 15;
let clock = 0;
const now = () => clock;
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
const run = () => {
  const v = useScanStore.getState().view;
  if (v?.kind !== 'run') throw new Error(`not a run: ${v?.kind}`);
  return v;
};
const states = (r: RunRecord | null) => r?.squares.map((s) => s.state[0]).join('') ?? '';

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1_800_000_000_000;
  localStorage.clear();
  setScanApi(mockScanApi({ squareMs: 1000, now, persist: false }));
});
afterEach(() => {
  resetScans();
  setScanApi(null);
  vi.useRealTimers();
});

describe('scan store', () => {
  it('plan -> offer with 15 squares (5 × 3), one already done', async () => {
    await useScanStore.getState().plan('discovery', REGION);
    const v = useScanStore.getState().view;
    expect(v?.kind).toBe('offer');
    if (v?.kind !== 'offer') return;
    expect(v.plan).toMatchObject({ cols: 5, rows: 3 });
    expect(v.plan!.squares.filter((s) => s.area_id).length).toBe(1);
  });

  it('start -> run: squares go todo -> running -> done, square 4 skipped, then done with results', async () => {
    await useScanStore.getState().plan('discovery', REGION);
    await useScanStore.getState().start();
    await flush();
    expect(run().record?.state).toBe('running');
    // Square 1 is stored (done at once); square 2 is analysing.
    expect(states(run().record)).toBe('dr' + 't'.repeat(13));
    expect(run().square?.steps.length).toBe(6);
    clock += 2500;
    await vi.advanceTimersByTimeAsync(1500);
    expect(states(run().record).slice(0, 5)).toBe('dddsr');
    expect(run().record!.squares[3]!.error?.code).toBe('area:no_visit_pair');
    clock += 60_000;
    await vi.advanceTimersByTimeAsync(1500);
    expect(run().record?.state).toBe('done');
    expect(states(run().record)).toBe('ddds' + 'd'.repeat(11));
    await flush();
    expect(run().results?.squares.filter((s) => s.state === 'done').length).toBe(n - 1);
    // 7051 Sean, in squares 2 and 3, is one row.
    expect(run().results?.known.find((k) => k.designation === '7051 Sean')?.squares).toEqual([
      2, 3,
    ]);
  });

  it('pause holds the run, resume continues, stop keeps finished squares', async () => {
    await useScanStore.getState().plan('known', REGION);
    await useScanStore.getState().start();
    await flush();
    await useScanStore.getState().pause();
    await flush();
    expect(run().record?.state).toBe('paused');
    clock += 30_000;
    await vi.advanceTimersByTimeAsync(1500);
    expect(states(run().record).slice(0, 3)).toBe('drt');
    await useScanStore.getState().resume();
    clock += 1500;
    await vi.advanceTimersByTimeAsync(1500);
    expect(run().record?.state).toBe('running');
    await useScanStore.getState().stop();
    await flush();
    expect(run().record?.state).toBe('stopped');
    expect(run().record!.squares.filter((s) => s.state === 'done').length).toBeGreaterThanOrEqual(
      2,
    );
    expect(run().record!.squares.some((s) => s.state === 'running')).toBe(false);
  });

  it('a reload mid-scan redraws every square from the record', async () => {
    const api = mockScanApi({ squareMs: 1000, now, persist: false });
    setScanApi(api);
    await useScanStore.getState().plan('discovery', REGION);
    await useScanStore.getState().start();
    await flush();
    clock += 5200;
    await vi.advanceTimersByTimeAsync(1500);
    const before = states(run().record);
    const saved = useScanStore.getState().saved();
    expect(saved).toMatchObject({ flow: 'discovery' });
    // The page reloads: the store is empty, the saved id brings the run back.
    useScanStore.setState({ view: null });
    useScanStore.getState().follow(saved!.runId, saved!.flow, saved!.region);
    expect(run().record).toBeNull();
    await flush();
    expect(states(run().record)).toBe(before);
    expect(run().record!.events.filter((e) => e.type === 'found').length).toBeGreaterThan(0);
  });

  it('refusals: too large, unavailable, run gone', async () => {
    await useScanStore
      .getState()
      .plan('discovery', { ra: 30, dec: 10, width_deg: 14, height_deg: 6 });
    expect(useScanStore.getState().view).toMatchObject({ kind: 'failed', code: 'scan:too_large' });
    setScanApi(
      httpScanApi('/v1', (async () => new Response('nope', { status: 404 })) as typeof fetch),
    );
    await useScanStore.getState().plan('discovery', REGION);
    expect(useScanStore.getState().view).toMatchObject({
      kind: 'failed',
      code: 'scan:unavailable',
    });
    setScanApi(mockScanApi({ now, persist: false }));
    useScanStore.getState().follow('run-missing', 'discovery', REGION);
    await flush();
    expect(useScanStore.getState().view).toMatchObject({ kind: 'failed', code: 'run_not_found' });
    expect(scanFailureText('scan:too_large').title).toBe('Region too large');
    expect(skippedText(1, 'area:frames_incomplete', true)).toEqual({
      title: 'Square 1 failed',
      line: 'Some of its frames could not be downloaded.',
    });
    expect(skippedText(4, 'area:no_visit_pair', false)).toEqual({
      title: 'Square 4 skipped',
      line: 'No two visits close in time there.',
    });
  });
});

describe('another run opened over a scan that is still going', () => {
  it('closing the other run keeps ours: followed again, and still saved for a reload', async () => {
    await useScanStore.getState().plan('discovery', REGION);
    await useScanStore.getState().start();
    await flush();
    const mine = run().runId;
    // The Runs list opens another (finished) run in the card, then the card is closed.
    useScanStore.getState().follow('run-20261113T070000-aaaaaa', 'known', REGION);
    expect(run().runId).not.toBe(mine);
    useScanStore.getState().clear();
    await flush();
    expect(run().runId).toBe(mine);
    expect(useScanStore.getState().saved()?.runId).toBe(mine);
    expect(run().record?.state).toBe('running');
    // Closing our own (finished or stopped) scan still forgets it.
    useScanStore.getState().clear();
    expect(useScanStore.getState().view).toBeNull();
    expect(useScanStore.getState().saved()).toBeNull();
  });
});

describe('start while the user moves on', () => {
  it('a run started after Select again is stopped, not followed (PR #159 review)', async () => {
    const api = mockScanApi({ squareMs: 1000, now, persist: false });
    const stop = vi.spyOn(api, 'stop');
    setScanApi(api);
    await useScanStore.getState().plan('discovery', REGION);
    const p = useScanStore.getState().start();
    useScanStore.getState().clear();
    await p;
    expect(useScanStore.getState().view).toBeNull();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(useScanStore.getState().saved()).toBeNull();
  });
});

describe('stop while a square is running', () => {
  it('says it is stopping until the server stops it (a square stops at its next check)', async () => {
    const api = mockScanApi({ squareMs: 1000, now, persist: false });
    // The server accepts the stop but the square is still running (Q-470: next Progress.check).
    setScanApi({ ...api, stop: async () => {} });
    await useScanStore.getState().plan('discovery', REGION);
    await useScanStore.getState().start();
    await flush();
    await useScanStore.getState().stop();
    await flush();
    expect(run().stopping).toBe(true);
    expect(run().record?.state).toBe('running');
    // A reload while it stops still says so.
    const saved = useScanStore.getState().saved()!;
    useScanStore.setState({ view: null });
    useScanStore.getState().follow(saved.runId, saved.flow, saved.region);
    expect(run().stopping).toBe(true);
  });
});

describe('scan plan reply check', () => {
  it('accepts a plan, an error, and calls anything else unavailable', () => {
    expect(parseScanPlan({ error: 'scan:too_large', detail: 'x' })).toEqual({
      kind: 'error',
      code: 'scan:too_large',
      detail: 'x',
    });
    expect(parseScanPlan({ detail: 'Not Found' })).toEqual({ kind: 'unavailable' });
    const box = { ra: 1, dec: 2, width_deg: 2, height_deg: 2 };
    const plan = {
      release: 'spherex_dr1',
      region: box,
      cols: 1,
      rows: 1,
      squares: [{ index: 1, box, area_id: null }],
      estimate_s: 960,
    };
    expect(parseScanPlan(plan)).toEqual({ kind: 'plan', plan });
    expect(parseScanPlan({ ...plan, cols: 2 })).toEqual({ kind: 'unavailable' });
  });
});
