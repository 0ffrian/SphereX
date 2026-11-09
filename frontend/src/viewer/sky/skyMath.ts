// Sky view maths (pure, no three.js, no DOM): ICRS RA/Dec <-> world direction, the camera of the
// inside-out sky sphere, pointer -> RA/Dec (analytic, no raycast), RA/Dec -> screen (markers),
// drag pan, zoom at the pointer, and the click-versus-drag rule. Unit-tested in skyMath.test.ts.
//
// Orientation (the "mirror"): the sky is seen from INSIDE the celestial sphere, as from Earth.
// With north up, east (increasing RA) is to the LEFT and west to the right. That follows from the
// frame below and is checked by the tests: a point a little left of the view centre has a larger
// RA than the centre.
//
// World frame (three.js, Y up): ICRS unit vector (x, y, z) = (cos δ cos α, cos δ sin α, sin δ) maps
// to world (x, z, −y). That is a proper rotation (−90° about x, determinant +1), so handedness is
// kept and nothing is mirrored by the frame itself.
//
// Camera: Euler order 'YXZ', yaw = α − 90°, pitch = δ, no roll. Its forward axis then points at
// (α, δ) and its up axis stays in the plane of the north pole, so north is always up on screen.
// three's PerspectiveCamera with `rotation.order = 'YXZ'` and `rotation.set(pitch, yaw, 0)` is the
// same camera (tested against r187 in skyMath.test.ts).

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface RaDec {
  /** Degrees, 0 ≤ ra < 360. */
  ra: number;
  /** Degrees, −90 … 90. */
  dec: number;
}

/** Where the camera looks: the view centre (ICRS, degrees) and the vertical field of view. */
export interface SkyCamera {
  ra: number;
  dec: number;
  /** Vertical field of view, degrees. */
  fovDeg: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
  /** False when the point is behind the camera. On-screen bounds are the caller's check. */
  inFront: boolean;
}

// ---- UI limits (display values, not physical ones) --------------------------------------------

/** Widest and narrowest vertical field of view, degrees. */
export const SKY_FOV_MAX_DEG = 120;
export const SKY_FOV_MIN_DEG = 2;
/** The view centre stays this far from the poles, so yaw stays defined. */
export const SKY_PITCH_LIMIT_DEG = 89.5;
/** A press that moves less than this (CSS px, largest distance from the start) is a click. */
export const CLICK_SLOP_PX = 5;
/** Arrow keys pan by this fraction of the field of view. */
export const KEY_PAN_FRACTION = 0.1;
/** +/− and the zoom buttons change the field of view by this factor. */
export const KEY_ZOOM_FACTOR = 1.25;
/** Wheel zoom: field of view × exp(deltaY × this). */
export const WHEEL_ZOOM_RATE = 0.0015;
/** Horizontal drag at high Dec: RA moves by dx / max(cos δ, this), so the pole does not spin. */
const MIN_COS_DEC = 0.2;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// ---- Angles ------------------------------------------------------------------------------------

/** RA into [0, 360). */
export function wrapRa(ra: number): number {
  const r = ra % 360;
  return r < 0 ? r + 360 : r === 360 ? 0 : r;
}

/** Signed difference a − b in (−180, 180]. */
export function deltaRa(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}

export function clampDec(dec: number, limit = SKY_PITCH_LIMIT_DEG): number {
  return Math.min(limit, Math.max(-limit, dec));
}

export function clampFov(fovDeg: number): number {
  return Math.min(SKY_FOV_MAX_DEG, Math.max(SKY_FOV_MIN_DEG, fovDeg));
}

/** Great-circle separation in degrees (haversine; stable for small angles). */
export function separationDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const p1 = dec1 * D2R;
  const p2 = dec2 * D2R;
  const dp = p2 - p1;
  const dl = (ra2 - ra1) * D2R;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * R2D;
}

// ---- Directions --------------------------------------------------------------------------------

/** World direction of (ra, dec) in the scene frame (see the header). Writes into `out`. */
export function raDecToWorld(
  raDeg: number,
  decDeg: number,
  out: Vec3 = { x: 0, y: 0, z: 0 },
): Vec3 {
  const a = raDeg * D2R;
  const d = decDeg * D2R;
  const c = Math.cos(d);
  out.x = c * Math.cos(a);
  out.y = Math.sin(d);
  out.z = -c * Math.sin(a);
  return out;
}

/** RA/Dec of a world direction (any length > 0). Writes into `out`. */
export function worldToRaDec(v: Vec3, out: RaDec = { ra: 0, dec: 0 }): RaDec {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  const sinDec = Math.max(-1, Math.min(1, v.y / len));
  out.dec = Math.asin(sinDec) * R2D;
  // ICRS x = world x, ICRS y = −world z.
  out.ra = wrapRa(Math.atan2(-v.z, v.x) * R2D);
  return out;
}

/** Camera Euler angles (radians) for three.js, order 'YXZ': rotation.set(pitch, yaw, 0). */
export function cameraEuler(cam: Pick<SkyCamera, 'ra' | 'dec'>): { yaw: number; pitch: number } {
  return { yaw: (cam.ra - 90) * D2R, pitch: cam.dec * D2R };
}

/** Camera axes in world space (right, up, forward), written into the given vectors. */
export interface CameraBasis {
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

export function newBasis(): CameraBasis {
  return { right: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: 0 } };
}

export function cameraBasis(
  cam: Pick<SkyCamera, 'ra' | 'dec'>,
  out: CameraBasis = newBasis(),
): CameraBasis {
  const t = (cam.ra - 90) * D2R;
  const p = cam.dec * D2R;
  const st = Math.sin(t);
  const ct = Math.cos(t);
  const sp = Math.sin(p);
  const cp = Math.cos(p);
  // R = Ry(yaw) · Rx(pitch) applied to the camera's local x, y and −z axes.
  out.right.x = ct;
  out.right.y = 0;
  out.right.z = -st;
  out.up.x = st * sp;
  out.up.y = cp;
  out.up.z = ct * sp;
  out.forward.x = -st * cp;
  out.forward.y = sp;
  out.forward.z = -ct * cp;
  return out;
}

// Scratch objects for the hot paths (pointer move, marker projection): no allocation per call.
const scratchBasis = newBasis();
const scratchDir: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * RA/Dec under a pointer at (px, py) CSS px in a view of width × height px (origin top-left),
 * from the camera ray. Writes into `out`.
 */
export function screenToRaDec(
  cam: SkyCamera,
  px: number,
  py: number,
  width: number,
  height: number,
  out: RaDec = { ra: 0, dec: 0 },
): RaDec {
  const b = cameraBasis(cam, scratchBasis);
  const t = Math.tan((cam.fovDeg * D2R) / 2);
  const aspect = width / Math.max(1, height);
  const nx = (px / Math.max(1, width)) * 2 - 1;
  const ny = 1 - (py / Math.max(1, height)) * 2;
  const sx = nx * t * aspect;
  const sy = ny * t;
  scratchDir.x = b.forward.x + b.right.x * sx + b.up.x * sy;
  scratchDir.y = b.forward.y + b.right.y * sx + b.up.y * sy;
  scratchDir.z = b.forward.z + b.right.z * sx + b.up.z * sy;
  return worldToRaDec(scratchDir, out);
}

/** Screen position (CSS px, origin top-left) of a world direction. Writes into `out`. */
export function worldToScreen(
  cam: SkyCamera,
  v: Vec3,
  width: number,
  height: number,
  out: ScreenPoint = { x: 0, y: 0, inFront: false },
): ScreenPoint {
  const b = cameraBasis(cam, scratchBasis);
  const cz = v.x * b.forward.x + v.y * b.forward.y + v.z * b.forward.z;
  out.inFront = cz > 1e-6;
  if (!out.inFront) {
    out.x = Number.NaN;
    out.y = Number.NaN;
    return out;
  }
  const cx = v.x * b.right.x + v.y * b.right.y + v.z * b.right.z;
  const cy = v.x * b.up.x + v.y * b.up.y + v.z * b.up.z;
  const t = Math.tan((cam.fovDeg * D2R) / 2);
  const aspect = width / Math.max(1, height);
  const nx = cx / (cz * t * aspect);
  const ny = cy / (cz * t);
  out.x = ((nx + 1) / 2) * width;
  out.y = ((1 - ny) / 2) * height;
  return out;
}

export function raDecToScreen(
  cam: SkyCamera,
  ra: number,
  dec: number,
  width: number,
  height: number,
  out?: ScreenPoint,
): ScreenPoint {
  return worldToScreen(cam, raDecToWorld(ra, dec, scratchDir), width, height, out);
}

// ---- Interaction -------------------------------------------------------------------------------

/**
 * Drag pan: the sky follows the pointer. Dragging right brings what was left of the centre (higher
 * RA, east) to the centre; dragging down brings what was above (higher Dec).
 */
export function panByPixels(cam: SkyCamera, dx: number, dy: number, heightPx: number): SkyCamera {
  const degPerPx = cam.fovDeg / Math.max(1, heightPx);
  const cosDec = Math.max(MIN_COS_DEC, Math.cos(cam.dec * D2R));
  return {
    ra: wrapRa(cam.ra + (dx * degPerPx) / cosDec),
    dec: clampDec(cam.dec + dy * degPerPx),
    fovDeg: cam.fovDeg,
  };
}

/** Pan by a fraction of the field of view (keyboard). `dx` > 0 looks left (east, higher RA). */
export function panByFraction(cam: SkyCamera, dx: number, dy: number): SkyCamera {
  const cosDec = Math.max(MIN_COS_DEC, Math.cos(cam.dec * D2R));
  return {
    ra: wrapRa(cam.ra + (dx * cam.fovDeg) / cosDec),
    dec: clampDec(cam.dec + dy * cam.fovDeg),
    fovDeg: cam.fovDeg,
  };
}

/**
 * Zoom by `factor` (< 1 zooms in) keeping the sky under the pointer (px, py) roughly in place.
 * Without a pointer, zooms about the centre.
 */
export function zoomAt(
  cam: SkyCamera,
  factor: number,
  width: number,
  height: number,
  px?: number,
  py?: number,
): SkyCamera {
  const fovDeg = clampFov(cam.fovDeg * factor);
  if (px === undefined || py === undefined || fovDeg === cam.fovDeg) {
    return { ra: cam.ra, dec: cam.dec, fovDeg };
  }
  const before = screenToRaDec(cam, px, py, width, height);
  const next: SkyCamera = { ra: cam.ra, dec: cam.dec, fovDeg };
  const after = screenToRaDec(next, px, py, width, height);
  next.ra = wrapRa(next.ra + deltaRa(before.ra, after.ra));
  next.dec = clampDec(next.dec + (before.dec - after.dec));
  return next;
}

/** A press is a click (pick a position) when the pointer never moved more than the slop. */
export function isClick(maxMovePx: number, slopPx: number = CLICK_SLOP_PX): boolean {
  return maxMovePx < slopPx;
}

/** Eased step between two views for a short fly-to (t in 0…1), shortest way round in RA. */
export function interpolateView(from: SkyCamera, to: SkyCamera, t: number): SkyCamera {
  const e = t <= 0 ? 0 : t >= 1 ? 1 : 1 - (1 - t) ** 3;
  return {
    ra: wrapRa(from.ra + deltaRa(to.ra, from.ra) * e),
    dec: clampDec(from.dec + (to.dec - from.dec) * e),
    fovDeg: clampFov(from.fovDeg + (to.fovDeg - from.fovDeg) * e),
  };
}

// ---- Text ---------------------------------------------------------------------------------------

/**
 * The search text for a picked position: "ra,dec" in decimal degrees with 6 decimals, the same
 * form parseQuery produces. RA rounding to 360 wraps to 0.
 */
export function pickQuery(ra: number, dec: number): string {
  let r = Number(wrapRa(ra).toFixed(6));
  if (r >= 360) r = 0;
  const d = Math.max(-90, Math.min(90, Number(dec.toFixed(6))));
  return `${r.toFixed(6)},${d.toFixed(6)}`;
}

/** "RA 266.4050°", "Dec −28.9362°" (4 decimals, Unicode minus). */
export function formatReadout(ra: number, dec: number): { ra: string; dec: string } {
  const sign = dec < 0 ? '−' : '+';
  return { ra: `${wrapRa(ra).toFixed(4)}°`, dec: `${sign}${Math.abs(dec).toFixed(4)}°` };
}

export function formatFov(fovDeg: number): string {
  return fovDeg >= 10 ? `${fovDeg.toFixed(0)}°` : `${fovDeg.toFixed(1)}°`;
}
