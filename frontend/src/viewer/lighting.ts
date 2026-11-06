// R5.1 lighting — data-driven lighting (DirectionalLight at phase_angle_deg for solar-system
// bodies, emissive for stars and brown dwarfs) is not implemented yet.

/**
 * R5.1: "A tiny ambient light (intensity ≤ 0.03) keeps the night side legible."
 * This is a spec limit, not a physical value. Every scene must keep ambient at or below it.
 */
export const MAX_AMBIENT_INTENSITY = 0.03;

/**
 * Default direction toward the light when RenderParams.lighting has no sun_dir. A placeholder
 * (`artistic`), shared by the viewer's DirectionalLight and the atmosphere shader so the two agree.
 */
export const DEFAULT_SUN_DIR: readonly [number, number, number] = [3, 1.5, 2];

export const LIGHTING_PLACEHOLDER = { spec: 'R5.1', implemented: false } as const;
