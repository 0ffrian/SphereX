// Issue #43: pure builders of `VolumePlan` for nebulae, supernova remnants (A7.5) and comets
// (R7.3). No three, no DOM. Colours are display colours of the named emission lines (artistic):
// H-alpha red and [O III] teal (A7.5 "Colour: hydrogen red, oxygen teal"), a blue-white synchrotron
// core, and the false colours of the comet gases (R7.3 legend). Sizes of tails are display values,
// not to scale.
import type { Tag } from '@/contract';
import type { DustPlan, Rgb, ShellPlan, Vec3, VolumePlan } from '../planTypes';
import {
  DUST_TAIL_BEND,
  dustTailCurve,
  ionTailDirection,
  outlineAxes,
  remnantRadiusFraction,
  REMNANT_SLIDER_MAX_AGE_YR,
} from './volumeMath';

/** H-alpha 656.3 nm, shown red (artistic display colour, linear sRGB). */
export const H_ALPHA_RGB: Rgb = [0.85, 0.1, 0.06];
/** [O III] 500.7 nm, shown teal (artistic display colour, linear sRGB). */
export const OIII_RGB: Rgb = [0.05, 0.6, 0.5];
/** Synchrotron core glow: smooth blue-white (artistic). */
export const SYNCHROTRON_RGB: Rgb = [0.3, 0.45, 0.8];

/** Tail length in coma radii (display value: real tails are far longer than the coma). */
export const TAIL_LENGTH_COMA_RADII = 2.5;
/** Half-width of the ion tail as a fraction of its length (display value). */
const ION_HALF_WIDTH = 0.05;
/** The shader keeps the bent dust centre line inside the box: bend <= this fraction of half-height. */
const DUST_BEND_LOCAL = 0.7;

export function nebulaVolume(seed: number): VolumePlan {
  // Unit scale: the body frame (ShaderBody's group) carries the scene scale, as for the points.
  return {
    id: 'nebula',
    kind: 'nebula',
    tag: 'artistic',
    halfExtent: [1, 0.8, 1],
    center: [0, 0, 0],
    axis: null,
    bend: null,
    bendFraction: 0,
    seed,
    emitters: [
      { label: 'H-alpha', rgb: H_ALPHA_RGB, gain: 0.9 },
      { label: '[O III]', rgb: OIII_RGB, gain: 0.8 },
    ],
    dust: 0.6,
    shell: 0,
  };
}

export interface RemnantInput {
  seed: number;
  /** Age from the age slider (A7.5), or null when the visitor has not set one. */
  ageYr: number | null;
  /** Measured axis ratio b/a in (0, 1], or null (circle). No card field holds it today. */
  axisRatio: number | null;
}

/**
 * Shell radius as a fraction of the box half-size for an age slider value: the Sedov law
 * `(t / t_max)^(2/5)` relative to the oldest age on the slider (A7.5; artistic, a visitor's value,
 * D-12). Without an age the shell is at its full size.
 */
export function remnantShell(ageYr: number | null): number {
  const fraction =
    ageYr === null ? 1 : (remnantRadiusFraction(ageYr, REMNANT_SLIDER_MAX_AGE_YR) ?? 1);
  // The box leaves 10% around the full shell.
  return 0.9 * fraction;
}

/**
 * A supernova remnant: smooth core glow, thin line-emitting filaments on a shell, dust lanes. The
 * box is the outline: the measured size (the body frame scales it) and the axis ratio when known.
 */
export function remnantVolume(input: RemnantInput): VolumePlan {
  const axes = outlineAxes(1, input.axisRatio);
  return {
    id: 'remnant',
    kind: 'remnant',
    tag: 'artistic',
    halfExtent: axes,
    center: [0, 0, 0],
    axis: null,
    bend: null,
    bendFraction: 0,
    seed: input.seed,
    emitters: [
      { label: 'H-alpha', rgb: H_ALPHA_RGB, gain: 0.9 },
      { label: '[O III]', rgb: OIII_RGB, gain: 0.8 },
      { label: 'Synchrotron', rgb: SYNCHROTRON_RGB, gain: 0.9 },
    ],
    dust: 0.7,
    // Shell radius as a fraction of the box half-size.
    shell: remnantShell(input.ageYr),
  };
}

/** Largest gas shell outer radius is 1 (coma radius). Returns null with no gas to show. */
export function comaVolume(
  shells: readonly ShellPlan[],
  tag: Tag,
  seed: number,
): VolumePlan | null {
  if (shells.length === 0) return null;
  const emitters = shells.slice(0, 3).map((s) => ({
    label: s.label,
    rgb: cssToLinear(s.css),
    gain: s.brightness,
  }));
  return {
    id: 'coma',
    kind: 'coma',
    tag,
    halfExtent: [1, 1, 1],
    center: [0, 0, 0],
    axis: null,
    bend: null,
    bendFraction: 0,
    seed,
    emitters,
    dust: 0,
    shell: 0,
  };
}

/**
 * The Sun-pointing December dust (R7.3): a pear-shaped cone along `dust.direction`. `tag` is the
 * backend `dust` layer's own tag, not a default.
 */
export function dustConeVolume(dust: DustPlan, tag: Tag): VolumePlan {
  const length = 0.9;
  const [x, y, z] = dust.direction;
  const n = Math.hypot(x, y, z) || 1;
  const axis: Vec3 = [x / n, y / n, z / n];
  return {
    id: 'dust',
    kind: 'dust',
    tag,
    halfExtent: [length / 2, 0.9, 0.9],
    center: [(axis[0] * length) / 2, (axis[1] * length) / 2, (axis[2] * length) / 2],
    axis,
    bend: null,
    bendFraction: 0,
    seed: dust.seed,
    emitters: [{ label: 'Dust', rgb: dust.tint, gain: 0.5 }],
    dust: 0,
    shell: 0,
  };
}

const ION_BLUE: Rgb = [0.25, 0.5, 1.0];
const DUST_WARM: Rgb = [0.9, 0.8, 0.6];

/**
 * Straight ion tail away from the Sun. Tag `derived`: the direction is `-sun_vector` (formula),
 * the length and width are display values. Null for a zero Sun vector.
 */
export function ionTailVolume(sunDir: readonly number[], seed: number): VolumePlan | null {
  const axis = ionTailDirection(sunDir);
  if (!axis) return null;
  const length = TAIL_LENGTH_COMA_RADII;
  const half = length * ION_HALF_WIDTH * 2; // shader width is 0.5 of the box half-width
  return {
    id: 'ion_tail',
    kind: 'ion_tail',
    tag: 'derived',
    halfExtent: [length / 2, half, half],
    center: [(axis[0] * length) / 2, (axis[1] * length) / 2, (axis[2] * length) / 2],
    axis,
    bend: null,
    bendFraction: 0,
    seed,
    emitters: [{ label: 'Ion tail', rgb: ION_BLUE, gain: 0.9 }],
    dust: 0,
    shell: 0,
  };
}

/**
 * Curved dust tail. Tag `artistic`: the bend side needs the orbit, which the card does not hold
 * (ASSUMPTION, see `dustTailCurve`). Null for a zero Sun vector.
 */
export function dustTailVolume(
  sunDir: readonly number[],
  seed: number,
  bendDir: readonly number[] | null = null,
): VolumePlan | null {
  const length = TAIL_LENGTH_COMA_RADII;
  const curve = dustTailCurve(sunDir, length, 2, bendDir);
  const axis = ionTailDirection(sunDir);
  if (!curve || !axis) return null;
  // Bend side: the end point's offset from the straight axis.
  const end = curve[1]!;
  const off: Vec3 = [
    end[0] - axis[0] * length,
    end[1] - axis[1] * length,
    end[2] - axis[2] * length,
  ];
  const offLen = Math.hypot(...off) || 1;
  const bend: Vec3 = [off[0] / offLen, off[1] / offLen, off[2] / offLen];
  const bendScene = DUST_TAIL_BEND * length;
  const halfYZ = bendScene / DUST_BEND_LOCAL;
  return {
    id: 'dust_tail',
    kind: 'dust_tail',
    tag: 'artistic',
    halfExtent: [length / 2, halfYZ, halfYZ],
    center: [(axis[0] * length) / 2, (axis[1] * length) / 2, (axis[2] * length) / 2],
    axis,
    bend,
    bendFraction: DUST_BEND_LOCAL,
    seed,
    emitters: [{ label: 'Dust tail', rgb: DUST_WARM, gain: 0.5 }],
    dust: 0,
    shell: 0,
  };
}

/**
 * Issue #71 F (Q-263): the modelled dust tail. `axis` is the real anti-solar direction, `bend` the
 * side the Finson-Probstein grains fall toward (perpendicular to `axis`), `lengthScene` the grains'
 * extent along the axis and `lateralScene` their sideways offset, both in scene units (coma radius
 * 1). Tag `model_dependent`: the grain sizes are assumed. Null for a degenerate axis or length.
 */
export function modelledDustTailVolume(
  axis: Vec3,
  bend: Vec3 | null,
  lengthScene: number,
  lateralScene: number,
  seed: number,
): VolumePlan | null {
  if (!(lengthScene > 0) || !Number.isFinite(lengthScene)) return null;
  // The shader keeps the bent centre line inside the box, so the box is as tall as the bend needs
  // (with a floor so a straight tail still has body).
  const lateral = Math.min(Math.max(lateralScene, 0), DUST_TAIL_BEND * lengthScene);
  const halfYZ = Math.max(lateral / DUST_BEND_LOCAL, 0.12 * lengthScene);
  return {
    id: 'dust_tail',
    kind: 'dust_tail',
    tag: 'model_dependent',
    halfExtent: [lengthScene / 2, halfYZ, halfYZ],
    center: [(axis[0] * lengthScene) / 2, (axis[1] * lengthScene) / 2, (axis[2] * lengthScene) / 2],
    axis,
    bend,
    bendFraction: lateral > 0 ? DUST_BEND_LOCAL : 0,
    seed,
    emitters: [{ label: 'Dust tail', rgb: DUST_WARM, gain: 0.5 }],
    dust: 0,
    shell: 0,
  };
}

/** '#rrggbb' (sRGB) to linear RGB in 0..1. Deterministic. */
export function cssToLinear(css: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1]!, 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
}
