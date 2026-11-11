// State of the square tools (Known objects and Discovery, the dock's two buttons): the square drawn
// on the sky, which flow started it and where that flow is. The square is kept in sky coordinates
// (two opposite corners), so it stays on the same patch of sky while the view moves.
//
// The area search backend is not built (Q-205 pending): the results come from app/area/areaService.ts,
// a dummy that is marked `demo: true`. Nothing here is a real search of the square.
import { create } from 'zustand';
import {
  discoverIn,
  erosDemo,
  knownObjectsIn,
  type AreaFlow,
  type DiscoveryResult,
  type ErosDemo,
  type ErosHop,
  type KnownObjectsResult,
} from '@/app/area/areaService';

export interface SkyCorner {
  ra: number;
  dec: number;
}
export interface AreaBox {
  /** Top-left and bottom-right corners when drawn. */
  a: SkyCorner;
  b: SkyCorner;
  /** Angular width of the square in degrees, from the sky view's own projection. */
  widthDeg: number;
}
/** The square being dragged, in sky-pane pixels. */
export interface AreaDrag {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
/** Where the flow is: the drawing card, the island searching, the list, an Eros card, the steps. */
export type AreaScreen = 'draw' | 'search' | 'list' | 'eros' | 'disc' | 'mover';

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

export interface AreaState {
  /** Which dock tool started this (the dock highlight follows it). */
  flow: AreaFlow;
  /** drawing: waiting for a drag; set: a square exists. */
  stage: 'drawing' | 'set';
  box: AreaBox | null;
  /** The last square, kept for "Keep the last square" after redrawing or reopening. */
  last: AreaBox | null;
  drag: AreaDrag | null;
  screen: AreaScreen;
  say: AreaSay | null;
  /** The card is shrunk to the island's pill. */
  minimised: boolean;
  known: KnownObjectsResult | null;
  disc: DiscoveryResult | null;
  eros: ErosDemo | null;
  /** The demo file could not be loaded. */
  erosFailed: boolean;
  /** Discovery: the last step that is done (-1: none yet), and whether the run is going. */
  step: number;
  running: boolean;
  /** The mover whose card is open (or ringed on the sky), -1 for none. */
  sel: number;
  /** Eros exposure shown (an index into the detector-filtered list) and the player's state. */
  index: number;
  playing: boolean;
  /** Detector 0..5 filter, null for all. */
  det: number | null;
  ov: ErosOverlays;
  /** Bumped when the sky should fly to fit the whole square (and on a refit). */
  fitSeq: number;
  /** Dock: start a flow (also from another flow): drawing mode, nothing searched yet. */
  startFlow(flow: AreaFlow): void;
  setDrag(drag: AreaDrag | null): void;
  /** The square is set: Known starts the island's search, Discovery opens its steps. */
  setBox(box: AreaBox): void;
  redraw(): void;
  openList(): void;
  openEros(): void;
  openDisc(): void;
  openMover(i: number): void;
  setMinimised(on: boolean): void;
  setIndex(i: number): void;
  setPlaying(on: boolean): void;
  setDet(det: number | null): void;
  toggleOv(k: keyof ErosOverlays): void;
  /** Leaving the tool: back to the start, keeping the last square. */
  reset(): void;
}

const SEARCH_MS = 1900;
const FOUND_MS = 1000;
const STEP_MS = 1000;

let timers: ReturnType<typeof setTimeout>[] = [];
let stepTimer: ReturnType<typeof setInterval> | null = null;
/** Bumped by every restart, so a late answer of an older run is dropped. */
let token = 0;
function clearTimers(): void {
  for (const t of timers) clearTimeout(t);
  timers = [];
  if (stepTimer !== null) clearInterval(stepTimer);
  stepTimer = null;
  token++;
}

const FRESH = {
  stage: 'drawing' as const,
  box: null,
  drag: null,
  screen: 'draw' as const,
  say: null,
  minimised: false,
  known: null,
  disc: null,
  step: -1,
  running: false,
  sel: -1,
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
  const loadEros = async (): Promise<ErosDemo | null> => {
    const d = await erosDemo();
    set({ eros: d, erosFailed: d === null });
    return d;
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
  const runKnown = (box: AreaBox) => {
    clearTimers();
    const mine = token;
    set({ ...FRESH, stage: 'set', box, last: box, screen: 'search', say: { kind: 'searching', text: 'Known objects in this square' } });
    const answer = knownObjectsIn(box);
    timers.push(
      setTimeout(() => {
        void answer.then((res) => {
          if (mine !== token) return;
          const n = res.objects.length;
          const names = res.objects.map((o) => `${o.id} ${o.name}`).join(', ');
          set({
            say: {
              kind: 'found',
              text: n === 0 ? 'No known objects in this square' : `${n} known object${n === 1 ? '' : 's'}: ${names}`,
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

  return {
    flow: 'discovery',
    ...FRESH,
    last: null,
    eros: null,
    erosFailed: false,
    fitSeq: 0,
    startFlow: (flow) => {
      clearTimers();
      set({ ...FRESH, flow });
    },
    setDrag: (drag) => set({ drag }),
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
    openEros: () => {
      set((s) => ({ screen: 'eros', minimised: false, index: 0, det: null, playing: false, sel: -1, fitSeq: s.fitSeq + 1 }));
      void loadEros();
    },
    openDisc: () => {
      const s0 = get();
      // Back from a mover card: the steps stay as they were.
      if (s0.disc) {
        set({ screen: 'disc', minimised: false, playing: false });
        return;
      }
      clearTimers();
      const mine = token;
      set((s) => ({ screen: 'disc', minimised: false, step: -1, running: false, sel: -1, fitSeq: s.fitSeq + 1 }));
      const box = get().box;
      if (!box) return;
      void Promise.all([discoverIn(box), loadEros()]).then(([disc]) => {
        if (mine !== token) return;
        set({ disc });
        startRun();
      });
    },
    openMover: (i) =>
      set({ screen: 'mover', sel: i, minimised: false, index: 0, det: null, playing: false }),
    setMinimised: (minimised) => set({ minimised }),
    setIndex: (i) => {
      const n = erosList(get().eros, get().det).length;
      if (n > 0) set({ index: Math.min(n - 1, Math.max(0, i)) });
    },
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
      set({ ...FRESH });
    },
  };
});

/** What the island's pill calls the open card while it is minimised. */
export function areaMiniTitle(s: Pick<AreaState, 'screen' | 'sel' | 'disc'>): string {
  if (s.screen === 'eros') return '433 Eros';
  if (s.screen === 'mover') {
    const m = s.disc?.movers[s.sel];
    return m ? (m.known ? `${m.id} · ${m.known}` : m.id) : 'Discovery';
  }
  return s.screen === 'list' ? 'Known objects' : 'Discovery';
}

/** The Eros exposure on show, or null. */
export function currentHop(s: Pick<AreaState, 'eros' | 'det' | 'index'>): ErosHop | null {
  const l = erosList(s.eros, s.det);
  return l[Math.min(s.index, l.length - 1)] ?? null;
}

/** True while the top-left player drives the Eros exposures (the Eros card is open). */
export function demoPlayerOn(s: Pick<AreaState, 'screen' | 'sel' | 'eros'>): boolean {
  return s.eros !== null && (s.screen === 'eros' || (s.screen === 'mover' && s.sel === 0));
}

/** "3.2°" or "42′" (arcminutes under one degree). */
export function formatAreaSize(widthDeg: number): string {
  if (widthDeg >= 1) return `${widthDeg.toFixed(widthDeg >= 10 ? 0 : 1)}°`;
  const arcmin = widthDeg * 60;
  if (arcmin >= 1) return `${arcmin.toFixed(arcmin >= 10 ? 0 : 1)}′`;
  return `${(arcmin * 60).toFixed(0)}″`;
}
