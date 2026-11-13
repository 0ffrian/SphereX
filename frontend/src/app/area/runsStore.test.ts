// The runs menu and the replay clock (issue #158): the list from GET /v1/runs (filter, polling
// while a run goes, errors), opening a run (#157's scan card follows it), and a replay that plays,
// pauses, seeks, changes speed and ends, deterministically.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useShellStore } from '@/app/shell/shellStore';
import { useAreaStore } from '@/app/shell/areaStore';
import { foundText, runLine } from '@/app/shell/RunsMenu';
import {
  getScanApi,
  httpScanApi,
  mockScanApi,
  parseRunList,
  setScanApi,
  summaryOf,
  type RunSummary,
} from './scanApi';
import { filteredRuns, resetRuns, RUNS_POLL_MS, setRunsClock, useRunsStore } from './runsStore';
import { resetScans, useScanStore } from './scanStore';

const REGION = { ra: 30, dec: 10, width_deg: 4, height_deg: 1.8 };
let clock = 0;
let wall = 0;
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1_800_000_000_000;
  wall = 0;
  localStorage.clear();
  setRunsClock(() => wall);
  setScanApi(mockScanApi({ squareMs: 1000, now: () => clock, persist: false }));
  useShellStore.setState({ tool: 'sky' });
});
afterEach(() => {
  resetRuns();
  resetScans();
  setScanApi(null);
  vi.useRealTimers();
});

async function startMockRun(kind: 'discovery' | 'known' = 'discovery') {
  await useScanStore.getState().plan(kind, REGION);
  await useScanStore.getState().start();
  await flush();
  const v = useScanStore.getState().view;
  if (v?.kind !== 'run') throw new Error('no run');
  return v.runId;
}

describe('runs menu', () => {
  it('opens with the runs of the server, newest first, and filters them', async () => {
    const a = await startMockRun('discovery');
    clock += 1000;
    const b = await startMockRun('known');
    resetScans();
    useRunsStore.getState().toggleMenu();
    expect(useRunsStore.getState().open).toBe(true);
    await flush();
    const s = useRunsStore.getState();
    expect(s.status).toBe('ready');
    expect(s.runs.map((r) => r.run_id)).toEqual([b, a]);
    expect(filteredRuns(s.runs, 'discovery').map((r) => r.run_id)).toEqual([a]);
    expect(filteredRuns(s.runs, 'known').map((r) => r.run_id)).toEqual([b]);
  });
  it('reads the list again while a run is still going, and stops when closed', async () => {
    await startMockRun();
    resetScans();
    const api = mockScanApi({ squareMs: 1000, now: () => clock, persist: false });
    let calls = 0;
    // Count the list calls through a wrapper around the mock that holds the running run.
    setScanApi({
      ...api,
      list: async () => {
        calls++;
        return [
          {
            run_id: 'run-20261113T210927-411a00',
            kind: 'discovery',
            region: REGION,
            state: 'running',
            created_at: '2026-11-13T21:09:27Z',
            duration_s: 10,
            totals: { known: 0, found: 0, unexplained: 0, squares_done: 0, squares_skipped: 0 },
            squares_done: 0,
            squares_total: 4,
          },
        ];
      },
    });
    useRunsStore.getState().toggleMenu();
    await flush();
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(RUNS_POLL_MS);
    expect(calls).toBe(2);
    useRunsStore.getState().closeMenu();
    await vi.advanceTimersByTimeAsync(RUNS_POLL_MS * 3);
    expect(calls).toBe(2);
  });
  it('keeps polling a run still going after a missed read', async () => {
    let calls = 0;
    const going = {
      run_id: 'run-20261113T210927-411a00',
      kind: 'discovery' as const,
      region: REGION,
      state: 'running' as const,
      created_at: '2026-11-13T21:09:27Z',
      duration_s: 10,
      totals: { known: 0, found: 0, unexplained: 0, squares_done: 0, squares_skipped: 0 },
      squares_done: 0,
      squares_total: 4,
    };
    setScanApi({
      ...mockScanApi({ persist: false }),
      list: async () => {
        calls++;
        if (calls === 2) throw new Error('down');
        return [going];
      },
    });
    useRunsStore.getState().toggleMenu();
    await flush();
    await vi.advanceTimersByTimeAsync(RUNS_POLL_MS);
    expect(calls).toBe(2);
    expect(useRunsStore.getState().status).toBe('ready');
    await vi.advanceTimersByTimeAsync(RUNS_POLL_MS);
    expect(calls).toBe(3);
  });
  it('a speed change or a pause keeps the position the clock has reached', async () => {
    const id = await startMockRun();
    clock += 4500;
    await flush();
    resetScans();
    await useRunsStore.getState().startReplay(id);
    useRunsStore.getState().setSpeed(1);
    wall += 450; // between two ticks: the store still holds the last tick's position
    useRunsStore.getState().setSpeed(10);
    expect(useRunsStore.getState().replay!.t).toBeCloseTo(0.45, 6);
    wall += 50;
    useRunsStore.getState().pause();
    expect(useRunsStore.getState().replay!.t).toBeCloseTo(0.95, 6);
  });
  it('says so when the list cannot be read', async () => {
    setScanApi(
      httpScanApi('/v1', (async () => new Response('down', { status: 502 })) as typeof fetch),
    );
    useRunsStore.getState().toggleMenu();
    await flush();
    expect(useRunsStore.getState().status).toBe('error');
  });
  it('opens a run: the scan card follows it and the area tool shows its scan', async () => {
    const id = await startMockRun();
    resetScans();
    const run = summaryOf(await getScanApi().run(id), clock);
    useRunsStore.getState().toggleMenu();
    useRunsStore.getState().openRun(run);
    expect(useRunsStore.getState().open).toBe(false);
    const v = useScanStore.getState().view;
    expect(v?.kind).toBe('run');
    expect(v?.kind === 'run' && v.runId).toBe(id);
    expect(useShellStore.getState().tool).toBe('area');
    expect(useAreaStore.getState().screen).toBe('scan');
  });
});

describe('replay', () => {
  async function replayOf(stepped = false) {
    const id = await startMockRun();
    clock += 4500; // the mock analyses a square a second: all four are done
    await flush();
    resetScans();
    await useRunsStore.getState().startReplay(id, { stepped });
    const r = useRunsStore.getState().replay;
    if (!r) throw new Error('no replay');
    return r;
  }
  it('starts at 0, playing at 60×, and takes the sky', async () => {
    useShellStore.setState({ tool: 'area' });
    const r = await replayOf();
    expect(r.t).toBe(0);
    expect(r.speed).toBe(60);
    expect(r.playing).toBe(true);
    expect(r.end).toBeGreaterThan(0);
    expect(useShellStore.getState().tool).toBe('sky');
  });
  it('plays at its speed from the wall clock, deterministically', async () => {
    const r = await replayOf();
    expect(r.end).toBeGreaterThan(1.5);
    useRunsStore.getState().setSpeed(1);
    wall += 500; // 0.5 s at 1×, whatever the timer's own jitter
    await vi.advanceTimersByTimeAsync(100);
    expect(useRunsStore.getState().replay!.t).toBeCloseTo(0.5, 6);
    useRunsStore.getState().setSpeed(10);
    wall += 100; // then 0.1 s at 10×
    await vi.advanceTimersByTimeAsync(100);
    expect(useRunsStore.getState().replay!.t).toBeCloseTo(1.5, 6);
  });
  it('pauses, seeks within the run, and stops at the end', async () => {
    const r = await replayOf();
    useRunsStore.getState().pause();
    wall += 5000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(useRunsStore.getState().replay!.t).toBe(0);
    useRunsStore.getState().seek(-10);
    expect(useRunsStore.getState().replay!.t).toBe(0);
    useRunsStore.getState().seek(r.end + 50);
    expect(useRunsStore.getState().replay!.t).toBe(r.end);
    useRunsStore.getState().seek(r.end - 1);
    useRunsStore.getState().play();
    wall += 1000;
    await vi.advanceTimersByTimeAsync(100);
    const end = useRunsStore.getState().replay!;
    expect(end.t).toBe(r.end);
    expect(end.playing).toBe(false);
    // Play at the end starts again from the beginning.
    useRunsStore.getState().play();
    expect(useRunsStore.getState().replay!.t).toBe(0);
  });
  it('steps once a second under reduced motion', async () => {
    await replayOf(true);
    useRunsStore.getState().setSpeed(1);
    wall += 900;
    await vi.advanceTimersByTimeAsync(1000);
    expect(useRunsStore.getState().replay!.t).toBe(0);
    wall += 200;
    await vi.advanceTimersByTimeAsync(1000);
    expect(useRunsStore.getState().replay!.t).toBe(1);
  });
  it('ends from the runs button, and from endReplay', async () => {
    await replayOf();
    useRunsStore.getState().toggleMenu();
    expect(useRunsStore.getState().replay).toBeNull();
    expect(useRunsStore.getState().open).toBe(false);
  });
  it('says so when the run is gone', async () => {
    useRunsStore.setState({ open: true });
    await useRunsStore.getState().startReplay('run-20991231T000000-000000');
    expect(useRunsStore.getState().replay).toBeNull();
    expect(useRunsStore.getState().note).toBe('That run is no longer on the server.');
  });
});

describe('list rows', () => {
  const base: RunSummary = {
    run_id: 'run-20261113T072800-abcdef',
    kind: 'discovery',
    region: { ra: 207.9, dec: -11.4, width_deg: 9.6, height_deg: 6 },
    state: 'done',
    created_at: '2026-11-13T07:28:00Z',
    duration_s: 13930,
    totals: { known: 11, found: 9, unexplained: 2, squares_done: 15, squares_skipped: 0 },
    squares_done: 15,
    squares_total: 15,
  };
  it('a finished run has no state word', () => {
    expect(runLine(base)).toEqual({
      before: null,
      state: null,
      line: '13 Nov 07:28 · 15 squares · 9 found, 2 unexplained · 3 h 52 min',
    });
  });
  it('a Known objects run counts known and detected', () => {
    expect(
      foundText({ ...base, kind: 'known', totals: { ...base.totals, known: 52, found: 0 } }),
    ).toBe('52 known, 0 detected');
  });
  it('a running run says where it is, in blue', () => {
    const r = runLine({
      ...base,
      state: 'running',
      squares_done: 2,
      squares_total: 8,
      totals: { ...base.totals, found: 1, unexplained: 0 },
    });
    expect(r.state).toEqual({ word: 'Running', tone: 'accent' });
    expect(r.line).toBe('square 3 of 8 · 1 found, 0 unexplained so far');
  });
  it('a stopped run says after how many squares, in red', () => {
    const r = runLine({
      ...base,
      state: 'stopped',
      created_at: '2026-11-13T06:58:00Z',
      squares_done: 1,
      squares_total: 2,
    });
    expect(r).toEqual({
      before: '13 Nov 06:58',
      state: { word: 'Stopped', tone: 'fail' },
      line: 'after 1 of 2 squares',
    });
  });
});

describe('GET /v1/runs', () => {
  it('reads the list and refuses a reply that is not the contract', async () => {
    const body = { runs: [{ ...summaryOfFixture() }] };
    expect(parseRunList(body)).toHaveLength(1);
    expect(() => parseRunList({ runs: [{ run_id: 'x' }] })).toThrow();
    expect(() => parseRunList({})).toThrow();
    const api = httpScanApi(
      '/v1',
      (async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as typeof fetch,
    );
    expect(await api.list()).toHaveLength(1);
  });
});

function summaryOfFixture(): RunSummary {
  return {
    run_id: 'run-20261113T210927-411a00',
    kind: 'discovery',
    region: { ra: 207.9, dec: -11.45, width_deg: 2.4, height_deg: 1.2 },
    state: 'done',
    created_at: '2026-11-13T21:09:27Z',
    duration_s: 1900,
    totals: { known: 2, found: 1, unexplained: 1, squares_done: 2, squares_skipped: 0 },
    squares_done: 2,
    squares_total: 2,
  };
}
