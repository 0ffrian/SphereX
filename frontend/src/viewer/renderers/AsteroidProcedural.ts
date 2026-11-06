// R7.2 `asteroid_procedural`. Pure plan; renderers/build.ts draws it.
//   Requires diameter_km. Optional: lightcurve_amp_mag, colour, albedo.
//   Sphere (256 x 128) scaled by the ellipsoid axes; albedo and normal maps are baked by the
//   backend (R6) and only loaded here. Measured-only state: plain sphere with a flat tint.
//   Displacement (desktop only) is not implemented: the normal map carries the relief.
import { ellipsoidAxes, litBody, numberField, PlanBuilder, type PlanInput } from '../planCommon';
import type { RenderPlan } from '../planTypes';

export function planAsteroidProcedural(input: PlanInput): RenderPlan {
  const b = new PlanBuilder(input);
  const tex = input.params.textures;
  const bodyOk = b.body('diameter_km');

  // R6.2: a/b = 10^(0.4 A), c = b (model_dependent). Hidden or refused: plain sphere.
  const ellipsoid = b.draw('ellipsoid');
  const albedo = b.draw('albedo_map', { asset: tex?.albedo ?? null });
  const relief = b.draw('relief', { asset: tex?.normal ?? null });
  if (!bodyOk) b.dropDrawn();

  const axes = ellipsoid ? ellipsoidAxes(numberField(input.card, 'lightcurve_amp_mag')) : undefined;
  if (bodyOk && !ellipsoid) {
    b.notes.push('Shown as a plain sphere: the ellipsoid shape is an estimate.');
    b.legendBody('Plain sphere at the size on the card.');
  }

  return b.build({
    bodies: bodyOk
      ? [
          litBody('body', axes ?? [1, 1, 1], b.tint.rgb, {
            segments: [256, 128],
            albedoUrl: albedo ? (tex?.albedo ?? null) : null,
            normalUrl: relief ? (tex?.normal ?? null) : null,
          }),
        ]
      : [],
    // The relief is illustrative (artistic) unless a measured mesh is shown.
    relief: 'illustrative',
  });
}
