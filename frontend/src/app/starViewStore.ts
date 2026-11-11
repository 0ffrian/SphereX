// The star views share one mode state (Light, field lines) and the zoom bar acts on the left close-up.
// The Details controls write the mode here; every engine instance (the globe, the flare close-up, the
// surface close-up) reads it, so the three always agree. The close-up engine registers itself for the zoom bar.
import { create } from 'zustand';
import type { StarEngine, StarLight } from '@/engine/stars/StarEngine';

interface State {
  light: StarLight;
  lines: boolean;
  /** The engine drawing the left close-up (flare or surface), for the zoom bar and the wheel. */
  closeUp: StarEngine | null;
  setLight(l: StarLight): void;
  setLines(on: boolean): void;
  setCloseUp(e: StarEngine | null): void;
}
export const useStarView = create<State>((set) => ({
  light: 0,
  lines: true,
  closeUp: null,
  setLight: (light) => set({ light }),
  setLines: (lines) => set({ lines }),
  setCloseUp: (closeUp) => set({ closeUp }),
}));
