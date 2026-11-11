// Issue #71 stream H (D-36, Q-270): the camera and place maths of the "Surface view" (orbit view).
// A port of the prototype's `flyCamera`, `flyMove`, `flyAimDefault`, `flyAimPeak`, `altRange`,
// `altToS` and `sToAlt`, as pure functions with no GPU and no DOM, so they can be tested.
//
// Frame: the body frame. A place is (lon, lat) with up = (cos lat cos lon, sin lat, cos lat sin lon),
// the same convention as the world UV of the rocky and gas renderers (u = atan2(z, x) / 2pi + 0.5,
// v = asin(y) / pi + 0.5). The camera sits at up * r, r in planet radii, and looks along a heading
// (0 = north, positive = east) with a pitch measured from the horizon DIP: pitch 0 looks at the
// true horizon, whatever the height, so the horizon stays put while the height changes.
//
// Every number here is a display or camera choice (`artistic`); none is a measurement.

export type Vec3 = [number, number, number];

const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));

export const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const nrm3 = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const scale3 = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Heights are drawn exaggerated so relief and clouds read from the ground (artistic, D-36). */
export const HEIGHT_EXAGGERATION = { rocky: 3, gas: 2 } as const;
/** Altitude ranges, km above the ground (rocky) or above the cloud deck (gas), prototype `altRange`. */
export const ALT_RANGE_KM = { rocky: [0.3, 3000], gas: [50, 80000] } as const;
/** The altitude the view opens at, km. */
export const ENTRY_ALT_KM = { rocky: 400, gas: 6000 } as const;
export const FOV = 0.62;
export const PITCH_MIN = -1.2;
export const PITCH_MAX = 0.6;
/** Radians of heading per pixel dragged, and of pitch per pixel (prototype). */
export const DRAG_YAW = 0.005;
export const DRAG_PITCH = 0.004;
/** Radians of heading per arrow-key press. */
export const KEY_TURN = 0.08;
/** Wheel: altitude *= exp(deltaY * WHEEL_RATE). */
export const WHEEL_RATE = 0.0015;
export const SLIDER_MAX = 1000;

export type OrbitKind = 'rocky' | 'gas';

export interface FlyState {
  lon: number;
  lat: number;
  /** Heading from north toward east, radians. */
  head: number;
  /** Pitch above the horizon dip, radians. */
  pitch: number;
  /** Height above the ground (rocky) or the cloud deck (gas), km. */
  altKm: number;
}

export interface FlyCamera {
  /** Camera position, planet radii, body frame. */
  cam: Vec3;
  fwd: Vec3;
  right: Vec3;
  up: Vec3;
  /** Heading direction in the local horizontal plane. */
  heading: Vec3;
  /** Local "up" at the camera (unit). */
  localUp: Vec3;
  /** Distance from the planet centre, planet radii. */
  r: number;
}

export function altRange(kind: OrbitKind): readonly [number, number] {
  return ALT_RANGE_KM[kind];
}

/** Log slider 0..1000 from an altitude (rounded, as the prototype). */
export function altToSlider(kind: OrbitKind, altKm: number): number {
  const [lo, hi] = altRange(kind);
  return Math.round((Math.log(clamp(altKm, lo, hi) / lo) / Math.log(hi / lo)) * SLIDER_MAX);
}

export function sliderToAlt(kind: OrbitKind, v: number): number {
  const [lo, hi] = altRange(kind);
  return lo * Math.pow(hi / lo, clamp(v, 0, SLIDER_MAX) / SLIDER_MAX);
}

export function clampAlt(kind: OrbitKind, altKm: number): number {
  const [lo, hi] = altRange(kind);
  return clamp(altKm, lo, hi);
}

/** The scroll wheel: a multiplicative step, so it feels the same at every height. */
export function wheelAlt(kind: OrbitKind, altKm: number, deltaY: number): number {
  return clampAlt(kind, altKm * Math.exp(deltaY * WHEEL_RATE));
}

export function upOf(lon: number, lat: number): Vec3 {
  return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
}

export function eastNorth(up: Vec3): { east: Vec3; north: Vec3 } {
  const east = nrm3(cross3([0, 1, 0], up));
  return { east, north: cross3(up, east) };
}

export function latLonOf(dir: Vec3): { lon: number; lat: number } {
  return { lon: Math.atan2(dir[2], dir[0]), lat: Math.asin(clamp(dir[1], -1, 1)) };
}

/** Where the horizon is below the level: a camera r radii out sees it acos(1 / r) below horizontal. */
export function horizonDip(r: number): number {
  return Math.acos(Math.min(1 / r, 1));
}

/** Ground height at the camera, km (model units, before exaggeration); 0 when unknown. */
export type GroundFn = (lon: number, lat: number) => number;

export interface CameraBody {
  radiusKm: number;
  exaggeration: number;
  /** Height of the ground below (rocky) or 0 (gas). */
  groundKm: GroundFn;
}

export function flyCamera(s: FlyState, b: CameraBody): FlyCamera {
  const up = upOf(s.lon, s.lat);
  const { east, north } = eastNorth(up);
  const ch = Math.cos(s.head);
  const sh = Math.sin(s.head);
  const r = 1 + (b.groundKm(s.lon, s.lat) * b.exaggeration + s.altKm) / b.radiusKm;
  const pitch = s.pitch - horizonDip(r);
  const heading: Vec3 = [
    north[0] * ch + east[0] * sh,
    north[1] * ch + east[1] * sh,
    north[2] * ch + east[2] * sh,
  ];
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const fwd = nrm3(add3(scale3(heading, cp), scale3(up, sp)));
  const right = nrm3(cross3(fwd, up));
  const camUp = cross3(right, fwd);
  return { cam: scale3(up, r), fwd, right, up: camUp, heading, localUp: up, r };
}

/**
 * Moves along the heading by `dKm` (and `side` km to the right) over the sphere, keeping the
 * heading continuous. A great-circle step: the new up is the normalised sum of the old up and the
 * move, and the heading is carried across by projecting it onto the new tangent plane.
 */
export function flyMove(s: FlyState, dKm: number, side: number, radiusKm: number): FlyState {
  const up = upOf(s.lon, s.lat);
  const { east, north } = eastNorth(up);
  const heading: Vec3 = [
    north[0] * Math.cos(s.head) + east[0] * Math.sin(s.head),
    north[1] * Math.cos(s.head) + east[1] * Math.sin(s.head),
    north[2] * Math.cos(s.head) + east[2] * Math.sin(s.head),
  ];
  const rt = nrm3(cross3(heading, up));
  const mv = add3(scale3(heading, dKm), scale3(rt, side));
  const nu = nrm3(add3(up, scale3(mv, 1 / radiusKm)));
  const lat = Math.asin(clamp(nu[1], -0.999, 0.999));
  const lon = Math.atan2(nu[2], nu[0]);
  const { east: e2, north: n2 } = eastNorth(nu);
  const k = dot3(heading, nu);
  const old = nrm3(sub3(heading, scale3(nu, k)));
  const head = Math.atan2(dot3(old, e2), dot3(old, n2));
  return { ...s, lon, lat, head };
}

/** Keys of the surface view: what each does (also the plain-words help). */
export type FlyKeyAction =
  | { type: 'move'; km: number }
  | { type: 'turn'; rad: number }
  | { type: 'alt'; factor: number }
  | { type: 'pitch'; rad: number };

export function flyKeyAction(key: string, altKm: number): FlyKeyAction | null {
  const step = Math.max(2, altKm * 0.8);
  switch (key) {
    case 'ArrowUp':
    case 'w':
    case 'W':
      return { type: 'move', km: step };
    case 'ArrowDown':
    case 's':
    case 'S':
      return { type: 'move', km: -step };
    case 'ArrowLeft':
    case 'a':
    case 'A':
      return { type: 'turn', rad: -KEY_TURN };
    case 'ArrowRight':
    case 'd':
    case 'D':
      return { type: 'turn', rad: KEY_TURN };
    case 'PageUp':
      return { type: 'pitch', rad: 0.08 };
    case 'PageDown':
      return { type: 'pitch', rad: -0.08 };
    case '+':
    case '=':
      return { type: 'alt', factor: 1 / 1.25 };
    case '-':
    case '_':
      return { type: 'alt', factor: 1.25 };
    default:
      return null;
  }
}

export function applyFlyKey(s: FlyState, a: FlyKeyAction, kind: OrbitKind, radiusKm: number): FlyState {
  switch (a.type) {
    case 'move':
      return flyMove(s, a.km, 0, radiusKm);
    case 'turn':
      return { ...s, head: s.head + a.rad };
    case 'pitch':
      return { ...s, pitch: clamp(s.pitch + a.rad, PITCH_MIN, PITCH_MAX) };
    case 'alt':
      return { ...s, altKm: clampAlt(kind, s.altKm * a.factor) };
  }
}

/** Drag: heading follows x, pitch follows y (dragging down looks down). */
export function applyDrag(s: FlyState, dx: number, dy: number): FlyState {
  return {
    ...s,
    head: s.head + dx * DRAG_YAW,
    pitch: clamp(s.pitch - dy * DRAG_PITCH, PITCH_MIN, PITCH_MAX),
  };
}

/** "Fly forward": km per second at this height (prototype `max(alt * 0.4, 4)`). */
export function flyForwardSpeedKmS(altKm: number): number {
  return Math.max(altKm * 0.4, 4);
}

/** A grid of ground heights for picking a destination (model km, channel 0 of `stride`). */
export interface HeightGrid {
  width: number;
  height: number;
  data: Float32Array;
  /** Floats per texel; the height is channel 0. */
  stride: number;
}

/** Nearest-texel ground height, km; rows run south to north, columns west to east from lon -pi. */
export function groundKmFromGrid(g: HeightGrid | null, oceanClampsToZero: boolean): GroundFn {
  if (!g) return () => 0;
  return (lon, lat) => {
    let i = Math.floor((lon / TAU + 0.5) * g.width);
    const j = clamp(Math.floor((lat / Math.PI + 0.5) * g.height), 0, g.height - 1);
    i = ((i % g.width) + g.width) % g.width;
    const e = g.data[(j * g.width + i) * g.stride] ?? 0;
    return oceanClampsToZero ? Math.max(e, 0) : e;
  };
}

/** Sun direction in the body frame; the tests and the aiming use it as plain numbers. */
export type SunDir = Vec3;

/** The place with the highest land that has the Sun 25 to 60 degrees up, a minimum of 0.8 km high. */
export const PEAK_MIN_KM = 0.8;
export const PEAK_SUN_SIN: readonly [number, number] = [0.42, 0.87];

/**
 * Prototype `flyAimPeak`: from orbit, look at the highest sunlit land from about 1.4 heights back.
 * Null when there is no land high enough (an ocean world, or no height grid).
 */
export function aimAtPeak(g: HeightGrid | null, sun: SunDir, altKm: number, radiusKm: number): FlyState | null {
  if (!g) return null;
  let best = -1e9;
  let bi = 0;
  let bj = 0;
  for (let j = 2; j < g.height - 2; j += 2) {
    for (let i = 0; i < g.width; i += 2) {
      const la = ((j + 0.5) / g.height - 0.5) * Math.PI;
      const lo = ((i + 0.5) / g.width - 0.5) * TAU;
      const se = dot3(upOf(lo, la), sun);
      if (se < PEAK_SUN_SIN[0] || se > PEAK_SUN_SIN[1]) continue;
      const e = g.data[(j * g.width + i) * g.stride] ?? 0;
      if (e > best) {
        best = e;
        bi = lo;
        bj = la;
      }
    }
  }
  if (best < PEAK_MIN_KM) return null;
  const up = upOf(bi, bj);
  const { east, north } = eastNorth(up);
  const k = dot3(sun, up);
  const sh = sub3(sun, scale3(up, k));
  const head = Math.atan2(dot3(sh, east), dot3(sh, north)) + 2.2;
  const s: FlyState = { lon: bi, lat: bj, head, pitch: -0.3, altKm };
  return flyMove(s, -altKm * 1.4, 0, radiusKm);
}

/**
 * Prototype `flyAimDefault`: land where the Sun is about 35 degrees up (from orbit) or 15 degrees
 * up (near the ground, so relief casts long shadows), with the Sun ahead and to the right.
 * `viewDir` is the direction the globe faces the viewer, in the body frame (the prototype's +z).
 */
export function aimDefault(sun: SunDir, viewDir: Vec3, kind: OrbitKind, altKm: number): FlyState {
  const d = dot3(viewDir, sun);
  const u = nrm3(sub3(viewDir, scale3(sun, d)));
  const se = altKm > 50 ? 0.6 : 0.26;
  const n = nrm3(add3(scale3(sun, Math.sin(se)), scale3(u, Math.cos(se))));
  const { lon, lat } = latLonOf(n);
  const up = nrm3(n);
  const { east, north } = eastNorth(up);
  const k = dot3(sun, up);
  const sh = sub3(sun, scale3(up, k));
  const head = Math.atan2(dot3(sh, east), dot3(sh, north)) - 0.7;
  const pitch = altKm > 50 ? (kind === 'gas' ? -0.42 : -0.3) : -0.14;
  return { lon, lat, head, pitch, altKm };
}

// ---- picking a place on the globe -------------------------------------------------------------

/** First hit of a ray with the unit sphere at the origin (the near side), or null. */
export function raySphere(origin: Vec3, dir: Vec3, radius = 1): Vec3 | null {
  const b = dot3(origin, dir);
  const c = dot3(origin, origin) - radius * radius;
  const h = b * b - c;
  if (h < 0) return null;
  const t = -b - Math.sqrt(h);
  if (t < 0) return null;
  return add3(origin, scale3(dir, t));
}

/**
 * A ray in the scene (origin and direction) to the place it hits, using the body's inverse
 * rotation (a row-major 3x3, scene to body frame). The globe is the unit sphere at the origin.
 */
export function pickPlace(
  origin: Vec3,
  dir: Vec3,
  sceneToBody: readonly number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1],
): { lon: number; lat: number } | null {
  const hit = raySphere(origin, nrm3(dir));
  if (!hit) return null;
  const m = sceneToBody;
  const b = nrm3([
    m[0]! * hit[0] + m[1]! * hit[1] + m[2]! * hit[2],
    m[3]! * hit[0] + m[4]! * hit[1] + m[5]! * hit[2],
    m[6]! * hit[0] + m[7]! * hit[1] + m[8]! * hit[2],
  ]);
  return latLonOf(b);
}

/** Moves the view to a picked place, keeping the heading, pitch and height. */
export function goTo(s: FlyState, place: { lon: number; lat: number }): FlyState {
  return { ...s, lon: place.lon, lat: place.lat };
}
