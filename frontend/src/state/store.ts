// A10 state: one Zustand store holding the current ObjectCard, RenderParams, honesty state and
// the client-side `overrides` map (D-02: user edits live apart from the card so Reset restores
// the data values), plus the flipbook session (`sky`: search, frames, playback, spectrum; A1.1,
// D-16).
import { create } from 'zustand';
import type { ObjectCard, RenderParams } from '@/contract';
import type { RendererBackend } from '@/viewer/ViewerApp';
import { createApiClient, type ApiClient } from '@/app/api/client';
import { isApiError, type ApiErrorKind } from '@/app/api/errors';
import type { FramesResponse, ResolveResponse, SpectrumResponse } from '@/app/api/types';
import { clampIndex, DEFAULT_FPS, nextIndex, type Fps } from '@/app/flipbook/playback';
import { formatUtc, formatWavelength } from '@/app/format';

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
  requestId: 0,
  announcement: '',
  linkProblems: [],
};

let skyApi: ApiClient = createApiClient();
let searchAbort: AbortController | null = null;
let spectrumAbort: AbortController | null = null;

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

function objectLabel(sky: SkyState): string {
  return sky.resolved?.name ?? sky.query?.q ?? 'this object';
}

// ---- Store -------------------------------------------------------------------------------------

export interface AppData {
  card: ObjectCard | null;
  params: RenderParams | null;
  /**
   * D-21 sets the starting state to + Estimated; wiring that default is a follow-up (M2), so
   * this is still `null` here. Code must not treat `null` as any of the three states.
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
}

export type AppStore = AppData & AppActions;

export const initialAppData: AppData = {
  card: null,
  params: null,
  honesty: null,
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
        announcement: `Loading the spectrum of ${objectLabel(sky)}.`,
      });
      try {
        const res = await skyApi.spectrum(id, controller.signal);
        if (!isCurrent(requestId)) return;
        const points = res.data.spectrum;
        const flagged = points.filter((p) => p.flagged).length;
        setSky({
          fixture: get().sky.fixture || res.fixture !== null,
          fixtureSeen: get().sky.fixtureSeen || res.fixture !== null,
          spectrum: { status: 'ready', data: res.data, error: null },
          announcement:
            points.length === 0
              ? 'No spectrum points for this object.'
              : `Spectrum loaded: ${points.length} points, ${flagged} flagged.`,
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
  };
});
