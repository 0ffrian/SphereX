// R7.2 `asteroid_procedural`. Pure plan; renderers/build.ts draws it.
//   Requires diameter_km. Optional: lightcurve_amp_mag, colour, albedo.
//   Sphere (256 x 128) scaled by the ellipsoid axes; albedo and normal maps are baked by the
//   backend (R6) and only loaded here. Measured-only state: plain sphere with a flat tint.
//   Displacement (desktop only) is not implemented: the normal map carries the relief.
import { ellipsoidAxes, litBody, numberField, PlanBuilder, type PlanInput } from '../planCommon';
import type { RenderParams } from '@/contract';
import type { RenderPlan, Rgb } from '../planTypes';

const WHITE: Rgb = [1, 1, 1];

/**
 * R7.2: `displacementScale = relief_amp` (fraction of the radius, R6.2). `RenderTextures` declares
 * `relief_amp` as an optional field (Q-103); the backend does not send it yet (Kevin), so it is
 * null today and the displacement layer is refused as a server gap, not guessed. A value that is
 * not a positive finite number is ignored.
 */
export function reliefAmpOf(params: RenderParams): number | null {
  const v: unknown = params.textures?.relief_amp;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** R7.2: displacement runs on desktop only (off on the low quality level, which is the phone's). */
export function displacementActive(tier: 'high' | 'medium' | 'low', scale: number | null): boolean {
  return scale !== null && scale > 0 && tier !== 'low';
}

export function planAsteroidProcedural(input: PlanInput): RenderPlan {
  const b = new PlanBuilder(input);
  const tex = input.params.textures;
  const bodyOk = b.body('diameter_km');

  // R6.2: a/b = 10^(0.4 A), c = b (model_dependent). Hidden or refused: plain sphere.
  const ellipsoid = b.draw('ellipsoid');
  const albedo = b.drawBaked('albedo_map', tex?.albedo);
  const relief = b.draw('relief', { asset: tex?.normal ?? null });
  if (!bodyOk) b.dropDrawn();

  // Displacement by the baked height map (one height field drives normals, relief and haptics).
  const reliefAmp = reliefAmpOf(input.params);
  const heightUrl = tex?.height ?? null;
  const displaceWanted = bodyOk && relief && heightUrl !== null;
  if (displaceWanted && reliefAmp === null) {
    // A gap in what the server sends, not missing data about the object (plain words: messages.ts).
    b.reject({
      id: 'displacement',
      reason: 'backend',
      detail: 'The server does not send the relief height yet, so the surface is not displaced.',
    });
  }
  // A legend entry and a tag of its own; refused when the load failed or the honesty state hides
  // `derived` (the scale is the baked relief amplitude, R6.2).
  const displaceDrawn =
    displaceWanted &&
    reliefAmp !== null &&
    b.drawLocal(
      'displacement',
      'derived',
      'Surface displaced by the baked height map (scale = relief amplitude).',
    );

  const axes = ellipsoid ? ellipsoidAxes(numberField(input.card, 'lightcurve_amp_mag')) : undefined;
  if (bodyOk && !ellipsoid) {
    b.notes.push('Shown as a plain sphere: the ellipsoid shape is an estimate.');
    b.legendBody('Plain sphere at the size on the card.');
  }

  return b.build({
    bodies: bodyOk
      ? [
          // The baked albedo already holds the colour; the tint is then white (not applied twice).
          litBody('body', axes ?? [1, 1, 1], albedo ? WHITE : b.tint.rgb, {
            segments: [256, 128],
            albedoUrl: albedo ? (tex?.albedo ?? null) : null,
            normalUrl: relief ? (tex?.normal ?? null) : null,
            heightUrl: displaceDrawn ? heightUrl : null,
            displacementScale: displaceDrawn ? reliefAmp : null,
          }),
        ]
      : [],
    // The relief is illustrative (artistic) unless a measured mesh is shown.
    relief: 'illustrative',
  });
}
