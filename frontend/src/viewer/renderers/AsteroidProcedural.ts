// R7.2 `asteroid_procedural`. Pure plan; renderers/build.ts draws it.
//   Requires diameter_km. Optional: lightcurve_amp_mag, colour, albedo.
//   Sphere (256 x 128) scaled by the ellipsoid axes; albedo and normal maps are baked by the
//   backend (R6) and only loaded here. Measured-only state: plain sphere with a flat tint.
//   Displacement by the baked height map (R7.2, issue #62) runs on the high and medium quality
//   levels (not the phone's low one); the normal map still carries the fine relief on top of it.
//   `textures.relief_amp` and the `displacement` layer (`artistic`) come from the backend.
import { ellipsoidAxes, litBody, numberField, PlanBuilder, type PlanInput } from '../planCommon';
import type { RenderParams } from '@/contract';
import type { RenderPlan, Rgb } from '../planTypes';

const WHITE: Rgb = [1, 1, 1];

/**
 * R7.2: `displacementScale = relief_amp` (fraction of the radius, R6.2). `RenderTextures` declares
 * `relief_amp` as an optional field (Q-103); the backend sends it for this kind (issue #62). When
 * it is absent the displacement layer is refused as a server gap, not guessed. A value that is not
 * a positive finite number is ignored.
 */
export function reliefAmpOf(params: RenderParams): number | null {
  const v: unknown = params.textures?.relief_amp;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** R7.2: displacement runs on desktop only (off on the low quality level, which is the phone's). */
export function displacementActive(tier: 'high' | 'medium' | 'low', scale: number | null): boolean {
  return scale !== null && scale > 0 && tier !== 'low';
}

/** Why the displacement layer is refused on the low quality level (Q-117). */
export const PHONE_TIER_REASON = 'phone tier: relief shows as shading only';

export function planAsteroidProcedural(input: PlanInput): RenderPlan {
  const b = new PlanBuilder(input);
  const tex = input.params.textures;
  const bodyOk = b.body('diameter_km');
  const tier = input.ctx.qualityTier ?? 'high';

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
  // A legend entry and a tag of its own. The backend offers the layer as `artistic` (the scale is
  // the R6.2 style rule's peak relief, a look); params without it still get the viewer's own entry
  // with the same tag. Refused when the load failed or the honesty state hides `artistic`.
  // Q-117: on the low quality level the layer is not drawn, so it is refused with that reason
  // rather than listed (the plan is rebuilt when the level changes).
  const lowTier = displaceWanted && reliefAmp !== null && !displacementActive(tier, reliefAmp);
  if (lowTier) {
    b.reject({ id: 'displacement', reason: 'quality', detail: PHONE_TIER_REASON });
  }
  const displaceDrawn =
    displaceWanted &&
    reliefAmp !== null &&
    !lowTier &&
    (b.has('displacement')
      ? b.draw('displacement', { asset: heightUrl })
      : b.drawLocal(
          'displacement',
          'artistic',
          'Surface pushed in and out by the relief map. On phones it stays smooth and the relief shows as shading only.',
        ));

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
