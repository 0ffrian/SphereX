// The opt-in mock of the scan and run API (issue #157): INVENTED TEST VALUES, answering only on
// the dev server with `?scan=mock` (scanApi.getScanApi). Kept apart from the HTTP client so a
// production build never carries it. `scan_ms=<ms>` sets the time per square, `scan_hold=<square>`
// freezes the run while that square is analysing (screenshots).
import { mockStatusAt, type LivePlan } from './liveAreaApi';
import {
  RunGone,
  type FoundObject,
  type RunEvent,
  type RunKnownRow,
  type RunPosition,
  type RunRecord,
  type RunResults,
  type RunSquare,
  type RunState,
  type RunSummary,
  type RunTotals,
  type RunTrackRow,
  type ScanApi,
  type ScanBox,
  type ScanKind,
  type ScanPlan,
  type ScanPlanAnswer,
  type ScanPlanSquare,
  type ScanRequest,
} from './scanApi';
import { gridShape, SQUARE_ESTIMATE_S, splitRegion, squareCentre } from './scanGrid';

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
const MOCK_PROV = {
  tag: 'derived' as const,
  source: 'mock (invented test values)',
  formula: 'mock',
};

/** The mock's square boxes, in the backend's split (scanGrid mirrors `scan.split`). */
function mockSquares(region: ScanBox): ScanPlanSquare[] {
  const g = splitRegion(region);
  return g.squares.map((s) => {
    const c = squareCentre(s);
    return {
      index: s.index,
      row: s.row,
      col: s.col,
      box: {
        ra: r6(snap(c.ra)),
        dec: r6(snap(c.dec)),
        width_deg: r6(Math.min(2, snap(g.cellW + 0.1))),
        height_deg: r6(Math.min(2, snap(g.cellH + 0.1))),
      },
      area_id: null,
    };
  });
}

/** Square 4 is skipped (no visit pair), as in the mock-up. Invented. */
const MOCK_SKIP = 4;
const MOCK_VISITS = ['2026-06-27T03:10:00Z', '2026-06-28T03:10:00Z'];

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
  const model = 'model_dependent' as const;
  if (index === 2 || index === 3) {
    const u0 = index === 2 ? 0.55 : -0.05;
    out.push({
      kind: 'known',
      designation: '7051 Sean',
      square: index,
      positions: path(u0, 0.35, 0.22, 0.12),
      positions_tag: model,
    });
  } else {
    out.push({
      kind: 'known',
      designation: index <= names.length ? names[index - 1]! : `2026 AB${index}`,
      square: index,
      positions: path(0.2, 0.25, 0.15, 0.1),
      positions_tag: model,
    });
  }
  out.push({
    kind: 'predicted',
    designation: `2014 HX${480 + index}`,
    square: index,
    positions: path(0.3, 0.7, 0.08, 0.06),
    positions_tag: model,
  });
  if (index % 3 === 0)
    out.push({
      kind: 'unexplained',
      track_id: `T${index}`,
      square: index,
      positions: path(0.6, 0.55, 0.1, 0.12).slice(0, 2),
      positions_tag: 'measured',
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
    if (Math.max(req.width_deg, req.height_deg) > 12.0001 || !gridShape(req))
      return {
        kind: 'error',
        code: 'scan:too_large',
        detail: 'At most 12° a side and 36 squares.',
      };
    if (Math.abs(req.dec) + req.height_deg / 2 >= 89)
      return {
        kind: 'error',
        code: 'area:bad_box',
        detail: 'Scans cannot reach a celestial pole.',
      };
    const g = splitRegion(req);
    const squares = mockSquares(req);
    if (squares[0]) squares[0].area_id = 'live-dr1-mock-1';
    return {
      kind: 'plan',
      plan: {
        region: { ra: req.ra, dec: req.dec, width_deg: req.width_deg, height_deg: req.height_deg },
        release: 'spherex_dr1',
        kind: req.kind,
        cols: g.cols,
        rows: g.rows,
        squares: squares as ScanPlan['squares'],
        estimate_s: (squares.length - 1) * SQUARE_ESTIMATE_S,
        provenance: { squares: MOCK_PROV },
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
    let running: { index: number; areaId: string; f: number } | null = null;
    const known = new Set<string>();
    for (const sq of plan.plan.squares) {
      const c = cost(sq.index);
      const startT = acc;
      acc += c;
      const base = { index: sq.index, box: sq.box };
      const areaId = sq.area_id ?? `live-dr1-mock-${r.id.slice(-6)}-${sq.index}`;
      if (running || elapsed < startT) {
        squares.push({ ...base, area_id: null, state: 'todo' });
        continue;
      }
      events.push({ t: startT / 1000, type: 'square_started', square: sq.index, area_id: areaId });
      if (elapsed < acc) {
        if (r.stoppedAt === null) {
          running = { index: sq.index, areaId, f: (elapsed - startT) / c };
          squares.push({ ...base, area_id: areaId, state: 'running' });
        } else squares.push({ ...base, area_id: null, state: 'todo' });
        continue;
      }
      if (sq.index === MOCK_SKIP) {
        events.push({ t: acc / 1000, type: 'square_skipped', square: sq.index });
        squares.push({
          ...base,
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
        if (o.designation && !known.has(o.designation)) {
          known.add(o.designation);
          totals.known++;
          if (o.kind === 'known') totals.found++;
        }
        if (o.kind === 'unexplained') {
          totals.found++;
          totals.unexplained++;
        }
      }
      squares.push({ ...base, area_id: areaId, state: 'done' });
      totals.squares_done++;
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
    const live =
      running && state === 'running'
        ? mockStatusAt(running.areaId, hold !== null ? 0.6 : Math.min(0.99, running.f), {
            n_frames: 14,
            estimate_s: SQUARE_ESTIMATE_S,
          } as LivePlan)
        : null;
    return {
      run_id: r.id,
      kind: r.kind,
      release: 'spherex_dr1',
      region: r.region,
      squares: squares as RunRecord['squares'],
      state,
      created_at: iso(r.t0),
      started_at: iso(r.t0),
      finished_at:
        state === 'done' ? iso(r.t0 + r.pausedMs + acc) : state === 'stopped' ? iso(tNow) : null,
      totals,
      events: events.sort((a, b) => a.t - b.t),
      provenance: { known_positions: MOCK_PROV, track_positions: MOCK_PROV },
      ...(running && live
        ? {
            progress: {
              square: running.index,
              area_id: running.areaId,
              step: live.step ?? null,
              steps: live.steps,
            },
          }
        : {}),
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
    async list() {
      return [...runs.values()]
        .map((r) => summaryOf(recordOf(r), now()))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
  };
}

/** A run's list row (`run-list.schema.json` RunSummary), from its record. Pure. */
export function summaryOf(rec: RunRecord, nowMs: number): RunSummary {
  const start = rec.started_at ? Date.parse(rec.started_at) : null;
  const end = rec.finished_at ? Date.parse(rec.finished_at) : nowMs;
  return {
    run_id: rec.run_id,
    kind: rec.kind,
    region: rec.region,
    state: rec.state,
    created_at: rec.created_at,
    duration_s: start === null ? null : Math.max(0, Math.round((end - start) / 1000)),
    totals: rec.totals,
    squares_done: rec.squares.filter((s) => s.state === 'done').length,
    squares_total: rec.squares.length,
  };
}

/** The mock's merged results, in the contract's shape (designations merged, as #156's). Pure. */
export function mockResultsOf(rec: RunRecord): RunResults {
  const known = new Map<string, RunKnownRow>();
  const tracks: RunTrackRow[] = [];
  for (const e of rec.events) {
    const o = e.object;
    if (e.type !== 'found' || !o) continue;
    const areaId = e.area_id ?? 'live-dr1-mock';
    if (o.designation) {
      const prev = known.get(o.designation);
      if (prev) {
        if (!prev.squares.includes(o.square)) prev.squares.push(o.square);
        prev.positions.push(...o.positions);
        if (o.kind === 'known') prev.detected = true;
        const t = tracks.find((x) => x.designation === o.designation);
        if (t && o.kind === 'known') {
          if (!t.squares.includes(o.square)) t.squares.push(o.square);
          t.tracks.push({ square: o.square, area_id: areaId, track_id: `T${o.square}a` });
          t.positions.push(...o.positions);
        }
        continue;
      }
      const [num] = o.designation.split(' ');
      known.set(o.designation, {
        designation: o.designation,
        number: /^\d+$/.test(num ?? '') ? Number(num) : null,
        object_id: null,
        kind: 'asteroid',
        v_mag: o.kind === 'predicted' ? 21.2 : 17.4,
        detected: o.kind === 'known',
        track_available: false,
        squares: [o.square],
        visits: [...MOCK_VISITS],
        positions: [...o.positions],
      });
      // A known object found in the frames is also a Discovery track matched to it.
      if (o.kind === 'known')
        tracks.push({
          kind: 'found',
          designation: o.designation,
          squares: [o.square],
          tracks: [{ square: o.square, area_id: areaId, track_id: `T${o.square}a` }],
          visits: [...MOCK_VISITS],
          positions: [...o.positions],
        });
    } else if (o.track_id) {
      tracks.push({
        kind: 'unexplained',
        designation: null,
        squares: [o.square],
        tracks: [{ square: o.square, area_id: areaId, track_id: o.track_id }],
        visits: [...MOCK_VISITS],
        positions: o.positions,
      });
    }
  }
  return {
    run_id: rec.run_id,
    kind: rec.kind,
    release: rec.release,
    region: rec.region,
    state: rec.state,
    squares: rec.squares.map((s) => ({ index: s.index, area_id: s.area_id, state: s.state })),
    known: [...known.values()],
    tracks,
    provenance: { merge: MOCK_PROV, known_positions: MOCK_PROV, track_positions: MOCK_PROV },
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
