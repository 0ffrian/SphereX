// R8.4 item 1, R8.8 pan: pointer → ray → analytic sphere or ellipsoid → body direction and UV.
// No mesh raycast is needed for these bodies (R8.4). Plain math on the camera's matrices, so it
// runs without a GPU and allocates nothing per sample (the optional `toBody` transform of a
// BodyRenderer is the caller's).
//
// Frame: the "probe frame" is where the bodies are described. For the shader kinds it is the body
// frame (`BodyRenderer.worldToBody`, unit sphere, gas-giant tilt included); for the planned kinds
// it is the plan's scene units (BodyPlan position and axes).
import { directionToUV } from '@/viewer/fields/fieldGenerator';
import type { TouchSample, Vec3 } from './sources/types';
import { clamp } from './sources/types';

/** The parts of a three.js PerspectiveCamera the probe reads (column-major 4×4 elements). */
export interface CameraLike {
  readonly projectionMatrixInverse: { readonly elements: ArrayLike<number> };
  readonly matrixWorld: { readonly elements: ArrayLike<number> };
}

export interface RectLike {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A sphere or ellipsoid the finger can touch. */
export interface ProbeBody {
  readonly id: string;
  readonly position: readonly [number, number, number];
  /** Semi-axes (1, 1, 1 for a unit sphere). */
  readonly axes: readonly [number, number, number];
}

/** −1 (left edge) to 1 (right edge) from the pointer's x (R8.8 `pan`). */
export function panFromX(clientX: number, rect: RectLike): number {
  if (!(rect.width > 0)) return 0;
  return clamp(((clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
}

function applyMat4(m: ArrayLike<number>, x: number, y: number, z: number, out: Vec3): Vec3 {
  const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  const iw = w !== 0 ? 1 / w : 1;
  out[0] = (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) * iw;
  out[1] = (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) * iw;
  out[2] = (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) * iw;
  return out;
}

/**
 * World-space ray through a pointer, as three.js `Raycaster.setFromCamera` does for a perspective
 * camera: origin = camera position, direction towards the point unprojected at NDC z = 0.5 (valid
 * for both WebGL and WebGPU depth conventions).
 */
export function pointerRay(
  clientX: number,
  clientY: number,
  rect: RectLike,
  camera: CameraLike,
  origin: Vec3,
  dir: Vec3,
): void {
  const ndcX = rect.width > 0 ? ((clientX - rect.left) / rect.width) * 2 - 1 : 0;
  const ndcY = rect.height > 0 ? -(((clientY - rect.top) / rect.height) * 2 - 1) : 0;
  const mw = camera.matrixWorld.elements;
  origin[0] = mw[12]!;
  origin[1] = mw[13]!;
  origin[2] = mw[14]!;
  applyMat4(camera.projectionMatrixInverse.elements, ndcX, ndcY, 0.5, dir);
  applyMat4(mw, dir[0], dir[1], dir[2], dir);
  dir[0] -= origin[0];
  dir[1] -= origin[1];
  dir[2] -= origin[2];
  normalise(dir);
}

function normalise(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (l > 0) {
    v[0] /= l;
    v[1] /= l;
    v[2] /= l;
  }
  return v;
}

/**
 * Nearest t ≥ 0 where the ray (o, unit d) meets the ellipsoid, or NaN. Solved on the unit sphere
 * after dividing by the axes.
 */
export function intersectEllipsoid(
  o: readonly number[],
  d: readonly number[],
  centre: readonly number[],
  axes: readonly number[],
): number {
  const ox = (o[0]! - centre[0]!) / axes[0]!;
  const oy = (o[1]! - centre[1]!) / axes[1]!;
  const oz = (o[2]! - centre[2]!) / axes[2]!;
  const dx = d[0]! / axes[0]!;
  const dy = d[1]! / axes[1]!;
  const dz = d[2]! / axes[2]!;
  const a = dx * dx + dy * dy + dz * dz;
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - 1;
  const disc = b * b - a * c;
  if (!(a > 0) || disc < 0) return NaN;
  const sq = Math.sqrt(disc);
  const t0 = (-b - sq) / a;
  if (t0 >= 0) return t0;
  const t1 = (-b + sq) / a;
  return t1 >= 0 ? t1 : NaN;
}

export interface TouchProbeOptions {
  bodies: readonly ProbeBody[];
  /** World → probe frame for points (`BodyRenderer.worldToBody`). Default: identity. */
  toBody?: (p: readonly [number, number, number]) => readonly [number, number, number];
  /** Fill `ringRadius` (gas giants with rings): the ray's crossing of the plane y = 0. */
  rings?: boolean;
}

/** Fills a reused `TouchSample` from a pointer or a ray. */
export class TouchProbe {
  private readonly wo: Vec3 = [0, 0, 0];
  private readonly wd: Vec3 = [0, 0, 1];
  private readonly tmp: Vec3 = [0, 0, 0];

  constructor(private readonly opts: TouchProbeOptions) {}

  /** From a pointer event's client position, the canvas rect and the camera. */
  fromPointer(
    clientX: number,
    clientY: number,
    rect: RectLike,
    camera: CameraLike,
    timeMs: number,
    out: TouchSample,
  ): TouchSample {
    pointerRay(clientX, clientY, rect, camera, this.wo, this.wd);
    return this.fromWorldRay(
      this.wo,
      this.wd,
      clientX,
      clientY,
      panFromX(clientX, rect),
      timeMs,
      out,
    );
  }

  /** From a world-space ray (origin, unit direction). */
  fromWorldRay(
    origin: readonly number[],
    dir: readonly number[],
    xPx: number,
    yPx: number,
    pan: number,
    timeMs: number,
    out: TouchSample,
  ): TouchSample {
    const o = out.rayOrigin;
    const d = out.rayDir;
    const toBody = this.opts.toBody;
    if (toBody) {
      const a = toBody([origin[0]!, origin[1]!, origin[2]!]);
      const b = toBody([origin[0]! + dir[0]!, origin[1]! + dir[1]!, origin[2]! + dir[2]!]);
      o[0] = a[0];
      o[1] = a[1];
      o[2] = a[2];
      d[0] = b[0] - a[0];
      d[1] = b[1] - a[1];
      d[2] = b[2] - a[2];
    } else {
      o[0] = origin[0]!;
      o[1] = origin[1]!;
      o[2] = origin[2]!;
      d[0] = dir[0]!;
      d[1] = dir[1]!;
      d[2] = dir[2]!;
    }
    normalise(d);
    return this.fromProbeRay(xPx, yPx, pan, timeMs, out);
  }

  /** `out.rayOrigin` and `out.rayDir` are already in the probe frame (unit direction). */
  fromProbeRay(
    xPx: number,
    yPx: number,
    pan: number,
    timeMs: number,
    out: TouchSample,
  ): TouchSample {
    const o = out.rayOrigin;
    const d = out.rayDir;
    out.timeMs = timeMs;
    out.xPx = xPx;
    out.yPx = yPx;
    out.pan = pan;

    // Projected distance from the frame origin to the ray: |o × d|.
    const cx = o[1] * d[2] - o[2] * d[1];
    const cy = o[2] * d[0] - o[0] * d[2];
    const cz = o[0] * d[1] - o[1] * d[0];
    out.centreDistance = Math.hypot(cx, cy, cz);

    let bestT = Infinity;
    let best: ProbeBody | null = null;
    for (const b of this.opts.bodies) {
      const t = intersectEllipsoid(o, d, b.position, b.axes);
      if (t < bestT) {
        bestT = t;
        best = b;
      }
    }

    out.ringRadius = NaN;
    if (this.opts.rings && d[1] !== 0) {
      const t = -o[1] / d[1];
      if (t >= 0 && t < bestT) out.ringRadius = Math.hypot(o[0] + t * d[0], o[2] + t * d[2]);
    }

    if (!best) {
      out.bodyId = null;
      return out;
    }
    out.bodyId = best.id;
    const p = this.tmp;
    const ax = best.axes;
    // Point on the unit sphere the texture is wrapped on, and the ellipsoid's normal there.
    p[0] = (o[0] + bestT * d[0] - best.position[0]) / ax[0];
    p[1] = (o[1] + bestT * d[1] - best.position[1]) / ax[1];
    p[2] = (o[2] + bestT * d[2] - best.position[2]) / ax[2];
    normalise(p);
    out.dir[0] = p[0];
    out.dir[1] = p[1];
    out.dir[2] = p[2];
    out.normal[0] = p[0] / ax[0];
    out.normal[1] = p[1] / ax[1];
    out.normal[2] = p[2] / ax[2];
    normalise(out.normal);
    const uv = directionToUV(p);
    out.u = uv.u;
    out.v = uv.v;
    return out;
  }
}
