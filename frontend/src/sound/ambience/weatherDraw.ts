// §8.5 weather overlay geometry (issue #117): rain and snow particles, the streak lean, the drawn cloud deck, where a
// strike is on screen, and the bolt's seeded polyline. Pure: no canvas, no clocks; the overlay (ui/WeatherOverlay.tsx)
// paints what these return. Every value made here is presentation (`artistic`); whether it rains, the rate, v_t and
// the slant come from the WeatherVisualFrame (`model_dependent`).
import { hash32 } from './hash';
import { destination } from './place';
import type { Strike } from './types';
import { rng32 } from './weather';
import {
  BOLT_BRANCHES, BOLT_JITTER, BOLT_LEVELS, DECK_MIN_KM, NEAR_KM, RAIN_LAYER_SHARE, RAIN_LEAN_MAX_RAD, RAIN_NEAR_M,
  RAIN_PARALLAX, RAIN_STREAKS_MAX, SNOW_FLAKES_MAX, SNOW_SIZE_PX, SNOW_WOBBLE_PX, SNOW_WOBBLE_RAD_S, WCAG_REF_PX2,
  WCAG_SMALL_AREA_PX2,
} from './tuning';

type V3 = readonly [number, number, number];

/** The parts of WorldEngine.flyCameraBasis() the overlay uses (planet radii, body frame). */
export interface Basis {
  cam: V3; fwd: V3; rt: V3; up: V3; rkm: number; ex: number; fov: number;
}

/** The engine's own cloud-base height when the model has none (core.js uCloudKm default). */
export const ENGINE_DECK_DEFAULT_KM = 3.5;

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const lerp3 = (a: V3, b: V3, t: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t,
];
const fin = (...xs: number[]): boolean => xs.every(Number.isFinite);

/** Red M1: a 0..1 engine colour as CSS rgba (0..255, rounded, clamped). */
export function tintCss(rgb: readonly number[], a: number): string {
  const c = (v: number | undefined) => Math.max(0, Math.min(255, Math.round((Number.isFinite(v) ? (v as number) : 0) * 255)));
  const al = Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 0;
  return `rgba(${c(rgb[0])},${c(rgb[1])},${c(rgb[2])},${al.toFixed(3)})`;
}

/** H3: the radius (planet radii) at which the engine draws the cloud deck: 1 + max(zc, 0.3) * ex / rkm from the datum. */
export function deckRadius(zc_km: number | null, ex: number, rkm: number): number {
  const z = Math.max(zc_km ?? ENGINE_DECK_DEFAULT_KM, DECK_MIN_KM);
  return 1 + (z * ex) / rkm;
}

/** Focal length in pixels: fov is tan of half the vertical angle. */
export function focalPx(H: number, fov: number): number {
  return H / 2 / fov;
}

/**
 * §8.5 streak lean from screen vertical (rad, + = the bottom moves right): atan(U10 sin(phi_to - head) / v_t),
 * phi_to = the direction the wind blows TO. No wind direction: no lean (never guessed).
 */
export function rainLean(windDirDeg: number | null, U10: number, head: number, vt: number): number {
  if (windDirDeg === null || !fin(windDirDeg, U10, head, vt) || !(vt > 0)) return 0;
  const to = (windDirDeg * Math.PI) / 180 + Math.PI;
  const lean = Math.atan2(U10 * Math.sin(to - head), vt);
  return Math.max(-RAIN_LEAN_MAX_RAD, Math.min(RAIN_LEAN_MAX_RAD, lean));
}

/** §8.5 counts: share of the overlay's maximum, capped. */
export function particleCount(density: number, snow: boolean): number {
  const max = snow ? SNOW_FLAKES_MAX : RAIN_STREAKS_MAX;
  const d = Number.isFinite(density) ? Math.max(0, Math.min(1, density)) : 0;
  return Math.min(max, Math.round(max * d));
}

/** How many of N particles go to each layer (near, mid, far); the far layer takes the remainder. */
export function layerCounts(N: number): [number, number, number] {
  const a = Math.round(N * RAIN_LAYER_SHARE[0]);
  const b = Math.round(N * RAIN_LAYER_SHARE[1]);
  return [a, b, Math.max(0, N - a - b)];
}

/** Streak length on screen at a layer: v_t over 1/60 s at the layer depth (§8.5). */
export function streakLengthPx(vt: number, fpx: number, layer: number): number {
  const D = RAIN_NEAR_M / (RAIN_PARALLAX[layer] ?? 1);
  return (vt / 60) * (fpx / D);
}

/**
 * §8.5 rain: fills `out` with segments (x0, y0, x1, y1) in CSS px, layer by layer; returns the count per layer.
 * Placement is seeded per frame bucket (floor(t * 60)) and layer (red L2: hash32, no xor collisions).
 */
export function buildRain(
  out: Float32Array, N: number, seed: number, bucket: number, W: number, H: number, fpx: number, vt: number, lean: number,
): [number, number, number] {
  const counts = layerCounts(Math.min(N, out.length >> 2));
  const sx = Math.sin(lean), sy = Math.cos(lean);
  let o = 0;
  for (let L = 0; L < 3; L++) {
    const rng = rng32(hash32(seed >>> 0, 'rain', bucket >>> 0, L));
    const len = streakLengthPx(vt, fpx, L);
    const dx = sx * len, dy = sy * len;
    for (let i = 0; i < counts[L]!; i++) {
      const x = rng() * (W + 2 * Math.abs(dx)) - Math.abs(dx);
      const y = rng() * (H + len) - len;
      out[o++] = x; out[o++] = y; out[o++] = x + dx; out[o++] = y + dy;
    }
  }
  return counts;
}

/**
 * §8.5 snow: fills `out` with flakes (x, y, size) in CSS px. Flakes keep their identity (seeded once per layer) and
 * fall at v (m/s) at the layer depth with a seeded lateral wobble.
 */
export function buildSnow(
  out: Float32Array, N: number, seed: number, t: number, W: number, H: number, fpx: number, v: number,
): [number, number, number] {
  const counts = layerCounts(Math.min(N, Math.floor(out.length / 3)));
  let o = 0;
  for (let L = 0; L < 3; L++) {
    const rng = rng32(hash32(seed >>> 0, 'snow', L));
    const par = RAIN_PARALLAX[L]!;
    const D = RAIN_NEAR_M / par;
    const fall = (v * fpx) / (D * Math.max(H, 1));
    for (let i = 0; i < counts[L]!; i++) {
      const x0 = rng(), y0 = rng(), ph = rng() * 2 * Math.PI;
      const yy = y0 + fall * t;
      out[o++] = x0 * W + SNOW_WOBBLE_PX * par * Math.sin(SNOW_WOBBLE_RAD_S * t + ph);
      out[o++] = (yy - Math.floor(yy)) * H;
      out[o++] = SNOW_SIZE_PX[L]!;
    }
  }
  return counts;
}

/** Camera-space depth (radii) of a body-frame point. */
export function depthOf(b: Basis, p: V3): number {
  return dot(sub(p, b.cam), b.fwd);
}

/** H2: clip segment a-b to camera depth >= NEAR_KM; null when it is wholly behind. */
export function clipSegmentNear(b: Basis, a: V3, c: V3): [V3, V3] | null {
  const near = NEAR_KM / b.rkm;
  const da = depthOf(b, a), dc = depthOf(b, c);
  if (!fin(da, dc)) return null;
  if (da < near && dc < near) return null;
  if (da >= near && dc >= near) return [a, c];
  const t = (near - da) / (dc - da);
  const m = lerp3(a, c, t);
  return da < near ? [m, c] : [a, m];
}

/**
 * Pixels (CSS) of a body-frame point in a W x H pane: the inverse of the fly shader's ray (as WorldEngine.projectFly),
 * or null behind the near plane or not finite.
 */
export function projectPx(b: Basis, W: number, H: number, p: V3): [number, number] | null {
  const v = sub(p, b.cam);
  const a = dot(v, b.fwd);
  if (!(a >= NEAR_KM / b.rkm * (1 - 1e-9))) return null;
  const aspect = W / H;
  const x = dot(v, b.rt) / (a * b.fov * aspect);
  const y = dot(v, b.up) / (a * b.fov);
  const px = ((x + 1) / 2) * W, py = ((1 - y) / 2) * H;
  return fin(px, py) ? [px, py] : null;
}

export type StrikeClass = 'inView' | 'edge' | 'deck';

export interface StrikeWorld {
  /** Body-frame points of the bolt: on the drawn deck, and on the drawn ground. */
  top: V3; foot: V3; deck: V3;
  bearing: number;
}

/**
 * Where a strike is in the body frame. The ground distance comes from the slant distance and the listener height
 * (ASSUMPTION, red M2: fly.alt in km stands in for place z_km, which the bus does not carry). The foot sits on the drawn
 * surface (ex * groundKm), the top on the drawn deck (H3).
 */
export function strikeWorld(
  s: Strike, lon: number, lat: number, altKm: number, b: Basis, zc_km: number | null, groundKm: ((lon: number, lat: number) => number) | null,
): StrikeWorld | null {
  const z = Math.max(altKm, 0) * 1000;
  const s_km = Math.sqrt(Math.max(s.d_m * s.d_m - z * z, 0)) / 1000;
  const d = destination(lon, lat, s.bearing, s_km, b.rkm);
  const g = groundKm ? groundKm(d.lon, d.lat) : 0;
  const rFoot = 1 + (b.ex * (Number.isFinite(g) ? g : 0)) / b.rkm;
  const rDeck = Math.max(deckRadius(zc_km, b.ex, b.rkm), rFoot + (DECK_MIN_KM * b.ex) / b.rkm);
  const dir = d.dir;
  const at = (r: number): V3 => [dir[0] * r, dir[1] * r, dir[2] * r];
  if (!fin(dir[0], dir[1], dir[2], rFoot, rDeck)) return null;
  return { top: at(rDeck), foot: at(rFoot), deck: at(rDeck), bearing: s.bearing };
}

const inside = (p: [number, number] | null, W: number, H: number): boolean =>
  !!p && p[0] >= 0 && p[0] <= W && p[1] >= 0 && p[1] <= H;

/**
 * The class of a strike this frame: gas giants and a camera above the drawn deck see a glow in the deck (red M3, H3);
 * otherwise it is in view when any point of the (near-clipped) bolt lands in the pane, else an edge glow.
 */
export function classifyStrike(
  b: Basis, W: number, H: number, w: StrikeWorld, aboveDeck: boolean, gas: boolean,
): StrikeClass {
  if (gas || aboveDeck) return 'deck';
  const seg = clipSegmentNear(b, w.top, w.foot);
  if (!seg) return 'edge';
  for (let i = 0; i <= 4; i++) {
    if (inside(projectPx(b, W, H, lerp3(seg[0], seg[1], i / 4)), W, H)) return 'inView';
  }
  return 'edge';
}

/** The side of the screen for an edge glow: +1 right, -1 left. */
export function edgeSide(bearing: number, head: number): 1 | -1 {
  return Math.sin(bearing - head) >= 0 ? 1 : -1;
}

/**
 * Blue 17: a seeded 2D bolt from (ax, ay) down to (bx, by), in screen space: midpoint displacement (BOLT_LEVELS levels,
 * 2^L + 1 vertices) plus 1 to 2 branches of 5 vertices. Each polyline is a Float32Array of x, y pairs.
 */
export function boltPolyline(seed: number, ax: number, ay: number, bx: number, by: number): Float32Array[] {
  const rng = rng32(hash32(seed >>> 0, 'bolt'));
  const len = Math.hypot(bx - ax, by - ay);
  if (!fin(ax, ay, bx, by) || !(len > 0)) return [];
  const nx = -(by - ay) / len, ny = (bx - ax) / len;
  let pts: number[] = [ax, ay, bx, by];
  for (let L = 0; L < BOLT_LEVELS; L++) {
    const next: number[] = [];
    const amp = (BOLT_JITTER * len) / 2 ** L;
    for (let i = 0; i + 2 < pts.length; i += 2) {
      const x0 = pts[i]!, y0 = pts[i + 1]!, x1 = pts[i + 2]!, y1 = pts[i + 3]!;
      const o = (rng() * 2 - 1) * amp;
      next.push(x0, y0, (x0 + x1) / 2 + nx * o, (y0 + y1) / 2 + ny * o);
    }
    next.push(pts[pts.length - 2]!, pts[pts.length - 1]!);
    pts = next;
  }
  const lines = [new Float32Array(pts)];
  const nb = BOLT_BRANCHES[0] + Math.floor(rng() * (BOLT_BRANCHES[1] - BOLT_BRANCHES[0] + 1));
  const nv = pts.length / 2;
  for (let k = 0; k < nb; k++) {
    const i0 = 1 + Math.floor(rng() * Math.max(nv - 3, 1));
    let x = pts[2 * i0]!, y = pts[2 * i0 + 1]!;
    const side = rng() < 0.5 ? -1 : 1;
    const ang = side * (0.35 + rng() * 0.35);
    const ux = (bx - ax) / len, uy = (by - ay) / len;
    const dx = ux * Math.cos(ang) - uy * Math.sin(ang), dy = ux * Math.sin(ang) + uy * Math.cos(ang);
    const step = (len * (0.25 + rng() * 0.15)) / 4;
    const br = [x, y];
    for (let j = 0; j < 4; j++) {
      const o = (rng() * 2 - 1) * BOLT_JITTER * step * 2;
      x += dx * step + -dy * o;
      y += dy * step + dx * o;
      br.push(x, y);
    }
    lines.push(new Float32Array(br));
  }
  return lines;
}

/**
 * Red 3: clip a screen segment to the rectangle [-m, W + m] x [-m, H + m] (Liang-Barsky), so a near strike whose deck
 * point projects far above the pane keeps only the part that can be seen. Null when nothing is inside.
 */
export function clipToRect(
  ax: number, ay: number, bx: number, by: number, W: number, H: number, m: number,
): [number, number, number, number] | null {
  if (!fin(ax, ay, bx, by, W, H, m)) return null;
  const dx = bx - ax, dy = by - ay;
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [ax + m, W + m - ax, ay + m, H + m - ay];
  for (let i = 0; i < 4; i++) {
    const pi = p[i]!, qi = q[i]!;
    if (pi === 0) {
      if (qi < 0) return null;
    } else {
      const r = qi / pi;
      if (pi < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1];
}

/** Total length (px) of a set of polylines. */
export function polylineLength(lines: readonly Float32Array[]): number {
  let s = 0;
  for (const l of lines) for (let i = 0; i + 3 < l.length; i += 2) s += Math.hypot(l[i + 2]! - l[i]!, l[i + 3]! - l[i + 1]!);
  return s;
}

/** H4: the WCAG 2.3.1 small-area limit for a W x H pane (25% of a 10 degree field at 1024 x 768, scaled). */
export function smallAreaLimitPx2(W: number, H: number): number {
  return (WCAG_SMALL_AREA_PX2 * W * H) / WCAG_REF_PX2;
}
