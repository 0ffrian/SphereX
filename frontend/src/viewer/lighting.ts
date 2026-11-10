// R5.1 lighting. Pure plan (testable without a GPU) plus the three.js rig built from it.
//   Solar-system bodies: one DirectionalLight at phase_angle_deg from the view direction, plus a
//   tiny ambient light (<= MAX_AMBIENT_INTENSITY). Stars and brown dwarfs: emissive, no light.
import { AmbientLight, DirectionalLight, type Object3D } from 'three/webgpu';
import type { ObjectCard, RenderParams, Tag } from '@/contract';
import type { ShadowSettings } from './shape/shapeModel';
import { InputReader } from '@/physics/tagging';
import { starlightColour } from '@/physics/starlight';
import { weakestTag } from './motion/motion';

/** Planet kinds whose light takes the colour of the host star (issue #68 Part 2). Solar-system bodies stay white. */
const STARLIT_TYPES: ReadonlySet<string> = new Set(['planet_rocky', 'planet_water', 'gas_giant']);

/**
 * R5.1: "A tiny ambient light (intensity ≤ 0.03) keeps the night side legible."
 * This is a spec limit, not a physical value. Every scene must keep ambient at or below it.
 */
export const MAX_AMBIENT_INTENSITY = 0.03;

/** Exposure of the Sun light. Display choice only, not a physical value (tag: artistic). */
export const DIRECTIONAL_INTENSITY = 2;

/**
 * Display tilt (artistic, Q-107 item 1 fixed): the card's `sun_vector` is an ICRF vector that is read
 * as scene space without a frame conversion (Q-62), so its angle to the camera is not a measured
 * phase. A Sun exactly in the image plane (a 90 degree phase, as the fixtures' [1, 0, 0]) makes the
 * terminator a straight line through the disc and half the body black. For a hint with no phase angle
 * the direction is therefore turned toward the camera and up by this vector before it is normalised
 * (about 51 degrees of phase for [1, 0, 0]), so the terminator is the curved ellipse of a gibbous
 * body. Not applied to a comet, whose tail is aimed by the same hint (Comet.ts), and never to a
 * phase angle that the card gives.
 */
export const SUN_HINT_DISPLAY_TILT: readonly [number, number, number] = [0, 0.45, 0.9];

/** Distance of the light from the origin in scene units. A directional light only uses the direction. */
const LIGHT_DISTANCE = 5;

export interface LightingPlan {
  mode: 'sun' | 'self';
  ambient: number;
  /** Unit vector from the object toward the Sun, in scene space (+z = toward the camera). */
  direction: [number, number, number] | null;
  intensity: number;
  /** Stars and brown dwarfs: the material emits its own light. */
  emissive: boolean;
  /**
   * The tag of the phase angle on the card; `artistic` when the angle is a display default or
   * the card gives no tag for it (never `measured` by default: that claims the most).
   */
  tag: Tag;
  source: 'phase_angle' | 'sun_dir' | 'view' | 'self';
  phaseAngleDeg: number | null;
  /**
   * Issue #68 Part 2: linear-sRGB colour of the Sun light, the blackbody colour of `host_teff_K` at
   * unit luminance (no white balance: an M dwarf's light is orange-red). Null: white. The planner
   * clears it when the `starlight` layer is hidden or refused.
   */
  colour: [number, number, number] | null;
  /** Tag of `colour`: `derived`, or weaker when `host_teff_K` is. Null with no colour. */
  colourTag: Tag | null;
  /** The host temperature the colour came from, K. */
  colourTeffK: number | null;
}

/** The light colour a planet card asks for, or none. Pure. */
function starlightFor(
  params: RenderParams,
  card: ObjectCard | null | undefined,
): Pick<LightingPlan, 'colour' | 'colourTag' | 'colourTeffK'> {
  const none = { colour: null, colourTag: null, colourTeffK: null };
  if (!card || !STARLIT_TYPES.has(params.type)) return none;
  const host = new InputReader(card, {}).readCard('host_teff_K');
  if (host === null) return none;
  const teff = host.value;
  const colour = starlightColour(teff);
  if (colour === null) return none;
  return {
    colour,
    colourTag: weakestTag(['derived', host.tag]),
    colourTeffK: teff,
  };
}

/** Light direction for a Sun-Target-Observer angle: 0° = Sun behind the camera (full phase). */
export function directionFromPhaseAngle(deg: number): [number, number, number] {
  const r = (deg * Math.PI) / 180;
  return [Math.sin(r), 0, Math.cos(r)];
}

function unit(v: readonly number[]): [number, number, number] | null {
  const [x = 0, y = 0, z = 0] = v;
  const n = Math.hypot(x, y, z);
  return n > 0 ? [x / n, y / n, z / n] : null;
}

export function planLighting(params: RenderParams, card?: ObjectCard | null): LightingPlan {
  if (params.lighting.mode === 'self') {
    return {
      mode: 'self',
      ambient: 0,
      direction: null,
      intensity: 0,
      emissive: true,
      tag: 'artistic',
      source: 'self',
      phaseAngleDeg: null,
      colour: null,
      colourTag: null,
      colourTeffK: null,
    };
  }
  const phase = params.lighting.phase_angle_deg;
  if (typeof phase === 'number' && Number.isFinite(phase)) {
    return {
      mode: 'sun',
      ambient: MAX_AMBIENT_INTENSITY,
      direction: directionFromPhaseAngle(phase),
      intensity: DIRECTIONAL_INTENSITY,
      emissive: false,
      tag: card?.phase_angle_deg?.tag ?? 'artistic',
      source: 'phase_angle',
      phaseAngleDeg: phase,
      ...starlightFor(params, card),
    };
  }
  // ASSUMPTION: with no phase angle, fall back to the Sun direction as given (its frame is not
  // specified, so it is only used as a direction hint) and then to a head-on light. Both are
  // tagged `artistic` and the plan lists "lighting" as refused.
  const hint = params.lighting.sun_dir ? unit(params.lighting.sun_dir) : null;
  const sun =
    hint && params.type !== 'comet'
      ? unit(hint.map((x, i) => x + SUN_HINT_DISPLAY_TILT[i]!))
      : hint;
  return {
    mode: 'sun',
    ambient: MAX_AMBIENT_INTENSITY,
    direction: sun ?? [0, 0, 1],
    intensity: DIRECTIONAL_INTENSITY,
    emissive: false,
    tag: 'artistic',
    source: sun ? 'sun_dir' : 'view',
    phaseAngleDeg: null,
    ...starlightFor(params, card),
  };
}

/**
 * Builds the lights for a plan. Self-luminous bodies get none. With `shadow` the Sun light casts a
 * shadow map (R7.1 self-shadowing of a shape model); the renderer's shadow map must be enabled.
 */
export function buildLights(plan: LightingPlan, shadow: ShadowSettings | null = null): Object3D[] {
  if (plan.mode === 'self' || plan.direction === null) return [];
  const [x, y, z] = plan.direction;
  const sun = new DirectionalLight(0xffffff, plan.intensity);
  // Linear sRGB (the working colour space); unit luminance, so the exposure is unchanged.
  if (plan.colour) sun.color.setRGB(plan.colour[0], plan.colour[1], plan.colour[2]);
  sun.position.set(x * LIGHT_DISTANCE, y * LIGHT_DISTANCE, z * LIGHT_DISTANCE);
  if (shadow) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadow.mapSize, shadow.mapSize);
    const cam = sun.shadow.camera;
    cam.left = -shadow.extent;
    cam.right = shadow.extent;
    cam.top = shadow.extent;
    cam.bottom = -shadow.extent;
    cam.near = LIGHT_DISTANCE - shadow.extent * 1.5;
    cam.far = LIGHT_DISTANCE + shadow.extent * 1.5;
    cam.updateProjectionMatrix();
    sun.shadow.bias = shadow.bias;
    sun.shadow.normalBias = shadow.normalBias;
  }
  return [sun, new AmbientLight(0xffffff, Math.min(plan.ambient, MAX_AMBIENT_INTENSITY))];
}
