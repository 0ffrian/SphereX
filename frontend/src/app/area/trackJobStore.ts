// Track it, computed on demand (issue #145, mock-up state 7; backend #142, Q-468): the one Track job
// the area card follows. Track it on an object the cache cannot Track yet starts the job; the card
// shows its steps; when it is done the Track view (the Eros card) opens on the object's real
// `/frames` and `/path`. Like the live areas, closing the card does not stop the job: it runs on
// the server and the object is Track-available when it ends.
import { create } from 'zustand';
import type { KnownObject } from './areaService';
import { getTrackJobApi, TRACK_DAYS, type TrackJobStatus } from './trackJobApi';

export const TRACK_POLL_MS = 1000;
/** Polls in a row that may fail before the job is given up as unreachable. */
export const TRACK_MAX_MISSED = 30;

export interface TrackJobView {
  obj: KnownObject;
  /** The data release named in the card's subtitle ("SPHEREx DR1"). */
  release: string;
  /** The time the path search is centred on (ISO), ± TRACK_DAYS. */
  around: string;
  status: TrackJobStatus | null;
  /** Date.now() when Track it was pressed (the elapsed clock). */
  t0: number;
  failed: { code: string; detail: string } | null;
}

export interface TrackJobState {
  view: TrackJobView | null;
  busy: boolean;
  start(obj: KnownObject, around: string, release: string): Promise<void>;
  /** Try again after a failure. */
  retry(): Promise<void>;
  /** The card is gone: the job, if any, keeps running on the server. */
  clear(): void;
}

/** Opens the Track view of an object whose job is done (registered by the area store). */
let onDone: ((obj: KnownObject) => void) | null = null;
export function registerTrackDone(fn: ((obj: KnownObject) => void) | null): void {
  onDone = fn;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let token = 0;
function stopPolling(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  token++;
}

export const useTrackJobStore = create<TrackJobState>()((set, get) => {
  let missed = 0;
  const fail = (code: string, detail = '') => {
    stopPolling();
    const v = get().view;
    if (v) set({ view: { ...v, failed: { code, detail } } });
  };
  const poll = (mine: number) => {
    const v = get().view;
    if (!v || mine !== token || !v.obj.objectId) return;
    getTrackJobApi()
      .status(v.obj.objectId)
      .then(
        (status) => {
          if (mine !== token) return;
          const cur = get().view;
          if (!cur) return;
          missed = 0;
          if (status.state === 'done') {
            stopPolling();
            set({ view: null });
            onDone?.({ ...cur.obj, trackAvailable: true });
            return;
          }
          if (status.state === 'failed') {
            set({ view: { ...cur, status } });
            fail('track:failed', status.error ?? '');
            return;
          }
          // `idle`: the job has not shown up yet (or this server lost it); ask again.
          set({ view: { ...cur, status } });
          timer = setTimeout(() => poll(mine), TRACK_POLL_MS);
        },
        () => {
          if (mine !== token) return;
          if (++missed >= TRACK_MAX_MISSED) {
            fail('upstream_unavailable');
            return;
          }
          timer = setTimeout(() => poll(mine), TRACK_POLL_MS);
        },
      );
  };
  const begin = async (v: TrackJobView) => {
    stopPolling();
    missed = 0;
    const mine = token;
    set({ view: v, busy: true });
    const id = v.obj.objectId;
    const answer = id
      ? await getTrackJobApi()
          .start(id, v.around, TRACK_DAYS)
          .catch(() => ({ kind: 'unavailable' as const }))
      : ({ kind: 'error', code: 'track:no_id', detail: '' } as const);
    if (mine !== token) return;
    set({ busy: false });
    if (answer.kind === 'started') {
      set({ view: { ...v, status: answer.status } });
      if (answer.status.state === 'done') {
        stopPolling();
        set({ view: null });
        onDone?.({ ...v.obj, trackAvailable: true });
        return;
      }
      poll(mine);
    } else if (answer.kind === 'error') fail(answer.code, answer.detail);
    else fail('track:unavailable');
  };
  return {
    view: null,
    busy: false,
    start: (obj, around, release) =>
      begin({ obj, around, release, status: null, t0: Date.now(), failed: null }),
    retry: async () => {
      const v = get().view;
      if (!v || !v.failed || get().busy) return;
      await begin({ ...v, status: null, t0: Date.now(), failed: null });
    },
    clear: () => {
      stopPolling();
      set({ view: null, busy: false });
    },
  };
});

export function resetTrackJobs(): void {
  stopPolling();
  useTrackJobStore.setState({ view: null, busy: false });
}

/** The job's steps as the card lists them (mock-up state 7), from its stage. */
export interface TrackStep {
  id: string;
  label: string;
  state: 'done' | 'running' | 'todo';
  count: string;
  /** 0..1 on the running step when the job counts it. */
  bar: number | null;
}

const STEPS: readonly { id: NonNullable<TrackJobStatus['stage']>; label: string }[] = [
  { id: 'catalogue', label: 'Look up the object and its path (JPL)' },
  { id: 'frames', label: 'Find every frame along the path' },
  { id: 'spectrum', label: 'Measure the spectrum' },
  { id: 'card', label: 'Save the result' },
];

/** Pure: the steps at a job status (null: just pressed, nothing answered yet). */
export function trackSteps(status: TrackJobStatus | null): TrackStep[] {
  const stage = status?.stage ?? null;
  const at =
    stage === 'done' || status?.state === 'done'
      ? STEPS.length
      : STEPS.findIndex((s) => s.id === stage);
  return STEPS.map((s, i) => {
    const state: TrackStep['state'] =
      at < 0
        ? i === 0 && status?.state === 'running'
          ? 'running'
          : 'todo'
        : i < at
          ? 'done'
          : i === at
            ? 'running'
            : 'todo';
    const done = status?.frames_done ?? null;
    const total = status?.frames_total ?? null;
    let count = '';
    let bar: number | null = null;
    if (s.id === 'frames' && total !== null && total > 0) {
      if (state === 'running') {
        count = `${done ?? 0} of ${total}`;
        bar = Math.min(1, (done ?? 0) / total);
      } else if (state === 'done') count = `${total} frames`;
    }
    return { id: s.id, label: s.label, state, count, bar };
  });
}

/** A failure's title and one muted line (a status dot, no tinted box). */
export function trackFailureText(code: string): { title: string; line: string; retry: boolean } {
  switch (code) {
    case 'track_window_outside':
      return {
        title: 'No path near these visits',
        line: 'JPL has no path for this object within 3 days of the area’s visits.',
        retry: false,
      };
    case 'not_moving':
    case 'no_ephemeris':
    case 'not_found':
    case 'track:no_id':
      return {
        title: 'Cannot be tracked',
        line: 'JPL Horizons has no path for this object.',
        retry: false,
      };
    case 'track:unavailable':
      return {
        title: 'Track not available here',
        line: 'This server cannot compute a Track yet.',
        retry: false,
      };
    case 'upstream_unavailable':
      return {
        title: 'Server not reachable',
        line: 'The Track keeps computing if it started. Try again in a minute.',
        retry: true,
      };
    default:
      return {
        title: 'Track could not be computed',
        line: 'Nothing was saved. Try again in a minute.',
        retry: true,
      };
  }
}

/** The middle of a set of ISO times (the Track's `around`), or null for none. */
export function middleTime(times: readonly string[]): string | null {
  const ms = times.map((t) => Date.parse(t)).filter((x) => Number.isFinite(x));
  if (ms.length === 0) return null;
  const mid = (Math.min(...ms) + Math.max(...ms)) / 2;
  return new Date(Math.round(mid / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}
