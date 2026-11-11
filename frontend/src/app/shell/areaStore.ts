// State of the Discovery tool (the mock-up's Area search): the square drawn on the sky and the step
// of its card. The square is kept in sky coordinates (two opposite corners), so it stays on the
// same patch of sky while the view moves. No results exist: the area search backend is not built
// (Q-205 pending), so picking an option only says so.
import { create } from 'zustand';

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
export type AreaChoice = 'known' | 'discovery';

export interface AreaState {
  /** drawing: waiting for a drag; set: a square exists and its options show. */
  stage: 'drawing' | 'set';
  box: AreaBox | null;
  /** The last square, kept for "Keep the last square" after Draw again or reopening. */
  last: AreaBox | null;
  drag: AreaDrag | null;
  choice: AreaChoice | null;
  setDrag(drag: AreaDrag | null): void;
  setBox(box: AreaBox): void;
  choose(choice: AreaChoice | null): void;
  redraw(): void;
  /** Leaving the tool: back to the start, keeping the last square. */
  reset(): void;
}

export const useAreaStore = create<AreaState>()((set) => ({
  stage: 'drawing',
  box: null,
  last: null,
  drag: null,
  choice: null,
  setDrag: (drag) => set({ drag }),
  setBox: (box) => set({ stage: 'set', box, last: box, drag: null, choice: null }),
  choose: (choice) => set({ choice }),
  redraw: () => set({ stage: 'drawing', box: null, drag: null, choice: null }),
  reset: () => set((s) => ({ stage: 'drawing', box: null, drag: null, choice: null, last: s.last })),
}));

/** "3.2°" or "42′" (arcminutes under one degree). */
export function formatAreaSize(widthDeg: number): string {
  if (widthDeg >= 1) return `${widthDeg.toFixed(widthDeg >= 10 ? 0 : 1)}°`;
  const arcmin = widthDeg * 60;
  if (arcmin >= 1) return `${arcmin.toFixed(arcmin >= 10 ? 0 : 1)}′`;
  return `${(arcmin * 60).toFixed(0)}″`;
}
