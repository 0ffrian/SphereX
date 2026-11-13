// Live area jobs (issue #144, Q-462; mock-up states 3 to 6): what the live card shows, and the one
// job this tab follows. It is separate from the area store on purpose: closing the card (which
// resets the area tool) does not stop the job, and when it is done the area opens (the hand-off).
//
//   view   what the card shows: the offer, the job (waiting or computing), or a failure.
//   job    the job being followed (polled every POLL_MS) until done, failed or stopped. A newer
//          job replaces it; the older one keeps running on the server, and is stored when done.
import { create } from 'zustand';
import type { AreaBox } from '@/app/shell/areaStore';
import type { AreaFlow } from './areaService';
import {
  getLiveAreaApi,
  liveBoxOf,
  type LiveJobStatus,
  type LivePlan,
  type PlanAnswer,
} from './liveAreaApi';

export const POLL_MS = 1000;

export type LiveView =
  | { kind: 'offer'; box: AreaBox; flow: AreaFlow; plan: LivePlan }
  | { kind: 'job'; box: AreaBox; flow: AreaFlow }
  | { kind: 'failed'; box: AreaBox; flow: AreaFlow; code: string; detail: string };

export interface LiveJob {
  areaId: string;
  box: AreaBox;
  flow: AreaFlow;
  /** The offer's plan (its estimate splits a queued job's wait from its run). */
  plan: LivePlan | null;
  status: LiveJobStatus | null;
}

export interface LiveJobStoreState {
  view: LiveView | null;
  job: LiveJob | null;
  /** A request of the card is in flight (Compute, Stop, Try again): its buttons wait. */
  busy: boolean;
  /** The coverage check answered: show the offer, a stored area's results, or a failure. */
  showPlan(box: AreaBox, flow: AreaFlow, answer: Exclude<PlanAnswer, { kind: 'unavailable' }>): void;
  /** Compute this area: start the job and follow it. */
  compute(): Promise<void>;
  /** Stop (computing) or Cancel (waiting): the job ends, nothing is saved, the offer shows again. */
  stop(): Promise<void>;
  /** Try again after a failure: the coverage check again. */
  retry(): Promise<void>;
  /** The card is gone (closed, Draw again, another flow): the job, if any, keeps running. */
  clearView(): void;
}

/** Opens a done area in the existing results views (registered by the area store). */
type Handoff = (box: AreaBox, flow: AreaFlow, opts: { ifIdle: boolean }) => void;
let handoff: Handoff | null = null;
export function registerLiveHandoff(fn: Handoff | null): void {
  handoff = fn;
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;
/** Bumped when the followed job changes, so a late poll of an older job is dropped. */
let jobToken = 0;
function stopPolling(): void {
  if (pollTimer !== null) clearTimeout(pollTimer);
  pollTimer = null;
  jobToken++;
}

export const useLiveJobStore = create<LiveJobStoreState>()((set, get) => {
  const failView = (box: AreaBox, flow: AreaFlow, code: string, detail: string): LiveView => ({ kind: 'failed', box, flow, code, detail });

  const finish = (job: LiveJob, status: LiveJobStatus) => {
    stopPolling();
    const showing = get().view?.kind === 'job';
    if (status.state === 'done') {
      set({ job: null, view: showing ? null : get().view });
      // Open the area here: at once when its card is showing (even minimised) or no card is; never
      // over another box's card the user is busy with.
      handoff?.(job.box, job.flow, { ifIdle: !showing });
      return;
    }
    const err = status.error ?? { code: 'area:failed', detail: '' };
    set({ job: null, view: showing ? failView(job.box, job.flow, err.code, err.detail) : get().view });
  };

  const poll = (mine: number) => {
    const job = get().job;
    if (!job || mine !== jobToken) return;
    getLiveAreaApi()
      .status(job.areaId)
      .then(
        (status) => {
          if (mine !== jobToken) return;
          const cur = get().job;
          if (!cur) return;
          if (status.state === 'done' || status.state === 'failed') {
            finish(cur, status);
            return;
          }
          set({ job: { ...cur, status } });
          pollTimer = setTimeout(() => poll(mine), POLL_MS);
        },
        // A missed poll is asked again: the job runs on the server whatever this tab does.
        () => {
          if (mine !== jobToken) return;
          pollTimer = setTimeout(() => poll(mine), POLL_MS);
        },
      );
  };

  const follow = (job: LiveJob) => {
    stopPolling();
    const mine = jobToken;
    set({ job });
    poll(mine);
  };

  return {
    view: null,
    job: null,
    busy: false,
    showPlan: (box, flow, answer) => {
      if (answer.kind === 'stored') {
        set({ view: null });
        handoff?.(box, flow, { ifIdle: false });
        return;
      }
      if (answer.kind === 'error') {
        set({ view: failView(box, flow, answer.code, answer.detail) });
        return;
      }
      if (answer.kind === 'running') {
        // Already being computed: follow that job (no estimate to split a wait from the run).
        set({ view: { kind: 'job', box, flow } });
        follow({ areaId: answer.areaId, box, flow, plan: null, status: null });
        return;
      }
      set({ view: { kind: 'offer', box, flow, plan: answer.plan } });
    },
    compute: async () => {
      const view = get().view;
      if (view?.kind !== 'offer' || get().busy) return;
      set({ busy: true });
      const answer = await getLiveAreaApi()
        .start(liveBoxOf(view.box))
        .catch(() => ({ kind: 'unavailable' as const }));
      set({ busy: false });
      if (get().view !== view) return; // the card moved on meanwhile
      if (answer.kind === 'started') {
        set({ view: { kind: 'job', box: view.box, flow: view.flow } });
        follow({ areaId: answer.areaId, box: view.box, flow: view.flow, plan: view.plan, status: null });
      } else if (answer.kind === 'stored') {
        set({ view: null });
        handoff?.(view.box, view.flow, { ifIdle: false });
      } else if (answer.kind === 'error') {
        set({ view: failView(view.box, view.flow, answer.code, answer.detail) });
      } else {
        set({ view: failView(view.box, view.flow, 'upstream_unavailable', '') });
      }
    },
    stop: async () => {
      const job = get().job;
      if (!job || get().busy) return;
      set({ busy: true });
      stopPolling();
      await getLiveAreaApi()
        .stop(job.areaId)
        .catch(() => undefined);
      set({ busy: false, job: null });
      // Back to the offer, so the same area can be computed again or redrawn.
      if (get().view?.kind === 'job' && job.plan) set({ view: { kind: 'offer', box: job.box, flow: job.flow, plan: job.plan } });
      else if (get().view?.kind === 'job') set({ view: null });
    },
    retry: async () => {
      const view = get().view;
      if (view?.kind !== 'failed' || get().busy) return;
      set({ busy: true });
      const answer = await getLiveAreaApi()
        .plan(liveBoxOf(view.box))
        .catch(() => ({ kind: 'unavailable' as const }));
      set({ busy: false });
      if (get().view !== view) return;
      if (answer.kind === 'unavailable') set({ view: failView(view.box, view.flow, 'upstream_unavailable', '') });
      else get().showPlan(view.box, view.flow, answer);
    },
    clearView: () => set({ view: null, busy: false }),
  };
});

/** Tests: forget the job and the card. */
export function resetLiveJobs(): void {
  stopPolling();
  useLiveJobStore.setState({ view: null, job: null, busy: false });
}

/** A failure's dot title and one muted line (mock-up state 6). */
export function failureText(code: string): { title: string; line: string; retry: boolean } {
  switch (code) {
    case 'area:no_visit_pair':
      return { title: 'No two visits close in time', line: 'Nothing can be seen moving here. Try a nearby patch.', retry: false };
    case 'upstream_unavailable':
      return { title: 'Frame archive not reachable', line: 'Nothing was saved. Try again in a minute.', retry: true };
    case 'offline':
      return { title: 'Not available offline', line: 'This server shows only areas computed before.', retry: false };
    default:
      // Another refusal of the box itself (`area:…`) gives the same answer again: no Try again.
      return { title: 'Could not compute this area', line: 'Nothing was saved. Try again in a minute.', retry: !code.startsWith('area:') };
  }
}

/** "SPHEREx DR1" from "spherex_dr1"; any other name as given. */
export function releaseName(release: string): string {
  const m = /^spherex_([a-z0-9]+)$/i.exec(release);
  return m ? `SPHEREx ${m[1]!.toUpperCase()}` : release;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const hm = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

/** "12 Jun 2026, 11:11 and 12:49 UTC (1.6 h apart)", from the visits' start times. */
export function visitsText(plan: Pick<LivePlan, 'visits'>): string {
  const a = new Date(plan.visits[0].start);
  const b = new Date(plan.visits[1].start);
  const gapH = Math.abs(b.getTime() - a.getTime()) / 3_600_000;
  const gap = gapH < 1 ? `${Math.round(gapH * 60)} min apart` : `${gapH.toFixed(1)} h apart`;
  const times = day(a) === day(b) ? `${day(a)}, ${hm(a)} and ${hm(b)} UTC` : `${day(a)}, ${hm(a)} and ${day(b)}, ${hm(b)} UTC`;
  return `${times} (${gap})`;
}

/** "about 9 min", "under a minute". */
export function aboutMinutes(s: number): string {
  if (s < 60) return 'under a minute';
  return `about ${Math.round(s / 60)} min`;
}

/** "3:42" (minutes:seconds), "1:02:05" past an hour. */
export function clock(s: number): string {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** What a step's count says: "9 of 14" while it runs, "2 visits" once done. */
export function stepCount(s: { id: string; state: string; done?: number; total?: number }): string {
  if (s.total === undefined) return '';
  if (s.state === 'running') return `${s.done ?? 0} of ${s.total}`;
  if (s.state !== 'done') return '';
  const unit = s.id === 'visits' || s.id === 'known' ? 'visits' : s.id === 'frames' || s.id === 'dots' ? 'frames' : '';
  return unit ? `${s.total} ${unit}` : String(s.total);
}

/** The island pill while the live card is minimised: "Discovery · Step 2 of 6 · Download frames". */
export function liveMiniTitle(s: Pick<LiveJobStoreState, 'view' | 'job'>, flowLabel: string): string {
  if (s.view?.kind !== 'job') return flowLabel;
  const st = s.job?.status;
  if (!st || st.state === 'queued') return `${flowLabel} · Waiting`;
  const i = st.steps.findIndex((x) => x.state === 'running');
  if (i < 0) return flowLabel;
  return `${flowLabel} · Step ${i + 1} of ${st.steps.length} · ${st.steps[i]!.label}`;
}
