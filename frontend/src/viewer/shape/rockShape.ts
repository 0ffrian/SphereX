// Issue #71 stream A (Q-210): the outline of a comet nucleus with no shape model. Pure and
// deterministic (no random numbers, no clock). Artistic: comet nuclei are often two-lobed (67P,
// 103P, 19P), but this nucleus has no model, so the shape is an illustration and says so.
import type { Vec3 } from './shapeModel';

/** Length-to-width ratio of the illustration (artistic; the prototype's value for a nucleus). */
export const NUCLEUS_AXIS_RATIO = 1.5;
/** The third axis relative to the second (artistic, prototype). */
export const NUCLEUS_C_OVER_B = 0.9;

/** Semi-axes of the ellipsoid under the lobes, volume-normalised to 1. */
export function nucleusAxes(ratio: number = NUCLEUS_AXIS_RATIO): Vec3 {
  const a = Math.pow(ratio, 2 / 3);
  const b = Math.pow(ratio, -1 / 3);
  const c = b * NUCLEUS_C_OVER_B;
  const k = Math.pow(a * b * c, -1 / 3);
  return [a * k, b * k, c * k];
}

/**
 * Radius of the two-lobed outline in the unit direction (x, y, z), x along the long axis:
 * the ellipsoid radius times `0.72 + 0.62 x^2 + 0.1 x`, which is smallest near the middle (the
 * neck) and larger toward both ends, with the +x lobe slightly bigger.
 */
export function lobedRadius(x: number, y: number, z: number, axes: Vec3 = nucleusAxes()): number {
  const e =
    (x * x) / (axes[0] * axes[0]) + (y * y) / (axes[1] * axes[1]) + (z * z) / (axes[2] * axes[2]);
  return (1 / Math.sqrt(e)) * (0.72 + 0.62 * x * x + 0.1 * x);
}

/** Largest radius of the outline over a coarse sweep, to scale it to a unit extent. */
export function lobedExtent(axes: Vec3 = nucleusAxes()): number {
  let m = 0;
  const n = 96;
  for (let i = 0; i <= n; i++) {
    const la = (i / n - 0.5) * Math.PI;
    for (let j = 0; j < n * 2; j++) {
      const lo = (j / (n * 2)) * 2 * Math.PI;
      m = Math.max(
        m,
        lobedRadius(Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo), axes),
      );
    }
  }
  return m;
}

/**
 * Moves the vertices of a unit sphere (`position` array, x y z triples) onto the outline, scaled so
 * the largest radius is 1: the body keeps the size the plan gives it.
 */
export function lobeSphere(position: { array: ArrayLike<number> & { [i: number]: number } }): void {
  const axes = nucleusAxes();
  const ext = lobedExtent(axes);
  const a = position.array;
  for (let i = 0; i + 2 < a.length; i += 3) {
    const x = a[i]!;
    const y = a[i + 1]!;
    const z = a[i + 2]!;
    const l = Math.hypot(x, y, z) || 1;
    const r = lobedRadius(x / l, y / l, z / l, axes) / ext;
    a[i] = (x / l) * r;
    a[i + 1] = (y / l) * r;
    a[i + 2] = (z / l) * r;
  }
}
