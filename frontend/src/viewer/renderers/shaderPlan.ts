// R7.7 plan for the shader-generated kinds (planet_rocky, planet_water, gas_giant, nebula, nova).
// Pure, like the other planners: it decides what is drawn, hidden or refused, and `buildScene`
// makes the ShaderBody. Rules (all through PlanBuilder, so the legend, the missing list and the
// alt text work as for the baked kinds):
//   - the surface layer is `artistic` (R7.7), so it is hidden at "Measured only" and "+ Estimated";
//   - Q-45 / R5.3: the plain grey sphere that stands in for a hidden surface is shown only when the
//     size on the card is shown at this honesty level (Measured only: only when it is `measured`);
//   - nebula and nova have no plain sphere, so nothing is drawn while the cloud is hidden;
//   - missing data refuses the layer; nothing is invented (R1 principle 3).
import { isTagShown } from '../honesty';
import { missingFields, PlanBuilder, type PlanInput } from '../planCommon';
import type { RenderPlan } from '../planTypes';
import { processOf, resolveMotion, weakestTag } from '../motion/motion';
import { listMotion, offerLayer, spinPlanOf, viewerLayer } from '../motion/planMotion';
import {
  kindHasPlainSphere,
  resolveShaderSpec,
  shaderDistance,
  sizeFieldFor,
  type ShaderKind,
} from './shaderSpec';

export const PLAIN_SPHERE_NOTE =
  "Shown as a plain grey sphere at the size on the card. The surface is an artist's impression and is hidden at this level.";

export function planShaderKind(input: PlanInput): RenderPlan {
  const b = new PlanBuilder(input);
  const { card, params, ctx } = input;
  // What moves, by the tier chain (R5.7, D-32): spin, jets, storms, clouds.
  const motion = resolveMotion(card, params);
  listMotion(b, motion);
  // Throws only for a card and params of different kinds (a caller bug); planRender catches it.
  const spec = resolveShaderSpec(card, params, undefined, motion);
  const kind: ShaderKind = spec.kind;
  const sizeField = sizeFieldFor(kind);
  const hasPlain = kindHasPlainSphere(kind);
  b.tintUsed = false; // the colour modes do not apply to a generated surface

  // The size and scale bar. A world's size is the plain body (Q-45 rule in PlanBuilder.body). A
  // cloud's size is shown only when its own tag is shown, so a hidden size never adds a second,
  // confusing "not drawn" line next to the cloud itself.
  const tv = card[sizeField];
  const sizeShown =
    hasPlain || (tv && isTagShown(ctx.honesty, tv.tag))
      ? spec.drawable && b.body(sizeField)
      : false;

  let surface = false;
  if (!spec.drawable) {
    // Data first: say why, in the layer's own words, and draw nothing (no legend line).
    const layer = params.layers.find((l) => l.id === spec.layerId);
    if (!layer || params.missing.includes(spec.layerId)) {
      b.refuse({ id: spec.layerId, reason: 'backend' });
    } else {
      const fields = missingFields(card, [...layer.requires, sizeField]);
      b.refuse({
        id: spec.layerId,
        reason: 'data',
        fields: fields.length > 0 ? fields : undefined,
        detail: fields.length > 0 ? undefined : 'The physical size is unknown.',
      });
    }
  } else {
    surface = b.draw(spec.layerId);
  }

  // Sub-layers of the generated surface (issue #42): each says what set its numbers and with what
  // tier. They exist only while the surface is drawn, so they follow its honesty state.
  if (surface) {
    const winds = processOf(motion, 'winds');
    if (spec.gas) {
      if (winds && motion.rates.jet_speed_ms) {
        offerLayer(
          b,
          viewerLayer(
            'jets',
            weakestTag([winds.tag, 'artistic']),
            'Counter-flowing jets: neighbouring bands blow opposite ways at up to the jet speed in the dynamics, and turbulence is strongest at the band edges. The band pattern itself is an artist look.',
            {
              formula:
                'wind = peak jet speed * band profile (sign flips between bands); drift = wind / cos(latitude)',
              assumed: {
                jet_speed_ms: motion.rates.jet_speed_ms.value,
                band_pattern: 'an artist look, not measured',
              },
            },
          ),
        );
        b.draw('jets');
        offerLayer(
          b,
          viewerLayer(
            'storms',
            'artistic',
            'Storms sit between the jets, drift at the wind speed of their latitude and turn at about wind speed over their size. Where they are is a seeded look.',
            {
              formula:
                'drift = wind speed at the storm latitude, turn rate ~ wind speed / storm size',
            },
          ),
        );
        b.draw('storms');
      }
      const rule = spec.gas.bandsRule;
      if (rule) {
        offerLayer(
          b,
          viewerLayer('band_count', rule.tag, rule.basis, {
            formula: rule.formula,
            assumed: rule.assumed,
          }),
        );
        b.draw('band_count');
      }
      const flat = spec.gas.flatteningRule;
      if (flat) {
        offerLayer(
          b,
          viewerLayer('flattening', flat.tag, flat.basis, {
            formula: flat.formula,
            assumed: flat.assumed,
          }),
        );
        b.draw('flattening');
      }
    }
    if (spec.planet) {
      if (winds && motion.rates.jet_speed_ms) {
        offerLayer(
          b,
          viewerLayer(
            'clouds',
            'artistic',
            "Clouds carried by winds that change with latitude and slowly re-form, with cloud shadows. The wind speed is the card's; the cloud shapes are an artist look.",
          ),
        );
        b.draw('clouds');
      }
      const climate = spec.planet.climate;
      if (climate) {
        offerLayer(
          b,
          viewerLayer('climate', climate.tag, climate.basis, {
            formula: climate.formula,
            assumed: climate.assumed,
          }),
        );
        b.draw('climate');
      }
    }
  }

  const plain = hasPlain && spec.drawable && !surface && sizeShown;
  if (plain) {
    b.notes.push(PLAIN_SPHERE_NOTE);
    b.legendBody('Plain grey sphere at the size on the card.');
  }

  return b.build({
    // The size is the only number on the card the viewer shows; it is not shown for a body that
    // is not on screen (A11: no unlabelled number).
    sizeTag: sizeShown && (surface || plain) ? b.sizeTag : null,
    shader: spec.drawable
      ? {
          card,
          params,
          key: JSON.stringify([
            params.id,
            spec.kind,
            spec.seed,
            spec.field,
            spec.planet,
            spec.gas,
            spec.layerId,
            motion,
          ]),
          surface,
          plain,
          distance: shaderDistance(spec),
        }
      : null,
    relief: 'illustrative',
    motion,
    spin: surface && spec.kind !== 'nebula' && spec.kind !== 'nova' ? spinPlanOf(motion) : null,
  });
}
