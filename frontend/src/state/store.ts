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
import type {
  CombineOp,
  FramesResponse,
  OverlaysResponse,
  ResolveResponse,
  SpectrumResponse,
} from '@/app/api/types';
import { clampIndex, DEFAULT_FPS, nextIndex, type Fps } from '@/app/flipbook/playback';
import { formatCoords, formatUtc, formatWavelength } from '@/app/format';
import { spectrumAnnouncement } from '@/app/messages';
import { summarizeSpectrum } from '@/app/refusals';

/**
 * Honesty toggle (D-21, R5.3): Measured only, + Estimated, + Artistic. The value names the most
 * permissive tag group shown: `measured`, `derived` (+ Estimated: derived, model_dependent,
 * inferred_from_analog) or `artistic`.
 */
export type HonestyState = 'measured' | 'derived' | 'artistic';

/**
 * D-02 client-side overrides: field name → user value.
 * ASSUMPTION: value types are not specified (sliders may be numbers, colours or flags) and the
 * allowed keys on baked bodies are open (Q-03), so values are `unknown` until those are settled.
 */
export type Overrides = Readonly<Record<string, unknown>>;

/** What the status line reports about the 3D renderer. */
export type RendererStatus = 'starting' | RendererBackend | 'unavailable';

// ---- Flipbook session (sky slice) ------------------------------------------------------------

export type SkyStatus = 'idle' | 'resolving' | 'loading_frames' | 'ready' | 'error';
export type SkyViewMode = 'frames' | 'trails';

export interface SkyQuery {
  /** Sent to `GET /v1/resolve?q=` as is: a name, or "ra,dec" in degrees. */
  q: string;
  kind: 'name' | 'coords';
  /** 'hash' when the search came from a shared link; the URL is then replaced, not pushed. */
  origin: 'input' | 'hash';
  /** Frame to show once frames load (from a shared link). */
  frameId?: string;
}

export interface SkyError {
  kind: ApiErrorKind;
  status: number | null;
  code: string | null;
  detail: string | null;
}

export interface SpectrumState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: SpectrumResponse | null;
  error: SkyError | null;
}

/** Overlay layers the flipbook can draw over the cutout (issue #12). */
export type OverlayLayer = 'gaia' | 'wise' | 'flags' | 'fov';
export type OverlayToggles = Readonly<Record<OverlayLayer, boolean>>;

export interface OverlaysState {
  /** Loaded lazily: the first time any layer is switched on, not on every search. */
  status: 'idle' | 'loading' | 'ready' | 'error';
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
  /** True when the current object's data came from the dev fixture server: it is synthetic. */
  fixture: boolean;
  /** True once any reply this session was a fixture; keeps the page banner up between searches. */
  fixtureSeen: boolean;
  index: number;
  playing: boolean;
  fps: Fps;
  viewMode: SkyViewMode;
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
  fixture: false,
  fixtureSeen: false,
  index: 0,
  playing: false,
  fps: DEFAULT_FPS,
  viewMode: 'frames',
  spectrum: { status: 'idle', data: null, error: null },
  overlays: initialOverlaysState,
  combine: initialCombineState,
  requestId: 0,
  announcement: '',
  linkProblems: [],
};

let skyApi: ApiClient = createApiClient();
let searchAbort: AbortController | null = null;
let spectrumAbort: AbortController | null = null;
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

/** Swap the API client (tests, or a different base URL). */
export function setSkyApi(client: ApiClient): void {
  skyApi = client;
}

function toSkyError(e: unknown): SkyError {
  if (isApiError(e)) return { kind: e.kind, status: e.status, code: e.code, detail: e.detail };
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
  setOverride(key: string, value: unknown): void;
  /** D-02 Reset: drop every user edit so the card's data values show again. */
  resetOverrides(): void;
  setRendererStatus(status: RendererStatus): void;

  /** Resolve, then load frames (UML 08). Aborts any earlier search and spectrum request. */
  skySearch(query: SkyQuery): Promise<void>;
  /** Repeat the failed step: the spectrum if that failed, else the whole search. */
  skyRetry(): Promise<void>;
  /** Load the spectrum of the resolved object (UML 09). */
  skyLoadSpectrum(): Promise<void>;
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
  /** Back to idle (the URL hash was cleared): aborts requests, keeps speed and the fixture flag. */
  skyReset(): void;
  /** Show and announce the unusable parts of a shared link. */
  skySetLinkProblems(problems: string[]): void;

  /** Switch one overlay layer; the first switch-on loads the overlays (again after an error). */
  skyToggleOverlay(layer: OverlayLayer): void;
  /** `GET /v1/objects/{id}/overlays` for the resolved object. Optional: never blocks the flipbook. */
  skyLoadOverlays(): Promise<void>;
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

  return {
    ...initialAppData,
    setObject: (card, params) => set({ card, params, overrides: {} }),
    clearObject: () => set({ card: null, params: null, overrides: {} }),
    setHonesty: (honesty) => set({ honesty }),
    setOverride: (key, value) => set((s) => ({ overrides: { ...s.overrides, [key]: value } })),
    resetOverrides: () => set({ overrides: {} }),
    setRendererStatus: (rendererStatus) => set({ rendererStatus }),

    skySearch: async (query) => {
      searchAbort?.abort();
      spectrumAbort?.abort();
      dropOverlayRequests(get().sky);
      const controller = new AbortController();
      searchAbort = controller;
      const requestId = get().sky.requestId + 1;
      set((s) => ({
        sky: {
          ...initialSkyState,
          fps: s.sky.fps,
          fixtureSeen: s.sky.fixtureSeen,
          query,
          status: 'resolving',
          startedAt: Date.now(),
          requestId,
          announcement: `Looking up ${query.q}`,
        },
      }));

      try {
        const resolved = await skyApi.resolve(query.q, controller.signal);
        if (!isCurrent(requestId)) return;
        const fixture = resolved.fixture !== null;
        setSky({
          resolved: resolved.data,
          fixture,
          fixtureSeen: get().sky.fixtureSeen || fixture,
          status: 'loading_frames',
          startedAt: Date.now(),
          announcement: `Found ${resolved.data.name ?? query.q}. Loading frames.`,
        });

        const frames = await skyApi.frames(resolved.data.id, controller.signal);
        if (!isCurrent(requestId)) return;
        const n = frames.data.frames.length;
        const wanted = query.frameId
          ? frames.data.frames.findIndex((f) => f.frame_id === query.frameId)
          : -1;
        setSky({
          frames: frames.data,
          fixture: fixture || frames.fixture !== null,
          fixtureSeen: get().sky.fixtureSeen || frames.fixture !== null,
          status: 'ready',
          startedAt: null,
          index: wanted >= 0 ? wanted : 0,
          announcement:
            n === 0
              ? `No frames to show for ${resolved.data.name ?? query.q}.`
              : `${n} frames loaded for ${resolved.data.name ?? query.q}.`,
        });
      } catch (e) {
        if (!isCurrent(requestId) || isAborted(e)) return;
        // Not announced here: the error box is role="alert".
        setSky({ status: 'error', error: toSkyError(e), startedAt: null, announcement: '' });
      }
    },

    skyRetry: async () => {
      const sky = get().sky;
      if (sky.spectrum.status === 'error' && sky.status === 'ready') {
        await get().skyLoadSpectrum();
        return;
      }
      if (sky.query) await get().skySearch({ ...sky.query });
    },

    skyLoadSpectrum: async () => {
      const sky = get().sky;
      if (!sky.resolved || sky.spectrum.status === 'loading') return;
      spectrumAbort?.abort();
      const controller = new AbortController();
      spectrumAbort = controller;
      const { requestId } = sky;
      const id = sky.resolved.id;
      setSky({
        spectrum: { status: 'loading', data: null, error: null },
        announcement: `Loading the spectrum of ${displayName(sky)}.`,
      });
      try {
        const res = await skyApi.spectrum(id, controller.signal);
        if (!isCurrent(requestId)) return;
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
      const { frames } = get().sky;
      if (!frames || frames.frames.length === 0) return;
      const i = clampIndex(index, frames.frames.length);
      setSky({ index: i, playing: false, announcement: describeFrame(frames, i) });
    },

    skySeekFrame: (frameId) => {
      const { frames } = get().sky;
      const i = frames?.frames.findIndex((f) => f.frame_id === frameId) ?? -1;
      if (i >= 0) get().skySeek(i);
    },

    skyStep: (delta) => get().skySeek(get().sky.index + delta),

    skyPlay: () => {
      const { frames } = get().sky;
      if (!frames || frames.frames.length < 2) return;
      setSky({ playing: true, announcement: 'Playing.' });
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

    skyReset: () => {
      searchAbort?.abort();
      spectrumAbort?.abort();
      dropOverlayRequests(get().sky);
      searchAbort = null;
      spectrumAbort = null;
      set((s) => {
        if (s.sky.status === 'idle' && s.sky.linkProblems.length === 0) return {};
        return {
          sky: {
            ...initialSkyState,
            fps: s.sky.fps,
            fixtureSeen: s.sky.fixtureSeen,
            // Any reply still in flight belongs to an older request id and is dropped.
            requestId: s.sky.requestId + 1,
            announcement: s.sky.status === 'idle' ? '' : 'Search cleared.',
          },
        };
      });
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

    skyLoadOverlays: async () => {
      const sky = get().sky;
      if (!sky.resolved || sky.overlays.status === 'loading') return;
      overlaysAbort?.abort();
      const controller = new AbortController();
      overlaysAbort = controller;
      const { requestId } = sky;
      // The previous reply stays drawn until the new one arrives, so retrying one catalogue does
      // not hide the other layers while the backend waits (up to 75 s).
      setSky({ overlays: { ...sky.overlays, status: 'loading', error: null } });
      try {
        const res = await skyApi.getOverlays(sky.resolved.id, controller.signal);
        if (!isCurrent(requestId)) return;
        const now = get().sky;
        setSky({
          fixture: now.fixture || res.fixture !== null,
          fixtureSeen: now.fixtureSeen || res.fixture !== null,
          overlays: { ...now.overlays, status: 'ready', data: res.data, error: null },
          announcement: 'Overlays loaded.',
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
