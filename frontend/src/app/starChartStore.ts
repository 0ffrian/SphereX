// The engine's flare light curve, published by the flare close-up (StarFlareStage) and drawn in the
// Details pane (StarEngineDetails). The close-up no longer draws the chart over the picture.
import { create } from 'zustand';

export interface StarChartState {
  soft: number[];
  hard: number[];
  /** 0..1 along the 60 minutes. */
  t: number;
  /** The flare clock is running (the engine advances `t` itself). */
  playing: boolean;
  setTime(t: number): void;
  setPlaying(playing: boolean): void;
}
interface Store {
  chart: StarChartState | null;
  set(c: StarChartState | null): void;
}
export const useStarChart = create<Store>((set) => ({
  chart: null,
  set: (chart) => set({ chart }),
}));
