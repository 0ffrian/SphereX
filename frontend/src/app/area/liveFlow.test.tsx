// The live area flow (issue #144, Q-462; mock-up states 3 to 6): a box no prepared area holds gets
// the coverage check and the offer; Compute follows the job (waiting, computing), Stop goes back to
// the offer, failures say what happened, and a done job opens in the existing results views.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient, type ApiClient } from '@/app/api/client';
import { useAreaStore, type AreaBox } from '@/app/shell/areaStore';
import { useShellStore } from '@/app/shell/shellStore';
import { setSkyApi } from '@/state/store';
import { LiveAreaCard } from './LiveAreaCard';
import { httpLiveAreaApi, mockLiveAreaApi, mockStatusAt, setLiveAreaApi, type LivePlan } from './liveAreaApi';
import {
  aboutMinutes,
  clock,
  failureText,
  liveMiniTitle,
  POLL_MS,
  releaseName,
  resetLiveJobs,
  stepCount,
  useLiveJobStore,
  visitsText,
} from './liveJobStore';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const box: AreaBox = { a: { ra: 30, dec: 10.4 }, b: { ra: 31, dec: 9.8 }, widthDeg: 0.98, heightDeg: 0.61 };
const ENTRY = { area_id: 'live-dr1-30.50-10.10', ra: 30.5, dec: 10.1, width_deg: 1, height_deg: 0.6, data_release: 'spherex_dr1' };
const KNOWN = {
  known: [
    { designation: '9532 Abramenko', number: 9532, object_id: null, kind: 'asteroid', v_mag: 17.4, n_frames: 14, n_visits: 2, positions: [], track_available: false },
  ],
  skybot: [{ visit: 1, fetched_at: '2026-11-13T07:28:00Z' }],
  missing: [],
  provenance: {},
};

/** The prepared-area index: empty until the live job has stored its area. */
let stored = false;
function backend(): void {
  setSkyApi({
    areaIndex: async () => ({ data: { areas: stored ? [ENTRY] : [] }, fixture: null }),
    areaKnown: async () => ({ data: KNOWN, fixture: null }),
  } as unknown as ApiClient);
}

beforeEach(() => {
  vi.useFakeTimers();
  stored = false;
  backend();
  // No demo file in jsdom: a box with no prepared area is refused as not prepared.
  vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
  useShellStore.setState({ tool: 'area' });
  useAreaStore.getState().reset();
  resetLiveJobs();
});
afterEach(() => {
  useAreaStore.getState().reset();
  resetLiveJobs();
  setLiveAreaApi(null);
  setSkyApi(createApiClient());
  useShellStore.setState({ tool: 'sky' });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Draw a box in a flow and wait out the island's search and the coverage check. */
async function draw(flow: 'known' | 'discovery'): Promise<void> {
  useAreaStore.getState().startFlow(flow);
  useAreaStore.getState().pickPatch();
  useAreaStore.getState().setBox(box);
  await vi.advanceTimersByTimeAsync(2000);
}

describe('no prepared area: the offer (state 3)', () => {
  it('Known: the coverage check answers with the plan, and nothing starts', async () => {
    const start = vi.fn();
    const api = mockLiveAreaApi('ok');
    setLiveAreaApi({ ...api, start: async (b) => (start(b), api.start(b)) });
    await draw('known');
    expect(useAreaStore.getState().screen).toBe('live');
    const view = useLiveJobStore.getState().view;
    expect(view?.kind).toBe('offer');
    expect(view?.kind === 'offer' && view.plan.n_frames).toBe(14);
    expect(start).not.toHaveBeenCalled();
  });
  it('Discovery gets the same offer', async () => {
    setLiveAreaApi(mockLiveAreaApi('ok'));
    await draw('discovery');
    expect(useAreaStore.getState().screen).toBe('live');
    expect(useLiveJobStore.getState().view).toMatchObject({ kind: 'offer', flow: 'discovery' });
  });
  it('a backend with no live areas keeps today\'s refusal (nothing is made up)', async () => {
    setLiveAreaApi(httpLiveAreaApi('/v1', (async () => new Response('', { status: 404 })) as unknown as typeof fetch));
    await draw('known');
    await vi.advanceTimersByTimeAsync(1100);
    expect(useAreaStore.getState().screen).toBe('list');
    expect(useAreaStore.getState().refusal?.code).toBe('area:not_prepared');
    expect(useLiveJobStore.getState().view).toBeNull();
  });
  it('a prepared area goes to the existing results, with no coverage check', async () => {
    stored = true;
    const plan = vi.fn();
    setLiveAreaApi({ ...mockLiveAreaApi('ok'), plan: async () => (plan(), { kind: 'unavailable' }) });
    await draw('known');
    await vi.advanceTimersByTimeAsync(1100);
    expect(plan).not.toHaveBeenCalled();
    expect(useAreaStore.getState().screen).toBe('list');
    expect(useAreaStore.getState().known?.objects[0]?.name).toBe('Abramenko');
  });
});

describe('computing (state 4) and the hand-off', () => {
  it('Compute follows the job step by step, then opens the area in the Known list', async () => {
    setLiveAreaApi(mockLiveAreaApi('ok', { durationMs: 10_000 }));
    await draw('known');
    await useLiveJobStore.getState().compute();
    expect(useLiveJobStore.getState().view?.kind).toBe('job');
    await vi.advanceTimersByTimeAsync(3000);
    const st = useLiveJobStore.getState().job?.status;
    expect(st?.state).toBe('running');
    expect(st?.steps[0]?.state).toBe('done');
    expect(st?.steps.some((s) => s.state === 'running')).toBe(true);
    // Done: the area is stored, and the existing Known list opens it.
    stored = true;
    await vi.advanceTimersByTimeAsync(8000 + POLL_MS);
    expect(useLiveJobStore.getState().job).toBeNull();
    await vi.advanceTimersByTimeAsync(3200);
    expect(useAreaStore.getState().screen).toBe('list');
    expect(useAreaStore.getState().known?.demo).toBe(false);
    expect(useAreaStore.getState().known?.objects).toHaveLength(1);
  });
  it('closing the card does not stop the job; the area opens when it is ready', async () => {
    const stop = vi.fn();
    const api = mockLiveAreaApi('ok', { durationMs: 4000 });
    setLiveAreaApi({ ...api, stop: async (id) => (stop(id), api.stop(id)) });
    await draw('known');
    await useLiveJobStore.getState().compute();
    // Close: the tool is left and the area tool resets (AreaCard's unmount).
    useShellStore.getState().closePanel();
    useAreaStore.getState().reset();
    expect(useLiveJobStore.getState().view).toBeNull();
    expect(useLiveJobStore.getState().job).not.toBeNull();
    stored = true;
    await vi.advanceTimersByTimeAsync(4000 + 2 * POLL_MS);
    expect(stop).not.toHaveBeenCalled();
    expect(useShellStore.getState().tool).toBe('area');
    await vi.advanceTimersByTimeAsync(3200);
    expect(useAreaStore.getState().screen).toBe('list');
    expect(useAreaStore.getState().box).toEqual(box);
  });
  it('Stop ends the job and shows the offer again', async () => {
    const api = mockLiveAreaApi('ok');
    const stop = vi.fn();
    setLiveAreaApi({ ...api, stop: async (id) => (stop(id), api.stop(id)) });
    await draw('discovery');
    await useLiveJobStore.getState().compute();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    await useLiveJobStore.getState().stop();
    expect(stop).toHaveBeenCalledWith('live-dr1-30.50-10.10');
    expect(useLiveJobStore.getState().job).toBeNull();
    expect(useLiveJobStore.getState().view?.kind).toBe('offer');
  });
  it('a job that fails mid-way says why, and saves nothing', async () => {
    setLiveAreaApi(mockLiveAreaApi('fail', { durationMs: 2000 }));
    await draw('known');
    await useLiveJobStore.getState().compute();
    await vi.advanceTimersByTimeAsync(2000);
    expect(useLiveJobStore.getState().view).toMatchObject({ kind: 'failed', code: 'upstream_unavailable' });
  });
  it('a stored area (plan says done) opens at once', async () => {
    stored = true;
    setLiveAreaApi(mockLiveAreaApi('stored'));
    // The index read misses it once (as a box just past a prepared one would), then has it.
    let first = true;
    setSkyApi({
      areaIndex: async () => {
        const areas = first ? [] : [ENTRY];
        first = false;
        return { data: { areas }, fixture: null };
      },
      areaKnown: async () => ({ data: KNOWN, fixture: null }),
    } as unknown as ApiClient);
    await draw('known');
    await vi.advanceTimersByTimeAsync(3200);
    expect(useAreaStore.getState().screen).toBe('list');
    expect(useAreaStore.getState().known?.objects).toHaveLength(1);
  });
});

describe('an area already being computed', () => {
  it('the coverage check answers its job: the card follows it, with no offer', async () => {
    const api = mockLiveAreaApi('ok', { durationMs: 10_000 });
    setLiveAreaApi({
      ...api,
      plan: async (b) => {
        const started = await api.start(b);
        return started.kind === 'started' ? { kind: 'running', areaId: started.areaId, state: 'running' } : { kind: 'unavailable' };
      },
    });
    await draw('discovery');
    expect(useLiveJobStore.getState().view?.kind).toBe('job');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(useLiveJobStore.getState().job?.status?.state).toBe('running');
  });
});

describe('waiting (state 5)', () => {
  it('a queued job waits, Cancel stops it', async () => {
    setLiveAreaApi(mockLiveAreaApi('queued', { durationMs: 10_000 }));
    await draw('known');
    await useLiveJobStore.getState().compute();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    const st = useLiveJobStore.getState().job?.status;
    expect(st?.state).toBe('queued');
    expect(st?.queue_position).toBe(1);
    expect(liveMiniTitle(useLiveJobStore.getState(), 'Known objects')).toBe('Known objects · Waiting');
    await useLiveJobStore.getState().stop();
    expect(useLiveJobStore.getState().view?.kind).toBe('offer');
  });
});

describe('failures (state 6)', () => {
  it.each([
    ['no_pair', 'area:no_visit_pair', false],
    ['unreachable', 'upstream_unavailable', true],
    ['offline', 'offline', false],
  ] as const)('%s: a status dot, a title and one line', async (scenario, code, retry) => {
    setLiveAreaApi(mockLiveAreaApi(scenario));
    await draw('discovery');
    expect(useLiveJobStore.getState().view).toMatchObject({ kind: 'failed', code });
    expect(failureText(code).retry).toBe(retry);
  });
  it('another refusal of the box (area:too_large) has no Try again', () => {
    expect(failureText('area:too_large')).toMatchObject({ title: 'Could not compute this area', retry: false });
  });
  it('Try again runs the coverage check again', async () => {
    let fail = true;
    const ok = mockLiveAreaApi('ok');
    setLiveAreaApi({
      ...ok,
      plan: async (b) => (fail ? { kind: 'error', code: 'upstream_unavailable', detail: '' } : ok.plan(b)),
    });
    await draw('known');
    expect(useLiveJobStore.getState().view?.kind).toBe('failed');
    fail = false;
    await useLiveJobStore.getState().retry();
    expect(useLiveJobStore.getState().view?.kind).toBe('offer');
  });
});

describe('wording', () => {
  const plan: LivePlan = {
    area_id: 'a',
    release: 'spherex_dr1',
    visits: [
      { start: '2026-06-12T11:11:00Z', end: '2026-06-12T11:24:00Z' },
      { start: '2026-06-12T12:49:00Z', end: '2026-06-12T13:02:00Z' },
    ],
    n_frames: 14,
    estimate_s: 540,
  };
  it('as the mock-up words it', () => {
    expect(releaseName('spherex_dr1')).toBe('SPHEREx DR1');
    expect(visitsText(plan)).toBe('12 Jun 2026, 11:11 and 12:49 UTC (1.6 h apart)');
    expect(aboutMinutes(540)).toBe('about 9 min');
    expect(aboutMinutes(20)).toBe('under a minute');
    expect(clock(222)).toBe('3:42');
    expect(stepCount({ id: 'visits', state: 'done', done: 2, total: 2 })).toBe('2 visits');
    expect(stepCount({ id: 'frames', state: 'running', done: 9, total: 14 })).toBe('9 of 14');
    expect(stepCount({ id: 'clean', state: 'todo' })).toBe('');
  });
});

describe('LiveAreaCard', () => {
  let host: HTMLDivElement;
  let root: Root;
  const plan: LivePlan = {
    area_id: 'a',
    release: 'spherex_dr1',
    visits: [
      { start: '2026-06-12T11:11:00Z', end: '2026-06-12T11:24:00Z' },
      { start: '2026-06-12T12:49:00Z', end: '2026-06-12T13:02:00Z' },
    ],
    n_frames: 14,
    estimate_s: 540,
  };
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  it('offer: data, visits, frames, time; Compute this area and Draw again; no icon tile', async () => {
    useLiveJobStore.setState({ view: { kind: 'offer', box, flow: 'known', plan } });
    await act(async () => root.render(<LiveAreaCard />));
    expect(host.querySelector('h2')?.textContent).toBe('Known objects');
    expect(q('live-facts')?.textContent).toContain('SPHEREx DR1');
    expect(q('live-facts')?.textContent).toContain('about 14');
    expect(q('live-facts')?.textContent).toContain('about 9 min');
    expect(q('live-compute')?.textContent).toBe('Compute this area');
    expect(q('live-draw-again')).not.toBeNull();
    expect(host.querySelector('.sx-panel-head .rounded-xl')).toBeNull();
    expect(host.querySelector('[aria-label="Minimise Known objects"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Close Known objects"]')).not.toBeNull();
  });
  it('computing: check marks, the current step\'s count and bar, elapsed and remaining', async () => {
    const status = mockStatusAt('a', 0.34, plan);
    useLiveJobStore.setState({ view: { kind: 'job', box, flow: 'discovery' }, job: { areaId: 'a', box, flow: 'discovery', plan, status } });
    await act(async () => root.render(<LiveAreaCard />));
    const rows = [...host.querySelectorAll<HTMLElement>('[data-testid="live-steps"] li')];
    expect(rows.map((r) => r.dataset.state)).toEqual(['done', 'running', 'todo', 'todo', 'todo', 'todo']);
    expect(rows[1]!.getAttribute('aria-current')).toBe('step');
    expect(rows[1]!.textContent).toContain('9 of 14');
    expect(rows[1]!.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('9');
    expect(q('live-time')?.textContent).toBe('3:04 elapsedabout 6 min left');
    expect(q('live-stop')?.textContent).toBe('Stop');
    expect(q('live-announce')?.textContent).toBe('Step 2 of 6: Download frames.');
  });
  it('waiting: starts next, the wait and the run; Cancel', async () => {
    const status = { ...mockStatusAt('a', 0, plan), state: 'queued' as const, eta_s: 240 + 540, queue_position: 1 };
    useLiveJobStore.setState({ view: { kind: 'job', box, flow: 'known' }, job: { areaId: 'a', box, flow: 'known', plan, status } });
    await act(async () => root.render(<LiveAreaCard />));
    expect(q('live-waiting')?.textContent).toBe('Another area is computing. Yours starts next.');
    expect(q('live-time')?.textContent).toBe('Starts in about 4 minthen about 9 min');
    expect(q('live-stop')?.textContent).toBe('Cancel');
  });
  it('failure: dot, title, one muted line; no Try again where it cannot help', async () => {
    useLiveJobStore.setState({ view: { kind: 'failed', box, flow: 'discovery', code: 'area:no_visit_pair', detail: '' } });
    await act(async () => root.render(<LiveAreaCard />));
    expect(q('live-failed')?.textContent).toBe('No two visits close in timeNothing can be seen moving here. Try a nearby patch.');
    expect(q('live-retry')).toBeNull();
    expect(host.querySelector('.sx-panel-head p')?.textContent).toBe('Area · 0.98° × 0.61°');
  });
  it('Draw again goes back to aiming and closes the card', async () => {
    useLiveJobStore.setState({ view: { kind: 'failed', box, flow: 'known', code: 'upstream_unavailable', detail: '' } });
    await act(async () => root.render(<LiveAreaCard />));
    expect(q('live-retry')).not.toBeNull();
    await act(async () => q('live-draw-again')!.click());
    expect(useAreaStore.getState().stage).toBe('aiming');
    expect(useLiveJobStore.getState().view).toBeNull();
  });
});
