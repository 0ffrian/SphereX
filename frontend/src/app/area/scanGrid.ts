// Scan geometry (issue #157; #156 Q-470; mock-up states 1 and 2): pure, so it is tested without a
// sky view.
//   Select: the pointer is a rectangle with the screen's shape covering SELECT_FRACTION of it,
//           drawn to scale: exactly the region that fills the screen after the click (north up).
//           Zooming the sky (scroll, pinch, + and -) changes how much sky it covers; past 12° a
//           side it is held at the limit, which also keeps it within 36 squares (6 × 6).
//   Grid:   cols = ceil(w / 2), rows = ceil(h / 2), equal squares (#156: no thin edge slivers),
//           cut on the region centre's tangent (gnomonic) plane, north up, RA increasing to the
//           left, numbered 1..N from the top row, left to right, row by row.
// The sky view is a gnomonic camera, so each square's edges (great circles) are straight lines on
// screen: four projected corners draw a square exactly, and it stays pinned when the sky moves.
import { clampFov, screenToRaDec, wrapRa, type SkyCamera } from '@/viewer/sky/skyMath';

/** Largest side of a scanned region (#156). */
export const MAX_REGION_DEG = 12;
/** Most squares in one scan (#156); 12° a side is at most 6 × 6. */
export const MAX_SQUARES = 36;
/** Largest side of one square (a live area, Q-462). */
export const SQUARE_DEG = 2;
/** Share of the screen's height the selection rectangle covers before the limit (design value). */
export const SELECT_FRACTION = 0.35;
/** Rough time of one square (s), for the pointer's label only (engineering value, #141's estimate). */
export const SQUARE_ESTIMATE_S = 960;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export interface Region {
  ra: number;
  dec: number;
  width_deg: number;
  height_deg: number;
}
export interface RaDec {
  ra: number;
  dec: number;
}
export interface GridSquare {
  index: number;
  col: number;
  row: number;
  /** The square on the tangent plane (tangent units, ξ east, η north): left, right, top, bottom. */
  xl: number;
  xr: number;
  yt: number;
  yb: number;
  /** Corners on the sky: top-left, top-right, bottom-right, bottom-left. */
  corners: [RaDec, RaDec, RaDec, RaDec];
  /** The region's centre (the tangent point). */
  ra0: number;
  dec0: number;
}
export interface Grid {
  cols: number;
  rows: number;
  /** Each square's sides in degrees (equal split). */
  cellW: number;
  cellH: number;
  squares: GridSquare[];
}

/** The number of squares of up to 2° along a side (a hair over a whole number is not a new square). */
export const splitCount = (sideDeg: number): number =>
  Math.max(1, Math.ceil(sideDeg / SQUARE_DEG - 1e-6));

/** Gnomonic inverse: tangent-plane (ξ east, η north) around (ra0, dec0) to the sky. */
export function deproject(ra0: number, dec0: number, xi: number, eta: number): RaDec {
  const d0 = dec0 * D2R;
  const den = Math.cos(d0) - eta * Math.sin(d0);
  const ra = ra0 + Math.atan2(xi, den) * R2D;
  const dec = Math.atan2(Math.sin(d0) + eta * Math.cos(d0), Math.hypot(xi, den)) * R2D;
  return { ra: wrapRa(ra), dec };
}

/** The equal split of a region and its squares, in scan order (#156 Q-470). */
export function splitRegion(region: Region): Grid {
  const cols = splitCount(region.width_deg);
  const rows = splitCount(region.height_deg);
  const X = Math.tan((region.width_deg / 2) * D2R);
  const Y = Math.tan((region.height_deg / 2) * D2R);
  const squares: GridSquare[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Screen left is east (+ξ): column 0 starts at ξ = +X.
      const xl = X - (2 * X * col) / cols;
      const xr = X - (2 * X * (col + 1)) / cols;
      const yt = Y - (2 * Y * row) / rows;
      const yb = Y - (2 * Y * (row + 1)) / rows;
      const at = (x: number, y: number) => deproject(region.ra, region.dec, x, y);
      squares.push({
        index: row * cols + col + 1,
        col,
        row,
        xl,
        xr,
        yt,
        yb,
        corners: [at(xl, yt), at(xr, yt), at(xr, yb), at(xl, yb)],
        ra0: region.ra,
        dec0: region.dec,
      });
    }
  }
  return { cols, rows, cellW: region.width_deg / cols, cellH: region.height_deg / rows, squares };
}

/** A point of a square: u from its left (0) to its right (1), v from its top (0) to its bottom (1). */
export function squareCentre(s: GridSquare, u = 0.5, v = 0.5): RaDec {
  return deproject(s.ra0, s.dec0, s.xl + (s.xr - s.xl) * u, s.yt + (s.yb - s.yt) * v);
}

/** A region's sides for a screen of aspect `aspect` and height `hDeg` (gnomonic, north up). */
function sidesFor(hDeg: number, aspect: number): { w: number; h: number } {
  return { w: 2 * Math.atan(aspect * Math.tan((hDeg / 2) * D2R)) * R2D, h: hDeg };
}

export interface Selection {
  region: Region;
  /** The rectangle's size on screen now (CSS px). */
  wPx: number;
  hPx: number;
  cols: number;
  rows: number;
  /** A side was held at MAX_REGION_DEG. */
  held: boolean;
  /** The view after the click: the region fills the screen, north up. */
  target: SkyCamera;
}

/**
 * The region under the pointer at (x, y) on a view of width × height px: the screen's shape,
 * SELECT_FRACTION of its height at the current zoom, each side held at MAX_REGION_DEG.
 */
export function selectionAt(
  cam: SkyCamera,
  x: number,
  y: number,
  width: number,
  height: number,
): Selection {
  const aspect = width / Math.max(1, height);
  const tanFov = Math.tan((cam.fovDeg / 2) * D2R);
  let h = 2 * Math.atan(SELECT_FRACTION * tanFov) * R2D;
  // The wider side reaches the limit first: hold h so both stay within MAX_REGION_DEG.
  const hMax = Math.min(
    MAX_REGION_DEG,
    2 * Math.atan(Math.tan((MAX_REGION_DEG / 2) * D2R) / aspect) * R2D,
  );
  const held = h > hMax + 1e-9;
  if (held) h = hMax;
  const { w } = sidesFor(h, aspect);
  const c = screenToRaDec(cam, x, y, width, height, { ra: 0, dec: 0 });
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
  const region = {
    ra: r6(c.ra),
    dec: r6(c.dec),
    width_deg: r6(Math.min(w, MAX_REGION_DEG)),
    height_deg: r6(h),
  };
  // Pixels per tangent unit at the centre: (height / 2) / tan(fov / 2).
  const hPx = (height * Math.tan((h / 2) * D2R)) / tanFov;
  return {
    region,
    wPx: hPx * aspect,
    hPx,
    cols: splitCount(region.width_deg),
    rows: splitCount(region.height_deg),
    held,
    target: { ra: c.ra, dec: c.dec, fovDeg: clampFov(h) },
  };
}

/** "about 4 h", "about 2 h 10 min", "about 15 min" (rough: whole hours from 3 h). */
export function aboutTime(s: number, rough = false): string {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `about ${min} min`;
  const h = Math.floor(min / 60);
  const m = Math.round((min - h * 60) / 10) * 10;
  if (rough || m === 0) return `about ${Math.round(min / 60)} h`;
  return m === 60 ? `about ${h + 1} h` : `about ${h} h ${m} min`;
}

/** The pointer's label: "9.6° × 6.0° · 15 squares · about 4 h", "… · 12° max" when held. */
export function selectionLabel(sel: Pick<Selection, 'region' | 'cols' | 'rows' | 'held'>): string {
  const n = sel.cols * sel.rows;
  const parts = [
    `${sel.region.width_deg.toFixed(1)}° × ${sel.region.height_deg.toFixed(1)}°`,
    `${n} square${n === 1 ? '' : 's'}`,
    aboutTime(n * SQUARE_ESTIMATE_S, true),
  ];
  if (sel.held) parts.push(`${MAX_REGION_DEG}° max`);
  return parts.join(' · ');
}

/** True when (x, y) is inside the convex quad (corners in order). */
export function inQuad(q: readonly { x: number; y: number }[], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i]!;
    const b = q[(i + 1) % q.length]!;
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (cross === 0) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}
