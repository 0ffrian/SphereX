// Aim and draw (issue #144, Q-462; mock-up states 1 and 2): pure geometry, so it is tested without
// a sky view.
//   Aim: the pointer is a rectangle with the screen's shape, drawn to scale: exactly what fills the
//        screen after the click, a view AIM_HEIGHT_DEG tall (north up: the sky camera has no roll).
//   Draw: in that view the box follows the drag and stops at MAX_SIDE_DEG on each side.
import type { AreaDrag } from '@/app/shell/areaStore';

/** Height of the view after the click: a 2° box fits top to bottom with a margin. */
export const AIM_HEIGHT_DEG = 2.2;
/** Largest side of a live area (Q-462). */
export const MAX_SIDE_DEG = 2;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/**
 * The aim rectangle in CSS px at the current field of view (vertical, degrees), for a view of
 * width × height px: the next view's height, by the gnomonic scale, and the screen's aspect.
 */
export function aimSizePx(fovDeg: number, width: number, height: number): { w: number; h: number } {
  const h = (height * Math.tan((AIM_HEIGHT_DEG / 2) * D2R)) / Math.tan((fovDeg / 2) * D2R);
  return { w: h * (width / Math.max(1, height)), h };
}

/** The next view's angular width and height ("3.5° × 2.2°"). */
export function aimViewDeg(width: number, height: number): { w: number; h: number } {
  const aspect = width / Math.max(1, height);
  return { w: 2 * Math.atan(aspect * Math.tan((AIM_HEIGHT_DEG / 2) * D2R)) * R2D, h: AIM_HEIGHT_DEG };
}

/** Measures a pixel rectangle on the sky: its angular width and height, or null off the sky. */
export type MeasureDrag = (d: AreaDrag) => { w: number; h: number } | null;

/** The largest scale in [0, 1] whose measured side stays at or under `max` (sides grow with the scale). */
function largestScale(fits: (s: number) => boolean): number {
  if (fits(1)) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * The drag from its anchor (x0, y0) to the pointer, each side stopped at `max` degrees. `held` is
 * true when a side was stopped, for the "2° max" readout.
 */
export function clampDrag(d: AreaDrag, measure: MeasureDrag, max = MAX_SIDE_DEG): AreaDrag & { held: boolean } {
  const dx = d.x1 - d.x0;
  const dy = d.y1 - d.y0;
  const at = (sx: number, sy: number): AreaDrag => ({ x0: d.x0, y0: d.y0, x1: d.x0 + dx * sx, y1: d.y0 + dy * sy });
  const m = measure(d);
  if (!m || (m.w <= max && m.h <= max)) return { ...d, held: false };
  const sx = m.w > max ? largestScale((s) => (measure(at(s, 1))?.w ?? Infinity) <= max) : 1;
  const sy = m.h > max ? largestScale((s) => (measure(at(sx, s))?.h ?? Infinity) <= max) : 1;
  return { ...at(sx, sy), held: true };
}

/** A centred rectangle of half sides (hw, hh) px, each side stopped at `max` degrees (the Enter key). */
export function clampCentred(
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  measure: MeasureDrag,
  max = MAX_SIDE_DEG,
): AreaDrag {
  const at = (sx: number, sy: number): AreaDrag => ({ x0: cx - hw * sx, y0: cy - hh * sy, x1: cx + hw * sx, y1: cy + hh * sy });
  const sx = largestScale((s) => (measure(at(s, 1))?.w ?? Infinity) <= max);
  const sy = largestScale((s) => (measure(at(sx, s))?.h ?? Infinity) <= max);
  return at(sx, sy);
}

/** "0.98° × 0.61°": the drawn box's sides, two decimals, as the mock-up labels it. */
export function formatBoxDeg(w: number, h: number): string {
  return `${w.toFixed(2)}° × ${h.toFixed(2)}°`;
}

/** The size readout while drawing: "1.20° × 0.80°", or "2.00° × 1.06° · 2° max" when held. */
export function drawReadout(w: number, h: number, held: boolean): string {
  return held ? `${formatBoxDeg(w, h)} · ${MAX_SIDE_DEG}° max` : formatBoxDeg(w, h);
}

/** The aim rectangle's label: "Next view · 3.5° × 2.2°". */
export function aimLabel(width: number, height: number): string {
  const v = aimViewDeg(width, height);
  return `Next view · ${v.w.toFixed(1)}° × ${v.h.toFixed(1)}°`;
}
