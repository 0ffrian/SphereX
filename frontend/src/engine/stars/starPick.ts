// Issue #71 stream X: picking a place on the star globe, and centring the close-up on it. Wrapper
// geometry only: the inverse of the artifact's drawStar view (its `rot` and `tilt`, the shader's
// `ry(rx(n, tilt), rot)`), and the close-up's rot/tilt from a latitude and longitude (artifact L305-L307).
// The artifact's globe has rot = 0.55 + time * 0.012, tilt = 0.12, half = 1.28 (L301).
export const GLOBE_HALF = 1.28;
export const GLOBE_TILT = 0.12;
export const globeRot = (time: number): number => 0.55 + time * 0.012;

export interface LatLon {
  /** Radians, north positive. */
  lat: number;
  /** Radians, the artifact's longitude: atan2(x, z) in the star's body frame. */
  lon: number;
}
const rx = (v: [number, number, number], a: number): [number, number, number] => {
  const c = Math.cos(a), s = Math.sin(a);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
};
const ry = (v: [number, number, number], a: number): [number, number, number] => {
  const c = Math.cos(a), s = Math.sin(a);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
};

/** The place under a point of the view, `q` in star radii from the view centre (x right, y up), or null off the disc. */
export function pickSurface(q: [number, number], rot: number, tilt: number): LatLon | null {
  const r2 = q[0] * q[0] + q[1] * q[1];
  if (r2 >= 1) return null;
  const s = ry(rx([q[0], q[1], Math.sqrt(1 - r2)], tilt), rot);
  return { lat: Math.asin(Math.max(-1, Math.min(1, s[1]))), lon: Math.atan2(s[0], s[2]) };
}
/** Where a place lands in the view (star radii, y up) and whether it faces us. Inverse of `pickSurface`. */
export function projectSurface(p: LatLon, rot: number, tilt: number): { x: number; y: number; visible: boolean } {
  const c = Math.cos(p.lat);
  const n = rx(ry([c * Math.sin(p.lon), Math.sin(p.lat), c * Math.cos(p.lon)], -rot), -tilt);
  return { x: n[0], y: n[1], visible: n[2] > 0 };
}
/** The artifact's close-up view (L305-L307) centred on a place. */
export function closeView(p: LatLon): { rot: number; tilt: number } {
  const c = Math.cos(p.lat);
  const L: [number, number, number] = [c * Math.sin(p.lon), Math.sin(p.lat), c * Math.cos(p.lon)];
  return { tilt: -Math.asin(L[1]), rot: Math.atan2(L[0], L[2]) };
}
/** Pixel position inside a canvas (0..1 from the top left) to star radii, for a view of half-height `half`. */
export function viewPoint(nx: number, ny: number, aspect: number, half: number): [number, number] {
  return [(2 * nx - 1) * aspect * half, (1 - 2 * ny) * half];
}
/** One arrow-key step: 5 degrees, latitude kept off the poles. */
export function nudge(p: LatLon, dLat: number, dLon: number): LatLon {
  const lim = (85 * Math.PI) / 180;
  const lon = ((p.lon + dLon + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return { lat: Math.max(-lim, Math.min(lim, p.lat + dLat)), lon };
}
