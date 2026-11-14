// Runs and replay (issue #158; mock-up states 12 and 13; #156 Q-471). The runs menu lists every
// run the server recorded (`GET /v1/runs`, newest first), so it is the same after a reload and on
// another device. A row opens its results, or the live progress of a run still going (#157's scan
// card, followed by id). Play replays it on the sky from its record (`GET /v1/runs/{id}`): the
// squares and circles at the times of its own events, at 1×, 10×, 60× or 600×. Nothing is computed
// again. The clock is deterministic: the position is `t0 + wall time × speed` (replay.ts).
import { create } from 'zustand';
import { useShellStore } from '@/app/shell/shellStore';
import { regionBox } from './scanGrid';
import { getScanApi, RunGone, type RunRecord, type RunSummary } from './scanApi';
import { advance, durationOf, REPLAY_SPEEDS, step, type ReplaySpeed } from './replay';
import { useScanStore } from './scanStore';
import { registerSkyHold, useAreaStore } from '@/app/shell/areaStore';
import { clampFov } from '@/viewer/sky/skyMath';
import { flyToView, reducedMotion } from '@/app/sky/areaDraw';

export type RunsFilter = 'all' | 'discovery' | 'known';
/** While the menu is open and a run is still going, the list is read again this often. */
export const RUNS_POLL_MS = 5000;
/** The replay clock's tick (ms): 10 a second, or once a second under reduced motion. */
export const REPLAY_TICK_MS = 100;
export const DEFAULT_SPEED: ReplaySpeed = 60;

export interface Replay {
  run: RunRecord;
  /** Seconds since the run's `started_at`. */
  t: number;
  end: number;
  speed: ReplaySpeed;
  playing: boolean;
  /** Reduced motion: the clock moves one step a second, by steps counted (no animation). */
  stepped: boolean;
}

export interface RunsState {
  open: boolean;
  status: 'idle' | 'loading' | 'ready' | 'error';
  runs: RunSummary[];
  filter: RunsFilter;
  /** The run whose record is on its way for a replay (its play button shows it is busy). */
  loadingReplay: string | null;
  /** A short message under the list (a run that could not be read). */
  note: string | null;
  replay: Replay | null;
  toggleMenu(): void;
  closeMenu(): void;
  load(): Promise<void>;
  setFilter(f: RunsFilter): void;
  openRun(run: RunSummary): void;
  startReplay(runId: string, opts?: { stepped?: boolean }): Promise<void>;
  play(): void;
  pause(): void;
  seek(t: number): void;
  setSpeed(s: ReplaySpeed): void;
  endReplay(): void;
}

// The wall clock, replaced in tests.
let nowMs = () => performance.now();
export function setRunsClock(f: () => number): void {
  nowMs = f;
}
const fly = (to: { ra: number; dec: number; fovDeg: number }) => flyToView(to, reducedMotion());

let listAbort: AbortController | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
/** Where the clock was anchored: the replay position and the wall time it was set. */
let anchor = { t: 0, wall: 0 };

const stopPoll = () => {
  if (pollTimer !== null) clearTimeout(pollTimer);
  pollTimer = null;
  listAbort?.abort();
  listAbort = null;
};
const stopTick = () => {
  if (tickTimer !== null) clearInterval(tickTimer);
  tickTimer = null;
};

export const useRunsStore = create<RunsState>()((set, get) => {
  const tick = () => {
    const r = get().replay;
    if (!r || !r.playing) return stopTick();
    const t = r.stepped
      ? step(r.t, r.speed, r.end)
      : advance(anchor.t, nowMs() - anchor.wall, r.speed, r.end);
    const done = t >= r.end;
    set({ replay: { ...r, t, playing: !done } });
    if (done) stopTick();
  };
  const startTick = () => {
    stopTick();
    const r = get().replay;
    if (!r) return;
    anchor = { t: r.t, wall: nowMs() };
    tickTimer = setInterval(tick, r.stepped ? 1000 : REPLAY_TICK_MS);
  };
  const reanchor = () => {
    const r = get().replay;
    if (r) anchor = { t: r.t, wall: nowMs() };
  };
  /**
   * Where the clock is now (not the last tick's position): no progress is lost on a change. Under
   * reduced motion it is the step shown.
   */
  const liveT = (r: Replay) =>
    r.playing && !r.stepped ? advance(anchor.t, nowMs() - anchor.wall, r.speed, r.end) : r.t;
  /** After a seek or a speed change: re-anchor; under reduced motion the next step is a full second away. */
  const restart = () => {
    const r = get().replay;
    if (r?.stepped && r.playing) startTick();
    else reanchor();
  };
  const isGoing = (runs: readonly RunSummary[]) =>
    runs.some((r) => r.state === 'running' || r.state === 'queued' || r.state === 'paused');
  const pollAgain = () => {
    pollTimer = setTimeout(() => void get().load(), RUNS_POLL_MS);
  };

  return {
    open: false,
    status: 'idle',
    runs: [],
    filter: 'all',
    loadingReplay: null,
    note: null,
    replay: null,

    toggleMenu() {
      // While a replay plays, the runs button ends it (mock-up state 13).
      if (get().replay) return get().endReplay();
      if (get().open) return get().closeMenu();
      set({ open: true, note: null });
      void get().load();
    },
    closeMenu() {
      stopPoll();
      set({ open: false, loadingReplay: null });
    },
    async load() {
      stopPoll();
      const ctl = new AbortController();
      listAbort = ctl;
      if (get().status !== 'ready') set({ status: 'loading' });
      try {
        const runs = await getScanApi().list(ctl.signal);
        if (ctl.signal.aborted || !get().open) return;
        set({ runs, status: 'ready' });
        // A run still going changes: read the list again while the menu is open.
        if (isGoing(runs)) pollAgain();
      } catch {
        if (ctl.signal.aborted || !get().open) return;
        const ready = get().status === 'ready';
        set({ status: ready ? 'ready' : 'error' });
        // A missed poll of a list that shows a run still going: keep trying.
        if (ready && isGoing(get().runs)) pollAgain();
      }
    },
    setFilter(filter) {
      set({ filter });
    },
    openRun(run) {
      get().closeMenu();
      get().endReplay();
      // #157's scan card follows the run: a running run shows its live progress, a finished one
      // its combined results (state 11). The sky flies to its region.
      useScanStore.getState().follow(run.run_id, run.kind, run.region);
      useShellStore.getState().setTool('area');
      useAreaStore.getState().openScan(run.kind, regionBox(run.region));
      fly({ ra: run.region.ra, dec: run.region.dec, fovDeg: clampFov(run.region.height_deg) });
    },
    async startReplay(runId, opts = {}) {
      set({ loadingReplay: runId, note: null });
      let run: RunRecord;
      try {
        run = await getScanApi().run(runId);
      } catch (e) {
        if (get().loadingReplay !== runId) return;
        set({
          loadingReplay: null,
          note:
            e instanceof RunGone
              ? 'That run is no longer on the server.'
              : 'That run could not be read. Try again.',
        });
        return;
      }
      if (get().loadingReplay !== runId) return;
      const end = durationOf(run);
      stopPoll();
      // The replay takes the sky: cards close (a scan still going keeps running on the server;
      // its dock button brings it back), and the sky flies to the run's region.
      useShellStore.getState().setTool('sky');
      set({
        open: false,
        loadingReplay: null,
        replay: {
          run,
          t: 0,
          end,
          speed: DEFAULT_SPEED,
          playing: end > 0,
          stepped: opts.stepped ?? false,
        },
      });
      fly({ ra: run.region.ra, dec: run.region.dec, fovDeg: clampFov(run.region.height_deg) });
      if (end > 0) startTick();
    },
    play() {
      const r = get().replay;
      if (!r || r.end <= 0) return;
      // At the end, play starts again from the beginning.
      set({ replay: { ...r, t: r.t >= r.end ? 0 : r.t, playing: true } });
      startTick();
    },
    pause() {
      const r = get().replay;
      if (!r) return;
      const t = liveT(r);
      stopTick();
      set({ replay: { ...r, t, playing: false } });
    },
    seek(t) {
      const r = get().replay;
      if (!r) return;
      set({ replay: { ...r, t: Math.min(r.end, Math.max(0, t)) } });
      restart();
    },
    setSpeed(speed) {
      const r = get().replay;
      if (!r || !REPLAY_SPEEDS.includes(speed)) return;
      set({ replay: { ...r, t: liveT(r), speed } });
      restart();
    },
    endReplay() {
      stopTick();
      if (get().replay) set({ replay: null });
    },
  };
});

/** The rows the filter shows. */
export function filteredRuns(runs: readonly RunSummary[], f: RunsFilter): RunSummary[] {
  return f === 'all' ? runs.slice() : runs.filter((r) => r.kind === f);
}

// A live area that finishes while a replay plays does not open over it (it would end the replay).
registerSkyHold(() => useRunsStore.getState().replay !== null);

/** Back to a clean state (tests). */
export function resetRuns(): void {
  stopPoll();
  stopTick();
  anchor = { t: 0, wall: 0 };
  useRunsStore.setState({
    open: false,
    status: 'idle',
    runs: [],
    filter: 'all',
    loadingReplay: null,
    note: null,
    replay: null,
  });
}
