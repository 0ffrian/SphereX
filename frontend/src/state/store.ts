// A10 state: one Zustand store holding the current ObjectCard, RenderParams, honesty state and
// the client-side `overrides` map (D-02: user edits live apart from the card so Reset restores
// the data values), plus the flipbook session (`sky`: search, frames, playback, spectrum; A1.1,
// D-16; overlays and combined frames, issue #12).
import { create } from 'zustand';
import type { ObjectCard, RenderParams } from '@/contract';
import type { RendererBackend } from '@/viewer/ViewerApp';
import {
  createApiClient,
  revokeObjectUrl,
  type ApiClient,
  type CombineResult,
} from '@/app/api/client';
import { isApiError, type ApiErrorKind } from '@/app/api/errors';
import type { ApiResult } from '@/app/api/client';
import type {
  CombineOp,
  CompositeResponse,
  FramesResponse,
  OverlaysResponse,
  ResolveResponse,
  SpectrumResponse,
} from '@/app/api/types';
import {
  colourAnnouncement,
  colourHidden,
  DEFAULT_COLOUR_CHOICE,
  effectiveColour,
  requestedColour,
  transportLocked,
  type ColourChoice,
} from '@/app/flipbook/colourMode';
import { clampIndex, DEFAULT_FPS, nextIndex, type Fps } from '@/app/flipbook/playback';
import {
  framesCounts,
  hasDeferred,
  indexAfterMerge,
  mergeFrames,
  pollFrames,
  PROGRESS_ANNOUNCE_MIN_MS,
  type PollRetry,
} from '@/app/flipbook/progressive';
import { formatCoords, formatUtc, formatWavelength } from '@/app/format';
import {
  compositeAnnouncement,
  framesCompleteAnnouncement,
  framesFirstPartAnnouncement,
  framesProgressAnnouncement,
  framesRetryAnnouncement,
  framesStoppedAnnouncement,
  spectrumAnnouncement,
  SPECTRUM_WAITING_ANNOUNCEMENT,
} from '@/app/messages';
import { summarizeSpectrum } from '@/app/refusals';
import { isValidOverride, type Overrides, type SliderKey } from '@/viewer/sliders';

/**
 * Honesty toggle (D-21, R5.3): Measured only, + Estimated, + Artistic. The value names the most
 * permissive tag group shown: `measured`, `derived` (+ Estimated: derived, model_dependent,
 * inferred_from_analog) or `artistic`.
 */
export type HonestyState = 'measured' | 'derived' | 'artistic';

/** D-02 / D-27 client-side overrides: slider key → value in card units (`@/viewer/sliders`). */
export type { Overrides } from '@/viewer/sliders';

/** What the status line reports about the 3D renderer. */
export type RendererStatus = 'starting' | RendererBackend | 'unavailable';

// ---- Flipbook session (sky slice) ------------------------------------------------------------

export type SkyStatus = 'idle' | 'resolving' | 'loading_frames' | 'ready' | 'error';
export type SkyViewMode = 'frames' | 'trails';

export interface SkyQuery {
  /** Sent to `GET /v1/resolve?q=` as is: a name, or "ra,dec" in degrees. */
  q: string;
  kind: 'name' | 'coords';
  /**
   * 'hash' when the search came from a shared link; the URL is then replaced, not pushed.
   * 'sky' when the user picked a position or a marker on the sky view; the search field then
   * shows the query, as for a link.
   */
  origin: 'input' | 'hash' | 'sky';
  /** Frame to show once frames load (from a shared link). */
  frameId?: string;
}

export interface SkyError {
  kind: ApiErrorKind;
  status: number | null;
  code: string | null;
  detail: string | null;
  /** For a 'timeout': how long the request waited, in ms (issue #102). Absent otherwise. */
  timeoutMs?: number | null;
}

export interface SpectrumState {
  /** 'waiting': asked for while frames are still being fetched; measured once they are all in. */
  status: 'idle' | 'waiting' | 'loading' | 'ready' | 'error';
  data: SpectrumResponse | null;
  error: SkyError | null;
}

/** The colour composite of the current object (`GET /v1/objects/{id}/composite`). */
export interface CompositeState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** `Date.now()` when the request started, for the elapsed-time message. */
  startedAt: number | null;
  data: CompositeResponse | null;
  error: SkyError | null;
}

/** A failed frames request that is being retried (progressive.ts PollRetry, in store terms). */
export interface FramesRetry {
  /** A client timeout: the server is probably still downloading; not counted as an error. */
  timeout: boolean;
  failures: number;
  max: number;
  delayMs: number;
  error: SkyError;
}

/**
 * Progressive frame loading (flipbook/progressive.ts): set while the backend still lists
 * `cutouts:deferred:<n>` for the current object, null once the list is complete.
 */
export interface FramesProgress {
  /** 'fetching': asking again; 'stopped': the user pressed Stop; 'failed': gave up after errors. */
  phase: 'fetching' | 'stopped' | 'failed';
  /** Frames replies merged so far. */
  replies: number;
  retry: FramesRetry | null;
  /** Why it gave up ('failed'). */
  error: SkyError | null;
  /** A frame named in a shared link that has not arrived yet; dropped when the user moves. */
  pendingFrameId: string | null;
}

/** Overlay layers the flipbook can draw over the cutout (issue #12). */
export type OverlayLayer = 'gaia' | 'wise' | 'flags' | 'fov';
export type OverlayToggles = Readonly<Record<OverlayLayer, boolean>>;

export interface OverlaysState {
  /**
   * Loaded lazily: the first time any layer is switched on, not on every search. 'waiting': a
   * layer was switched on while the frame list is still loading progressively; the overlays are
   * asked for once, when the list is complete (one per-frame reply for every frame, and no
   * cutout downloads alongside the frames requests).
   */
  status: 'idle' | 'waiting' | 'loading' | 'ready' | 'error';
  data: OverlaysResponse | null;
  error: SkyError | null;
  /** All off by default and after every new search. */
  toggles: OverlayToggles;
}

/** "Combine frames" panel: frame A and frame B added or subtracted by the backend (issue #12). */
export interface CombineState {
  open: boolean;
  op: CombineOp;
  a: string | null;
  b: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** The image as an object URL; revoked whenever it is replaced or cleared. */
  result: CombineResult | null;
  error: SkyError | null;
}

export const OVERLAYS_OFF: OverlayToggles = { gaia: false, wise: false, flags: false, fov: false };

export const initialOverlaysState: OverlaysState = {
  status: 'idle',
  data: null,
  error: null,
  toggles: OVERLAYS_OFF,
};

export const initialCombineState: CombineState = {
  open: false,
  op: 'sub',
  a: null,
  b: null,
  status: 'idle',
  result: null,
  error: null,
};

export interface SkyState {
  query: SkyQuery | null;
  status: SkyStatus;
  /** `Date.now()` when the current request started, for the elapsed-time message. */
  startedAt: number | null;
  error: SkyError | null;
  resolved: ResolveResponse | null;
  frames: FramesResponse | null;
  progress: FramesProgress | null;
  /** True when the current object's data came from the dev fixture server: it is synthetic. */
  fixture: boolean;
  /** True once any reply this session was a fixture; keeps the page banner up between searches. */
  fixtureSeen: boolean;
  index: number;
  playing: boolean;
  fps: Fps;
  viewMode: SkyViewMode;
  /** Raw | Colour, and which colour view (tint or composite). Kept across searches, like `fps`. */
  colour: ColourChoice;
  composite: CompositeState;
  spectrum: SpectrumState;
  overlays: OverlaysState;
  combine: CombineState;
  /** Bumped by every search; a reply for an older id is dropped. */
  requestId: number;
  /** Text for the polite live region (R9). */
  announcement: string;
  /** Unusable parts of a shared link (from parseHash), shown under the search field. */
  linkProblems: string[];
}

export const initialSkyState: SkyState = {
  query: null,
  status: 'idle',
  startedAt: null,
  error: null,
  resolved: null,
  frames: null,
  progress: null,
  fixture: false,
  fixtureSeen: false,
  index: 0,
  playing: false,
  fps: DEFAULT_FPS,
  viewMode: 'frames',
  colour: DEFAULT_COLOUR_CHOICE,
  composite: { status: 'idle', startedAt: null, data: null, error: null },
  spectrum: { status: 'idle', data: null, error: null },
  overlays: initialOverlaysState,
  combine: initialCombineState,
  requestId: 0,
  announcement: '',
  linkProblems: [],
};

let skyApi: ApiClient = createApiClient();
let searchAbort: AbortController | null = null;
/** The progressive frames requests of the current object; Stop aborts only these. */
let framesAbort: AbortController | null = null;
/** When the last progress update went to the live region (throttle, R9). */
let lastProgressSay = 0;
let spectrumAbort: AbortController | null = null;
let compositeAbort: AbortController | null = null;
/** One composite request per object: replies (images and refusals) by object id. */
const compositeCache = new Map<string, ApiResult<CompositeResponse>>();
let overlaysAbort: AbortController | null = null;
let combineAbort: AbortController | null = null;

/** Aborts the overlay and combine requests and frees the combined image of `sky`. */
function dropOverlayRequests(sky: SkyState): void {
  overlaysAbort?.abort();
  combineAbort?.abort();
  overlaysAbort = null;
  combineAbort = null;
  revokeObjectUrl(sky.combine.result?.objectUrl);
}

const LAYER_NAMES: Readonly<Record<OverlayLayer, string>> = {
  gaia: 'Gaia stars',
  wise: 'WISE sources',
  flags: 'Flagged pixels',
  fov: 'Field of view',
};

/** Swap the API client (tests, or a different base URL). Clears the composite cache. */
export function setSkyApi(client: ApiClient): void {
  skyApi = client;
  compositeCache.clear();
}

/** The API client the flipbook uses; the sky view loads its index and markers through it too. */
export function getSkyApi(): ApiClient {
  return skyApi;
}

function toSkyError(e: unknown): SkyError {
  if (isApiError(e)) {
    return {
      kind: e.kind,
      status: e.status,
      code: e.code,
      detail: e.detail,
      ...(e.timeoutMs !== null ? { timeoutMs: e.timeoutMs } : {}),
    };
  }
  return {
    kind: 'bad_response',
    status: null,
    code: null,
    detail: e instanceof Error ? e.message : null,
  };
}

function isAborted(e: unknown): boolean {
  return isApiError(e) && e.kind === 'aborted';
}

/** Frames are still on their way: no spectrum or composite yet (they would use a partial list). */
export function framesFetching(sky: SkyState): boolean {
  return (
    sky.status === 'resolving' ||
    sky.status === 'loading_frames' ||
    sky.progress?.phase === 'fetching'
  );
}

function startProgress(pendingFrameId: string | null): FramesProgress {
  return { phase: 'fetching', replies: 0, retry: null, error: null, pendingFrameId };
}

/** "Frame 5 of 24, 1.420 µm, 2025-05-03 14:22:10 UTC" */
export function describeFrame(frames: FramesResponse, index: number): string {
  const f = frames.frames[index];
  if (!f) return '';
  return `Frame ${index + 1} of ${frames.frames.length}, ${formatWavelength(f.wavelength_um)}, ${formatUtc(f.time)}`;
}

/** The name the panels show: the resolved name, else the coordinates, else the query. */
function displayName(sky: SkyState): string {
  const r = sky.resolved;
  if (r) return r.name ?? formatCoords(r.ra, r.dec);
  return sky.query?.q ?? 'this object';
}

// ---- Store -------------------------------------------------------------------------------------

export interface AppData {
  card: ObjectCard | null;
  params: RenderParams | null;
  /**
   * D-21 (answers Q-08): the toggle starts at + Estimated (`derived`). The type still allows
   * `null`; the viewer reads it through `effectiveHonesty()`, which maps `null` to the same default.
   */
  honesty: HonestyState | null;
  overrides: Overrides;
  rendererStatus: RendererStatus;
  sky: SkyState;
}

export interface AppActions {
  /** Loads an object. Clears overrides, since they belong to the previous object. */
  setObject(card: ObjectCard, params: RenderParams): void;
  clearObject(): void;
  setHonesty(state: HonestyState): void;
  /**
   * D-27: only registered slider keys type-check. A value is stored only when a card is loaded and
   * `isValidOverride` accepts it for the card's type (applies, finite, in range); otherwise the
   * call changes nothing and returns false, so the caller can say why. `undefined` clears that
   * one slider so its data value shows again (returns true).
   */
  setOverride(key: SliderKey, value: number | boolean | undefined): boolean;
  /** D-02 Reset: drop every user edit so the card's data values show again. */
  resetOverrides(): void;
  setRendererStatus(status: RendererStatus): void;

  /** Resolve, then load frames (UML 08). Aborts any earlier search and spectrum request. */
  skySearch(query: SkyQuery): Promise<void>;
  /**
   * Repeat the failed step: the remaining frames if fetching them gave up, the spectrum if that
   * failed, else the whole search.
   */
  skyRetry(): Promise<void>;
  /**
   * Load the spectrum of the resolved object (UML 09). While frames are still being fetched it
   * only marks the spectrum as wanted ('waiting'); it loads once the frame list is complete.
   */
  skyLoadSpectrum(options?: { quiet?: boolean }): Promise<void>;
  /** Stop the progressive frames requests; the frames already shown stay playable. */
  skyStopFrames(): void;
  /** Fetch the remaining frames again after Stop or after giving up. */
  skyContinueFrames(): void;
  skySeek(index: number): void;
  skySeekFrame(frameId: string): void;
  skyStep(delta: number): void;
  skyPlay(): void;
  skyPause(): void;
  skyTogglePlay(): void;
  /** Playback tick: moves to the next frame only once it has loaded or failed. */
  skyAdvance(settled: (index: number) => boolean): void;
  skySetFps(fps: Fps): void;
  skySetViewMode(mode: SkyViewMode): void;
  /**
   * Raw | Colour and the colour view. Pauses playback when the composite (one picture) shows.
   * `quiet` skips the announcement (a shared link sets it).
   */
  skySetColour(choice: ColourChoice, quiet?: boolean): void;
  /** Load the colour composite of the resolved object, once per object (cached). */
  skyLoadComposite(): Promise<void>;
  /** Back to idle (the URL hash was cleared): aborts requests, keeps speed and the fixture flag. */
  skyReset(): void;
  /** Show and announce the unusable parts of a shared link. */
  skySetLinkProblems(problems: string[]): void;
  /** A reply outside a search (the sky index, a marker) came from the fixture server (A11). */
  skyMarkFixtureSeen(): void;

  /** Switch one overlay layer; the first switch-on loads the overlays (again after an error). */
  skyToggleOverlay(layer: OverlayLayer): void;
  /**
   * `GET /v1/objects/{id}/overlays` for the resolved object. Optional: never blocks the flipbook.
   * While the frame list is still loading it only marks the overlays 'waiting'. `quiet`: no
   * "Overlays loaded." announcement (the automatic reload once the list is complete).
   */
  skyLoadOverlays(options?: { quiet?: boolean }): Promise<void>;
  /** Open or close the combine panel. Opening picks the current and the previous frame. */
  skyCombineOpen(open: boolean): void;
  /** Change the operation or a frame; clears a result made from the old choice. */
  skyCombineSet(patch: Partial<Pick<CombineState, 'op' | 'a' | 'b'>>): void;
  /** `GET /v1/objects/{id}/combine.png` for the chosen frames. */
  skyCombineShow(): Promise<void>;
  /** Drop the combined image and free its object URL (the panel unmounted). */
  skyCombineClear(): void;
}

export type AppStore = AppData & AppActions;

export const initialAppData: AppData = {
  card: null,
  params: null,
  honesty: 'derived',
  overrides: {},
  rendererStatus: 'starting',
  sky: initialSkyState,
};

export const useAppStore = create<AppStore>()((set, get) => {
  const setSky = (patch: Partial<SkyState>) => set((s) => ({ sky: { ...s.sky, ...patch } }));
  const isCurrent = (requestId: number) => get().sky.requestId === requestId;

  /** Once the frame list is complete: measure a waiting spectrum, redo partial ones. */
  const afterFramesComplete = () => {
    const s = get().sky;
    const spectrumPartial =
      s.spectrum.status === 'ready' &&
      s.spectrum.data !== null &&
      hasDeferred(s.spectrum.data.missing);
    if (s.spectrum.status === 'waiting' || spectrumPartial) {
      setSky({ spectrum: { status: 'idle', data: null, error: null } });
      void get().skyLoadSpectrum({ quiet: true });
    }
    const c = s.composite;
    if (c.status === 'ready' && c.data && hasDeferred(c.data.missing)) {
      // Built from a partial list (after Stop): the colour view rebuilds it when it shows.
      setSky({ composite: { status: 'idle', startedAt: null, data: null, error: null } });
    }
    // Overlays: any reply so far was for a partial list (frames that arrived later have no
    // markers in it). Ask once more now; with every layer off, drop it so the next switch-on asks.
    const o = s.overlays;
    if (o.status !== 'idle') {
      const anyOn = Object.values(o.toggles).some(Boolean);
      overlaysAbort?.abort();
      overlaysAbort = null;
      if (anyOn) {
        // 'idle' first, so skyLoadOverlays does not skip it as already loading; the old reply
        // stays drawn until the new one lands.
        setSky({ overlays: { ...o, status: 'idle' } });
        void get().skyLoadOverlays({ quiet: o.status !== 'waiting' });
      } else {
        setSky({ overlays: { ...o, status: 'idle', data: null, error: null } });
      }
    }
  };

  /** One frames reply: merge it, keep the user's frame, update progress. True: ask again. */
  const applyFramesReply = (res: ApiResult<FramesResponse>): boolean => {
    const now = get().sky;
    const name = now.resolved?.name ?? now.query?.q ?? 'this object';
    const first = now.status !== 'ready';
    const merged = mergeFrames(first ? null : now.frames, res.data);
    const more = hasDeferred(res.data.missing);
    const pending = now.progress?.pendingFrameId ?? null;
    const { index, pendingFound } = first
      ? indexAfterMerge([], 0, merged.frames, pending)
      : indexAfterMerge(now.frames?.frames ?? [], now.index, merged.frames, pending);
    const counts = framesCounts(merged);
    const t = Date.now();
    let announcement = now.announcement;
    if (first) {
      lastProgressSay = t;
      const n = merged.frames.length;
      announcement = more
        ? framesFirstPartAnnouncement(counts, name)
        : n === 0
          ? `No frames to show for ${name}.`
          : `${n} frames loaded for ${name}.`;
    } else if (!more) {
      announcement = framesCompleteAnnouncement(counts, name);
    } else if (t - lastProgressSay >= PROGRESS_ANNOUNCE_MIN_MS) {
      lastProgressSay = t;
      announcement = framesProgressAnnouncement(counts);
    }
    const fixture = res.fixture !== null;
    setSky({
      frames: merged,
      fixture: now.fixture || fixture,
      fixtureSeen: now.fixtureSeen || fixture,
      status: 'ready',
      startedAt: null,
      index,
      progress: more
        ? {
            phase: 'fetching',
            replies: (now.progress?.replies ?? 0) + 1,
            retry: null,
            error: null,
            pendingFrameId: pendingFound ? null : pending,
          }
        : null,
      announcement,
    });
    if (!more && !first) afterFramesComplete();
    return more;
  };

  const onFramesRetry = (r: PollRetry) => {
    const s = get().sky;
    if (!s.progress) return;
    setSky({
      progress: {
        ...s.progress,
        retry: {
          timeout: r.timeout,
          failures: r.failures,
          max: r.max,
          delayMs: r.delayMs,
          error: toSkyError(r.error),
        },
      },
      // Said once per run of failures, so a slow archive does not flood the live region.
      ...(r.failures === 1 ? { announcement: framesRetryAnnouncement(r.timeout, r.delayMs) } : {}),
    });
  };

  const onFramesGaveUp = (error: unknown) => {
    const s = get().sky;
    if (s.status === 'ready') {
      // Not announced here: the error box is role="alert".
      setSky({
        progress: {
          ...(s.progress ?? startProgress(null)),
          phase: 'failed',
          retry: null,
          error: toSkyError(error),
        },
        announcement: '',
      });
      return;
    }
    setSky({
      status: 'error',
      error: toSkyError(error),
      startedAt: null,
      progress: null,
      announcement: '',
    });
  };

  /**
   * Asks for the frame list until it is complete (progressive.ts pollFrames): one request at a
   * time, stale replies dropped. `first` settles with the first reply or the end of the run.
   */
  const runFrames = (requestId: number, id: string): { first: Promise<void> } => {
    framesAbort?.abort();
    const controller = new AbortController();
    framesAbort = controller;
    const live = () => isCurrent(requestId) && framesAbort === controller;
    let releaseFirst: () => void = () => {};
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    void pollFrames({
      fetch: (signal) => skyApi.frames(id, signal),
      signal: controller.signal,
      retryErrors: () => get().sky.status === 'ready',
      onRetry: (r) => {
        if (live()) onFramesRetry(r);
      },
      onReply: (res) => {
        if (!live()) return false;
        const more = applyFramesReply(res);
        releaseFirst();
        return more;
      },
    }).then((outcome) => {
      if (live()) {
        if (outcome.kind === 'gave_up') onFramesGaveUp(outcome.error);
        framesAbort = null;
      }
      releaseFirst();
    });
    return { first };
  };

  return {
    ...initialAppData,
    setObject: (card, params) => set({ card, params, overrides: {} }),
    clearObject: () => set({ card: null, params: null, overrides: {} }),
    // A change out of "Measured only" can bring the composite back: it does not play (one picture).
    setHonesty: (honesty) =>
      set((s) => {
        const lock = transportLocked(effectiveColour(s.sky.colour, honesty)) && s.sky.playing;
        return lock ? { honesty, sky: { ...s.sky, playing: false } } : { honesty };
      }),
    setOverride: (key, value) => {
      const s = get();
      if (value === undefined) {
        if (key in s.overrides) {
          const rest = { ...s.overrides };
          delete rest[key];
          set({ overrides: rest });
        }
        return true;
      }
      if (!s.card || !isValidOverride(s.card.type, key, value)) return false;
      set({ overrides: { ...s.overrides, [key]: value } });
      return true;
    },
    resetOverrides: () => set({ overrides: {} }),
    setRendererStatus: (rendererStatus) => set({ rendererStatus }),

    skySearch: async (query) => {
      searchAbort?.abort();
      framesAbort?.abort();
      framesAbort = null;
      spectrumAbort?.abort();
      compositeAbort?.abort();
      dropOverlayRequests(get().sky);
      const controller = new AbortController();
      searchAbort = controller;
      const requestId = get().sky.requestId + 1;
      set((s) => ({
        sky: {
          ...initialSkyState,
          fps: s.sky.fps,
          colour: s.sky.colour,
          fixtureSeen: s.sky.fixtureSeen,
          query,
          status: 'resolving',
          startedAt: Date.now(),
          requestId,
          announcement: `Looking up ${query.q}`,
        },
      }));

      let objectId: string;
      try {
        const resolved = await skyApi.resolve(query.q, controller.signal);
        if (!isCurrent(requestId)) return;
        objectId = resolved.data.id;
        const fixture = resolved.fixture !== null;
        setSky({
          resolved: resolved.data,
          fixture,
          fixtureSeen: get().sky.fixtureSeen || fixture,
          status: 'loading_frames',
          startedAt: Date.now(),
          progress: startProgress(query.frameId ?? null),
          announcement: `Found ${resolved.data.name ?? query.q}. Loading frames.`,
        });
      } catch (e) {
        if (!isCurrent(requestId) || isAborted(e)) return;
        // Not announced here: the error box is role="alert".
        setSky({ status: 'error', error: toSkyError(e), startedAt: null, announcement: '' });
        return;
      }
      // Settles with the first frames reply; any further parts load in the background.
      await runFrames(requestId, objectId).first;
    },

    skyRetry: async () => {
      const sky = get().sky;
      if (sky.status === 'ready' && sky.progress?.phase === 'failed') {
        get().skyContinueFrames();
        return;
      }
      if (sky.spectrum.status === 'error' && sky.status === 'ready') {
        await get().skyLoadSpectrum();
        return;
      }
      if (sky.query) await get().skySearch({ ...sky.query });
    },

    skyLoadSpectrum: async (options) => {
      const sky = get().sky;
      if (!sky.resolved || sky.spectrum.status === 'loading') return;
      if (framesFetching(sky)) {
        // A spectrum from a partial frame list would be wrong (and the request would download
        // cutouts alongside the frames requests); measure it once the list is complete.
        if (sky.spectrum.status !== 'waiting') {
          setSky({
            spectrum: { status: 'waiting', data: null, error: null },
            announcement: SPECTRUM_WAITING_ANNOUNCEMENT,
          });
        }
        return;
      }
      spectrumAbort?.abort();
      const controller = new AbortController();
      spectrumAbort = controller;
      const { requestId } = sky;
      const id = sky.resolved.id;
      setSky({
        spectrum: { status: 'loading', data: null, error: null },
        ...(options?.quiet ? {} : { announcement: `Loading the spectrum of ${displayName(sky)}.` }),
      });
      try {
        const res = await skyApi.spectrum(id, controller.signal);
        // Aborted: a newer request, or Continue put it back to waiting for the full list.
        if (!isCurrent(requestId) || controller.signal.aborted) return;
        const now = get().sky;
        const outcome = summarizeSpectrum(res.data.spectrum, res.data.missing, now.frames?.frames);
        // Same display name as the panel heading and the loading announcement.
        const name = displayName(now);
        setSky({
          fixture: get().sky.fixture || res.fixture !== null,
          fixtureSeen: get().sky.fixtureSeen || res.fixture !== null,
          spectrum: { status: 'ready', data: res.data, error: null },
          announcement: spectrumAnnouncement(outcome, name),
        });
      } catch (e) {
        if (!isCurrent(requestId) || isAborted(e)) return;
        setSky({
          spectrum: { status: 'error', data: null, error: toSkyError(e) },
          announcement: '',
        });
      }
    },

    skySeek: (index) => {
      const { frames, progress } = get().sky;
      if (!frames || frames.frames.length === 0) return;
      const i = clampIndex(index, frames.frames.length);
      setSky({
        index: i,
        playing: false,
        announcement: describeFrame(frames, i),
        // The user moved: a frame from a shared link that has not arrived yet no longer wins.
        ...(progress?.pendingFrameId ? { progress: { ...progress, pendingFrameId: null } } : {}),
      });
    },

    skySeekFrame: (frameId) => {
      const { frames } = get().sky;
      const i = frames?.frames.findIndex((f) => f.frame_id === frameId) ?? -1;
      if (i >= 0) get().skySeek(i);
    },

    skyStep: (delta) => get().skySeek(get().sky.index + delta),

    skyPlay: () => {
      const { frames, colour } = get().sky;
      if (!frames || frames.frames.length < 2) return;
      // The composite is one picture: nothing to play while it shows.
      if (transportLocked(effectiveColour(colour, get().honesty))) return;
      const { progress } = get().sky;
      setSky({
        playing: true,
        announcement: 'Playing.',
        ...(progress?.pendingFrameId ? { progress: { ...progress, pendingFrameId: null } } : {}),
      });
    },

    skyPause: () => {
      const { frames, index, playing } = get().sky;
      if (!playing) return;
      setSky({
        playing: false,
        announcement: frames ? `Paused. ${describeFrame(frames, index)}` : 'Paused.',
      });
    },

    skyTogglePlay: () => (get().sky.playing ? get().skyPause() : get().skyPlay()),

    skyAdvance: (settled) => {
      const { frames, index, playing } = get().sky;
      if (!playing || !frames || frames.frames.length === 0) return;
      const next = nextIndex(index, frames.frames.length);
      if (!settled(next)) return; // hold on this frame until the next cutout has loaded
      setSky({ index: next });
    },

    skySetFps: (fps) => setSky({ fps }),

    skySetColour: (choice, quiet = false) => {
      const sky = get().sky;
      if (sky.colour.on === choice.on && sky.colour.view === choice.view) return;
      const honesty = get().honesty;
      const shown = effectiveColour(choice, honesty);
      const hidden = colourHidden(choice, honesty);
      const changed = requestedColour(choice) !== requestedColour(sky.colour);
      setSky({
        colour: { ...choice },
        playing: transportLocked(shown) ? false : sky.playing,
        ...(quiet || !changed ? {} : { announcement: colourAnnouncement(shown, hidden) }),
      });
    },

    skyLoadComposite: async () => {
      const sky = get().sky;
      if (!sky.resolved || sky.composite.status === 'loading') return;
      // Built once the frame list is complete (the colour view says so meanwhile).
      if (framesFetching(sky)) return;
      const id = sky.resolved.id;
      const { requestId } = sky;
      const cached = compositeCache.get(id);
      if (cached) {
        setSky({
          composite: { status: 'ready', startedAt: null, data: cached.data, error: null },
          fixture: sky.fixture || cached.fixture !== null,
          fixtureSeen: sky.fixtureSeen || cached.fixture !== null,
        });
        return;
      }
      compositeAbort?.abort();
      const controller = new AbortController();
      compositeAbort = controller;
      setSky({
        composite: { status: 'loading', startedAt: Date.now(), data: null, error: null },
        announcement: `Building the SPHEREx colour composite of ${displayName(sky)}.`,
      });
      try {
        const res = await skyApi.composite(id, controller.signal);
        if (!isCurrent(requestId) || controller.signal.aborted) return;
        // A composite from a partial list (after Stop) is not kept: the full list may pick better.
        if (!hasDeferred(res.data.missing)) compositeCache.set(id, res);
        const now = get().sky;
        setSky({
          composite: { status: 'ready', startedAt: null, data: res.data, error: null },
          fixture: now.fixture || res.fixture !== null,
          fixtureSeen: now.fixtureSeen || res.fixture !== null,
          announcement: compositeAnnouncement(res.data),
        });
      } catch (e) {
        if (!isCurrent(requestId) || isAborted(e)) return;
        // Not announced here: the error box is role="alert".
        setSky({
          composite: { status: 'error', startedAt: null, data: null, error: toSkyError(e) },
          announcement: '',
        });
      }
    },

    skySetViewMode: (viewMode) => {
      if (get().sky.viewMode === viewMode) return;
      setSky({
        viewMode,
        announcement:
          viewMode === 'trails'
            ? 'Rainbow Trails view: one dot per frame, coloured by wavelength.'
            : 'Frames view.',
      });
    },

    skyStopFrames: () => {
      const s = get().sky;
      if (s.status !== 'ready' || !s.progress || s.progress.phase !== 'fetching') return;
      framesAbort?.abort();
      framesAbort = null;
      setSky({
        progress: { ...s.progress, phase: 'stopped', retry: null },
        announcement: s.frames ? framesStoppedAnnouncement(framesCounts(s.frames)) : 'Stopped.',
      });
    },

    skyContinueFrames: () => {
      const s = get().sky;
      if (s.status !== 'ready' || !s.resolved || !s.progress || s.progress.phase === 'fetching') {
        return;
      }
      // A spectrum or composite still being made from the partial list (after Stop) would run
      // alongside the frames requests and land with a partial result after the list completes:
      // drop it and wait for the complete list, like a request made while fetching.
      const spectrumLoading = s.spectrum.status === 'loading';
      const compositeLoading = s.composite.status === 'loading';
      const overlaysLoading = s.overlays.status === 'loading';
      if (spectrumLoading) spectrumAbort?.abort();
      if (compositeLoading) compositeAbort?.abort();
      if (overlaysLoading) overlaysAbort?.abort();
      setSky({
        progress: { ...s.progress, phase: 'fetching', retry: null, error: null },
        ...(spectrumLoading ? { spectrum: { status: 'waiting', data: null, error: null } } : {}),
        ...(compositeLoading
          ? { composite: { status: 'idle', startedAt: null, data: null, error: null } }
          : {}),
        // The last overlays reply (if any) stays drawn; the new one comes with the full list.
        ...(overlaysLoading ? { overlays: { ...s.overlays, status: 'waiting' } } : {}),
        announcement: 'Fetching the remaining frames.',
      });
      runFrames(s.requestId, s.resolved.id);
    },

    skyReset: () => {
      searchAbort?.abort();
      framesAbort?.abort();
      framesAbort = null;
      spectrumAbort?.abort();
      compositeAbort?.abort();
      dropOverlayRequests(get().sky);
      searchAbort = null;
      spectrumAbort = null;
      compositeAbort = null;
      set((s) => {
        if (s.sky.status === 'idle' && s.sky.linkProblems.length === 0) return {};
        return {
          sky: {
            ...initialSkyState,
            fps: s.sky.fps,
            colour: s.sky.colour,
            fixtureSeen: s.sky.fixtureSeen,
            // Any reply still in flight belongs to an older request id and is dropped.
            requestId: s.sky.requestId + 1,
            announcement: s.sky.status === 'idle' ? '' : 'Search cleared.',
          },
        };
      });
    },

    skyMarkFixtureSeen: () => {
      if (!get().sky.fixtureSeen) setSky({ fixtureSeen: true });
    },

    skySetLinkProblems: (problems) =>
      setSky({
        linkProblems: problems,
        announcement: problems.length > 0 ? problems.join(' ') : get().sky.announcement,
      }),

    skyToggleOverlay: (layer) => {
      const { overlays } = get().sky;
      const on = !overlays.toggles[layer];
      setSky({
        overlays: { ...overlays, toggles: { ...overlays.toggles, [layer]: on } },
        announcement: `${LAYER_NAMES[layer]} ${on ? 'shown' : 'hidden'}.`,
      });
      // A catalogue the backend was still fetching (`overlay:<layer>:pending`) is asked for again
      // when it is switched back on; by then it is usually in the backend cache.
      const pending =
        overlays.status === 'ready' &&
        (overlays.data?.missing.includes(`overlay:${layer}:pending`) ?? false);
      if (on && (overlays.status === 'idle' || overlays.status === 'error' || pending)) {
        void get().skyLoadOverlays();
      }
    },

    skyLoadOverlays: async (options) => {
      const sky = get().sky;
      if (!sky.resolved || sky.overlays.status === 'loading') return;
      if (framesFetching(sky)) {
        // Asked for once the list is complete (afterFramesComplete), not on every frames reply.
        if (sky.overlays.status !== 'waiting') {
          setSky({ overlays: { ...sky.overlays, status: 'waiting', error: null } });
        }
        return;
      }
      overlaysAbort?.abort();
      const controller = new AbortController();
      overlaysAbort = controller;
      const { requestId } = sky;
      // The previous reply stays drawn until the new one arrives, so retrying one catalogue does
      // not hide the other layers while the backend waits (up to 75 s).
      setSky({ overlays: { ...sky.overlays, status: 'loading', error: null } });
      try {
        const res = await skyApi.getOverlays(sky.resolved.id, controller.signal);
        // Aborted: a newer search, or Continue put it back to waiting for the full list.
        if (!isCurrent(requestId) || controller.signal.aborted) return;
        const now = get().sky;
        setSky({
          fixture: now.fixture || res.fixture !== null,
          fixtureSeen: now.fixtureSeen || res.fixture !== null,
          overlays: { ...now.overlays, status: 'ready', data: res.data, error: null },
          ...(options?.quiet ? {} : { announcement: 'Overlays loaded.' }),
        });
      } catch (e) {
        if (!isCurrent(requestId) || isAborted(e)) return;
        // Not announced here: the overlay error box is role="alert".
        const now = get().sky;
        setSky({
          // A failed reload keeps the last good reply drawn; the error box offers a retry.
          overlays: { ...now.overlays, status: 'error', error: toSkyError(e) },
          announcement: '',
        });
      }
    },

    skyCombineOpen: (open) => {
      const { combine, frames, index } = get().sky;
      if (!open) {
        if (combine.open) setSky({ combine: { ...combine, open } });
        return;
      }
      const list = frames?.frames ?? [];
      // Defaults: frame A = the current frame, frame B = the previous one. ASSUMPTION: on the
      // first frame there is no previous one, so B is the next frame instead.
      const a = combine.a ?? list[index]?.frame_id ?? null;
      const b = combine.b ?? list[index > 0 ? index - 1 : index + 1]?.frame_id ?? null;
      setSky({ combine: { ...combine, open, a, b } });
    },

    skyCombineSet: (patch) => {
      const { combine } = get().sky;
      combineAbort?.abort();
      combineAbort = null;
      revokeObjectUrl(combine.result?.objectUrl);
      setSky({ combine: { ...combine, ...patch, status: 'idle', result: null, error: null } });
    },

    skyCombineShow: async () => {
      const sky = get().sky;
      const { a, b, op } = sky.combine;
      if (!sky.resolved || !a || !b || a === b) return;
      combineAbort?.abort();
      const controller = new AbortController();
      combineAbort = controller;
      revokeObjectUrl(sky.combine.result?.objectUrl);
      const { requestId } = sky;
      setSky({
        combine: { ...sky.combine, status: 'loading', result: null, error: null },
        announcement: 'Combining the frames.',
      });
      try {
        const res = await skyApi.getCombine(sky.resolved.id, op, a, b, controller.signal);
        const now = get().sky;
        const c = now.combine;
        // A reply for an older search or an older choice of frames is dropped and freed.
        if (!isCurrent(requestId) || c.a !== a || c.b !== b || c.op !== op) {
          revokeObjectUrl(res.data.objectUrl);
          return;
        }
        setSky({
          fixture: now.fixture || res.fixture !== null,
          fixtureSeen: now.fixtureSeen || res.fixture !== null,
          combine: { ...c, status: 'ready', result: res.data, error: null },
          announcement: 'Combined image ready.',
        });
      } catch (e) {
        if (!isCurrent(requestId) || isAborted(e)) return;
        const now = get().sky;
        setSky({
          combine: { ...now.combine, status: 'error', result: null, error: toSkyError(e) },
          announcement: '',
        });
      }
    },

    skyCombineClear: () => {
      const { combine } = get().sky;
      combineAbort?.abort();
      combineAbort = null;
      revokeObjectUrl(combine.result?.objectUrl);
      if (combine.status === 'idle' && combine.result === null) return;
      setSky({ combine: { ...combine, status: 'idle', result: null, error: null } });
    },
  };
});
