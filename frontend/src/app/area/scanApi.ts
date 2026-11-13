// Scans and runs (issue #157; backend #156, Q-470, Q-471): the API behind ONE module, so swapping
// the mock for the real backend touches this file only. #156 has not published its schemas yet,
// so the types below are copied from #156's spec (and posted on #156 for the backend to match);
// once `shared/schemas/scan-plan.schema.json` and `run*.schema.json` exist, these become aliases of
// the generated `@/contract` types.
//
//   POST   /v1/scans {ra, dec, width_deg, height_deg, kind, start: false} -> 200 ScanPlan
//          (no network calls on the backend; visit pairs are resolved square by square by the job)
//   POST   same body with start: true -> 202 RunRecord
//          errors: 422 scan:too_large | area:bad_box, 429 queue_full, 503 offline
//   GET    /v1/runs/{run_id} -> RunRecord (404 run_not_found)
//   POST   /v1/runs/{run_id}/pause, /resume -> RunRecord (409 when not applicable)
//   DELETE /v1/runs/{run_id} -> 204 (stops it; finished squares stay stored)
//   GET    /v1/runs/{run_id}/results -> RunResults (merged results of the finished squares)
//   The running square's steps: #141's GET /v1/areas/live/{area_id} (liveAreaApi.status).
//
// Which implementation answers: the HTTP client by default (a backend that does not serve the
// routes answers `unavailable`, and the tool keeps today's single-area flow). The MOCK only when
// asked, on the dev server only: `?scan=mock` (or VITE_SX_SCANS=mock). Its runs, objects and
// positions are INVENTED TEST VALUES, never shown in a public build. `scan_ms=<ms>` sets the time
// per square, `scan_hold=<square>` freezes the run while that square is analysing (screenshots).
import { API_BASE } from '@/app/api/config';
import { getLiveAreaApi, mockStatusAt, type LiveJobStatus, type LivePlan } from './liveAreaApi';
import { SQUARE_ESTIMATE_S, splitRegion, squareCentre } from './scanGrid';

// ---- Types (#156) ------------------------------------------------------------------------------

export type ScanKind = 'discovery' | 'known';
/** A box on the sky: centre and sides in degrees (north up, on the centre's tangent plane). */
export interface ScanBox {
  ra: number;
  dec: number;
  width_deg: number;
  height_deg: number;
}
export interface ScanPlanSquare {
  /** 1..N: top row first, left to right on screen, row by row. */
  index: number;
  /** The square's box, padded 0.05° and snapped (`live.snap_box`), as its live area's box. */
  box: ScanBox;
  /** The stored area of the same box, when it is already computed; else null. */
  area_id: string | null;
}
export interface ScanPlan {
  /** Data release, e.g. `spherex_dr1` (not in #156's list: asked for on #156, the card shows it). */
  release: string;
  /** The region as snapped by the backend (0.05°). */
  region: ScanBox;
  cols: number;
  rows: number;
  squares: ScanPlanSquare[];
  /** Rough run time in seconds: the squares not stored yet. */
  estimate_s: number;
}

export type SquareState = 'todo' | 'running' | 'done' | 'skipped' | 'failed';
export type RunState = 'queued' | 'running' | 'paused' | 'done' | 'stopped' | 'failed';
export interface RunError {
  code: string;
  detail: string;
}
export interface RunSquare extends ScanPlanSquare {
  state: SquareState;
  error?: RunError;
}
export interface RunPosition {
  ra: number;
  dec: number;
  /** ISO UTC. */
  time: string;
}
export type FoundKind = 'known' | 'unexplained' | 'predicted';
export interface FoundObject {
  kind: FoundKind;
  /** Known and predicted objects: the designation as SkyBoT gives it ("7051 Sean"). */
  designation?: string;
  /** Tracks found by Discovery: the square's track id ("T7"). */
  track_id?: string;
  square: number;
  /** The trajectory drawn: Horizons positions for known objects, measured dots for tracks. */
  positions: RunPosition[];
  /** SkyBoT's V magnitude, when given (optional; asked for on #156 for the label). */
  v_mag?: number | null;
}
export type RunEventType =
  | 'run_started'
  | 'square_started'
  | 'square_done'
  | 'square_skipped'
  | 'square_failed'
  | 'found'
  | 'run_paused'
  | 'run_resumed'
  | 'run_done'
  | 'run_stopped';
export interface RunEvent {
  /** Seconds since `started_at`. */
  t: number;
  type: RunEventType;
  square?: number;
  area_id?: string;
  object?: FoundObject;
}
export interface RunTotals {
  known: number;
  found: number;
  unexplained: number;
  squares_done: number;
  squares_skipped: number;
}
export interface RunRecord {
  run_id: string;
  kind: ScanKind;
  release: string;
  region: ScanBox;
  squares: RunSquare[];
  state: RunState;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  totals: RunTotals;
  events: RunEvent[];
  /** Queued behind another job: its place (1 = next). Optional (#141's `queue_position`). */
  queue_position?: number;
}

/** One known object of the merged results, de-duplicated by designation. */
export interface RunKnownRow {
  designation: string;
  /** Null for an unnumbered object. */
  number: number | null;
  name: string | null;
  /** "asteroid", "comet". */
  kind: string;
  v_mag: number | null;
  /** True when Discovery found it blind in a square (a track matched to it). */
  detected: boolean;
  /** The backend's object id (`sbdb-…`), null when it has none. */
  object_id: string | null;
  /** The Track pane can open it at once (Q-461). */
  track_available: boolean;
  squares: number[];
  /** ISO dates of the visit pairs it was seen or predicted in (one per square). */
  dates: string[];
  positions: RunPosition[];
}
/** One Discovery track of the merged results; duplicates within 30″ across neighbouring squares merged. */
export interface RunTrackRow {
  track_id: string;
  verdict: 'found_blind' | 'unexplained' | 'possible' | 'unchecked';
  /** The known object it matched, when found_blind. */
  designation: string | null;
  rate_deg_day: number | null;
  squares: number[];
  dates: string[];
  /** The stored area of its first square (the Track and Build it read it). */
  area_id: string;
  positions: RunPosition[];
}
export interface RunResults {
  run_id: string;
  release: string;
  squares_total: number;
  squares_done: number;
  skipped: { index: number; error: RunError }[];
  /** First visit start and last visit end over every finished square (ISO UTC). */
  visits: { start: string; end: string } | null;
  n_frames: number;
  known: RunKnownRow[];
  tracks: RunTrackRow[];
}

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
  /** The running square's steps (#141's live area job). */
  squareStatus(areaId: string, signal?: AbortSignal): Promise<LiveJobStatus>;
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
      if (!res.ok && res.status !== 404) throw new Error(`Stop failed (${res.status}).`);
    },
    async results(id, signal) {
      const res = await fetchImpl(runUrl(id, '/results'), { signal: timed(signal) });
      const body = await json(res);
      if (res.status === 404) throw new RunGone(id);
      return parseRunResults(body);
    },
    squareStatus: (areaId, signal) => getLiveAreaApi().status(areaId, signal),
  };
}

// ---- Mock (opt-in; invented test values) -------------------------------------------------------

interface MockRun {
  id: string;
  kind: ScanKind;
  region: ScanBox;
  t0: number;
  /** Time spent paused so far (ms), and when the current pause started. */
  pausedMs: number;
  pausedAt: number | null;
  stoppedAt: number | null;
}

const MOCK_KEY = 'sx-scan-mock-runs';
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const snap = (x: number) => Math.round(x / 0.05) * 0.05;

/** The mock's square boxes: the equal split, padded 0.05° and snapped (as #156's). */
function mockSquares(region: ScanBox): ScanPlanSquare[] {
  const g = splitRegion(region);
  return g.squares.map((s) => {
    const c = squareCentre(s);
    return {
      index: s.index,
      box: {
        ra: r6(c.ra),
        dec: r6(c.dec),
        width_deg: r6(snap(g.cellW + 0.1)),
        height_deg: r6(snap(g.cellH + 0.1)),
      },
      area_id: null,
    };
  });
}

/** Square 4 is skipped (no visit pair), as in the mock-up; square 9 fails once. Invented. */
const MOCK_SKIP = 4;

/**
 * Invented objects of a mock square: a known object crossing it, one predicted-only object and, in
 * every third square, an unexplained track. The known object of square 2 continues into square 3
 * (the same designation), so a trajectory carries across a border.
 */
export function mockObjectsOf(region: ScanBox, index: number): FoundObject[] {
  const g = splitRegion(region);
  const s = g.squares[index - 1];
  if (!s) return [];
  const at = (u: number, v: number) => squareCentre(s, u, v);
  const times = ['2026-06-27T03:10:00Z', '2026-06-28T03:10:00Z', '2026-06-29T03:10:00Z'];
  const path = (u0: number, v0: number, du: number, dv: number): RunPosition[] =>
    times.map((time, k) => ({ ...at(u0 + du * k, v0 + dv * k), time }));
  const names = [
    '9532 Abramenko',
    '1993 EW',
    '2001 FP77',
    '5535 Annefrank',
    '1999 TD264',
    '4179 Toutatis',
  ];
  const out: FoundObject[] = [];
  if (index === 2 || index === 3) {
    // 7051 Sean: from the middle of square 2 across the border into square 3.
    const u0 = index === 2 ? 0.55 : -0.05;
    out.push({
      kind: 'known',
      designation: '7051 Sean',
      square: index,
      positions: path(u0, 0.35, 0.22, 0.12),
      v_mag: 17.7,
    });
  } else {
    out.push({
      kind: 'known',
      designation: index <= names.length ? names[index - 1]! : `2026 AB${index}`,
      square: index,
      positions: path(0.2, 0.25, 0.15, 0.1),
      v_mag: 17 + (index % 5) * 0.4,
    });
  }
  out.push({
    kind: 'predicted',
    designation: `2014 HX${480 + index}`,
    square: index,
    positions: path(0.3, 0.7, 0.08, 0.06),
    v_mag: 21.2,
  });
  if (index % 3 === 0)
    out.push({
      kind: 'unexplained',
      track_id: `T${index}`,
      square: index,
      positions: path(0.6, 0.55, 0.1, 0.12).slice(0, 2),
    });
  return out;
}

export function mockScanApi(
  opts: { squareMs?: number; hold?: number | null; now?: () => number; persist?: boolean } = {},
): ScanApi {
  const squareMs = opts.squareMs ?? 4000;
  const now = opts.now ?? (() => Date.now());
  const hold = opts.hold ?? null;
  const persist = opts.persist ?? true;
  const runs = new Map<string, MockRun>();
  // Kept in this browser only so a page reload finds the mock run again (e2e, screenshots).
  const load = () => {
    if (!persist) return;
    try {
      const raw = localStorage.getItem(MOCK_KEY);
      if (raw) for (const r of JSON.parse(raw) as MockRun[]) runs.set(r.id, r);
    } catch {
      /* storage blocked: the mock forgets runs on reload */
    }
  };
  const save = () => {
    if (!persist) return;
    try {
      localStorage.setItem(MOCK_KEY, JSON.stringify([...runs.values()]));
    } catch {
      /* storage blocked */
    }
  };
  load();
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const planOf = (req: ScanRequest): ScanPlanAnswer => {
    const g = splitRegion(req);
    if (Math.max(req.width_deg, req.height_deg) > 12.0001 || g.cols * g.rows > 36)
      return {
        kind: 'error',
        code: 'scan:too_large',
        detail: 'At most 12° a side and 36 squares.',
      };
    if (Math.abs(req.dec) + req.height_deg / 2 >= 89)
      return { kind: 'error', code: 'area:bad_box', detail: 'The region reaches a pole.' };
    const squares = mockSquares(req);
    if (squares[0]) squares[0].area_id = 'live-dr1-mock-1';
    return {
      kind: 'plan',
      plan: {
        release: 'spherex_dr1',
        region: req,
        cols: g.cols,
        rows: g.rows,
        squares,
        estimate_s: (squares.length - 1) * SQUARE_ESTIMATE_S,
      },
    };
  };
  /** The run as it is at `now`: pure from the mock's own clock. */
  const recordOf = (r: MockRun): RunRecord => {
    const plan = planOf({ ...r.region, kind: r.kind });
    if (plan.kind !== 'plan') throw new Error('mock plan');
    const tNow = r.stoppedAt ?? r.pausedAt ?? now();
    let elapsed = Math.max(0, tNow - r.t0 - r.pausedMs);
    // Square 1 is stored: done at once. Each other square takes squareMs.
    const cost = (i: number) => (i === 1 ? 0 : i === MOCK_SKIP ? squareMs * 0.1 : squareMs);
    if (hold !== null) {
      let upTo = 0;
      for (let i = 1; i < hold; i++) upTo += cost(i);
      elapsed = upTo + squareMs * 0.6;
    }
    const events: RunEvent[] = [{ t: 0, type: 'run_started' }];
    const squares: RunSquare[] = [];
    const totals: RunTotals = {
      known: 0,
      found: 0,
      unexplained: 0,
      squares_done: 0,
      squares_skipped: 0,
    };
    let acc = 0;
    let running = false;
    for (const sq of plan.plan.squares) {
      const c = cost(sq.index);
      const startT = acc;
      acc += c;
      const areaId = sq.area_id ?? `live-dr1-mock-${r.id.slice(-6)}-${sq.index}`;
      if (running || elapsed < startT) {
        squares.push({ ...sq, area_id: null, state: 'todo' });
        continue;
      }
      events.push({ t: startT / 1000, type: 'square_started', square: sq.index, area_id: areaId });
      if (elapsed < acc) {
        running = r.stoppedAt === null;
        squares.push({ ...sq, area_id: areaId, state: running ? 'running' : 'todo' });
        continue;
      }
      if (sq.index === MOCK_SKIP) {
        events.push({ t: acc / 1000, type: 'square_skipped', square: sq.index });
        squares.push({
          ...sq,
          area_id: null,
          state: 'skipped',
          error: { code: 'area:no_visit_pair', detail: 'No two visits within 6 h there.' },
        });
        totals.squares_skipped++;
        continue;
      }
      events.push({ t: acc / 1000, type: 'square_done', square: sq.index, area_id: areaId });
      for (const o of mockObjectsOf(r.region, sq.index)) {
        events.push({ t: acc / 1000, type: 'found', square: sq.index, area_id: areaId, object: o });
        if (o.kind === 'known') {
          totals.known++;
          totals.found++;
        } else if (o.kind === 'unexplained') {
          totals.found++;
          totals.unexplained++;
        } else totals.known++;
      }
      squares.push({ ...sq, area_id: areaId, state: 'done' });
      totals.squares_done++;
    }
    // 7051 Sean is one object in squares 2 and 3.
    if (squares[1]?.state === 'done' && squares[2]?.state === 'done') {
      totals.known--;
      totals.found--;
    }
    const finished = squares.every((s) => s.state === 'done' || s.state === 'skipped');
    const state: RunState =
      r.stoppedAt !== null
        ? 'stopped'
        : finished
          ? 'done'
          : r.pausedAt !== null
            ? 'paused'
            : 'running';
    if (state === 'done') events.push({ t: acc / 1000, type: 'run_done' });
    if (state === 'stopped') events.push({ t: elapsed / 1000, type: 'run_stopped' });
    if (state === 'paused') events.push({ t: elapsed / 1000, type: 'run_paused' });
    return {
      run_id: r.id,
      kind: r.kind,
      release: 'spherex_dr1',
      region: r.region,
      squares,
      state,
      created_at: iso(r.t0),
      started_at: iso(r.t0),
      finished_at:
        state === 'done' ? iso(r.t0 + r.pausedMs + acc) : state === 'stopped' ? iso(tNow) : null,
      totals,
      events: events.sort((a, b) => a.t - b.t),
    };
  };
  const get = (id: string) => {
    const r = runs.get(id);
    if (!r) throw new RunGone(id);
    return r;
  };
  return {
    async plan(req) {
      return planOf(req);
    },
    async start(req) {
      const p = planOf(req);
      if (p.kind !== 'plan') return p;
      const t = now();
      const id = `run-${iso(t).replace(/[-:]/g, '').replace(/Z$/, '')}-${(t % 0xffffff).toString(16).padStart(6, '0')}`;
      const r: MockRun = {
        id,
        kind: req.kind,
        region: p.plan.region,
        t0: t,
        pausedMs: 0,
        pausedAt: null,
        stoppedAt: null,
      };
      runs.set(id, r);
      save();
      return { kind: 'started', run: recordOf(r) };
    },
    async run(id) {
      return recordOf(get(id));
    },
    async pause(id) {
      const r = get(id);
      if (r.pausedAt === null && r.stoppedAt === null) r.pausedAt = now();
      save();
      return recordOf(r);
    },
    async resume(id) {
      const r = get(id);
      if (r.pausedAt !== null) {
        r.pausedMs += now() - r.pausedAt;
        r.pausedAt = null;
      }
      save();
      return recordOf(r);
    },
    async stop(id) {
      const r = runs.get(id);
      if (r && r.stoppedAt === null) r.stoppedAt = r.pausedAt ?? now();
      save();
    },
    async results(id) {
      return mockResultsOf(recordOf(get(id)));
    },
    async squareStatus(areaId) {
      // The running square's progress: its share of the square's time.
      for (const r of runs.values()) {
        const rec = recordOf(r);
        const sq = rec.squares.find((s) => s.area_id === areaId);
        if (!sq) continue;
        const start =
          rec.events.find((e) => e.type === 'square_started' && e.square === sq.index)?.t ?? 0;
        const tNow = Math.max(0, (r.pausedAt ?? now()) - r.t0 - r.pausedMs) / 1000;
        const f =
          hold !== null
            ? 0.6
            : sq.state === 'running'
              ? Math.min(0.99, (tNow - start) / (squareMs / 1000))
              : 1;
        const plan = { n_frames: 14, estimate_s: SQUARE_ESTIMATE_S } as LivePlan;
        return mockStatusAt(areaId, f, plan);
      }
      throw new Error('no such square');
    },
  };
}

/** The mock's merged results, from its record (designations merged, as #156's). Pure. */
export function mockResultsOf(rec: RunRecord): RunResults {
  const known = new Map<string, RunKnownRow>();
  const tracks: RunTrackRow[] = [];
  for (const e of rec.events) {
    const o = e.object;
    if (e.type !== 'found' || !o) continue;
    const date = o.positions[0]?.time.slice(0, 10) ?? '';
    if (o.designation) {
      const prev = known.get(o.designation);
      if (prev) {
        const t = tracks.find((x) => x.designation === o.designation);
        if (t && !t.squares.includes(o.square)) t.squares.push(o.square);
        prev.squares.push(o.square);
        if (!prev.dates.includes(date)) prev.dates.push(date);
        prev.positions.push(...o.positions);
        continue;
      }
      const [num, ...rest] = o.designation.split(' ');
      const numbered = /^\d+$/.test(num ?? '');
      known.set(o.designation, {
        designation: o.designation,
        number: numbered ? Number(num) : null,
        name: numbered ? rest.join(' ') : null,
        kind: 'asteroid',
        v_mag: o.v_mag ?? null,
        detected: o.kind === 'known',
        object_id: null,
        track_available: false,
        squares: [o.square],
        dates: [date],
        positions: [...o.positions],
      });
      // A known object found in the frames is also a Discovery track matched to it (found blind).
      if (o.kind === 'known')
        tracks.push({
          track_id: `T${o.square}a`,
          verdict: 'found_blind',
          designation: o.designation,
          rate_deg_day: 0.3,
          squares: [o.square],
          dates: [date],
          area_id: e.area_id ?? '',
          positions: o.positions,
        });
    } else if (o.track_id) {
      tracks.push({
        track_id: o.track_id,
        verdict: 'unexplained',
        designation: null,
        rate_deg_day: 0.31,
        squares: [o.square],
        dates: [date],
        area_id: e.area_id ?? '',
        positions: o.positions,
      });
    }
  }
  const done = rec.squares.filter((s) => s.state === 'done');
  return {
    run_id: rec.run_id,
    release: rec.release,
    squares_total: rec.squares.length,
    squares_done: done.length,
    skipped: rec.squares
      .filter((s) => s.state === 'skipped' || s.state === 'failed')
      .map((s) => ({ index: s.index, error: s.error ?? { code: 'area:failed', detail: '' } })),
    visits: done.length > 0 ? { start: '2026-06-24T02:00:00Z', end: '2026-07-02T06:30:00Z' } : null,
    n_frames: done.length * 14,
    known: [...known.values()],
    tracks,
  };
}

/** The mock asked for in the page URL or the build env, or null. */
export function scanMockFromEnv(search: string, env: string | undefined): ScanApi | null {
  const q = new URLSearchParams(search);
  const v = q.get('scan') ?? env ?? '';
  if (!v.startsWith('mock')) return null;
  const ms = Number(q.get('scan_ms'));
  const hold = Number(q.get('scan_hold'));
  return mockScanApi({
    ...(ms > 0 ? { squareMs: ms } : {}),
    hold: hold >= 1 ? Math.floor(hold) : null,
  });
}

let api: ScanApi | null = null;
/** The scan API in use: the opt-in mock (dev server only), else the backend. */
export function getScanApi(): ScanApi {
  if (!api) {
    const search = typeof location === 'undefined' || !import.meta.env.DEV ? '' : location.search;
    const env = import.meta.env.DEV
      ? (import.meta.env.VITE_SX_SCANS as string | undefined)
      : undefined;
    api = scanMockFromEnv(search, env) ?? httpScanApi();
  }
  return api;
}
/** Tests: put an implementation in place (null: choose again from the URL and env). */
export function setScanApi(next: ScanApi | null): void {
  api = next;
}
