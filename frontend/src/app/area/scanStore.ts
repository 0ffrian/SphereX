// A scan of a region, square by square (issue #157; backend #156; mock-up states 2, 10 and 11).
//   offer   the region fills the screen, gridded: the plan (squares, time), Start scan or Select again;
//   run     the run being followed (polled every SCAN_POLL_MS from GET /v1/runs/{id}), with the
//           running square's steps (#141's live job) and, once it ends, the merged results;
//   failed  the plan or the start was refused: a status dot, a short title and one muted line.
// The run id is kept in this browser (localStorage, a per-viewer convenience) so a page reload
// mid-scan finds the run again and redraws every square from its record. The record is the truth:
// nothing about a square is guessed here.
import { create } from 'zustand';
import type { RunProgress } from '@/contract';
import { failureText } from './liveJobStore';
import {
  getScanApi,
  RunGone,
  type RunRecord,
  type RunResults,
  type ScanKind,
  type ScanPlan,
} from './scanApi';
import type { Region } from './scanGrid';

export const SCAN_POLL_MS = 1500;
/** Polls missed in a row before the card says it lost touch (it keeps trying). */
export const SCAN_MAX_MISSED = 20;
const SAVED_KEY = 'sx-scan-run';

export type ScanFlow = ScanKind;
export type ScanView =
  | { kind: 'offer'; flow: ScanFlow; region: Region; plan: ScanPlan | null }
  | {
      kind: 'run';
      flow: ScanFlow;
      runId: string;
      region: Region;
      record: RunRecord | null;
      /** The running square's live job (steps, counts), when it can be read. */
      square: RunProgress | null;
      results: RunResults | null;
      /** Polls have failed SCAN_MAX_MISSED times in a row (still trying). */
      stale: boolean;
      /** Stop was accepted; a running square stops at its next check (Q-470), so this can take a while. */
      stopping: boolean;
    }
  | { kind: 'failed'; flow: ScanFlow; region: Region; code: string; detail: string };

export interface ScanState {
  view: ScanView | null;
  /** A request of the card is on its way (Start, Pause, Resume, Stop). */
  busy: boolean;
  /** Predicted-only known objects are drawn (hidden by default, mock-up state 10). */
  showPredicted: boolean;
  /** The region is chosen: ask for its plan (no network calls on the backend). */
  plan(flow: ScanFlow, region: Region): Promise<void>;
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  /** Follow a run by id (after a reload, or from the runs list of #158). */
  follow(runId: string, flow: ScanFlow, region: Region, record?: RunRecord | null): void;
  /** The saved run of this browser, if any: { runId, flow, region }. */
  saved(): { runId: string; flow: ScanFlow; region: Region; stopping: boolean } | null;
  togglePredicted(): void;
  /** Forget the scan (Select again, Scan again, closing a finished one). */
  clear(): void;
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let abort: AbortController | null = null;
/** Bumped by every new view, so a late answer of an older one is dropped. */
let token = 0;
const stopPolling = () => {
  if (pollTimer !== null) clearTimeout(pollTimer);
  pollTimer = null;
  abort?.abort();
  abort = null;
};

/** The states a run no longer changes from. */
export const isFinished = (s: RunRecord['state']): boolean =>
  s === 'done' || s === 'stopped' || s === 'failed';

function save(
  v: { runId: string; flow: ScanFlow; region: Region; stopping?: boolean } | null,
): void {
  try {
    if (v) localStorage.setItem(SAVED_KEY, JSON.stringify(v));
    else localStorage.removeItem(SAVED_KEY);
  } catch {
    /* storage blocked: a reload forgets the scan, which keeps running on the server */
  }
}

export const useScanStore = create<ScanState>()((set, get) => {
  const poll = async (mine: number, missed = 0): Promise<void> => {
    const v = get().view;
    if (mine !== token || v?.kind !== 'run') return;
    const ctl = new AbortController();
    abort = ctl;
    const api = getScanApi();
    try {
      const record = await api.run(v.runId, ctl.signal);
      if (mine !== token) return;
      // The running square's steps come with the record (#156 `progress`, only while running).
      const square = record.progress ?? null;
      if (mine !== token) return;
      const prev = get().view;
      if (prev?.kind !== 'run') return;
      let results = prev.results;
      // The merged results of a finished run (state 11); read once, and again if it ends later.
      if (
        isFinished(record.state) &&
        (!results ||
          results.squares.filter((s) => s.state === 'done').length !== record.totals.squares_done)
      )
        results = await api.results(v.runId, ctl.signal).catch(() => results);
      if (mine !== token) return;
      // A finished run whose results cannot be read: try again, up to SCAN_MAX_MISSED times.
      const noResults = isFinished(record.state) && !results;
      const miss = noResults ? missed + 1 : 0;
      set({ view: { ...prev, record, square, results, stale: miss >= SCAN_MAX_MISSED } });
      if ((!isFinished(record.state) || !results) && miss < SCAN_MAX_MISSED)
        pollTimer = setTimeout(() => void poll(mine, miss), SCAN_POLL_MS);
    } catch (e) {
      if (mine !== token || ctl.signal.aborted) return;
      if (e instanceof RunGone) {
        save(null);
        set({
          view: {
            kind: 'failed',
            flow: v.flow,
            region: v.region,
            code: 'run_not_found',
            detail: '',
          },
        });
        return;
      }
      const n = missed + 1;
      const cur = get().view;
      if (cur?.kind === 'run' && n >= SCAN_MAX_MISSED && !cur.stale)
        set({ view: { ...cur, stale: true } });
      pollTimer = setTimeout(() => void poll(mine, n), SCAN_POLL_MS);
    }
  };
  const act = async (fn: (id: string) => Promise<RunRecord | void>) => {
    const v = get().view;
    if (v?.kind !== 'run' || get().busy) return;
    set({ busy: true });
    try {
      const rec = await fn(v.runId);
      const cur = get().view;
      if (rec && cur?.kind === 'run' && cur.runId === rec.run_id)
        set({ view: { ...cur, record: rec } });
    } catch {
      /* the next poll shows the run as the server has it */
    } finally {
      set({ busy: false });
    }
    // Poll at once so the card follows (and a finished run reads its results).
    stopPolling();
    void poll(token);
  };
  return {
    view: null,
    busy: false,
    showPredicted: false,
    async plan(flow, region) {
      stopPolling();
      const mine = ++token;
      set({ view: { kind: 'offer', flow, region, plan: null }, busy: false });
      const ctl = new AbortController();
      abort = ctl;
      const answer = await getScanApi()
        .plan({ ...region, kind: flow }, ctl.signal)
        .catch(() => ({ kind: 'unavailable' as const }));
      if (mine !== token) return;
      if (answer.kind === 'plan') set({ view: { kind: 'offer', flow, region, plan: answer.plan } });
      else if (answer.kind === 'error')
        set({ view: { kind: 'failed', flow, region, code: answer.code, detail: answer.detail } });
      else set({ view: { kind: 'failed', flow, region, code: 'scan:unavailable', detail: '' } });
    },
    async start() {
      const v = get().view;
      if (v?.kind !== 'offer' || get().busy) return;
      set({ busy: true });
      const answer = await getScanApi()
        .start({ ...v.region, kind: v.flow })
        .catch(() => ({ kind: 'unavailable' as const }));
      set({ busy: false });
      if (get().view !== v) {
        // The user moved on (Select again, Escape) while it started: stop it, nothing follows it.
        if (answer.kind === 'started')
          void getScanApi()
            .stop(answer.run.run_id)
            .catch(() => {});
        return;
      }
      if (answer.kind === 'started') {
        save({ runId: answer.run.run_id, flow: v.flow, region: answer.run.region });
        get().follow(answer.run.run_id, v.flow, answer.run.region, answer.run);
      } else if (answer.kind === 'error')
        set({
          view: {
            kind: 'failed',
            flow: v.flow,
            region: v.region,
            code: answer.code,
            detail: answer.detail,
          },
        });
      else
        set({
          view: {
            kind: 'failed',
            flow: v.flow,
            region: v.region,
            code: 'scan:unavailable',
            detail: '',
          },
        });
    },
    pause: () => act((id) => getScanApi().pause(id)),
    resume: () => act((id) => getScanApi().resume(id)),
    stop: () =>
      act(async (id) => {
        await getScanApi().stop(id);
        const cur = get().view;
        if (cur?.kind === 'run' && cur.runId === id) {
          set({ view: { ...cur, stopping: true } });
          // Kept with the saved run, so a reload while it stops still says so.
          const kept = get().saved();
          if (kept?.runId === id) save({ ...kept, stopping: true });
        }
      }),
    follow(runId, flow, region, record = null) {
      stopPolling();
      const mine = ++token;
      set({
        view: {
          kind: 'run',
          flow,
          runId,
          region,
          record,
          square: null,
          results: null,
          stale: false,
          stopping: get().saved()?.runId === runId && get().saved()?.stopping === true,
        },
        busy: false,
      });
      void poll(mine);
    },
    saved() {
      try {
        const raw = localStorage.getItem(SAVED_KEY);
        if (!raw) return null;
        const v = JSON.parse(raw) as {
          runId?: unknown;
          flow?: unknown;
          region?: Region;
          stopping?: unknown;
        };
        if (
          typeof v.runId !== 'string' ||
          (v.flow !== 'known' && v.flow !== 'discovery') ||
          !v.region
        )
          return null;
        return { runId: v.runId, flow: v.flow, region: v.region, stopping: v.stopping === true };
      } catch {
        return null;
      }
    },
    togglePredicted: () => set((s) => ({ showPredicted: !s.showPredicted })),
    clear() {
      stopPolling();
      token++;
      save(null);
      set({ view: null, busy: false });
    },
  };
});

/** Tests: forget everything (timers, the saved run). */
export function resetScans(): void {
  useScanStore.getState().clear();
  useScanStore.setState({ showPredicted: false });
}

/** The region on screen: the offer's, or the run's (from its record once read). */
export function viewRegion(v: ScanView | null): Region | null {
  if (!v) return null;
  if (v.kind === 'run') return v.record?.region ?? v.region;
  return v.region;
}

/** What a refused plan or start says (status dot, title, one line). */
export function scanFailureText(code: string): { title: string; line: string } {
  switch (code) {
    case 'scan:too_large':
      return {
        title: 'Region too large',
        line: 'At most 12° a side and 36 squares. Zoom in and select again.',
      };
    case 'area:bad_box':
      return { title: 'Too close to a pole', line: 'Select a region further from the pole.' };
    case 'queue_full':
      return { title: 'Too many areas waiting', line: 'Try again in a few minutes.' };
    case 'run_not_found':
      return { title: 'Scan not found', line: 'The server no longer has this scan.' };
    case 'scan:unavailable':
      return {
        title: 'Scans not available',
        line: 'This server cannot scan a region yet. Zoom in to one square.',
      };
    default: {
      const t = failureText(code);
      return { title: t.title, line: t.line };
    }
  }
}

/** Why a square was skipped or failed, as the card's status-dot message. */
export function skippedText(
  index: number,
  code: string | undefined,
  failed: boolean,
): { title: string; line: string } {
  return {
    title: `Square ${index} ${failed ? 'failed' : 'skipped'}`,
    line: squareReason(code) + '.',
  };
}

/** Why a square has no result, in a few words (no full stop): "No two visits close in time there". */
export function squareReason(code: string | undefined): string {
  if (code === 'area:no_visit_pair') return 'No two visits close in time there';
  if (code === 'area:frames_incomplete') return 'Some of its frames could not be downloaded';
  if (code === 'cancelled') return 'It was stopped';
  return code ? failureText(code, true).title : 'It could not be computed';
}

/** The island's pill for a minimised scan card: "Discovery · Square 7 of 15", or its end. */
export function scanMiniTitle(v: ScanView | null): string | null {
  if (!v) return null;
  const flow = v.flow === 'known' ? 'Known objects' : 'Discovery';
  if (v.kind !== 'run' || !v.record) return `${flow} · Scan`;
  const r = v.record;
  const n = r.squares.length;
  if (isFinished(r.state)) return `${flow} · Scan ${r.state === 'done' ? 'done' : r.state}`;
  if (r.state === 'paused') return `${flow} · Paused`;
  const cur = r.squares.find((s) => s.state === 'running');
  return cur ? `${flow} · Square ${cur.index} of ${n}` : `${flow} · Scanning`;
}

/** A scan that is still going (queued, running or paused): a new selection must not drop it. */
export function runningScan(v: ScanView | null): Extract<ScanView, { kind: 'run' }> | null {
  return v?.kind === 'run' && !(v.record && isFinished(v.record.state)) ? v : null;
}
