// Issue #39: sphere geometry helpers for shader-generated bodies, as TSL builders and CPU
// reference twins using the same maths. Convention: +y is the rotation axis (north), longitude is
// atan2(z, x), east = normalize(y x n), north = n x east. At the poles east is undefined; both
// versions return east = +x there (and north = n x east), so the frame stays finite.
// Differential rotation (R7.7, artistic here): omega(lat) = omega0 * (1 - k sin^2(lat)).
// omega0 and k are caller-supplied; no physical default lives in this file.
/* eslint-disable @typescript-eslint/no-explicit-any -- TSL node graphs are built from untyped proxies */
import { asin, atan, clamp, cos, float, length, sin, vec3 } from 'three/tsl';

/** |x|,|z| below this counts as "on the pole" for the tangent frame (same in CPU and TSL). */
export const POLE_EPS = 1e-6;

export type V3 = [number, number, number];

/** Latitude (rad, -pi/2..pi/2) and longitude (rad, -pi..pi) of a (not necessarily unit) vector. */
export function latLonCpu(n: V3): { lat: number; lon: number } {
  const len = Math.hypot(n[0], n[1], n[2]);
  const y = len > 0 ? Math.min(1, Math.max(-1, n[1] / len)) : 0;
  return { lat: Math.asin(y), lon: Math.atan2(n[2], n[0]) };
}

/** East and north unit vectors at unit normal n. */
export function tangentFrameCpu(n: V3): { east: V3; north: V3 } {
  const r = Math.hypot(n[0], n[2]);
  // east = normalize(y x n) = (n.z, 0, -n.x) / r
  const east: V3 = r < POLE_EPS ? [1, 0, 0] : [n[2] / r, 0, -n[0] / r];
  // north = n x east
  const north: V3 = [
    n[1] * east[2] - n[2] * east[1],
    n[2] * east[0] - n[0] * east[2],
    n[0] * east[1] - n[1] * east[0],
  ];
  return { east, north };
}

/** Angular speed at latitude `lat`: omega0 * (1 - k sin^2 lat). */
export function omegaCpu(lat: number, omega0: number, k: number): number {
  const s = Math.sin(lat);
  return omega0 * (1 - k * s * s);
}

/** Sample position p rotated about +y by omega(lat(p)) * t (sampling the surface as it was). */
export function differentialRotateCpu(p: V3, t: number, omega0: number, k: number): V3 {
  const a = omegaCpu(latLonCpu(p).lat, omega0, k) * t;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}

/** TSL: latitude and longitude nodes of a vec3 node. */
export function latLon(n: any): { lat: any; lon: any } {
  const y = clamp(n.y.div(length(n)), -1, 1);
  return { lat: asin(y), lon: atan(n.z, n.x) };
}

/** TSL: east and north nodes at unit-normal node n. */
export function tangentFrame(n: any): { east: any; north: any } {
  const r = length(vec3(n.x, 0, n.z));
  const safeR = r.max(POLE_EPS);
  const onPole = r.lessThan(POLE_EPS);
  const east = onPole.select(vec3(1, 0, 0), vec3(n.z.div(safeR), 0, n.x.negate().div(safeR)));
  return { east, north: n.cross(east) };
}

/** TSL: omega(lat) = omega0 (1 - k sin^2 lat). */
export function omega(lat: any, omega0: any, k: any): any {
  const s = sin(lat);
  return float(omega0).mul(float(1).sub(float(k).mul(s.mul(s))));
}

/** TSL: differential-rotation sample position for time t. */
export function differentialRotate(p: any, t: any, omega0: any, k: any): any {
  const a = omega(latLon(p).lat, omega0, k).mul(t);
  const c = cos(a);
  const s = sin(a);
  return vec3(p.x.mul(c).add(p.z.mul(s)), p.y, p.x.negate().mul(s).add(p.z.mul(c)));
}
