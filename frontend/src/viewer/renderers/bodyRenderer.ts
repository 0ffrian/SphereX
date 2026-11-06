// Renderer registry contract: one BodyRenderer per displayed object, picked by ObjectType.
// ASSUMPTION: not in the specs. It is the smallest hook that lets ViewerApp.setBody pick a renderer
// per type, so the baked types (issue #7) can register next to the shader kinds without editing
// ViewerApp again. Types here are plain data; no three.js renderer is needed to build one.
import type { Object3D } from 'three/webgpu';
import type { ObjectCard, ObjectType, RenderParams, Tag } from '@/contract';
import type { Overrides } from '../sliders';
import type { Vec3 } from '../fields/fieldGenerator';
import type { FieldData, FieldParams } from '../fields/fieldGenerator';

export const ALL_TAGS: readonly Tag[] = [
  'measured',
  'derived',
  'model_dependent',
  'inferred_from_analog',
  'artistic',
];

export interface BodyContext {
  /**
   * Tags the honesty toggle currently shows (D-21). Layers whose tag is not listed are hidden, not
   * refused. Default: all tags. ASSUMPTION: the honesty toggle itself is issue #7's.
   */
  visibleTags?: readonly Tag[];
  /** D-27 slider overrides (relief sliders live on the shader kinds, D-26). */
  overrides?: Overrides;
  /** Replaces the field Web Worker (tests). Default: `requestField`. */
  fieldSource?: (params: FieldParams) => Promise<FieldData>;
}

export interface BodyRenderer {
  readonly object: Object3D;
  /** Layer ids that were drawn. */
  readonly drawn: readonly string[];
  /** Layers refused for missing data (R1 principle 3). */
  readonly missing: readonly string[];
  /** Layers hidden by the honesty filter. */
  readonly hidden: readonly string[];
  /** Camera distance that frames the body. */
  readonly suggestedDistance: number;
  setSunDirection(dir: Vec3): void;
  setVisibleTags(tags: readonly Tag[]): void;
  /** D-27. Rebuilds what the changed sliders affect; resolves when drawn. */
  setOverrides(overrides: Overrides): Promise<void>;
  dispose(): void;
}

export type BodyFactory = (
  card: ObjectCard,
  params: RenderParams,
  ctx: BodyContext,
) => Promise<BodyRenderer>;

const factories = new Map<ObjectType, BodyFactory>();

export function registerBodyRenderer(types: readonly ObjectType[], factory: BodyFactory): void {
  for (const t of types) factories.set(t, factory);
}

/** Null when no renderer is registered for the type (ViewerApp then keeps its placeholder). */
export function createBodyRenderer(
  card: ObjectCard,
  params: RenderParams,
  ctx: BodyContext = {},
): Promise<BodyRenderer> | null {
  const factory = factories.get(params.type);
  return factory ? factory(card, params, ctx) : null;
}
