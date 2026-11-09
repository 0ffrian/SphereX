// R5.1 lighting. Pure plan (testable without a GPU) plus the three.js rig built from it.
//   Solar-system bodies: one DirectionalLight at phase_angle_deg from the view direction, plus a
//   tiny ambient light (<= MAX_AMBIENT_INTENSITY). Stars and brown dwarfs: emissive, no light.
import { AmbientLight, DirectionalLight, type Object3D } from 'three/webgpu';
import type { ObjectCard, RenderParams, Tag } from '@/contract';
import type { ShadowSettings } from './shape/shapeModel';

/**
 * R5.1: "A tiny ambient light (intensity ≤ 0.03) keeps the night side legible."
 * This is a spec limit, not a physical value. Every scene must keep ambient at or below it.
 */
export const MAX_AMBIENT_INTENSITY = 0.03;

/** Exposure of the Sun light. Display choice only, not a physical value (tag: artistic). */
export const DIRECTIONAL_INTENSITY = 2;

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
    };
  }
  // ASSUMPTION: with no phase angle, fall back to the Sun direction as given (its frame is not
  // specified, so it is only used as a direction hint) and then to a head-on light. Both are
  // tagged `artistic` and the plan lists "lighting" as refused.
  const sun = params.lighting.sun_dir ? unit(params.lighting.sun_dir) : null;
  return {
    mode: 'sun',
    ambient: MAX_AMBIENT_INTENSITY,
    direction: sun ?? [0, 0, 1],
    intensity: DIRECTIONAL_INTENSITY,
    emissive: false,
    tag: 'artistic',
    source: sun ? 'sun_dir' : 'view',
    phaseAngleDeg: null,
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
