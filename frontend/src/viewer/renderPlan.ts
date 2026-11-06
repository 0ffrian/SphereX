// Picks the renderer by type (R4 level 3) and returns its plan. Pure: no three.js, no GPU.
// Never throws: a card or params the renderer cannot use gives a plan with nothing drawn, a
// message and the reason in `missing`.
import type { CometEpoch, ObjectCard, RenderParams } from '@/contract';
import { DEFAULT_HONESTY } from './honesty';
import { NEUTRAL_TINT } from './modes';
import { PlanBuilder, type PlanInput } from './planCommon';
import type { PlanContext, RenderPlan } from './planTypes';
import { planAsteroidMesh } from './renderers/AsteroidMesh';
import { planAsteroidProcedural } from './renderers/AsteroidProcedural';
import { planBrownDwarf } from './renderers/BrownDwarf';
import { planComet } from './renderers/Comet';
import { planStar } from './renderers/Star';

/** R7.6: the message shown for a `candidate`. */
export const CANDIDATE_MESSAGE = 'Not enough data for a 3D model: distance and albedo unknown';

/** The shader-generated kinds (D-01) have no renderer in this build (ShaderBody is a placeholder). */
export const UNSUPPORTED_MESSAGE =
  'This kind of object is drawn by the shader renderers, which are not built yet.';

export const DEFAULT_EPOCH: CometEpoch = '2025-12';

export function defaultContext(over: Partial<PlanContext> = {}): PlanContext {
  return {
    honesty: DEFAULT_HONESTY,
    mode: null,
    epoch: DEFAULT_EPOCH,
    scrubIndex: 0,
    failed: [],
    ...over,
  };
}

function planNoBody(input: PlanInput, message: string): RenderPlan {
  const b = new PlanBuilder(input);
  b.notes.length = 0;
  return b.build({ threeD: false, message, mode: null, relief: 'illustrative' });
}

export function planRender(card: ObjectCard, params: RenderParams, ctx: PlanContext): RenderPlan {
  const input: PlanInput = { card, params, ctx };
  try {
    switch (params.type) {
      case 'asteroid_shape':
        return planAsteroidMesh(input);
      case 'asteroid_procedural':
        return planAsteroidProcedural(input);
      case 'comet':
        return planComet(input);
      case 'brown_dwarf':
      case 'brown_dwarf_binary':
        return planBrownDwarf(input);
      case 'star':
      case 'star_mira':
      case 'star_ttauri':
        return planStar(input);
      case 'candidate':
        return planNoBody(input, CANDIDATE_MESSAGE);
      default:
        return planNoBody(input, UNSUPPORTED_MESSAGE);
    }
  } catch (err) {
    // Refuse rather than crash. The reason goes to the console for developers.
    console.warn('[viewer] could not plan', params.id, err);
    return {
      id: params?.id ?? '',
      type: params?.type ?? 'candidate',
      name: card?.name ?? '',
      threeD: false,
      message: 'This object could not be drawn: its data was not usable.',
      bodies: [],
      shells: [],
      discs: [],
      screens: [],
      trails: [],
      dust: null,
      drawn: [],
      missing: [{ id: 'body', reason: 'data', detail: 'The data was not usable.' }],
      notes: [],
      honesty: ctx.honesty,
      mode: null,
      modes: [],
      tint: { rgb: NEUTRAL_TINT, tag: null, source: null },
      epoch: null,
      epochs: [],
      lighting: {
        mode: 'self',
        ambient: 0,
        direction: null,
        intensity: 0,
        emissive: true,
        tag: 'artistic',
        source: 'self',
        phaseAngleDeg: null,
      },
      scaleM: null,
      sizeTag: null,
      sizeQualifier: null,
      sizeWhy: null,
      tintUsed: false,
      extent: 1,
      spin: null,
      scrub: null,
      relief: 'illustrative',
    };
  }
}
