// Track on demand (issue #145 for the UI, #142 / PR #150 for the backend, Q-468): one known object's
// Track (Horizons path, frames along it within ±3 days of a given time, cutouts, spectrum) computed
// on the object job runner (#41). Behind ONE interface, like the live areas, so the mock and the
// real backend swap in this file only.
//
// Contract (PR #150, as proposed in #142):
//   POST /v1/objects/{id}/track  {around: ISO UTC, days?: 0 < days ≤ 15 (default 3)}
//        -> 202 the `/job` body (JobStatus): {id, state, stage, frames_done, frames_total, error, …}
//        |  400 {error: "bad_request" | "track_window_outside"} | 404 {error: "not_found" |
//           "not_moving" | "no_ephemeris"}: nothing stored, no job started
//   GET  /v1/objects/{id}/job?around=…&days=…   -> JobStatus of that window's Track job; state
//        "idle" | "running" | "done" | "failed"; when done, `track_available` and `reason`.
//        Without the two parameters the route answers for the object's base job, not this one.
// When `state` is `done` and `track_available` is true, `/frames` and `/path` with the same two
// parameters are served from the cache: the Track view (the Eros card) opens on them.
//
// The MOCK answers only when asked, on the dev server only (`?track=mock`, or VITE_SX_TRACK=mock),
// so a public build never shows invented progress. Its job ends `done` but stores nothing: the
// Track view then reads the real `/frames` and `/path` (or says they are not there).
import { trackQuery, type TrackWindow } from '@/app/api/client';
import { API_BASE } from '@/app/api/config';

/** `GET /v1/objects/{id}/job` (backend `JobStatus`, issue #41, Q-111). */
export interface TrackJobStatus {
  id: string;
  state: 'idle' | 'running' | 'done' | 'failed';
  stage?: 'queued' | 'catalogue' | 'frames' | 'spectrum' | 'card' | 'done' | null;
  frames_done?: number | null;
  frames_total?: number | null;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
  /** On a done Track job: false when the Track still cannot open, with the first `reason`. */
  track_available?: boolean;
  reason?: string | null;
}

export type TrackStartAnswer =
  | { kind: 'started'; status: TrackJobStatus }
  | { kind: 'error'; code: string; detail: string }
  /** The backend has no Track on demand (route not served, or not reachable). */
  | { kind: 'unavailable' };

export interface TrackJobApi {
  start(
    objectId: string,
    around: string,
    days?: number,
    signal?: AbortSignal,
  ): Promise<TrackStartAnswer>;
  /** The Track job of that window. Throws when it cannot be read (the poll is asked again). */
  status(objectId: string, window: TrackWindow, signal?: AbortSignal): Promise<TrackJobStatus>;
}

/** The window either side of `around`, in days (Q-468: ±3 days, not the whole release). */
export const TRACK_DAYS = 3;
export const STATUS_TIMEOUT_MS = 10_000;
export const START_TIMEOUT_MS = 60_000;

const STATES: readonly string[] = ['idle', 'running', 'done', 'failed'];
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The reply's shape, as far as the card reads it; anything else is a broken reply. */
export function parseTrackStatus(body: unknown): TrackJobStatus {
  if (
    !isObj(body) ||
    typeof body.id !== 'string' ||
    typeof body.state !== 'string' ||
    !STATES.includes(body.state)
  )
    throw new Error('The Track job reply could not be read.');
  return body as unknown as TrackJobStatus;
}

export function httpTrackJobApi(
  base = API_BASE,
  fetchImpl: typeof fetch = (i, init) => globalThis.fetch(i, init),
): TrackJobApi {
  const json = async (res: Response): Promise<unknown> =>
    (res.headers.get('content-type') ?? '').includes('json') ? res.json().catch(() => null) : null;
  const aborted = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
  return {
    async start(objectId, around, days = TRACK_DAYS, signal) {
      try {
        // A server that takes the connection and never answers ends as `unavailable`.
        const timeout = AbortSignal.timeout(START_TIMEOUT_MS);
        const res = await fetchImpl(`${base}/objects/${encodeURIComponent(objectId)}/track`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ around, days }),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        const body = await json(res);
        if (res.ok) return { kind: 'started', status: parseTrackStatus(body) };
        // 405: a backend without PR #150 (the route is not served).
        if (isObj(body) && typeof body.error === 'string' && res.status !== 405)
          return {
            kind: 'error',
            code: body.error,
            detail: typeof body.detail === 'string' ? body.detail : '',
          };
        return { kind: 'unavailable' };
      } catch (e) {
        if (aborted(e)) throw e;
        return { kind: 'unavailable' };
      }
    },
    async status(objectId, window, signal) {
      const timeout = AbortSignal.timeout(STATUS_TIMEOUT_MS);
      const url = `${base}/objects/${encodeURIComponent(objectId)}/job${trackQuery(window)}`;
      const res = await fetchImpl(url, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      return parseTrackStatus(await json(res));
    },
  };
}

// ---- Mock (opt-in; invented progress) -----------------------------------------------------------

export type TrackMockScenario = 'ok' | 'fail' | 'outside';

/** The mock job at fraction `f` (0..1) of its run. Pure. */
export function mockTrackStatusAt(id: string, f: number, framesTotal = 18): TrackJobStatus {
  if (f >= 1)
    return {
      id,
      state: 'done',
      stage: 'done',
      frames_done: framesTotal,
      frames_total: framesTotal,
    };
  const stage = f < 0.15 ? 'catalogue' : f < 0.75 ? 'frames' : f < 0.95 ? 'spectrum' : 'card';
  const framesDone =
    stage === 'frames'
      ? Math.floor(((f - 0.15) / 0.6) * framesTotal)
      : stage === 'catalogue'
        ? 0
        : framesTotal;
  return {
    id,
    state: 'running',
    stage,
    frames_done: framesDone,
    frames_total: stage === 'catalogue' ? null : framesTotal,
  };
}

export function mockTrackJobApi(
  scenario: TrackMockScenario = 'ok',
  opts: { durationMs?: number; hold?: number | null; now?: () => number } = {},
): TrackJobApi {
  const durationMs = opts.durationMs ?? 8000;
  const now = opts.now ?? (() => Date.now());
  const hold = opts.hold ?? null;
  const jobs = new Map<string, number>();
  return {
    async start(objectId) {
      if (scenario === 'outside')
        return {
          kind: 'error',
          code: 'track_window_outside',
          detail: 'The window misses every search window of the object.',
        };
      jobs.set(objectId, now());
      return { kind: 'started', status: mockTrackStatusAt(objectId, 0) };
    },
    async status(objectId) {
      const t0 = jobs.get(objectId);
      if (t0 === undefined) return { id: objectId, state: 'idle' };
      const f = hold ?? Math.min(1, (now() - t0) / durationMs);
      if (scenario === 'fail' && f > 0.4)
        return {
          ...mockTrackStatusAt(objectId, 0.4),
          state: 'failed',
          error: 'IRSA stopped answering.',
        };
      return mockTrackStatusAt(objectId, f);
    },
  };
}

/** The mock asked for in the page URL or the build env, or null. */
export function trackMockFromEnv(search: string, env: string | undefined): TrackJobApi | null {
  const q = new URLSearchParams(search);
  const v = q.get('track') ?? env ?? '';
  if (!v.startsWith('mock')) return null;
  const name = v.slice('mock'.length).replace(/^-/, '');
  const scenario: TrackMockScenario = name === 'fail' || name === 'outside' ? name : 'ok';
  const ms = Number(q.get('track_ms'));
  const hold = q.get('track_hold');
  return mockTrackJobApi(scenario, {
    ...(ms > 0 ? { durationMs: ms } : {}),
    hold:
      hold !== null && Number.isFinite(Number(hold))
        ? Math.min(1, Math.max(0, Number(hold)))
        : null,
  });
}

let api: TrackJobApi | null = null;
export function getTrackJobApi(): TrackJobApi {
  if (!api) {
    const search = typeof location === 'undefined' || !import.meta.env.DEV ? '' : location.search;
    const env = import.meta.env.DEV
      ? (import.meta.env.VITE_SX_TRACK as string | undefined)
      : undefined;
    api = trackMockFromEnv(search, env) ?? httpTrackJobApi();
  }
  return api;
}
export function setTrackJobApi(next: TrackJobApi | null): void {
  api = next;
}
