// Live areas (issue #144, plan ticket C1; backend #141, Q-462): the job API behind ONE interface, so
// swapping the mock for the real backend touches this file only.
//
// Contract: #141's `shared/schemas/area-live-plan.schema.json` and `area-job.schema.json` (PR #147;
// these hand-written types give way to the generated ones in `@/contract` once it is on main):
//   POST   /v1/areas/live  {ra, dec, width_deg, height_deg, start: false}
//          -> plan {area_id, release, box, visits: [{start, end, n_frames}] x2, n_frames, estimate_s, …}
//          |  job  {area_id, state: "done"}                    (already stored)
//          |  job  {area_id, state: "queued" | "running", …}   (already being computed)
//          |  422/503 {error: "area:no_visit_pair" | "area:…" | "upstream_unavailable" | "offline", detail}
//   POST   same body with start: true -> 202 job {area_id, state: "queued" | "running", …}
//   GET    /v1/areas/live/{area_id}
//          -> {area_id, state, step, steps: [{id, label, state, done?, total?}], elapsed_s,
//              eta_s (null when unknown; for a queued job the wait plus the run), queue_position?,
//              error?: {code, detail}}; a stopped job fails with `cancelled`.
//   DELETE /v1/areas/live/{area_id} stops a queued or running job (204).
//
// Which implementation answers:
//   - the HTTP client by default. A backend that does not serve the route (404, or not JSON: the
//     fixture server, a backend before #141) or cannot be reached answers `unavailable`, and the UI
//     keeps today's "No prepared data for this area yet" (Q-414). Nothing is made up.
//   - the MOCK only when asked, on the dev server only: `?live=mock` in the page URL, or
//     VITE_SX_LIVE_AREAS=mock. A public build never uses it. Its
//     visit pair and counts are invented test values, so it never answers on its own (data first).
//     Scenarios: `mock`, `mock-queued`, `mock-no-pair`, `mock-unreachable`, `mock-offline`,
//     `mock-stored`, `mock-fail`; `live_ms=<ms>` sets the job's length, `live_hold=<0..1>` freezes
//     its progress (screenshots).
import { API_BASE } from '@/app/api/config';
import { deltaRa, wrapRa } from '@/viewer/sky/skyMath';
import { MAX_SIDE_DEG } from './aim';

export interface LiveVisit {
  /** ISO times (UTC). */
  start: string;
  end: string;
}
export interface LivePlan {
  area_id: string;
  /** Data release, e.g. "spherex_dr1". */
  release: string;
  visits: [LiveVisit, LiveVisit];
  n_frames: number;
  estimate_s: number;
}
/** `area:no_visit_pair`, `upstream_unavailable`, `offline`, or another `area:…` refusal. */
export type LiveErrorCode = string;
/** An error body of the live routes. Anything else (`not_found`: no such route) is "unavailable". */
export function isLiveError(code: string): boolean {
  return code === 'upstream_unavailable' || code === 'offline' || code.startsWith('area:');
}

export type LiveStepState = 'done' | 'running' | 'todo';
export interface LiveStep {
  id: string;
  label: string;
  state: LiveStepState;
  done?: number;
  total?: number;
}
export type LiveJobState = 'queued' | 'running' | 'done' | 'failed';
export interface LiveJobStatus {
  area_id: string;
  state: LiveJobState;
  /** Id of the current step (null before the first or after the last). */
  step: string | null;
  steps: LiveStep[];
  elapsed_s: number;
  /** Seconds until the area is done (for a queued job: the wait plus the run); null: unknown. */
  eta_s: number | null;
  queue_position?: number;
  error?: { code: string; detail: string };
}

/** The box asked about: centre and sides in degrees. */
export interface LiveBox {
  ra: number;
  dec: number;
  width_deg: number;
  height_deg: number;
}

export type PlanAnswer =
  | { kind: 'plan'; plan: LivePlan }
  | { kind: 'stored'; areaId: string }
  /** The same area is already queued or running (another tab, or this one): follow that job. */
  | { kind: 'running'; areaId: string; state: 'queued' | 'running' }
  | { kind: 'error'; code: LiveErrorCode; detail: string }
  /** The backend has no live areas (route not served, or not reachable): keep today's refusal. */
  | { kind: 'unavailable' };
export type StartAnswer =
  | { kind: 'started'; areaId: string; state: 'queued' | 'running' }
  | { kind: 'stored'; areaId: string }
  | { kind: 'error'; code: LiveErrorCode; detail: string }
  | { kind: 'unavailable' };

/** The server no longer knows the job (404 `job_not_found`, e.g. after a restart). */
export class LiveJobGone extends Error {
  constructor(areaId: string) {
    super(`No live area job '${areaId}'.`);
    this.name = 'LiveJobGone';
  }
}

export interface LiveAreaApi {
  /** Coverage check: the plan, without starting anything. */
  plan(box: LiveBox, signal?: AbortSignal): Promise<PlanAnswer>;
  start(box: LiveBox, signal?: AbortSignal): Promise<StartAnswer>;
  /** Throws LiveJobGone when the server has no such job, another error when it cannot be read. */
  status(areaId: string, signal?: AbortSignal): Promise<LiveJobStatus>;
  stop(areaId: string): Promise<void>;
}

/** A drawn box (two opposite corners and its sides) as the request's centre and sides. */
export function liveBoxOf(b: {
  a: { ra: number; dec: number };
  b: { ra: number; dec: number };
  widthDeg: number;
  heightDeg: number;
}): LiveBox {
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
  // Never past the 2° the backend allows (`area:too_large`): the drawn box is held there, and a
  // rounding or projection hair over it must not turn into a refusal.
  return {
    ra: r6(wrapRa(b.a.ra + deltaRa(b.b.ra, b.a.ra) / 2)),
    dec: r6((b.a.dec + b.b.dec) / 2),
    width_deg: Math.min(MAX_SIDE_DEG, r6(b.widthDeg)),
    height_deg: Math.min(MAX_SIDE_DEG, r6(b.heightDeg)),
  };
}

// ---- Reply checks (shape only; the schema of #141 replaces them) -------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isVisit = (v: unknown): v is LiveVisit => isObj(v) && isStr(v.start) && isStr(v.end);

export function parsePlanReply(body: unknown): PlanAnswer {
  if (!isObj(body)) return { kind: 'unavailable' };
  if (isStr(body.error) && isLiveError(body.error))
    return { kind: 'error', code: body.error, detail: isStr(body.detail) ? body.detail : '' };
  if (!isStr(body.area_id)) return { kind: 'unavailable' };
  if (body.state === 'done') return { kind: 'stored', areaId: body.area_id };
  if (body.state === 'queued' || body.state === 'running') return { kind: 'running', areaId: body.area_id, state: body.state };
  const v = body.visits;
  if (isStr(body.release) && Array.isArray(v) && v.length === 2 && v.every(isVisit) && isNum(body.n_frames) && isNum(body.estimate_s))
    return {
      kind: 'plan',
      plan: {
        area_id: body.area_id,
        release: body.release,
        visits: [v[0] as LiveVisit, v[1] as LiveVisit],
        n_frames: body.n_frames,
        estimate_s: body.estimate_s,
      },
    };
  return { kind: 'unavailable' };
}

export function parseStartReply(body: unknown): StartAnswer {
  if (!isObj(body)) return { kind: 'unavailable' };
  if (isStr(body.error) && isLiveError(body.error))
    return { kind: 'error', code: body.error, detail: isStr(body.detail) ? body.detail : '' };
  if (!isStr(body.area_id)) return { kind: 'unavailable' };
  if (body.state === 'done') return { kind: 'stored', areaId: body.area_id };
  if (body.state === 'queued' || body.state === 'running') return { kind: 'started', areaId: body.area_id, state: body.state };
  return { kind: 'unavailable' };
}

const STEP_STATES: readonly string[] = ['done', 'running', 'todo'];
const JOB_STATES: readonly string[] = ['queued', 'running', 'done', 'failed'];

export function parseStatusReply(body: unknown): LiveJobStatus {
  const bad = () => new Error('Live area job reply does not match the contract.');
  if (!isObj(body) || !isStr(body.area_id) || !isStr(body.state) || !JOB_STATES.includes(body.state)) throw bad();
  if (!Array.isArray(body.steps) || !isNum(body.elapsed_s) || !(isNum(body.eta_s) || body.eta_s === null)) throw bad();
  const steps: LiveStep[] = body.steps.map((s: unknown) => {
    if (!isObj(s) || !isStr(s.id) || !isStr(s.label) || !isStr(s.state) || !STEP_STATES.includes(s.state)) throw bad();
    return {
      id: s.id,
      label: s.label,
      state: s.state as LiveStepState,
      ...(isNum(s.done) ? { done: s.done } : {}),
      ...(isNum(s.total) ? { total: s.total } : {}),
    };
  });
  const err = body.error;
  return {
    area_id: body.area_id,
    state: body.state as LiveJobState,
    step: isStr(body.step) ? body.step : null,
    steps,
    elapsed_s: body.elapsed_s,
    eta_s: isNum(body.eta_s) ? body.eta_s : null,
    ...(isNum(body.queue_position) ? { queue_position: body.queue_position } : {}),
    ...(isObj(err) && isStr(err.code) ? { error: { code: err.code, detail: isStr(err.detail) ? err.detail : '' } } : {}),
  };
}

// ---- HTTP --------------------------------------------------------------------------------------

/** One job poll waits at most this long (engineering value). */
export const STATUS_TIMEOUT_MS = 10_000;

/** The backend (#141). A route it does not serve, a reply that is not JSON or no backend: `unavailable`. */
export function httpLiveAreaApi(base = API_BASE, fetchImpl: typeof fetch = (i, init) => globalThis.fetch(i, init)): LiveAreaApi {
  const json = async (res: Response): Promise<unknown> => {
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) return null;
    return res.json().catch(() => null);
  };
  const post = async (box: LiveBox, start: boolean, signal?: AbortSignal): Promise<unknown> => {
    const res = await fetchImpl(`${base}/areas/live`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...box, start }),
      signal,
    });
    return json(res);
  };
  const aborted = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
  return {
    async plan(box, signal) {
      try {
        return parsePlanReply(await post(box, false, signal));
      } catch (e) {
        if (aborted(e)) throw e;
        return { kind: 'unavailable' };
      }
    },
    async start(box, signal) {
      try {
        return parseStartReply(await post(box, true, signal));
      } catch (e) {
        if (aborted(e)) throw e;
        return { kind: 'unavailable' };
      }
    },
    async status(areaId, signal) {
      // A hung reply counts as a missed poll (STATUS_TIMEOUT_MS), so polling never stalls.
      const timeout = AbortSignal.timeout(STATUS_TIMEOUT_MS);
      const res = await fetchImpl(`${base}/areas/live/${encodeURIComponent(areaId)}`, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      const body = await json(res);
      if (res.status === 404 && typeof body === 'object' && body !== null && (body as { error?: unknown }).error === 'job_not_found')
        throw new LiveJobGone(areaId);
      return parseStatusReply(body);
    },
    async stop(areaId) {
      const res = await fetchImpl(`${base}/areas/live/${encodeURIComponent(areaId)}`, { method: 'DELETE' });
      // 404: nothing left to stop (it just ended). Anything else that is not 2xx: not stopped.
      if (!res.ok && res.status !== 404) throw new Error(`Stop failed (${res.status}).`);
    },
  };
}

// ---- Mock (opt-in; invented test values) -------------------------------------------------------

export type MockScenario = 'ok' | 'queued' | 'no_pair' | 'unreachable' | 'offline' | 'stored' | 'fail';

/** The six steps of a live area job, with their share of the run time and what they count. */
export const MOCK_STEPS: readonly { id: string; label: string; weight: number; total?: 'visits' | 'frames' }[] = [
  { id: 'visits', label: 'Find a pair of visits', weight: 0.05 },
  { id: 'frames', label: 'Download frames', weight: 0.45, total: 'frames' },
  { id: 'dots', label: 'Find dots', weight: 0.2, total: 'frames' },
  { id: 'labels', label: 'Drop glitches and stars', weight: 0.1 },
  { id: 'join', label: 'Join what moves across visits', weight: 0.1 },
  { id: 'known', label: 'Check known objects (SkyBoT)', weight: 0.1, total: 'visits' },
];

const MOCK_PLAN = (areaId: string): LivePlan => ({
  area_id: areaId,
  release: 'spherex_dr1',
  visits: [
    { start: '2026-06-12T11:11:00Z', end: '2026-06-12T11:24:00Z' },
    { start: '2026-06-12T12:49:00Z', end: '2026-06-12T13:02:00Z' },
  ],
  n_frames: 14,
  estimate_s: 540,
});

/** The mock job's progress at fraction `f` (0..1) of its run. Pure, so tests can check it. */
export function mockStatusAt(areaId: string, f: number, plan: LivePlan): LiveJobStatus {
  const steps: LiveStep[] = [];
  let acc = 0;
  let current: string | null = null;
  for (const s of MOCK_STEPS) {
    const lo = acc;
    acc += s.weight;
    const total = s.total === 'visits' ? 2 : s.total === 'frames' ? plan.n_frames : undefined;
    const state: LiveStepState = f >= acc ? 'done' : f >= lo ? 'running' : 'todo';
    if (state === 'running') current = s.id;
    const done = total === undefined ? undefined : state === 'done' ? total : state === 'running' ? Math.floor(((f - lo) / s.weight) * total) : 0;
    steps.push({ id: s.id, label: s.label, state, ...(total !== undefined ? { total, done } : {}) });
  }
  return {
    area_id: areaId,
    state: f >= 1 ? 'done' : 'running',
    step: current,
    steps,
    elapsed_s: Math.round(f * plan.estimate_s),
    eta_s: f >= 1 ? null : Math.max(0, Math.round((1 - f) * plan.estimate_s)),
  };
}

export function mockLiveAreaApi(
  scenario: MockScenario = 'ok',
  opts: { durationMs?: number; hold?: number | null; now?: () => number } = {},
): LiveAreaApi {
  const durationMs = opts.durationMs ?? 12_000;
  const now = opts.now ?? (() => Date.now());
  const hold = opts.hold ?? null;
  /** A queued job waits this share of the run before it starts. */
  const queueMs = durationMs * 0.4;
  const jobs = new Map<string, { t0: number; stopped: boolean }>();
  const idOf = (b: LiveBox) => `live-dr1-${b.ra.toFixed(2)}-${b.dec.toFixed(2)}`;
  const failure = (): PlanAnswer | null =>
    scenario === 'no_pair'
      ? { kind: 'error', code: 'area:no_visit_pair', detail: 'No two visits within 6 h at this position.' }
      : scenario === 'unreachable'
        ? { kind: 'error', code: 'upstream_unavailable', detail: 'IRSA did not answer.' }
        : scenario === 'offline'
          ? { kind: 'error', code: 'offline', detail: 'SX_OFFLINE=1: only stored areas.' }
          : null;
  return {
    async plan(box) {
      const f = failure();
      if (f) return f;
      const id = idOf(box);
      if (scenario === 'stored') return { kind: 'stored', areaId: id };
      return { kind: 'plan', plan: MOCK_PLAN(id) };
    },
    async start(box) {
      const f = failure();
      if (f) return f as StartAnswer;
      const id = idOf(box);
      jobs.set(id, { t0: now(), stopped: false });
      return { kind: 'started', areaId: id, state: scenario === 'queued' ? 'queued' : 'running' };
    },
    async status(areaId) {
      const job = jobs.get(areaId);
      if (!job) throw new LiveJobGone(areaId);
      const plan = MOCK_PLAN(areaId);
      if (job.stopped) {
        return { ...mockStatusAt(areaId, 0, plan), state: 'failed', eta_s: null, error: { code: 'cancelled', detail: 'The job was stopped. Nothing was saved.' } };
      }
      let t = now() - job.t0;
      if (scenario === 'queued') {
        // Held (screenshots): always waiting, 4 min before it starts.
        if (hold !== null || t < queueMs) {
          const wait = hold !== null ? 240 : Math.round(((queueMs - t) / durationMs) * plan.estimate_s);
          const base = mockStatusAt(areaId, 0, plan);
          return {
            ...base,
            state: 'queued',
            step: null,
            eta_s: wait + plan.estimate_s,
            queue_position: 1,
            steps: base.steps.map((s) => ({ ...s, state: 'todo' as const })),
          };
        }
        t -= queueMs;
      }
      const f = hold ?? Math.min(1, t / durationMs);
      if (scenario === 'fail' && f > 0.3) {
        return { ...mockStatusAt(areaId, 0.3, plan), state: 'failed', eta_s: null, error: { code: 'upstream_unavailable', detail: 'IRSA stopped answering.' } };
      }
      return mockStatusAt(areaId, f, plan);
    },
    async stop(areaId) {
      const job = jobs.get(areaId);
      if (job) job.stopped = true;
    },
  };
}

/** The mock asked for in the page URL or the build env, or null. */
export function mockFromEnv(search: string, env: string | undefined): LiveAreaApi | null {
  const q = new URLSearchParams(search);
  const v = q.get('live') ?? env ?? '';
  if (!v.startsWith('mock')) return null;
  const name = v.slice('mock'.length).replace(/^-/, '').replace(/-/g, '_');
  const scenarios: readonly MockScenario[] = ['ok', 'queued', 'no_pair', 'unreachable', 'offline', 'stored', 'fail'];
  const scenario = (scenarios as readonly string[]).includes(name) ? (name as MockScenario) : 'ok';
  const ms = Number(q.get('live_ms'));
  const hold = q.get('live_hold');
  return mockLiveAreaApi(scenario, {
    ...(ms > 0 ? { durationMs: ms } : {}),
    hold: hold !== null && Number.isFinite(Number(hold)) ? Math.min(1, Math.max(0, Number(hold))) : null,
  });
}

let api: LiveAreaApi | null = null;
/** The live area API in use: the opt-in mock, else the backend. */
export function getLiveAreaApi(): LiveAreaApi {
  if (!api) {
    // The URL switch works on the dev server only (e2e, screenshots): a public build never shows
    // invented visit pairs because of a link.
    const search = typeof location === 'undefined' || !import.meta.env.DEV ? '' : location.search;
    const env = import.meta.env.DEV ? (import.meta.env.VITE_SX_LIVE_AREAS as string | undefined) : undefined;
    api = mockFromEnv(search, env) ?? httpLiveAreaApi();
  }
  return api;
}
/** Tests: put an implementation in place (null: choose again from the URL and env). */
export function setLiveAreaApi(next: LiveAreaApi | null): void {
  api = next;
}
