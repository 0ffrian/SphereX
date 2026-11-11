// Area search state (A18.9; issue #96, P8). The `area` slice and its actions, composed into the
// app store by store.ts (D-17: store.ts stays Moon's; the hand-over of this file is proposed in
// Q-406). Fields P9 needs (`known`, `card`, `minimised`, `selectedResult`, `step`) are declared
// here so P9 builds on the same type.
//
// Requests: one AbortController per area, as the sky search's; a newer square or area aborts the
// older requests, and a reply for an older area is dropped. Announcements go through
// `sky.announcement` until the shell's `announce()` exists (Q-176); blink ticks are never said.
import type {
  AreaDots,
  AreaIndex,
  AreaIndexEntry,
  AreaKnown,
  AreaSummary,
  AreaTracks,
} from '@/contract';
import type { ApiClient, ApiResult } from '@/app/api/client';
import { isApiError } from '@/app/api/errors';
import { formatVisitTime } from '@/app/format';
import {
  areaLinkProblem,
  areaSnapAnnouncement,
  AREA_NOT_PREPARED,
  AREA_TOO_BIG,
  AREA_TOO_SMALL,
  visitAnnouncement,
} from '@/app/messages';
import { nextVisit, visitNumbers, visitTimes } from '@/app/sky/area/blink';
import type { SkySquare } from '@/app/sky/area/geometry';
import { snapToArea } from '@/app/sky/area/snap';
import type { AppStore, SkyError } from './store';

export type Load<T> = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: T | null;
  error: SkyError | null;
};

export type AreaStep = 0 | 1 | 2 | 3 | 4 | 5;

export type AreaRefusal =
  'square:too_small' | 'square:too_big' | 'area:not_prepared' | 'area:not_found' | null;

export interface AreaLayers {
  dots: boolean;
  tracks: boolean;
  known: boolean;
}

export interface AreaState {
  index: Load<AreaIndex>;
  areaId: string | null;
  /** The square searched last (centre, RA in [0, 360), side in degrees). */
  square: SkySquare | null;
  /** The square searched last, kept while drawing again ("Keep the last square"). */
  lastSquare: SkySquare | null;
  summary: Load<AreaSummary>;
  known: Load<AreaKnown>;
  dots: Load<AreaDots>;
  tracks: Load<AreaTracks>;
  layers: AreaLayers;
  /** Discovery step, 0 (nothing) to 5 (checked); P8 opens at 5, P9's replay drives it (Q-406 (3)). */
  step: AreaStep;
  visit: number;
  blink: boolean;
  selectedResult: string | null;
  /** The open Area card; P9 adds its cards. */
  card: 'area' | null;
  minimised: boolean;
  refusal: AreaRefusal;
  /** Any area reply came from the dev fixture server (A11). */
  fixture: boolean;
}

/**
 * P9 PLACEHOLDER (Q-406 (7)): the final state is shown until the replay lands. When an area opens,
 * both layers are on at the last step (5, checked), so the verdicts and labels show at once. P9
 * replaces this one constant: its Options card opens with the layers off and its Discovery replay
 * drives `step`, so a "found blind" label is not shown before Known or Discovery is chosen
 * (red-team M11).
 */
export const AREA_OPEN_DEFAULTS: { layers: AreaLayers; step: AreaStep } = {
  layers: { dots: true, tracks: true, known: false },
  step: 5,
};

const idle = <T>(): Load<T> => ({ status: 'idle', data: null, error: null });

export const initialAreaState: AreaState = {
  index: idle(),
  areaId: null,
  square: null,
  lastSquare: null,
  summary: idle(),
  known: idle(),
  dots: idle(),
  tracks: idle(),
  layers: { dots: false, tracks: false, known: false },
  step: 0,
  visit: 1,
  blink: false,
  selectedResult: null,
  card: null,
  minimised: false,
  refusal: null,
  fixture: false,
};

export type AreaOpenOrigin = 'snap' | 'hash' | 'fly';

export interface AreaActions {
  areaShowCard(): void;
  areaCloseCard(): void;
  /** `GET /v1/areas` once; again after an error. Resolves with the index or null. */
  areaLoadIndex(): Promise<AreaIndex | null>;
  /** A drawn or chosen square: snap it to a prepared area and open it. True when one snapped. */
  areaSearchSquare(sq: SkySquare): Promise<boolean>;
  /** Open a prepared area by id (a snap, a shared link or Fly there). */
  areaOpen(id: string, origin: AreaOpenOrigin): Promise<boolean>;
  /** A square refused while drawing (too small or too big): the card says why. */
  areaRefuse(refusal: 'square:too_small' | 'square:too_big'): void;
  areaSetLayer(layer: keyof AreaLayers, on: boolean): void;
  areaSetVisit(visit: number): void;
  /** Blink tick or "Next visit": the next visit. `say` announces it (never for a blink tick). */
  areaStepVisit(say?: boolean): void;
  areaSetBlink(on: boolean): void;
  areaSetStep(step: AreaStep): void;
  areaSelectResult(trackId: string | null): void;
  /** A keyboard edit of the square (no search until Enter). */
  areaSetSquare(sq: SkySquare): void;
  /** `GET /v1/areas/{id}/known` for the open area (P9's Known card). */
  areaLoadKnown(): Promise<void>;
}

type Set = (fn: (s: AppStore) => Partial<AppStore>) => void;
type Get = () => AppStore;

let areaAbort: AbortController | null = null;
let indexAbort: AbortController | null = null;
let indexPromise: Promise<AreaIndex | null> | null = null;

function toError(e: unknown): SkyError {
  if (isApiError(e)) return { kind: e.kind, status: e.status, code: e.code, detail: e.detail };
  return {
    kind: 'bad_response',
    status: null,
    code: null,
    detail: e instanceof Error ? e.message : null,
  };
}

const aborted = (e: unknown) => isApiError(e) && e.kind === 'aborted';

/** For tests: forget the module-level requests between stores. */
export function resetAreaRequests(): void {
  areaAbort?.abort();
  indexAbort?.abort();
  areaAbort = null;
  indexAbort = null;
  indexPromise = null;
}

export function createAreaActions(set: Set, get: Get, api: () => ApiClient): AreaActions {
  const setArea = (patch: Partial<AreaState>) => set((s) => ({ area: { ...s.area, ...patch } }));
  const say = (announcement: string) => set((s) => ({ sky: { ...s.sky, announcement } }));
  const noteFixture = (res: ApiResult<unknown>) => {
    if (res.fixture === null) return;
    if (!get().area.fixture) setArea({ fixture: true });
    get().skyMarkFixtureSeen();
  };
  /** Loads one part of the open area (dots, tracks or known) unless it is loaded or loading. */
  const loadPart = async <K extends 'dots' | 'tracks' | 'known'>(
    key: K,
    fetch: (
      id: string,
      signal: AbortSignal,
    ) => Promise<ApiResult<NonNullable<AreaState[K]['data']>>>,
  ) => {
    const { areaId } = get().area;
    const controller = areaAbort;
    if (!areaId || !controller) return;
    const cur = get().area[key];
    if (cur.status === 'loading' || cur.status === 'ready') return;
    setArea({ [key]: { status: 'loading', data: null, error: null } } as Partial<AreaState>);
    try {
      const res = await fetch(areaId, controller.signal);
      if (areaAbort !== controller) return;
      noteFixture(res);
      setArea({ [key]: { status: 'ready', data: res.data, error: null } } as Partial<AreaState>);
    } catch (e) {
      if (areaAbort !== controller || aborted(e)) return;
      setArea({ [key]: { status: 'error', data: null, error: toError(e) } } as Partial<AreaState>);
    }
  };

  const loadLayers = () => {
    const { layers } = get().area;
    // The Tracks layer joins its dot ids to /dots (Q-208 (2)), so it needs both.
    if (layers.dots || layers.tracks) void loadPart('dots', (id, s) => api().areaDots(id, s));
    if (layers.tracks) void loadPart('tracks', (id, s) => api().areaTracks(id, s));
  };

  const visitsOf = () => {
    const a = get().area;
    return visitNumbers(a.summary.data, a.dots.data);
  };

  const timeOf = (visit: number) => {
    const t = visitTimes(get().area.summary.data).get(visit);
    return t ? formatVisitTime(t) : null;
  };

  return {
    areaShowCard: () => {
      if (get().area.card !== 'area') setArea({ card: 'area' });
    },

    areaCloseCard: () => setArea({ card: null, blink: false }),

    areaLoadIndex: () => {
      const cur = get().area.index;
      if (cur.status === 'ready') return Promise.resolve(cur.data);
      if (cur.status === 'loading' && indexPromise) return indexPromise;
      indexAbort?.abort();
      const controller = new AbortController();
      indexAbort = controller;
      setArea({ index: { status: 'loading', data: null, error: null } });
      indexPromise = (async () => {
        try {
          const res = await api().areaIndex(controller.signal);
          if (indexAbort !== controller) return null;
          noteFixture(res);
          setArea({ index: { status: 'ready', data: res.data, error: null } });
          return res.data;
        } catch (e) {
          if (indexAbort !== controller) return null;
          setArea({ index: { status: 'error', data: null, error: toError(e) } });
          return null;
        }
      })();
      return indexPromise;
    },

    areaSearchSquare: async (sq) => {
      areaAbort?.abort();
      areaAbort = null;
      setArea({
        square: sq,
        lastSquare: sq,
        refusal: null,
        blink: false,
        selectedResult: null,
      });
      const index = await get().areaLoadIndex();
      // A newer square was drawn while the index loaded.
      if (get().area.square !== sq) return false;
      if (!index) return false;
      const hit = snapToArea(sq, index.areas);
      if (!hit) {
        setArea({
          areaId: null,
          refusal: index.areas.length > 0 ? 'area:not_prepared' : null,
          summary: idle(),
          dots: idle(),
          tracks: idle(),
          known: idle(),
        });
        if (index.areas.length > 0) say(`${AREA_NOT_PREPARED}.`);
        return false;
      }
      return get().areaOpen(hit.area_id, 'snap');
    },

    areaOpen: async (id, origin) => {
      const index = await get().areaLoadIndex();
      const entry = index?.areas.find((a) => a.area_id === id) ?? null;
      if (!entry) {
        if (origin === 'hash' && index) get().skySetLinkProblems([areaLinkProblem(id)]);
        else if (index) setArea({ refusal: 'area:not_found' });
        return false;
      }
      areaAbort?.abort();
      const controller = new AbortController();
      areaAbort = controller;
      setArea({
        areaId: id,
        card: 'area',
        refusal: null,
        layers: { ...AREA_OPEN_DEFAULTS.layers },
        step: AREA_OPEN_DEFAULTS.step,
        blink: false,
        selectedResult: null,
        summary: { status: 'loading', data: null, error: null },
        dots: idle(),
        tracks: idle(),
        known: idle(),
      });
      try {
        const res = await api().area(id, controller.signal);
        if (areaAbort !== controller) return false;
        noteFixture(res);
        const visits = visitNumbers(res.data, null);
        setArea({
          summary: { status: 'ready', data: res.data, error: null },
          visit: visits[0] ?? 1,
        });
        say(areaSnapAnnouncement(entry.width_deg, entry.height_deg, res.data.n_visits));
      } catch (e) {
        if (areaAbort !== controller || aborted(e)) return false;
        const err = toError(e);
        setArea({
          summary: { status: 'error', data: null, error: err },
          refusal: err.code === 'area_not_found' ? 'area:not_found' : null,
        });
        return false;
      }
      loadLayers();
      return true;
    },

    areaRefuse: (refusal) => {
      setArea({ refusal });
      say(`${refusal === 'square:too_small' ? AREA_TOO_SMALL : AREA_TOO_BIG}.`);
    },

    areaSetLayer: (layer, on) => {
      const a = get().area;
      if (a.layers[layer] === on) return;
      setArea({
        layers: { ...a.layers, [layer]: on },
        ...(layer === 'tracks' && !on ? { selectedResult: null } : {}),
      });
      loadLayers();
    },

    areaSetVisit: (visit) => {
      const visits = visitsOf();
      if (!visits.includes(visit) || get().area.visit === visit) return;
      setArea({ visit });
      say(visitAnnouncement(visit, visits.length, timeOf(visit)));
    },

    areaStepVisit: (announce = false) => {
      const visits = visitsOf();
      if (visits.length < 2) return;
      const visit = nextVisit(visits, get().area.visit);
      setArea({ visit });
      if (announce) say(visitAnnouncement(visit, visits.length, timeOf(visit)));
    },

    areaSetBlink: (on) => {
      if (get().area.blink === on) return;
      if (on && visitsOf().length < 2) return;
      setArea({ blink: on });
    },

    areaSetStep: (step) => setArea({ step }),

    areaSelectResult: (trackId) => {
      if (get().area.selectedResult !== trackId) setArea({ selectedResult: trackId });
    },

    areaSetSquare: (sq) => setArea({ square: sq }),

    areaLoadKnown: () => loadPart('known', (id, s) => api().areaKnown(id, s)),
  };
}

/** The prepared area that is open, from the index (null before it loads). */
export function openAreaEntry(area: AreaState): AreaIndexEntry | null {
  if (!area.areaId) return null;
  return area.index.data?.areas.find((a) => a.area_id === area.areaId) ?? null;
}
