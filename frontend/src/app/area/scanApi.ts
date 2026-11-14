// Scans and runs (issue #157; backend #156, Q-470, Q-471): the API behind ONE module, so swapping
// the mock for the real backend touches this file only. The types are #156's contract
// (`shared/schemas/scan-plan`, `run`, `run-results`; generated `@/contract` types, D-18).
//
//   POST   /v1/scans {ra, dec, width_deg, height_deg, kind, start: false} -> 200 ScanPlan
//          (no network calls on the backend; visit pairs are resolved square by square by the job)
//   POST   same body with start: true -> 202 RunRecord
//          errors: 422 scan:too_large | area:bad_box, 429 queue_full, 503 offline
//   GET    /v1/runs/{run_id} -> RunRecord (404 run_not_found)
//   POST   /v1/runs/{run_id}/pause, /resume -> RunRecord (409 run_not_pausable | run_not_paused |
//          run_finished; 429 queue_full on resume)
//   DELETE /v1/runs/{run_id} -> 204 (stops it; finished squares stay stored)
//   GET    /v1/runs/{run_id}/results -> RunResults (merged results of the finished squares)
//   The running square's steps come with the record (`progress`, only while running).
//
// Which implementation answers: the HTTP client by default (a backend that does not serve the
// routes answers `unavailable`, and the tool keeps today's single-area flow). The MOCK only when
// asked, on the dev server only: `?scan=mock` (or VITE_SX_SCANS=mock; `scanMock.ts`). Its runs, objects and
// positions are INVENTED TEST VALUES, never shown in a public build. `scan_ms=<ms>` sets the time
// per square, `scan_hold=<square>` freezes the run while that square is analysing (screenshots).
import { API_BASE } from '@/app/api/config';
import type {
  LiveJobError,
  Run,
  RunEvent,
  RunKind,
  RunKnownRow,
  RunObject,
  RunPosition,
  RunRegion,
  RunResults,
  RunSquare,
  RunSquareState,
  RunState,
  RunTotals,
  RunTrackRow,
  ScanPlan as ContractScanPlan,
  ScanSquare,
} from '@/contract';
import { scanMockFromEnv } from './scanMock';

// ---- Types: #156's contract (`scan-plan`, `run`, `run-results` schemas; generated) ----------

export type ScanKind = RunKind;
/** A box on the sky: centre and sides in degrees (north up, on the centre's tangent plane). */
export type ScanBox = RunRegion;
export type ScanPlanSquare = ScanSquare;
export type ScanPlan = ContractScanPlan;
export type SquareState = RunSquareState;
export type RunError = LiveJobError;
export type FoundObject = RunObject;
export type FoundKind = RunObject['kind'];
export type RunEventType = RunEvent['type'];
/** The record of a run (`GET /v1/runs/{id}`). */
export type RunRecord = Run;
export type {
  RunEvent,
  RunKnownRow,
  RunPosition,
  RunResults,
  RunSquare,
  RunState,
  RunTotals,
  RunTrackRow,
};

export type ScanErrorCode = string;
export type ScanPlanAnswer =
  | { kind: 'plan'; plan: ScanPlan }
  | { kind: 'error'; code: ScanErrorCode; detail: string }
  /** No scan routes (not served, not reachable): the region falls back to the single-area flow. */
  | { kind: 'unavailable' };
export type ScanStartAnswer =
  | { kind: 'started'; run: RunRecord }
  | { kind: 'error'; code: ScanErrorCode; detail: string }
  | { kind: 'unavailable' };

/** The server no longer knows the run (404 `run_not_found`). */
export class RunGone extends Error {
  constructor(runId: string) {
    super(`No run '${runId}'.`);
    this.name = 'RunGone';
  }
}

export interface ScanRequest extends ScanBox {
  kind: ScanKind;
}

export interface ScanApi {
  plan(req: ScanRequest, signal?: AbortSignal): Promise<ScanPlanAnswer>;
  start(req: ScanRequest, signal?: AbortSignal): Promise<ScanStartAnswer>;
  /** Throws RunGone when the server has no such run, another error when it cannot be read. */
  run(runId: string, signal?: AbortSignal): Promise<RunRecord>;
  pause(runId: string): Promise<RunRecord>;
  resume(runId: string): Promise<RunRecord>;
  stop(runId: string): Promise<void>;
  results(runId: string, signal?: AbortSignal): Promise<RunResults>;
}

// ---- Reply checks (shape only; #156's schemas replace them) ------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isBox = (v: unknown): v is ScanBox =>
  isObj(v) && isNum(v.ra) && isNum(v.dec) && isNum(v.width_deg) && isNum(v.height_deg);

export const SCAN_ERRORS: readonly string[] = [
  'scan:too_large',
  'area:bad_box',
  'queue_full',
  'offline',
  'upstream_unavailable',
];
const isScanError = (code: string) =>
  SCAN_ERRORS.includes(code) || code.startsWith('scan:') || code.startsWith('area:');

const SQUARE_STATES: readonly string[] = ['todo', 'running', 'done', 'skipped', 'failed'];
const RUN_STATES: readonly string[] = ['queued', 'running', 'paused', 'done', 'stopped', 'failed'];

const bad = (what: string) => new Error(`${what} reply does not match the contract.`);

export function parseScanPlan(body: unknown): ScanPlanAnswer {
  if (!isObj(body)) return { kind: 'unavailable' };
  if (isStr(body.error) && isScanError(body.error))
    return { kind: 'error', code: body.error, detail: isStr(body.detail) ? body.detail : '' };
  const sq = body.squares;
  if (
    isStr(body.release) &&
    isBox(body.region) &&
    isNum(body.cols) &&
    isNum(body.rows) &&
    isNum(body.estimate_s) &&
    Array.isArray(sq) &&
    sq.length === body.cols * body.rows &&
    sq.every(
      (s: unknown) =>
        isObj(s) && isNum(s.index) && isBox(s.box) && (isStr(s.area_id) || s.area_id === null),
    )
  )
    return { kind: 'plan', plan: body as unknown as ScanPlan };
  return { kind: 'unavailable' };
}

export function parseRunRecord(body: unknown): RunRecord {
  if (
    !isObj(body) ||
    !isStr(body.run_id) ||
    !isStr(body.kind) ||
    !isBox(body.region) ||
    !isStr(body.state) ||
    !RUN_STATES.includes(body.state)
  )
    throw bad('Run');
  if (!Array.isArray(body.squares) || !Array.isArray(body.events) || !isObj(body.totals))
    throw bad('Run');
  for (const s of body.squares as unknown[])
    if (
      !isObj(s) ||
      !isNum(s.index) ||
      !isBox(s.box) ||
      !isStr(s.state) ||
      !SQUARE_STATES.includes(s.state)
    )
      throw bad('Run');
  for (const e of body.events as unknown[])
    if (!isObj(e) || !isNum(e.t) || !isStr(e.type)) throw bad('Run');
  return body as unknown as RunRecord;
}

export function parseRunResults(body: unknown): RunResults {
  if (
    !isObj(body) ||
    !isStr(body.run_id) ||
    !Array.isArray(body.known) ||
    !Array.isArray(body.tracks)
  )
    throw bad('Run results');
  return body as unknown as RunResults;
}

// ---- HTTP --------------------------------------------------------------------------------------

/** One poll waits at most this long (engineering value, as the live areas'). */
export const RUN_TIMEOUT_MS = 10_000;

export function httpScanApi(
  base = API_BASE,
  fetchImpl: typeof fetch = (i, init) => globalThis.fetch(i, init),
): ScanApi {
  const json = async (res: Response): Promise<unknown> => {
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) return null;
    return res.json().catch(() => null);
  };
  const aborted = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
  const post = (req: ScanRequest, start: boolean, signal?: AbortSignal) =>
    fetchImpl(`${base}/scans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...req, start }),
      signal,
    });
  const timed = (signal?: AbortSignal) => {
    const t = AbortSignal.timeout(RUN_TIMEOUT_MS);
    return signal ? AbortSignal.any([signal, t]) : t;
  };
  const runUrl = (id: string, tail = '') => `${base}/runs/${encodeURIComponent(id)}${tail}`;
  const readRun = async (res: Response, id: string) => {
    const body = await json(res);
    if (res.status === 404) throw new RunGone(id);
    if (!res.ok) throw new Error(`Run request failed (${res.status}).`);
    return parseRunRecord(body);
  };
  return {
    async plan(req, signal) {
      try {
        return parseScanPlan(await json(await post(req, false, signal)));
      } catch (e) {
        if (aborted(e)) throw e;
        return { kind: 'unavailable' };
      }
    },
    async start(req, signal) {
      try {
        const res = await post(req, true, signal);
        const body = await json(res);
        if (isObj(body) && isStr(body.error) && isScanError(body.error))
          return { kind: 'error', code: body.error, detail: isStr(body.detail) ? body.detail : '' };
        if (res.status !== 202 && !res.ok) return { kind: 'unavailable' };
        return { kind: 'started', run: parseRunRecord(body) };
      } catch (e) {
        if (aborted(e)) throw e;
        return { kind: 'unavailable' };
      }
    },
    async run(id, signal) {
      return readRun(await fetchImpl(runUrl(id), { signal: timed(signal) }), id);
    },
    async pause(id) {
      return readRun(await fetchImpl(runUrl(id, '/pause'), { method: 'POST' }), id);
    },
    async resume(id) {
      return readRun(await fetchImpl(runUrl(id, '/resume'), { method: 'POST' }), id);
    },
    async stop(id) {
      const res = await fetchImpl(runUrl(id), { method: 'DELETE' });
      // 404: no such run; 409 run_finished: it has finished or is already stopping.
      if (!res.ok && res.status !== 404 && res.status !== 409)
        throw new Error(`Stop failed (${res.status}).`);
    },
    async results(id, signal) {
      const res = await fetchImpl(runUrl(id, '/results'), { signal: timed(signal) });
      const body = await json(res);
      if (res.status === 404) throw new RunGone(id);
      return parseRunResults(body);
    },
  };
}

let api: ScanApi | null = null;
/** The scan API in use: the opt-in mock (dev server only), else the backend. */
export function getScanApi(): ScanApi {
  if (!api) {
    const search = typeof location === 'undefined' || !import.meta.env.DEV ? '' : location.search;
    const env = import.meta.env.DEV
      ? (import.meta.env.VITE_SX_SCANS as string | undefined)
      : undefined;
    // The mock only on the dev server: a production build drops the branch (and the mock).
    api = (import.meta.env.DEV ? scanMockFromEnv(search, env) : null) ?? httpScanApi();
  }
  return api;
}
/** Tests: put an implementation in place (null: choose again from the URL and env). */
export function setScanApi(next: ScanApi | null): void {
  api = next;
}
