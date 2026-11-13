// Area search geometry (A18.1, A16.4; Q-406). One tangent plane for everything the Area tool
// draws or compares on the sky: the drawn square, its corners, the snap test and the prepared
// area's box. The plane is gnomonic about a centre, north up, xi along RA (east positive) and eta
// along Dec, both in degrees (tangent-plane units × 180/π), the same box definition as the backend's
// prepared area (P3). Pure functions; RA wrap goes through the tangent plane, so a box across RA
// 0/360 needs no special case.
import { wrapRa, type RaDec } from '@/viewer/sky/skyMath';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export interface PlanePoint {
  xi: number;
  eta: number;
}

/** A square on the sky: centre (RA in [0, 360)) and side in degrees, north up. */
export interface SkySquare {
  ra: number;
  dec: number;
  sideDeg: number;
}

/** A box on the sky: centre and on-sky width (along RA) and height (along Dec), in degrees. */
export interface SkyBox {
  ra: number;
  dec: number;
  width_deg: number;
  height_deg: number;
}

/**
 * (ra, dec) on the tangent plane about (ra0, dec0). `null` for a point 90° or more from the centre
 * (behind the plane).
 */
export function toPlane(
  ra0: number,
  dec0: number,
  ra: number,
  dec: number,
  out: PlanePoint = { xi: 0, eta: 0 },
): PlanePoint | null {
  const d0 = dec0 * D2R;
  const d = dec * D2R;
  const da = (ra - ra0) * D2R;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(da);
  if (cosc <= 1e-9) return null;
  out.xi = ((Math.cos(d) * Math.sin(da)) / cosc) * R2D;
  out.eta = ((Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(da)) / cosc) * R2D;
  return out;
}

/** Inverse of toPlane: the sky position of plane point (xi, eta) about (ra0, dec0). */
export function fromPlane(
  ra0: number,
  dec0: number,
  xi: number,
  eta: number,
  out: RaDec = { ra: 0, dec: 0 },
): RaDec {
  const x = xi * D2R;
  const y = eta * D2R;
  const d0 = dec0 * D2R;
  const rho = Math.hypot(x, y);
  if (rho < 1e-15) {
    out.ra = wrapRa(ra0);
    out.dec = dec0;
    return out;
  }
  const c = Math.atan(rho);
  const sinc = Math.sin(c);
  const cosc = Math.cos(c);
  const dec = Math.asin(cosc * Math.sin(d0) + (y * sinc * Math.cos(d0)) / rho);
  const ra = ra0 * D2R + Math.atan2(x * sinc, rho * Math.cos(d0) * cosc - y * Math.sin(d0) * sinc);
  out.ra = wrapRa(ra * R2D);
  out.dec = dec * R2D;
  return out;
}

/**
 * The four corners of a box (centre, width, height) in drawing order: top-left (north-east, as the
 * sky is seen with east to the left), top-right, bottom-right, bottom-left. Writes into `out`.
 */
export function boxCorners(
  ra: number,
  dec: number,
  widthDeg: number,
  heightDeg: number,
  out: RaDec[] = [
    { ra: 0, dec: 0 },
    { ra: 0, dec: 0 },
    { ra: 0, dec: 0 },
    { ra: 0, dec: 0 },
  ],
): RaDec[] {
  const w = widthDeg / 2;
  const h = heightDeg / 2;
  // East (+xi) is on the left of the sky view (SkyView draws the sky from inside).
  fromPlane(ra, dec, w, h, out[0]);
  fromPlane(ra, dec, -w, h, out[1]);
  fromPlane(ra, dec, -w, -h, out[2]);
  fromPlane(ra, dec, w, -h, out[3]);
  return out;
}

export function squareCorners(sq: SkySquare, out?: RaDec[]): RaDec[] {
  return boxCorners(sq.ra, sq.dec, sq.sideDeg, sq.sideDeg, out);
}

/** True when (ra, dec) lies inside the box (on its tangent plane, edges included). */
export function boxContains(box: SkyBox, ra: number, dec: number): boolean {
  const p = toPlane(box.ra, box.dec, ra, dec);
  if (!p) return false;
  return Math.abs(p.xi) <= box.width_deg / 2 && Math.abs(p.eta) <= box.height_deg / 2;
}

/**
 * Overlap of a square with a box, in square degrees on the box's tangent plane. The square is
 * taken as the bounding rectangle of its corners on that plane (small fields: the error is far
 * below what the tie-break needs).
 */
export function overlapDeg2(box: SkyBox, sq: SkySquare): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of squareCorners(sq)) {
    const p = toPlane(box.ra, box.dec, c.ra, c.dec);
    if (!p) return 0;
    minX = Math.min(minX, p.xi);
    maxX = Math.max(maxX, p.xi);
    minY = Math.min(minY, p.eta);
    maxY = Math.max(maxY, p.eta);
  }
  const w = box.width_deg / 2;
  const h = box.height_deg / 2;
  const ox = Math.min(maxX, w) - Math.max(minX, -w);
  const oy = Math.min(maxY, h) - Math.max(minY, -h);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}
