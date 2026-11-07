// Issue #43: volume maths (steps per tier, jitter, ray box, remnant age -> radius, tail geometry).
import { describe, expect, it } from 'vitest';
import { TIER_ORDER, TIERS } from '../render/quality';
import {
  comaDensity,
  DUST_TAIL_BEND,
  dustTailCurve,
  interleavedGradientNoise,
  ionTailDirection,
  outlineAxes,
  rayBox,
  REMNANT_MIN_FRACTION,
  REMNANT_PHASE_TRANSITIONS_YR,
  REMNANT_SLIDER_MAX_AGE_YR,
  remnantPhase,
  remnantRadiusFraction,
  SEDOV_EXPONENT,
  stepLength,
  volumeStepCount,
  type Vec3,
} from './volumeMath';

const len = (v: readonly number[]) => Math.hypot(...v);
const dot = (a: readonly number[], b: readonly number[]) =>
  a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

describe('steps by quality tier (R5.7)', () => {
  it('follows the single tier table, and falls with the tier', () => {
    expect(TIER_ORDER.map(volumeStepCount)).toEqual([96, 64, 40]);
    for (const t of TIER_ORDER) expect(volumeStepCount(t)).toBe(TIERS[t].volumeSteps);
    expect(volumeStepCount('high')).toBeGreaterThan(volumeStepCount('medium'));
    expect(volumeStepCount('medium')).toBeGreaterThan(volumeStepCount('low'));
  });

  it('spreads the ray over the steps, and is 0 for no ray', () => {
    expect(stepLength(2, 40)).toBeCloseTo(0.05, 12);
    expect(stepLength(0, 40)).toBe(0);
    expect(stepLength(-1, 40)).toBe(0);
    expect(stepLength(2, 0)).toBe(0);
  });
});

describe('interleaved gradient noise jitter', () => {
  it('stays in [0, 1) and is a pure function of the pixel', () => {
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        const v = interleavedGradientNoise(x + 0.5, y + 0.5);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
        expect(interleavedGradientNoise(x + 0.5, y + 0.5)).toBe(v);
      }
    }
  });

  it('matches the formula of three r187 at a known pixel', () => {
    const fract = (v: number) => v - Math.floor(v);
    expect(interleavedGradientNoise(10, 20)).toBeCloseTo(
      fract(52.9829189 * fract(10 * 0.06711056 + 20 * 0.00583715)),
      12,
    );
  });

  it('spreads over the interval (no banding): the mean is near one half', () => {
    let sum = 0;
    let n = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        sum += interleavedGradientNoise(x, y);
        n++;
      }
    }
    expect(sum / n).toBeGreaterThan(0.4);
    expect(sum / n).toBeLessThan(0.6);
  });
});

describe('ray against the volume box', () => {
  const half: Vec3 = [1, 1, 1];

  it('enters and leaves a box on the axis', () => {
    expect(rayBox([0, 0, -5], [0, 0, 1], half)).toEqual({ near: 4, far: 6 });
  });

  it('starts at the camera when the camera is inside', () => {
    expect(rayBox([0, 0, 0], [0, 0, 1], half)).toEqual({ near: 0, far: 1 });
  });

  it('misses a box behind the ray and one beside it', () => {
    expect(rayBox([0, 0, 5], [0, 0, 1], half)).toBeNull();
    expect(rayBox([3, 0, -5], [0, 0, 1], half)).toBeNull();
  });

  it('scales with the half-extent (an elliptical outline)', () => {
    expect(rayBox([0, -5, 0], [0, 1, 0], [1, 0.5, 1])).toEqual({ near: 4.5, far: 5.5 });
  });
});

describe('remnant age to radius (A7.5)', () => {
  it('is the Sedov law (t / t_ref)^(2/5)', () => {
    expect(SEDOV_EXPONENT).toBe(0.4);
    expect(remnantRadiusFraction(1e4, 1e5)).toBeCloseTo(Math.pow(0.1, 0.4), 12);
    expect(remnantRadiusFraction(5e4, 1e5)).toBeCloseTo(Math.pow(0.5, 0.4), 12);
  });

  it('is 1 at the reference age, grows with age and is clamped', () => {
    expect(remnantRadiusFraction(1e5, 1e5)).toBe(1);
    expect(remnantRadiusFraction(2e5, 1e5)).toBe(1);
    expect(remnantRadiusFraction(1, 1e5)).toBe(REMNANT_MIN_FRACTION);
    const a = remnantRadiusFraction(1e3, REMNANT_SLIDER_MAX_AGE_YR)!;
    const b = remnantRadiusFraction(1e4, REMNANT_SLIDER_MAX_AGE_YR)!;
    expect(b).toBeGreaterThan(a);
  });

  it('refuses a bad age or reference', () => {
    expect(remnantRadiusFraction(0, 1e5)).toBeNull();
    expect(remnantRadiusFraction(-5, 1e5)).toBeNull();
    expect(remnantRadiusFraction(10, 0)).toBeNull();
    expect(remnantRadiusFraction(NaN, 1e5)).toBeNull();
    expect(remnantRadiusFraction(Infinity, 1e5)).toBeNull();
  });

  it('names no phase while the transition times are [verify] (null)', () => {
    expect(REMNANT_PHASE_TRANSITIONS_YR).toBeNull();
    expect(remnantPhase(1000)).toBeNull();
  });
});

describe('outline from size and axis ratio', () => {
  it('a missing or invalid ratio is a circle', () => {
    expect(outlineAxes(2, null)).toEqual([2, 2, 2]);
    expect(outlineAxes(2, 0)).toEqual([2, 2, 2]);
    expect(outlineAxes(2, 1.5)).toEqual([2, 2, 2]);
  });

  it('keeps the largest axis and applies b/a; the depth is sqrt(a b)', () => {
    const [a, b, c] = outlineAxes(2, 0.5);
    expect(a).toBe(2);
    expect(b).toBe(1);
    expect(c).toBeCloseTo(Math.sqrt(2), 12);
  });
});

describe('comet tails (R7.3)', () => {
  it('the ion tail is straight and points away from the Sun', () => {
    const sun: Vec3 = [0.6, 0, 0.8];
    const dir = ionTailDirection(sun)!;
    expect(len(dir)).toBeCloseTo(1, 12);
    expect(dot(dir, sun)).toBeCloseTo(-1, 12);
  });

  it('normalises a non-unit Sun vector and refuses a zero one', () => {
    expect(ionTailDirection([0, 0, 5])).toEqual([-0, -0, -1]);
    expect(ionTailDirection([0, 0, 0])).toBeNull();
    expect(ionTailDirection([NaN, 0, 0])).toBeNull();
  });

  it('the dust tail starts at the nucleus, ends the tail length out and curves sideways', () => {
    const sun: Vec3 = [0, 0, 1];
    const pts = dustTailCurve(sun, 2, 11)!;
    expect(pts).toHaveLength(11);
    expect(pts[0]).toEqual([0, 0, 0]);
    const axis = ionTailDirection(sun)!;
    // Along-axis distance is the tail length at the end.
    expect(dot(pts[10]!, axis)).toBeCloseTo(2, 12);
    // The bend at the end is DUST_TAIL_BEND * length, perpendicular to the axis.
    const end = pts[10]!;
    const side = [end[0] - axis[0] * 2, end[1] - axis[1] * 2, end[2] - axis[2] * 2];
    expect(len(side)).toBeCloseTo(DUST_TAIL_BEND * 2, 12);
    expect(dot(side, axis)).toBeCloseTo(0, 12);
  });

  it('the bend grows with the square of the distance (a curve, not a line)', () => {
    const pts = dustTailCurve([1, 0, 0], 4, 5)!;
    const axis = ionTailDirection([1, 0, 0])!;
    const off = (p: Vec3) => {
      const along = dot(p, axis);
      return len([p[0] - axis[0] * along, p[1] - axis[1] * along, p[2] - axis[2] * along]);
    };
    expect(off(pts[2]!)).toBeCloseTo(off(pts[4]!) / 4, 12);
  });

  it('bends toward the given side (the trailing side of the orbit), perpendicular part only', () => {
    const pts = dustTailCurve([0, 0, 1], 2, 3, [1, 0, 0.7])!;
    const end = pts[2]!;
    expect(end[0]).toBeGreaterThan(0);
    expect(end[1]).toBeCloseTo(0, 12);
  });

  it('refuses a zero Sun vector, no length or too few points', () => {
    expect(dustTailCurve([0, 0, 0], 2, 5)).toBeNull();
    expect(dustTailCurve([0, 0, 1], 0, 5)).toBeNull();
    expect(dustTailCurve([0, 0, 1], 2, 1)).toBeNull();
  });

  it('the coma density falls as 1/r^2', () => {
    expect(comaDensity(0.5, 0.05)).toBeCloseTo(0.01, 12);
    expect(comaDensity(1, 0.05) / comaDensity(0.5, 0.05)).toBeCloseTo(0.25, 12);
    expect(comaDensity(0, 0.05)).toBe(1);
  });
});
