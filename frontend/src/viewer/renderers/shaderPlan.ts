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
import {
  kindHasPlainSphere,
  resolveShaderSpec,
  shaderDistance,
  sizeFieldFor,
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
  // Throws only for a card and params of different kinds (a caller bug); planRender catches it.
  const spec = resolveShaderSpec(card, params);
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
          ]),
          surface,
          plain,
          distance: shaderDistance(spec),
        }
      : null,
    relief: 'illustrative',
  });
}
