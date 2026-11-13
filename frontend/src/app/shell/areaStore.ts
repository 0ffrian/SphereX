// State of the area tools (Known objects and Discovery, the dock's two buttons): the rectangle drawn
// on the sky (any aspect), which flow started it and where that flow is. It is kept in sky coordinates
// (two opposite corners), so it stays on the same patch of sky while the view moves.
//
// The results come from app/area/areaService.ts: a prepared area's precomputed replies when one holds
// the square (Q-205), else the demo, which is marked `demo: true` and is not a search of the area.
// Track it on a known object reads its `/frames` and `/path` (issue #130, Q-455); the Eros card's
// cutouts, mask and brightness stay the demo's, under the Demo tag.
import { create } from 'zustand';
import { ApiError } from '@/app/api/errors';
import {
  AreaRefused,
  discoverIn,
  erosDemo,
  knownObjectsIn,
  loadObjectTrack,
  mergeReal,
  type KnownObject,
  type AreaFlow,
  type DiscoveryResult,
  type ErosDemo,
  type ErosHop,
  type KnownObjectsResult,
} from '@/app/area/areaService';
import { getLiveAreaApi, liveBoxOf, type PlanAnswer } from '@/app/area/liveAreaApi';
import { registerLiveHandoff, registerLiveRedraw, useLiveJobStore } from '@/app/area/liveJobStore';
import { registerTrackDone, useTrackJobStore } from '@/app/area/trackJobStore';
import { useShellStore } from './shellStore';

export interface SkyCorner {
  ra: number;
  dec: number;
}
export interface AreaBox {
  /** Top-left and bottom-right corners when drawn. */
  a: SkyCorner;
  b: SkyCorner;
  /** Angular width and height of the rectangle in degrees, from the sky view's own projection. */
  widthDeg: number;
  heightDeg: number;
}
/** The rectangle being dragged, in sky-pane pixels. */
export interface AreaDrag {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** A side is held at the 2° limit (issue #144): the readout says "2° max". */
  held?: boolean;
}
/**
 * Where the flow is: the drawing card, the island searching, the list, an Eros card, the steps, or
 * the live card (offer, computing, waiting, failure; issue #144), or a Track computed on demand
 * (issue #145, trackJobStore).
 */
export type AreaScreen = 'draw' | 'search' | 'list' | 'eros' | 'disc' | 'mover' | 'live' | 'track';

/** The checkboxes of the Eros card: which layers show on the cutout. */
export interface ErosOverlays {
  mask: boolean;
  pred: boolean;
  path: boolean;
  flags: boolean;
}

/** What the island says while the known-objects search runs (a dummy: nothing is asked). */
export interface AreaSay {
  kind: 'searching' | 'found';
  text: string;
}

/** Why the area gave no answer: no prepared data for it (Q-414), an unknown id, or a failed request. */
export interface AreaRefusal {
  code: string;
  message: string;
}
export function refusalOf(e: unknown): AreaRefusal {
  if (e instanceof AreaRefused) return { code: e.code, message: e.message };
  const detail = e instanceof ApiError && e.kind === 'timeout' ? 'The area search timed out.' : 'The area search failed.';
  return { code: 'area:failed', message: `${detail} Draw the area again.` };
}

/**
 * The coverage check for a box with no prepared area (issue #144): the live plan, or null when the
 * refusal is not "not prepared" or the backend has no live areas (then today's refusal stands).
 */
async function liveCheck(
  box: AreaBox,
  refusal: AreaRefusal,
  signal: AbortSignal,
): Promise<Exclude<PlanAnswer, { kind: 'unavailable' }> | null> {
  if (refusal.code !== 'area:not_prepared') return null;
  const answer = await getLiveAreaApi()
    .plan(liveBoxOf(box), signal)
    .catch(() => ({ kind: 'unavailable' as const }));
  return answer.kind === 'unavailable' ? null : answer;
}

/** The backend's id of 433 Eros, whose frames the demo file holds (issue #130). */
export const DEMO_OBJECT_ID = 'sbdb-20000433';
/** `/path` codes that mean "not ready yet, ask again" rather than "no path" (A19.5). */
const PATH_PENDING: readonly string[] = ['path:deferred', 'path:frames_incomplete'];

export interface AreaState {
  /** Which dock tool started this (the dock highlight follows it). */
  flow: AreaFlow;
  /**
   * aiming: the pointer is the next view's rectangle, a click zooms there (issue #144);
   * drawing: in that view, waiting for a drag; set: an area exists.
   */
  stage: 'aiming' | 'drawing' | 'set';
  box: AreaBox | null;
  /** The last area, kept for "Keep the last area" after redrawing or reopening. */
  last: AreaBox | null;
  drag: AreaDrag | null;
  screen: AreaScreen;
  say: AreaSay | null;
  /** The card is shrunk to the island's pill. */
  minimised: boolean;
  known: KnownObjectsResult | null;
  disc: DiscoveryResult | null;
  eros: ErosDemo | null;
  /** The known object whose Eros card is open (null: the demo Eros). */
  focus: KnownObject | null;
  /** Where the Eros card's frame list and path come from: the API, or the demo file. */
  trackSource: 'real' | 'demo';
  /** True when the real `/path` was read, so the sky path is the Horizons path. */
  trackPath: boolean;
  /** True when `/path` answered "not ready yet" (`path:deferred`, `path:frames_incomplete`, A19.5). */
  pathPending: boolean;
  /** Set when the area has no answer; the cards say so and draw nothing. */
  refusal: AreaRefusal | null;
  /** The demo file could not be loaded. */
  erosFailed: boolean;
  /** Discovery: the last step that is done (-1: none yet), and whether the run is going. */
  step: number;
  running: boolean;
  /** The mover whose card is open (or ringed on the sky), -1 for none. */
  sel: number;
  /** A prepared area's visit whose dots are drawn (null: the first visit). */
  visit: number | null;
  /** Eros exposure shown (an index into the detector-filtered list) and the player's state. */
  index: number;
  playing: boolean;
  /** Detector 0..5 filter, null for all. */
  det: number | null;
  ov: ErosOverlays;
  /** Bumped when the sky should fly to fit the whole area (and on a refit). */
  fitSeq: number;
  /** Dock: start a flow (also from another flow): drawing mode, nothing searched yet. */
  startFlow(flow: AreaFlow): void;
  setDrag(drag: AreaDrag | null): void;
  /** Aim: the patch is picked (the sky zooms to it); the drag now draws. */
  pickPatch(): void;
  /** The area is set: Known starts the island's search, Discovery opens its steps. */
  setBox(box: AreaBox): void;
  redraw(): void;
  openList(): void;
  /** The Eros card; `obj` is the known object to Track (null/undefined: the demo Eros). */
  openEros(obj?: KnownObject | null): void;
  openDisc(): void;
  openMover(i: number): void;
  /**
   * Track it on an object the cache cannot Track yet (issue #145): start its Track job around
   * `around` (ISO) and show its progress; the Track view opens when it is done.
   */
  openTrack(obj: KnownObject, around: string, release: string): void;
  /** Where the Track card's "Back to the results" goes: the Known list, or the Discovery track. */
  trackBack: 'list' | 'mover';
  setMinimised(on: boolean): void;
  setIndex(i: number): void;
  setVisit(visit: number | null): void;
  setPlaying(on: boolean): void;
  setDet(det: number | null): void;
  toggleOv(k: keyof ErosOverlays): void;
  /** Leaving the tool: back to the start, keeping the last area. */
  reset(): void;
}

const SEARCH_MS = 1900;
const FOUND_MS = 1000;
const STEP_MS = 1000;

let timers: ReturnType<typeof setTimeout>[] = [];
let stepTimer: ReturnType<typeof setInterval> | null = null;
/** Bumped by every restart, so a late answer of an older run is dropped. */
let token = 0;
/** One request per square, and one per Eros card (issue #130): a newer one aborts the older. */
let knownAbort: AbortController | null = null;
let trackAbort: AbortController | null = null;
function clearTimers(): void {
  knownAbort?.abort();
  knownAbort = null;
  trackAbort?.abort();
  trackAbort = null;
  for (const t of timers) clearTimeout(t);
  timers = [];
  if (stepTimer !== null) clearInterval(stepTimer);
  stepTimer = null;
  token++;
}

const FRESH = {
  stage: 'aiming' as const,
  box: null,
  drag: null,
  screen: 'draw' as const,
  say: null,
  minimised: false,
  known: null,
  focus: null as KnownObject | null,
  disc: null,
  refusal: null as AreaRefusal | null,
  step: -1,
  running: false,
  sel: -1,
  visit: null as number | null,
  index: 0,
  playing: false,
  det: null,
  ov: { mask: true, pred: true, path: true, flags: false },
};

/** Exposures shown: all of them, or those of one detector (D1..D6 is 0..5). */
export function erosList(eros: ErosDemo | null, det: number | null): ErosHop[] {
  if (!eros) return [];
  return det === null ? eros.hops : eros.hops.filter((h) => Number(h.detector.slice(1)) - 1 === det);
}

export const useAreaStore = create<AreaState>()((set, get) => {
  const loadEros = async (obj: KnownObject | null = null): Promise<ErosDemo | null> => {
    trackAbort?.abort();
    const ctl = new AbortController();
    trackAbort = ctl;
    // The demo file is 433 Eros only: another object never borrows its sky image, cutouts or title.
    const demoAll = await erosDemo();
    // The fallback row of an unreachable backend (no designation, no id) is the demo Eros too.
    const isDemoEros = !obj || obj.objectId === DEMO_OBJECT_ID || (!obj.objectId && obj.designation === undefined);
    const demo = isDemoEros ? demoAll : null;
    if (ctl.signal.aborted) return demo;
    // A real object: its frames and path from the API (issue #130).
    if (obj?.objectId) {
      // Never blank (D-32): the demo Eros shows its demo frames at once (Demo tag), and the real
      // frames and path replace them when the API answers, so a slow backend never leaves "Loading…".
      if (demo) set({ eros: demo, erosFailed: false, trackSource: 'demo', trackPath: false, pathPending: false });
      try {
        const real = await loadObjectTrack(obj.objectId, ctl.signal);
        if (ctl.signal.aborted) return demo;
        const eros = mergeReal(demo, real.frames, real.path);
        if (eros.hops.length === 0) throw new ApiError('bad_response', 'No frames for this object.');
        // A path reply with no points (`path:not_cached`) is no path: nothing is drawn or claimed.
        const hasPath = (real.path?.points.length ?? 0) > 0;
        const pending = !hasPath && (real.path?.missing ?? []).some((c) => PATH_PENDING.includes(c));
        set({ eros, erosFailed: false, trackSource: 'real', trackPath: hasPath, pathPending: pending });
        return eros;
      } catch (e) {
        if (ctl.signal.aborted || (e instanceof ApiError && e.kind === 'aborted')) return demo;
        // Never blank: 433 Eros falls back to the demo file (Demo tag); another object has no demo.
        if (obj.objectId !== DEMO_OBJECT_ID) {
          set({ eros: null, erosFailed: true, trackSource: 'demo', trackPath: false, pathPending: false });
          return null;
        }
      }
    }
    set({ eros: demo, erosFailed: demo === null, trackSource: 'demo', trackPath: false, pathPending: false });
    return demo;
  };
  const startRun = () => {
    const mine = token;
    set({ step: -1, running: true });
    stepTimer = setInterval(() => {
      if (mine !== token) return;
      const n = get().disc?.steps.length ?? 0;
      const step = get().step + 1;
      if (step >= n - 1 && stepTimer !== null) {
        clearInterval(stepTimer);
        stepTimer = null;
      }
      set({ step, running: step < n - 1 });
    }, STEP_MS);
  };
  const runKnown = (box: AreaBox, handoff = false) => {
    clearTimers();
    const mine = token;
    const ctl = new AbortController();
    knownAbort = ctl;
    set({ ...FRESH, stage: 'set', box, last: box, screen: 'search', say: { kind: 'searching', text: 'Known objects in this area' } });
    // Settled at once (a refusal must not sit unhandled while the island "searches"). No prepared
    // area: the coverage check runs inside the same search (issue #144).
    type Answer =
      | { res: KnownObjectsResult }
      | { refusal: AreaRefusal }
      | { live: Exclude<PlanAnswer, { kind: 'unavailable' }> };
    const answer: Promise<Answer> = knownObjectsIn(box, ctl.signal).then(
      (res): Answer => ({ res }),
      async (e: unknown): Promise<Answer> => {
        const refusal = refusalOf(e);
        const live = handoff ? null : await liveCheck(box, refusal, ctl.signal);
        return live ? { live } : { refusal };
      },
    );
    timers.push(
      setTimeout(() => {
        void answer.then((a) => {
          if (mine !== token) return;
          if ('live' in a) {
            openLive(box, 'known', a.live);
            return;
          }
          if ('refusal' in a) {
            const refusal = a.refusal;
            set({ say: { kind: 'found', text: refusal.message } });
            timers.push(
              setTimeout(() => {
                if (mine !== token) return;
                set({ say: null, screen: 'list', known: null, refusal });
              }, FOUND_MS),
            );
            return;
          }
          const res = a.res;
          const n = res.objects.length;
          const names = res.objects.map((o) => [o.id, o.name].filter(Boolean).join(' ')).join(', ');
          set({
            say: {
              kind: 'found',
              text:
                (n === 0 ? 'No known objects in this area' : `${n} known object${n === 1 ? '' : 's'}: ${names}`) +
                (res.demo ? ' (demo)' : ''),
            },
          });
          timers.push(
            setTimeout(() => {
              if (mine !== token) return;
              set({ say: null, screen: 'list', known: res });
            }, FOUND_MS),
          );
        });
      }, SEARCH_MS),
    );
  };

  // A Track job that ends opens its Track view, unless the user has left the area tool or moved to
  // another card meanwhile; the object is Track-available from then on (its row says so).
  registerTrackDone((obj) => {
    const s = get();
    const key = obj.designation ?? obj.id;
    const known = s.known
      ? { ...s.known, objects: s.known.objects.map((o) => ((o.designation ?? o.id) === key ? { ...o, trackAvailable: true } : o)) }
      : null;
    set({ known });
    if (s.screen === 'track' && useShellStore.getState().tool === 'area') get().openEros(obj);
  });

  /** The live card for a box with no prepared area (issue #144). */
  const openLive = (box: AreaBox, flow: AreaFlow, live: Exclude<PlanAnswer, { kind: 'unavailable' }>) => {
    set({ say: null, screen: 'live', minimised: false });
    useLiveJobStore.getState().showPlan(box, flow, live);
  };
  // A done live area (or a stored one) opens in the existing results views, unchanged.
  // The live card has nothing left to show (a followed job stopped, with no offer to go back to).
  registerLiveRedraw(() => {
    if (get().screen === 'live') get().redraw();
  });
  registerLiveHandoff((box, flow, { ifIdle }) => {
    const shell = useShellStore.getState();
    const s = get();
    // Never over another area the user is busy with (any card of a set box, the live card of
    // another box included, or a box being dragged): only on the plain sky or while aiming.
    if (ifIdle && shell.tool === 'area' && (s.stage === 'set' || s.drag !== null)) return;
    if (ifIdle && shell.tool !== 'area' && shell.tool !== 'sky') return;
    clearTimers();
    set({ ...FRESH, flow });
    if (shell.tool !== 'area') shell.setTool('area');
    if (flow === 'known') runKnown(box, true);
    else {
      set({ ...FRESH, flow, stage: 'set', box, last: box });
      openDiscFor(true);
    }
  });
  const openDiscFor = (handoff: boolean) => {
    const s0 = get();
    // Back from a mover card: the steps stay as they were.
    if (s0.disc) {
      set({ screen: 'disc', minimised: false, playing: false });
      return;
    }
    clearTimers();
    const mine = token;
    const ctl = new AbortController();
    knownAbort = ctl;
    set((s) => ({ screen: 'disc', minimised: false, step: -1, running: false, sel: -1, fitSeq: s.fitSeq + 1 }));
    const box = get().box;
    if (!box) return;
    void Promise.all([discoverIn(box, ctl.signal), loadEros()]).then(
      ([disc]) => {
        if (mine !== token) return;
        set({ disc });
        startRun();
      },
      async (e: unknown) => {
        if (mine !== token) return;
        const refusal = refusalOf(e);
        // No prepared area: the coverage check, then the live card (issue #144).
        const live = handoff ? null : await liveCheck(box, refusal, ctl.signal);
        if (mine !== token) return;
        if (live) openLive(box, 'discovery', live);
        else set({ refusal, running: false });
      },
    );
  };

  return {
    flow: 'discovery',
    ...FRESH,
    last: null,
    eros: null,
    focus: null,
    trackSource: 'demo',
    trackPath: false,
    pathPending: false,
    refusal: null,
    erosFailed: false,
    fitSeq: 0,
    startFlow: (flow) => {
      clearTimers();
      useLiveJobStore.getState().clearView();
      useTrackJobStore.getState().clear();
      set({ ...FRESH, flow });
    },
    setDrag: (drag) => set({ drag }),
    pickPatch: () => {
      if (get().stage === 'aiming') set({ stage: 'drawing', drag: null });
    },
    setBox: (box) => {
      if (get().flow === 'known') runKnown(box);
      else {
        clearTimers();
        set({ ...FRESH, stage: 'set', box, last: box });
        get().openDisc();
      }
    },
    redraw: () => get().startFlow(get().flow),
    openList: () => {
      clearTimers();
      set({ screen: 'list', say: null, minimised: false, playing: false });
    },
    openEros: (obj = null) => {
      set((s) => ({
        screen: 'eros',
        // Back from the Track view: to the Discovery track it was opened from, else none (Known).
        trackBack: s.screen === 'mover' ? 'mover' : s.screen === 'track' ? s.trackBack : 'list',
        minimised: false,
        index: 0,
        det: null,
        playing: false,
        // Kept when it came from a Discovery track, so its back chevron returns to that track.
        sel: s.screen === 'mover' || (s.screen === 'track' && s.trackBack === 'mover') ? s.sel : -1,
        fitSeq: s.fitSeq + 1,
        focus: obj,
        eros: obj ? null : s.eros,
        trackSource: 'demo',
        trackPath: false,
        pathPending: false,
        erosFailed: false,
      }));
      void loadEros(obj);
    },
    openDisc: () => openDiscFor(false),
    trackBack: 'list',
    openTrack: (obj, around, release) => {
      const from = get().screen;
      set({ screen: 'track', minimised: false, focus: obj, trackBack: from === 'mover' ? 'mover' : 'list', playing: false });
      void useTrackJobStore.getState().start(obj, around, release);
    },
    openMover: (i) =>
      set({ screen: 'mover', sel: i, minimised: false, index: 0, det: null, playing: false }),
    setMinimised: (minimised) => set({ minimised }),
    setIndex: (i) => {
      const n = erosList(get().eros, get().det).length;
      if (n > 0) set({ index: Math.min(n - 1, Math.max(0, i)) });
    },
    setVisit: (visit) => set({ visit }),
    setPlaying: (playing) => set({ playing }),
    setDet: (det) => {
      const s = get();
      const was = erosList(s.eros, s.det);
      const now = erosList(s.eros, det);
      const frac = was.length > 1 ? s.index / (was.length - 1) : 0;
      set({ det, index: now.length > 1 ? Math.round(frac * (now.length - 1)) : 0 });
    },
    toggleOv: (k) => set((s) => ({ ov: { ...s.ov, [k]: !s.ov[k] } })),
    reset: () => {
      clearTimers();
      useLiveJobStore.getState().clearView();
      useTrackJobStore.getState().clear();
      set({ ...FRESH });
    },
  };
});

/** What the island's pill calls the open card while it is minimised. */
export function areaMiniTitle(
  s: Pick<AreaState, 'screen' | 'sel' | 'disc' | 'known'> &
    Partial<Pick<AreaState, 'focus' | 'trackSource'>>,
): string {
  if (s.screen === 'eros') {
    const name = s.focus ? [s.focus.id, s.focus.name].filter(Boolean).join(' ') : '433 Eros';
    return s.trackSource === 'real' ? name : `${name} (demo)`;
  }
  // Only an answer known to be the demo says "(demo)"; a prepared area's, one still loading or a
  // refused one do not.
  const tag = (s.screen === 'list' ? s.known?.demo : s.disc?.demo) === true ? ' (demo)' : '';
  if (s.screen === 'mover') {
    const m = s.disc?.movers[s.sel];
    return m ? `${m.known ? `${m.id} · ${m.known}` : m.id}${tag}` : 'Discovery';
  }
  // The live card's pill is liveMiniTitle (Island.tsx); this is only its fallback.
  if (s.screen === 'live') return 'Live area';
  if (s.screen === 'track') {
    const name = s.focus ? [s.focus.id, s.focus.name].filter(Boolean).join(' ') : 'Track';
    return `${name} · Preparing Track`;
  }
  return s.screen === 'list' ? `Known objects${tag}` : `Discovery${tag}`;
}

/** The Eros exposure on show, or null. */
export function currentHop(s: Pick<AreaState, 'eros' | 'det' | 'index'>): ErosHop | null {
  const l = erosList(s.eros, s.det);
  return l[Math.min(s.index, l.length - 1)] ?? null;
}

/** True while the top-left player drives the Eros exposures (the Eros card is open). */
export function demoPlayerOn(s: Pick<AreaState, 'screen' | 'sel' | 'eros' | 'disc'>): boolean {
  // Mover T1 is Eros only in the demo; a prepared area's movers have no demo frames.
  return (
    s.eros !== null &&
    (s.screen === 'eros' || (s.screen === 'mover' && s.sel === 0 && !s.disc?.real))
  );
}

/** One length: "3.2°", "42′" (arcminutes under one degree) or "30″". */
export function formatAreaSize(deg: number): string {
  if (deg >= 1) return `${deg.toFixed(deg >= 10 ? 0 : 1)}°`;
  const arcmin = deg * 60;
  if (arcmin >= 1) return `${arcmin.toFixed(arcmin >= 10 ? 0 : 1)}′`;
  return `${(arcmin * 60).toFixed(0)}″`;
}

/** "1.27° × 0.77°", or "42′ × 18′" once the larger side is under one degree. */
export function formatAreaDims(box: Pick<AreaBox, 'widthDeg' | 'heightDeg'>): string {
  const big = Math.max(box.widthDeg, box.heightDeg);
  const one = (d: number): string => {
    if (big >= 1) return `${d.toFixed(big >= 10 ? 1 : 2)}°`;
    const m = d * 60;
    if (big * 60 >= 1) return `${m.toFixed(big * 60 >= 10 ? 0 : 1)}′`;
    return `${(m * 60).toFixed(0)}″`;
  };
  return `${one(box.widthDeg)} × ${one(box.heightDeg)}`;
}
