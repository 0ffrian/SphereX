// Bridge between the sky view and the Discovery tool: SkyPane registers the live camera while its
// view exists, and the square's pixel <-> sky conversion uses the view's own projection (skyMath).
import {
  clampFov,
  deltaRa,
  panByPixels,
  raDecToScreen,
  wrapRa,
  type SkyCamera,
} from '@/viewer/sky/skyMath';
import { useAreaStore, type AreaBox, type PixelRect } from '@/app/shell/areaStore';
import { regionBox, selectionAt, type Selection } from '@/app/area/scanGrid';
import { isFinished, runningScan, useScanStore, viewRegion } from '@/app/area/scanStore';
import { getScanApi, RunGone } from '@/app/area/scanApi';
import { useShellStore } from '@/app/shell/shellStore';

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

/** The selection rectangle at (x, y) now (issue #157, state 1), or null with no view. */
export function selectionNow(x: number, y: number): Selection | null {
  if (!access) return null;
  const { width, height } = access.getSize();
  return selectionAt(access.getView(), x, y, width, height);
}

/**
 * Select a region (issue #157; mock-up states 1 and 2): the sky zooms north up so the region fills
 * the screen. A region of one square is a single area (the cards of #144 and #145); a larger one
 * is gridded and offered for a scan (scanStore).
 */
export function pickRegionAt(x: number, y: number): void {
  // One scan at a time (one worker, #156): while one is going, its card comes back instead.
  const going = runningScan(useScanStore.getState().view);
  if (going) {
    reopenScan(going.flow);
    return;
  }
  const sel = selectionNow(x, y);
  if (!sel) return;
  const s = useAreaStore.getState();
  flyToView(sel.target, reducedMotion());
  const box = regionBox(sel.region);
  if (sel.cols * sel.rows === 1) {
    s.setBox(box);
    return;
  }
  s.openScan(s.flow, box);
  void useScanStore.getState().plan(s.flow, sel.region);
}

/**
 * The dock button of a tool with a scan still held (running, or finished and not closed): the
 * scan card comes back and the sky flies to its region. False when there is none.
 */
export function reopenScan(flow: 'known' | 'discovery'): boolean {
  const v = useScanStore.getState().view;
  const region = viewRegion(v);
  if (!v || v.kind !== 'run' || !region) return false;
  // A finished scan comes back from its own tool only; one still going, from either tool.
  if (v.flow !== flow && !runningScan(v)) return false;
  useAreaStore.getState().openScan(v.flow, regionBox(region));
  flyToView({ ra: region.ra, dec: region.dec, fovDeg: clampFov(region.height_deg) }, reducedMotion());
  return true;
}

/**
 * A click on your patch while its list is folded away (#173, after ← "Back to your patch"): the
 * list opens again. True when it did.
 */
export function patchClickAt(x: number, y: number): boolean {
  const s = useAreaStore.getState();
  if (!s.minimised || !s.box || (s.screen !== 'disc' && s.screen !== 'list')) return false;
  const r = boxToPixels(s.box);
  if (!r) return false;
  const inside =
    x >= Math.min(r.x0, r.x1) && x <= Math.max(r.x0, r.x1) && y >= Math.min(r.y0, r.y1) && y <= Math.max(r.y0, r.y1);
  if (!inside) return false;
  s.setMinimised(false);
  return true;
}

/** Back to the scan card from an object or square opened in it: the card, and the sky on its region. */
export function backToScan(): void {
  const v = useScanStore.getState().view;
  if (!v || !reopenScan(v.flow)) useAreaStore.getState().backToScan();
}

/**
 * A scan saved in this browser (a page reload mid-scan): follow it again, and when it is still
 * going and the user is on the plain sky, open its tool and fly to its region. Its squares redraw
 * from GET /v1/runs/{id}. A finished one is only followed: its dock button brings it back.
 */
export function restoreSavedScan(): void {
  const s = useScanStore.getState();
  const saved = s.saved();
  if (!saved || s.view) return;
  // A run the server no longer has, or one that cannot be read now, is not brought back.
  void getScanApi()
    .run(saved.runId)
    .then(
      (record) => {
        if (useScanStore.getState().view) return;
        useScanStore.getState().follow(saved.runId, saved.flow, record.region, record);
        if (isFinished(record.state) || useShellStore.getState().tool !== 'sky') return;
        useShellStore.getState().setTool('area');
        reopenScan(saved.flow);
      },
      (e: unknown) => {
        if (e instanceof RunGone) useScanStore.getState().clear();
      },
    );
}

/** Enter in the area tools (the keyboard way to select): the region in the middle of the screen. */
export function enterInArea(): void {
  if (!access || useAreaStore.getState().stage !== 'aiming') return;
  const { width, height } = access.getSize();
  pickRegionAt(width / 2, height / 2);
}

/** The live camera and the pane's size (the aim rectangle's scale), or null with no view. */
export function viewNow(): { cam: SkyCamera; width: number; height: number } | null {
  if (!access) return null;
  return { cam: access.getView(), ...access.getSize() };
}

/** The set area's screen corners now (it follows the view), or null when a corner is behind. */
export function boxToPixels(box: AreaBox): PixelRect | null {
  if (!access) return null;
  const cam = access.getView();
  const { width, height } = access.getSize();
  const a = raDecToScreen(cam, box.a.ra, box.a.dec, width, height);
  const b = raDecToScreen(cam, box.b.ra, box.b.dec, width, height);
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return null;
  return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
}

/** A sky position in the pane's pixels now, or null when it is behind the camera or no view is registered. */
export function skyToPixels(ra: number, dec: number): { x: number; y: number } | null {
  if (!access) return null;
  const { width, height } = access.getSize();
  const p = raDecToScreen(access.getView(), ra, dec, width, height);
  return Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
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

/** True when the user asks for reduced motion: flights are then instant. */
export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
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
