// Replay of a recorded run (issue #158; mock-up state 13; #156 run record, Q-471). Pure: the run
// as it was at time t is a function of the record and t only, so the same speed and position
// always show the same frame (deterministic). Nothing is computed again: squares change state and
// objects appear at the times of the run's own events.
//   t           seconds since the run's `started_at` (the events' own clock)
//   recordAt    the record at t: events up to t, each square's state from its last event, totals
//   ticksOf     the timeline marks: green a known object found, amber unexplained, red skipped
//   foundAtOf   when each circled object was first found (the label's "found at 0:21:40")
import type { RunEvent, RunRecord, RunSummary, SquareState as RunSquareState } from './scanApi';

export const REPLAY_SPEEDS = [1, 10, 60, 600] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

const SQUARE_EVENT: Partial<Record<RunEvent['type'], RunSquareState>> = {
  square_started: 'running',
  square_done: 'done',
  square_skipped: 'skipped',
  square_failed: 'failed',
};

/**
 * How long the run lasts on the timeline (s): started to finished for a finished run, else up to
 * its last event (a running run replays what is recorded so far). 0 for a run that never started.
 */
export function durationOf(run: RunRecord): number {
  const last = run.events.reduce((m, e) => Math.max(m, e.t), 0);
  if (run.started_at && run.finished_at) {
    const d = (Date.parse(run.finished_at) - Date.parse(run.started_at)) / 1000;
    if (Number.isFinite(d)) return Math.max(d, last);
  }
  return last;
}

/** The record as it was at `t` (s since `started_at`). Same input, same output. */
export function recordAt(run: RunRecord, t: number): RunRecord {
  const events = run.events.filter((e) => e.t <= t);
  const state = new Map<number, RunSquareState>();
  for (const e of events) {
    const s = SQUARE_EVENT[e.type];
    if (s && e.square !== undefined) state.set(e.square, s);
  }
  const squares = run.squares.map((sq) => {
    const st = state.get(sq.index) ?? 'todo';
    const out = { ...sq, state: st };
    // A square only has its results (and its error) once it has finished.
    if (st !== 'done' && st !== 'failed' && st !== 'skipped') out.area_id = null;
    if (st !== 'failed' && st !== 'skipped') delete out.error;
    return out;
  });
  // One per object, as the circles are (an object found in two squares counts once).
  const known = new Set<string>();
  const found = new Set<string>();
  const unexplained = new Set<string>();
  for (const e of events) {
    const o = e.type === 'found' ? e.object : undefined;
    if (!o) continue;
    const k = objectKey(o);
    if (o.kind === 'unexplained') unexplained.add(k);
    else {
      known.add(k);
      if (o.kind === 'known') found.add(k);
    }
  }
  const end = durationOf(run);
  const finished =
    t >= end && (run.state === 'done' || run.state === 'stopped' || run.state === 'failed');
  const paused = isPausedAt(events);
  return {
    ...run,
    squares: squares as RunRecord['squares'],
    events,
    state: finished ? run.state : paused ? 'paused' : 'running',
    finished_at: finished ? run.finished_at : null,
    // The end frame is the run itself: its totals are the server's (#156 merges a track found in
    // two neighbouring squares, which the events alone cannot tell).
    totals: finished
      ? run.totals
      : {
          known: known.size,
          found: found.size,
          unexplained: unexplained.size,
          squares_done: squares.filter((s) => s.state === 'done').length,
          squares_skipped: squares.filter((s) => s.state === 'skipped').length,
        },
  };
}

function isPausedAt(events: readonly RunEvent[]): boolean {
  let paused = false;
  for (const e of events) {
    if (e.type === 'run_paused') paused = true;
    else if (e.type === 'run_resumed') paused = false;
  }
  return paused;
}

/** "square 3 of 15": the square being analysed at t, else the last one that finished; 0 before any. */
export function squareAt(run: RunRecord, t: number): number {
  let n = 0;
  for (const e of run.events) {
    if (e.t > t) break;
    if (e.square !== undefined && SQUARE_EVENT[e.type]) n = e.square;
  }
  return n;
}

export type TickKind = 'known' | 'unexplained' | 'skipped' | 'track';
export interface Tick {
  t: number;
  kind: TickKind;
  /** What happened, for the tick's name ("7051 Sean found", "Square 4 skipped"). */
  label: string;
}

/**
 * The timeline's marks, in time order. Predicted-only objects (not found) have no mark. At Measured
 * only (#170) a find is named by its track ("Track T4 found", square in the label) and is a plain
 * `known`-shaped mark: no verdict colour and no known name; a find without a track id has none.
 */
export function ticksOf(run: RunRecord, measured = false): Tick[] {
  const out: Tick[] = [];
  const seen = new Set<string>();
  for (const e of [...run.events].sort((a, b) => a.t - b.t)) {
    if (e.type === 'square_skipped' || e.type === 'square_failed') {
      out.push({
        t: e.t,
        kind: 'skipped',
        label: `Square ${e.square ?? '?'} ${e.type === 'square_failed' ? 'failed' : 'skipped'}`,
      });
      continue;
    }
    const o = e.type === 'found' ? e.object : undefined;
    if (!o || o.kind === 'predicted') continue;
    if (measured) {
      // As the sky at Measured only: only finds whose positions were measured (a matched known
      // object's event carries Horizons positions, so it has no mark here, nor a ring).
      if (!o.track_id || o.positions_tag !== 'measured') continue;
      const key = `${o.square}:${o.track_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ t: e.t, kind: 'track', label: `Track ${o.track_id} found, square ${o.square}` });
      continue;
    }
    const key = objectKey(o);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      t: e.t,
      kind: o.kind,
      label:
        o.kind === 'known'
          ? `${o.designation ?? 'Known object'} found`
          : `${o.track_id ?? 'Track'} unexplained, square ${o.square}`,
    });
  }
  return out;
}

/** The key scanObjects.objectsFromEvents gives an object (designation, else square and track). */
export function objectKey(o: { designation?: string; square: number; track_id?: string }): string {
  return o.designation ?? `${o.square}:${o.track_id ?? ''}`;
}

/**
 * When each object was first found (s), by objectsFromEvents' key. Predicted events are not finds:
 * a predicted-only object has no entry (its label keeps "predicted · V…"), and an object predicted
 * first and detected later is found at its detection, the time its tick shows (as ticksOf).
 */
export function foundAtOf(run: RunRecord): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of run.events) {
    const o = e.type === 'found' ? e.object : undefined;
    if (!o || o.kind === 'predicted') continue;
    const k = objectKey(o);
    const prev = out.get(k);
    if (prev === undefined || e.t < prev) out.set(k, e.t);
  }
  return out;
}

/** "1:19:05" (h:mm:ss), or "4:05" under an hour; whole seconds, rounded down. */
export function clock(s: number): string {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "3 h 52 min", "9 min", "40 s": a run's length in the list. */
export function lengthText(s: number): string {
  const t = Math.max(0, Math.round(s));
  if (t < 60) return `${t} s`;
  const m = Math.round(t / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** Where the replay is after `wallMs` of playing from `fromT` at `speed`, stopped at the end. */
export function advance(fromT: number, wallMs: number, speed: ReplaySpeed, end: number): number {
  return Math.min(end, fromT + (wallMs / 1000) * speed);
}

/**
 * Reduced motion: one step a second, each step one second of the run times the speed. The
 * position moves by whole steps counted, not by wall time, so timer jitter (a tick at 999 ms, the
 * next at 2001 ms) never skips or doubles a step.
 */
export function step(fromT: number, speed: ReplaySpeed, end: number): number {
  return Math.min(end, fromT + speed);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "13 Nov 07:28 UTC": the mock-up's form, saying it is UTC (on stage UTC+4 would read it as local). */
export function whenText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${hh}:${mm} UTC`;
}

const signed = (v: number) => `${v < 0 ? '−' : '+'}${Math.abs(Math.round(v))}°`;
/** "9.6° × 6.0° near RA 208°, Dec −11°": what a run searched, and where. */
export function regionText(r: RunSummary['region']): string {
  const ra = Math.round(r.ra) % 360;
  const dec = Math.round(r.dec);
  return `${r.width_deg.toFixed(1)}° × ${r.height_deg.toFixed(1)}° near RA ${ra}°, Dec ${dec === 0 ? '0°' : signed(r.dec)}`;
}
