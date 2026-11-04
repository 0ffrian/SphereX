// A10 state: one Zustand store holding the current ObjectCard, RenderParams, honesty state and
// the client-side `overrides` map (D-02: user edits live apart from the card so Reset restores
// the data values).
import { create } from 'zustand';
import type { ObjectCard, RenderParams } from '@/contract';
import type { RendererBackend } from '@/viewer/ViewerApp';

/** R5.3 honesty toggle: Measured only, + Derived, + Artistic. */
export type HonestyState = 'measured' | 'derived' | 'artistic';

/**
 * D-02 client-side overrides: field name → user value.
 * ASSUMPTION: value types are not specified (sliders may be numbers, colours or flags) and the
 * allowed keys on baked bodies are open (Q-03), so values are `unknown` until those are settled.
 */
export type Overrides = Readonly<Record<string, unknown>>;

/** What the status line reports about the 3D renderer. */
export type RendererStatus = 'starting' | RendererBackend | 'unavailable';

export interface AppData {
  card: ObjectCard | null;
  params: RenderParams | null;
  /**
   * Q-08: the honesty toggle's starting state is not decided, so there is no default.
   * `null` means "not chosen yet"; code must not treat it as any of the three states.
   */
  honesty: HonestyState | null;
  overrides: Overrides;
  rendererStatus: RendererStatus;
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
}

export type AppStore = AppData & AppActions;

export const initialAppData: AppData = {
  card: null,
  params: null,
  honesty: null,
  overrides: {},
  rendererStatus: 'starting',
};

export const useAppStore = create<AppStore>()((set) => ({
  ...initialAppData,
  setObject: (card, params) => set({ card, params, overrides: {} }),
  clearObject: () => set({ card: null, params: null, overrides: {} }),
  setHonesty: (honesty) => set({ honesty }),
  setOverride: (key, value) => set((s) => ({ overrides: { ...s.overrides, [key]: value } })),
  resetOverrides: () => set({ overrides: {} }),
  setRendererStatus: (rendererStatus) => set({ rendererStatus }),
}));
