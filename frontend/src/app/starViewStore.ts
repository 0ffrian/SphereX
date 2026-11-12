// The star views share one mode state (Light, field lines) and the zoom bar acts on the left close-up.
// The Details controls write the mode here; every engine instance (the globe, the flare close-up, the
// surface close-up) reads it, so the three always agree. The close-up engine registers itself for the zoom bar.
import { create } from 'zustand';
import type { StarEngine, StarLight, StarScaleView } from '@/engine/stars/StarEngine';

interface State {
  light: StarLight;
  lines: boolean;
  /** The View pill (whole star larger detail / true scale / close-up): the globe and the close-up read it. */
  scale: StarScaleView;
  /** The engine drawing the left close-up , for the zoom bar and the wheel. */
  closeUp: StarEngine | null;
  setLight(l: StarLight): void;
  setLines(on: boolean): void;
  setScale(s: StarScaleView): void;
  setCloseUp(e: StarEngine | null): void;
}
export const useStarView = create<State>((set) => ({
  light: 0,
  lines: true,
  scale: 'big',
  closeUp: null,
  setLight: (light) => set({ light }),
  setLines: (lines) => set({ lines }),
  setScale: (scale) => set({ scale }),
  setCloseUp: (closeUp) => set({ closeUp }),
}));
