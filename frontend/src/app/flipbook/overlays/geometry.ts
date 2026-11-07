// Display maths for the overlays (issue #12). Pure functions, no physical constants: positions come
// from the overlays reply, these only turn them into screen positions.
import type { SkyPoint } from '@/app/api/types';

/**
 * Left/top of a pixel centre over the cutout, in percent. Same maths as the object ring in
 * Flipbook.tsx: pixel `v` (0-based, origin top-left) covers [v, v + 1), so its centre is v + 0.5.
 */
export function markerPercent(v: number, size: number): number {
  return ((v + 0.5) / size) * 100;
}

const RAD = Math.PI / 180;

/**
 * Gnomonic (tangent-plane) projection around (ra0, dec0), in degrees: `xi` grows to the east,
 * `eta` to the north. Null when the point is 90° or more from the centre (no projection).
 */
export function tangentPlane(
  ra0: number,
  dec0: number,
  ra: number,
  dec: number,
): { xi: number; eta: number } | null {
  const d0 = dec0 * RAD;
  const d = dec * RAD;
  const da = (ra - ra0) * RAD;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(da);
  if (!(cosc > 0)) return null;
  const xi = (Math.cos(d) * Math.sin(da)) / cosc;
  const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(da)) / cosc;
  return { xi: xi / RAD, eta: eta / RAD };
}

/** A projected point on the map: `u` to the right (west), `v` down (south), degrees. */
export interface MapPoint {
  u: number;
  v: number;
}

/** North up, east left: east (+xi) goes to the left, north (+eta) goes up. */
export function toMap(ra0: number, dec0: number, p: SkyPoint): MapPoint | null {
  const t = tangentPlane(ra0, dec0, p[0], p[1]);
  return t ? { u: -t.xi, v: -t.eta } : null;
}

/** Round scale-bar lengths, degrees, with their labels. */
const SCALE_STEPS: readonly [number, string][] = [
  [1 / 3600, '1″'],
  [2 / 3600, '2″'],
  [5 / 3600, '5″'],
  [10 / 3600, '10″'],
  [30 / 3600, '30″'],
  [1 / 60, '1′'],
  [2 / 60, '2′'],
  [5 / 60, '5′'],
  [10 / 60, '10′'],
  [15 / 60, '15′'],
  [30 / 60, '30′'],
  [1, '1°'],
  [2, '2°'],
  [5, '5°'],
  [10, '10°'],
];

/** The longest round length not above `maxDeg` (the shortest step when all are longer). */
export function niceScale(maxDeg: number): { deg: number; label: string } {
  let best = SCALE_STEPS[0]!;
  for (const step of SCALE_STEPS) if (step[0] <= maxDeg) best = step;
  return { deg: best[0], label: best[1] };
}
