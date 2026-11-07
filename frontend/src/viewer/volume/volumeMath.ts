// Issue #43: pure maths of the emission-only volume renderer (no three, no DOM). Everything here
// has a CPU mirror of what the shader does, so the shader's inputs can be tested without a GPU.
// Tags: the geometry of a measured outline is `derived`; every colour, density and the dust-tail
// bend is `artistic` (R7.7, D-12). Nothing here is a measured physical value.
import { TIERS, type TierName } from '../render/quality';
import { SLIDER_REGISTRY } from '../sliders';

export type Vec3 = [number, number, number];

// ---- steps and jitter --------------------------------------------------------------------------

/** Ray-march steps for a quality level (R5.7): the single table is `TIERS[..].volumeSteps`. */
export function volumeStepCount(tier: TierName): number {
  return TIERS[tier].volumeSteps;
}

/** Distance between two samples for a ray crossing `rayLength` of volume in `steps` steps. */
export function stepLength(rayLength: number, steps: number): number {
  return steps > 0 && rayLength > 0 ? rayLength / steps : 0;
}

/**
 * CPU mirror of three's `interleavedGradientNoise` (r187, nodes/utils/PostProcessingUtils.js):
 * `fract(52.9829189 * fract(dot(p, (0.06711056, 0.00583715))))`. In [0, 1). The shader offsets the
 * first sample of each ray by this fraction of one step, so banding becomes fine noise that TAAU
 * averages away. Deterministic: a function of the pixel only.
 */
export function interleavedGradientNoise(x: number, y: number): number {
  const fract = (v: number) => v - Math.floor(v);
  return fract(52.9829189 * fract(x * 0.06711056 + y * 0.00583715));
}

// ---- ray against the box that bounds a volume --------------------------------------------------

/**
 * Slab test of a ray against the box [-half, half] (the volume's local frame). Returns the entry
 * and exit distance along `dir` (not necessarily unit), or null for a miss or a box behind the
 * origin. `near` is clamped to 0, so a camera inside the box starts at the camera.
 */
export function rayBox(origin: Vec3, dir: Vec3, half: Vec3): { near: number; far: number } | null {
  let near = -Infinity;
  let far = Infinity;
  for (let i = 0; i < 3; i++) {
    const o = origin[i]!;
    const d = dir[i]!;
    const h = half[i]!;
    if (Math.abs(d) < 1e-12) {
      if (Math.abs(o) > h) return null;
      continue;
    }
    const t0 = (-h - o) / d;
    const t1 = (h - o) / d;
    near = Math.max(near, Math.min(t0, t1));
    far = Math.min(far, Math.max(t0, t1));
  }
  if (!(far > near) || far < 0) return null;
  return { near: Math.max(near, 0), far };
}

// ---- remnants (A7.5) ---------------------------------------------------------------------------

/** A7.5: radius grows as age^(2/5) in the Sedov phase. */
export const SEDOV_EXPONENT = 2 / 5;

/**
 * [verify] Transition times between free expansion, Sedov and radiative phases depend on E and n
 * and A7.5 gives no values ("Phases: To build"). Null: no phase name is computed or drawn, and
 * the whole age range is expanded with the Sedov law (the one A7.5 gives).
 */
export const REMNANT_PHASE_TRANSITIONS_YR: {
  freeToSedov: number;
  sedovToRadiative: number;
} | null = null;

/** Oldest age on the age slider (SLIDER_REGISTRY.age_yr.max): the remnant is full size there. */
export const REMNANT_SLIDER_MAX_AGE_YR: number = SLIDER_REGISTRY.age_yr.max;

/** Smallest radius fraction drawn, so a very young remnant is still a visible dot-free glow. */
export const REMNANT_MIN_FRACTION = 0.03;

/**
 * Radius at `ageYr` as a fraction of the radius at `refAgeYr`, `(t / t_ref)^(2/5)` (Sedov, A7.5),
 * clamped to [REMNANT_MIN_FRACTION, 1]. Null for a non-positive age or reference. The value is
 * `artistic` when the age is the visitor's slider value (Q-58, D-12); the formula travels with it.
 */
export function remnantRadiusFraction(ageYr: number, refAgeYr: number): number | null {
  if (!(ageYr > 0) || !(refAgeYr > 0) || !Number.isFinite(ageYr + refAgeYr)) return null;
  const f = Math.pow(ageYr / refAgeYr, SEDOV_EXPONENT);
  return Math.min(1, Math.max(REMNANT_MIN_FRACTION, f));
}

/** Phase name for an age, or null while the transition times are [verify]. */
export function remnantPhase(ageYr: number): 'free_expansion' | 'sedov' | 'radiative' | null {
  const t = REMNANT_PHASE_TRANSITIONS_YR;
  if (t === null || !(ageYr > 0)) return null;
  if (ageYr < t.freeToSedov) return 'free_expansion';
  return ageYr < t.sedovToRadiative ? 'sedov' : 'radiative';
}

/**
 * Outline semi-axes in scene units from the measured size (largest semi-axis `radius`) and the
 * measured axis ratio b/a in (0, 1]. ASSUMPTION: the line-of-sight axis equals the geometric mean
 * sqrt(a * b) (no field gives it). A missing or invalid ratio gives a circle (a = b = c).
 */
export function outlineAxes(radius: number, axisRatio: number | null): Vec3 {
  const a = radius;
  const q = axisRatio !== null && axisRatio > 0 && axisRatio <= 1 ? axisRatio : 1;
  return [a, a * q, a * Math.sqrt(q)];
}

// ---- comets (R7.3) -----------------------------------------------------------------------------

function unit(v: readonly number[]): Vec3 | null {
  const [x = 0, y = 0, z = 0] = v;
  const n = Math.hypot(x, y, z);
  return n > 0 && Number.isFinite(n) ? [x / n, y / n, z / n] : null;
}

/** Direction of the ion tail: straight, away from the Sun (anti-solar). Null for a zero vector. */
export function ionTailDirection(sunDir: readonly number[]): Vec3 | null {
  const s = unit(sunDir);
  return s ? [-s[0], -s[1], -s[2]] : null;
}

/** Fraction of the tail length by which the dust tail bends (artistic; a real bend needs the orbit). */
export const DUST_TAIL_BEND = 0.35;

function perpendicular(v: Vec3, axis: Vec3): Vec3 | null {
  const d = v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2];
  return unit([v[0] - d * axis[0], v[1] - d * axis[1], v[2] - d * axis[2]]);
}

/**
 * Centre line of the dust tail: a curve from the nucleus that leaves along the anti-solar
 * direction and bends toward `bendDir` (the trailing side of the orbit). ASSUMPTION: the card
 * holds no orbital velocity, so without `bendDir` the bend side is a display choice, and the
 * curve is `artistic`. `points` samples (>= 2) at t = i / (points - 1); `length` in scene units.
 */
export function dustTailCurve(
  sunDir: readonly number[],
  length: number,
  points: number,
  bendDir: readonly number[] | null = null,
): Vec3[] | null {
  const axis = ionTailDirection(sunDir);
  if (!axis || !(length > 0) || points < 2) return null;
  const given = bendDir ? unit(bendDir) : null;
  let side = given ? perpendicular(given, axis) : null;
  if (!side) {
    const helper: Vec3 = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    side = perpendicular(helper, axis)!;
  }
  const out: Vec3[] = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const along = t * length;
    const bend = DUST_TAIL_BEND * length * t * t;
    out.push([
      axis[0] * along + side[0] * bend,
      axis[1] * along + side[1] * bend,
      axis[2] * along + side[2] * bend,
    ]);
  }
  return out;
}

/** Coma density ~ 1/r^2 outside `inner`, 1 at `inner` (R7.3); r and inner in the same unit. */
export function comaDensity(r: number, inner: number): number {
  const rr = Math.max(r, inner);
  return rr > 0 ? (inner * inner) / (rr * rr) : 0;
}
