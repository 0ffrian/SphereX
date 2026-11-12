// Bridge between the sky view and the Discovery tool: SkyPane registers the live camera while its
// view exists, and the square's pixel <-> sky conversion uses the view's own projection (skyMath).
import {
  clampFov,
  deltaRa,
  panByPixels,
  raDecToScreen,
  screenToRaDec,
  separationDeg,
  wrapRa,
  type SkyCamera,
} from '@/viewer/sky/skyMath';
import type { AreaBox, AreaDrag } from '@/app/shell/areaStore';

export interface AreaViewAccess {
  getView(): SkyCamera;
  getSize(): { width: number; height: number };
  setView(next: SkyCamera): void;
}

let access: AreaViewAccess | null = null;
/** The pane's way of cancelling a running fly (the user's own pan or zoom stops ours). */
let setFlyCancel: ((cancel: (() => void) | null) => void) | null = null;
export function registerAreaView(
  a: AreaViewAccess | null,
  flyCancel?: (cancel: (() => void) | null) => void,
): void {
  access = a;
  setFlyCancel = flyCancel ?? null;
}

/** The rectangle with the given pixel corners, as a sky box and its angular width and height. */
export function boxFromPixels(d: AreaDrag): AreaBox | null {
  if (!access) return null;
  const cam = access.getView();
  const { width, height } = access.getSize();
  const a = screenToRaDec(cam, d.x0, d.y0, width, height, { ra: 0, dec: 0 });
  const b = screenToRaDec(cam, d.x1, d.y1, width, height, { ra: 0, dec: 0 });
  const ym = (d.y0 + d.y1) / 2;
  const l = screenToRaDec(cam, d.x0, ym, width, height, { ra: 0, dec: 0 });
  const r = screenToRaDec(cam, d.x1, ym, width, height, { ra: 0, dec: 0 });
  const xm = (d.x0 + d.x1) / 2;
  const t = screenToRaDec(cam, xm, d.y0, width, height, { ra: 0, dec: 0 });
  const u = screenToRaDec(cam, xm, d.y1, width, height, { ra: 0, dec: 0 });
  const widthDeg = separationDeg(l.ra, l.dec, r.ra, r.dec);
  const heightDeg = separationDeg(t.ra, t.dec, u.ra, u.dec);
  if (!(widthDeg > 0) || !(heightDeg > 0)) return null;
  return { a: { ra: a.ra, dec: a.dec }, b: { ra: b.ra, dec: b.dec }, widthDeg, heightDeg };
}

/** A drag turned into a free rectangle: from where it started to the pointer, any aspect. */
export function rectOf(x0: number, y0: number, x1: number, y1: number): AreaDrag {
  return { x0, y0, x1, y1 };
}

/** The Enter shortcut: a wide default box (about half by a third of the shorter side's span), centred. */
export function centreRect(): AreaBox | null {
  if (!access) return null;
  const { width, height } = access.getSize();
  const m = Math.min(width, height);
  const hw = m * 0.3;
  const hh = m * 0.18;
  return boxFromPixels({ x0: width / 2 - hw, y0: height / 2 - hh, x1: width / 2 + hw, y1: height / 2 + hh });
}

/** The set area's screen corners now (it follows the view), or null when a corner is behind. */
export function boxToPixels(box: AreaBox): AreaDrag | null {
  if (!access) return null;
  const cam = access.getView();
  const { width, height } = access.getSize();
  const a = raDecToScreen(cam, box.a.ra, box.a.dec, width, height);
  const b = raDecToScreen(cam, box.b.ra, box.b.dec, width, height);
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return null;
  return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
}

/** The free rectangle of the sky pane in its own pixels, where the whole area should sit. */
export interface SafeRect {
  l: number;
  t: number;
  r: number;
  b: number;
}

const MARGIN = 20;

/**
 * Free area for the rectangle: below the top-left player, above the dock and the zoom card, left of the
 * card (mock-up `knSafe`), with a 20 px margin. Read from the DOM, so it follows the layout.
 */
export function safeRect(): SafeRect | null {
  if (!access) return null;
  const { width, height } = access.getSize();
  const pane = document.querySelector<HTMLElement>('.sx-sky-pane canvas');
  if (!pane) return null;
  const vr = pane.getBoundingClientRect();
  const rect = (sel: string) => {
    const e = document.querySelector<HTMLElement>(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { l: r.left - vr.left, t: r.top - vr.top, r: r.right - vr.left, b: r.bottom - vr.top };
  };
  const player = rect('.sx-player');
  const dock = rect('.sx-dock');
  const zoom = rect('.sx-zoom-slot > *');
  const card = rect('.sx-panel');
  // 12 more at the top for the size label over the rectangle.
  const top = (player ? player.b : 0) + MARGIN + 12;
  const bottom = Math.min(dock ? dock.t : height, zoom ? zoom.t : height, height) - MARGIN;
  const right = (card ? card.l : width - 408 - 16) - MARGIN;
  return { l: MARGIN, t: top, r: right, b: bottom };
}

/** The camera that puts the WHOLE rectangle in the safe rectangle, centred, by its limiting dimension. */
export function fitCamera(box: AreaBox, safe: SafeRect): SkyCamera | null {
  if (!access) return null;
  const { width, height } = access.getSize();
  const aw = Math.max(80, safe.r - safe.l);
  const ah = Math.max(80, safe.b - safe.t);
  const sx = safe.l + aw / 2;
  const sy = safe.t + ah / 2;
  // Rectangle centre and sides in degrees (the box corners are opposite corners).
  const ra = wrapRa(box.a.ra + deltaRa(box.b.ra, box.a.ra) / 2);
  const dec = (box.a.dec + box.b.dec) / 2;
  const wDeg = box.widthDeg;
  const hDeg = box.heightDeg;
  // Pixels per degree at a field of view: (height / 2) / tan(fov / 2), per radian, small angles.
  const side = Math.min(aw / wDeg, ah / hDeg); // wanted pixels per degree
  const tanHalf = height / 2 / (side * (180 / Math.PI));
  let cam: SkyCamera = {
    ra,
    dec,
    fovDeg: clampFov((2 * Math.atan(tanHalf) * 180) / Math.PI),
  };
  // Put the square's centre on the safe rectangle's centre (look past it by the offset), then
  // correct the field of view from the rectangle's real projected size; repeat a few times.
  for (let i = 0; i < 8; i++) {
    const a = raDecToScreen(cam, box.a.ra, box.a.dec, width, height);
    const b = raDecToScreen(cam, box.b.ra, box.b.dec, width, height);
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) break;
    cam = panByPixels(cam, sx - (a.x + b.x) / 2, sy - (a.y + b.y) / 2, height);
    const a2 = raDecToScreen(cam, box.a.ra, box.a.dec, width, height);
    const b2 = raDecToScreen(cam, box.b.ra, box.b.dec, width, height);
    const pw = Math.abs(b2.x - a2.x);
    const ph = Math.abs(b2.y - a2.y);
    if (![pw, ph].every(Number.isFinite) || pw < 1 || ph < 1) break;
    const k = Math.min(aw / pw, ah / ph);
    const t = Math.tan((cam.fovDeg * Math.PI) / 360) / k;
    cam = { ...cam, fovDeg: clampFov((2 * Math.atan(t) * 180) / Math.PI) };
  }
  return cam;
}

/** Sets the view at once, or flies there in about a second (ease in and out). */
export function flyToView(to: SkyCamera, instant: boolean): void {
  if (!access) return;
  const view = access;
  setFlyCancel?.(null);
  if (instant) {
    view.setView(to);
    return;
  }
  const from = view.getView();
  const t0 = performance.now();
  let raf = 0;
  const step = (now: number) => {
    const u = Math.min(1, (now - t0) / 1000);
    const e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
    view.setView({
      ra: wrapRa(from.ra + deltaRa(to.ra, from.ra) * e),
      dec: from.dec + (to.dec - from.dec) * e,
      fovDeg: from.fovDeg * (to.fovDeg / from.fovDeg) ** e,
    });
    if (u < 1) raf = requestAnimationFrame(step);
    else setFlyCancel?.(null);
  };
  raf = requestAnimationFrame(step);
  setFlyCancel?.(() => cancelAnimationFrame(raf));
}
