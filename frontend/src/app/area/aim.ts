// Single live areas (issue #144, Q-462): the size limit of one area and how a box's sides read.
// The aim and draw steps of #144 are replaced by selecting a region (issue #157, Q-472;
// `scanGrid.ts`, `AimOverlay.tsx`); a region of one square is a single area of at most this size.

/** Largest side of a live area (Q-462). */
export const MAX_SIDE_DEG = 2;

/** "0.98° × 0.61°": a box's sides, two decimals, as the mock-up labels it. */
export function formatBoxDeg(w: number, h: number): string {
  return `${w.toFixed(2)}° × ${h.toFixed(2)}°`;
}
