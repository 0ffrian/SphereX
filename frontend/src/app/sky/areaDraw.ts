// Bridge between the sky view and the Discovery tool: SkyPane registers the live camera while its
// view exists, and the square's pixel <-> sky conversion uses the view's own projection (skyMath).
import {
  raDecToScreen,
  screenToRaDec,
  separationDeg,
  type SkyCamera,
} from '@/viewer/sky/skyMath';
import type { AreaBox, AreaDrag } from '@/app/shell/areaStore';

export interface AreaViewAccess {
  getView(): SkyCamera;
  getSize(): { width: number; height: number };
}

let access: AreaViewAccess | null = null;
export function registerAreaView(a: AreaViewAccess | null): void {
  access = a;
}

/** The square with the given pixel corners, as a sky box and its angular width. */
export function boxFromPixels(d: AreaDrag): AreaBox | null {
  if (!access) return null;
  const cam = access.getView();
  const { width, height } = access.getSize();
  const a = screenToRaDec(cam, d.x0, d.y0, width, height, { ra: 0, dec: 0 });
  const b = screenToRaDec(cam, d.x1, d.y1, width, height, { ra: 0, dec: 0 });
  const ym = (d.y0 + d.y1) / 2;
  const l = screenToRaDec(cam, d.x0, ym, width, height, { ra: 0, dec: 0 });
  const r = screenToRaDec(cam, d.x1, ym, width, height, { ra: 0, dec: 0 });
  const widthDeg = separationDeg(l.ra, l.dec, r.ra, r.dec);
  if (!(widthDeg > 0)) return null;
  return { a: { ra: a.ra, dec: a.dec }, b: { ra: b.ra, dec: b.dec }, widthDeg };
}

/** A drag turned into a square: the side is the longer of the two sides, in the drag's direction. */
export function squareOf(x0: number, y0: number, x1: number, y1: number): AreaDrag {
  const side = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  return { x0, y0, x1: x0 + (x1 >= x0 ? side : -side), y1: y0 + (y1 >= y0 ? side : -side) };
}

/** "Use a square in the middle": about a third of the shorter side, centred in the view. */
export function centreSquare(): AreaBox | null {
  if (!access) return null;
  const { width, height } = access.getSize();
  const half = Math.min(width, height) * 0.17;
  return boxFromPixels({
    x0: width / 2 - half,
    y0: height / 2 - half,
    x1: width / 2 + half,
    y1: height / 2 + half,
  });
}

/** The set square's screen corners now (it follows the view), or null when a corner is behind. */
export function boxToPixels(box: AreaBox): AreaDrag | null {
  if (!access) return null;
  const cam = access.getView();
  const { width, height } = access.getSize();
  const a = raDecToScreen(cam, box.a.ra, box.a.dec, width, height);
  const b = raDecToScreen(cam, box.b.ra, box.b.dec, width, height);
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return null;
  return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
}
