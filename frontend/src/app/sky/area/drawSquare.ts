// Drawing the search square (A18.1; Q-406 (2), (4)). Pure: a drag in screen pixels becomes a
// north-up square on the sky (geometry.ts), which then follows pans and zooms. The size limits are
// UI rules (Q-406 (2)), not physical values.
import { screenToRaDec, separationDeg, type SkyCamera } from '@/viewer/sky/skyMath';
import { fromPlane, type SkySquare } from './geometry';

/** A18.1: a square under this many CSS px on a side is refused ("Drag a bigger square"). */
export const MIN_SQUARE_PX = 30;
/** Q-406 (2): a square over this many degrees on a side is refused. Prepared areas are about 1°. */
export const MAX_SQUARE_DEG = 10;
/** "Use a square in the middle": at most this side (A18.9), else MIDDLE_FRACTION of the view. */
export const MIDDLE_SQUARE_DEG = 1;
export const MIDDLE_FRACTION = 0.4;
/** Square keys (A18.9): arrows move by this fraction of the side; Shift + arrows resize by it. */
export const KEY_STEP_FRACTION = 0.1;

export type SquareRefusal = 'square:too_small' | 'square:too_big';

export interface ScreenSquare {
  /** Top-left corner and side, CSS px, pane-local. */
  x: number;
  y: number;
  side: number;
}

/** A screen square from a drag: side = max(|dx|, |dy|), anchored at the start, towards the end. */
export function squareFromDrag(
  start: { x: number; y: number },
  end: { x: number; y: number },
): ScreenSquare {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: dx < 0 ? start.x - side : start.x,
    y: dy < 0 ? start.y - side : start.y,
    side,
  };
}

/**
 * The sky square under a screen square: its centre through the camera, its side the angle between
 * the left and right mid-edge points (so it is the true on-sky size at any zoom or position).
 */
export function skySquareFromScreen(
  s: ScreenSquare,
  cam: SkyCamera,
  width: number,
  height: number,
): SkySquare {
  const cy = s.y + s.side / 2;
  const centre = screenToRaDec(cam, s.x + s.side / 2, cy, width, height);
  const left = screenToRaDec(cam, s.x, cy, width, height);
  const right = screenToRaDec(cam, s.x + s.side, cy, width, height);
  return {
    ra: centre.ra,
    dec: centre.dec,
    sideDeg: separationDeg(left.ra, left.dec, right.ra, right.dec),
  };
}

/** The refusal for a drawn square, or null when it can be searched. */
export function checkSquare(sidePx: number, sideDeg: number): SquareRefusal | null {
  if (!(sidePx >= MIN_SQUARE_PX)) return 'square:too_small';
  if (!(sideDeg <= MAX_SQUARE_DEG)) return 'square:too_big';
  return null;
}

/**
 * "Use a square in the middle" (A18.1): centred on the safe rectangle, 1° or 40 % of its smaller
 * side, whichever is smaller.
 */
export function middleSquare(
  cam: SkyCamera,
  width: number,
  height: number,
  safe: { x: number; y: number; w: number; h: number },
): SkySquare {
  const sidePx = MIDDLE_FRACTION * Math.min(safe.w, safe.h);
  const s = skySquareFromScreen(
    { x: safe.x + safe.w / 2 - sidePx / 2, y: safe.y + safe.h / 2 - sidePx / 2, side: sidePx },
    cam,
    width,
    height,
  );
  return { ...s, sideDeg: Math.min(MIDDLE_SQUARE_DEG, s.sideDeg) };
}

export type SquareKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

export function isSquareKey(key: string): key is SquareKey {
  return key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown';
}

/**
 * Square keys (A18.9): an arrow moves the square by 10 % of its side on the sky as seen (Left is
 * east, the higher RA); Shift + Up or Right grows it by 10 %, Shift + Down or Left shrinks it,
 * kept within [minDeg, MAX_SQUARE_DEG].
 */
export function nudgeSquare(
  sq: SkySquare,
  key: SquareKey,
  shift: boolean,
  minDeg: number,
): SkySquare {
  if (shift) {
    const grow = key === 'ArrowUp' || key === 'ArrowRight';
    const side = sq.sideDeg * (grow ? 1 + KEY_STEP_FRACTION : 1 - KEY_STEP_FRACTION);
    return { ...sq, sideDeg: Math.min(MAX_SQUARE_DEG, Math.max(minDeg, side)) };
  }
  const step = sq.sideDeg * KEY_STEP_FRACTION;
  const xi = key === 'ArrowLeft' ? step : key === 'ArrowRight' ? -step : 0;
  const eta = key === 'ArrowUp' ? step : key === 'ArrowDown' ? -step : 0;
  const c = fromPlane(sq.ra, sq.dec, xi, eta);
  return { ra: c.ra, dec: c.dec, sideDeg: sq.sideDeg };
}

/** "0.84°" */
export function formatSideDeg(deg: number): string {
  return `${deg.toFixed(2)}°`;
}
