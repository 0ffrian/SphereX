// R7.7 plan for the shader-generated kinds (planet_rocky, planet_water, gas_giant, nebula, nova).
// Pure, like the other planners: it decides what is drawn, hidden or refused, and `buildScene`
// makes the ShaderBody. Rules (all through PlanBuilder, so the legend, the missing list and the
// alt text work as for the baked kinds):
//   - the surface layer of a planet, nebula or nova is `artistic` (R7.7), so it is hidden at
//     "Measured only" and "+ Estimated"; a gas giant has five layers with their own tags (issue
//     #62, D-32): bands, flattening, colour and storms follow the data and show from "+ Estimated",
//     turbulence is `artistic` and shows with "+ Artistic";
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
  GAS_LAYER_IDS,
  kindHasPlainSphere,
  NO_GAS_LAYERS,
  resolveShaderSpec,
  shaderDistance,
  sizeFieldFor,
  type GasLayerId,
  type GasSwitches,
  type ShaderKind,
} from './shaderSpec';

export const PLAIN_SPHERE_NOTE =
  "Shown as a plain grey sphere at the size on the card. The surface is an artist's impression and is hidden at this level.";

const NO_TOUCH_NOTE = {
  nebula:
    'Nebulae have no touch feedback: they are drawn as glowing gas, so there is no surface to feel.',
  nova: 'Supernova remnants have no touch feedback: they are drawn as glowing gas, so there is no surface to feel.',
} as const;

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
  let gas: GasSwitches | null = null;
  if (!spec.drawable) {
    // Data first: say why, in the layer's own words, and draw nothing (no legend line).
    for (const id of spec.layerIds) {
      const layer = params.layers.find((l) => l.id === id);
      if (!layer && spec.layerIds.length > 1) continue; // a gas layer the backend did not offer
      if (!layer || params.missing.includes(id)) {
        b.refuse({ id, reason: 'backend' });
      } else {
        const fields = missingFields(card, [...layer.requires, sizeField]);
        b.refuse({
          id,
          reason: 'data',
          fields: fields.length > 0 ? fields : undefined,
          detail: fields.length > 0 ? undefined : 'The physical size is unknown.',
        });
      }
    }
  } else if (spec.gasLayers) {
    // Each gas layer is decided on its own: tag against the honesty level, data, refusals, holds.
    // A layer that is refused or hidden is off in the body too.
    const on: Record<GasLayerId, boolean> = { ...NO_GAS_LAYERS };
    for (const id of GAS_LAYER_IDS) on[id] = b.draw(id);
    gas = on;
    surface = GAS_LAYER_IDS.some((id) => on[id]);
  } else {
    surface = b.draw(spec.layerId);
  }

  // Sub-layers of the generated surface (issue #42): each says what set its numbers and with what
  // tier. They exist only while the surface is drawn, so they follow its honesty state.
  if (surface) {
    const winds = processOf(motion, 'winds');
    if (spec.gas && gas) {
      // The jets slide the bands past each other, so they need the bands; the storms drift with
      // the wind of their latitude, so they need the storms (issue #62).
      if (winds && motion.rates.jet_speed_ms && gas.bands) {
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
      }
      if (winds && motion.rates.jet_speed_ms && gas.storms) {
        offerLayer(
          b,
          viewerLayer(
            'storm_drift',
            'artistic',
            'Storms drift at the wind speed of their latitude and turn at about wind speed over their size. Where they are is a seeded look.',
            {
              formula:
                'drift = wind speed at the storm latitude, turn rate ~ wind speed / storm size',
            },
          ),
        );
        b.draw('storm_drift');
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

  // Q-103: the glowing volumes have no touch feedback. Said in plain words so that Touch mode on
  // one of them is not silent without a reason (R9). Listed whether or not it is drawn now.
  if (spec.kind === 'nebula' || spec.kind === 'nova') {
    b.notes.push(NO_TOUCH_NOTE[spec.kind]);
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
          gas,
          plain,
          distance: shaderDistance(spec),
        }
      : null,
    relief: 'illustrative',
    motion,
    spin: surface && spec.kind !== 'nebula' && spec.kind !== 'nova' ? spinPlanOf(motion) : null,
  });
}
