// Contract of a generated body (the shader kinds, D-01). The plan (`shaderPlan.ts`) decides what is
// shown; `buildScene` makes the body from the plan; the viewer keeps it across plans that change
// only the honesty state or the light. Types here are plain data; no GPU is needed to import them.
import type { Object3D } from 'three/webgpu';
import type { Tag } from '@/contract';
import { allowedTags, DEFAULT_HONESTY } from '../honesty';
import type { Overrides } from '../sliders';
import type { FieldData, FieldParams, FieldSampler, Vec3 } from '../fields/fieldGenerator';
import type { TierName } from '../render/quality';
import type { PointKind, PointSet, PointSets } from './pointClouds';

export const ALL_TAGS: readonly Tag[] = [
  'measured',
  'derived',
  'model_dependent',
  'inferred_from_analog',
  'artistic',
];

/**
 * D-21 "+ Estimated", the starting state: `measured` plus everything `derived`, `model_dependent`
 * or `inferred_from_analog`. `artistic` is NOT in it. The same set as the honesty model's
 * `allowedTags(DEFAULT_HONESTY)` (honesty.ts), which the plan passes in.
 */
export const ESTIMATED_TAGS: readonly Tag[] = allowedTags(DEFAULT_HONESTY);

/** What the panel can say about the body in plain words (R5.3, A11). */
export interface BodyStatus {
  state: 'drawn' | 'hidden' | 'refused';
  /** Plain-words sentence for the panel. */
  message: string;
  /** Tags of what is on screen (empty when nothing is drawn). */
  tags: readonly Tag[];
}

export interface BodyContext {
  /**
   * Tags the honesty toggle currently shows (D-21). Layers whose tag is not listed are hidden, not
   * refused. Default: `ESTIMATED_TAGS` (the D-21 starting state), so `artistic` surfaces are
   * hidden unless the caller asks for them. The viewer passes `allowedTags(plan.honesty)`.
   */
  visibleTags?: readonly Tag[];
  /** Unit vector toward the light, in world space. The viewer owns lighting; the body only uses it. */
  lightDir?: Vec3;
  /** Called after anything visible changed (tags, rebuild), so a render-on-change viewer redraws. */
  onChange?: () => void;
  /** The generated layer could not be built (the field failed): the plan refuses it with reason `load`. */
  onFailed?: (layerId: string) => void;
  /** Replaces the point-cloud Web Worker call (tests). Default: `requestPoints`. */
  pointSource?: (type: PointKind, seed: number) => Promise<PointSets>;
  /** D-27 slider overrides (relief sliders live on the shader kinds, D-26). */
  overrides?: Overrides;
  /** Quality level the body is built for (volume steps). Default: medium. */
  tier?: TierName;
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
  /** Why and how this body is shown, for the panel. */
  readonly status: BodyStatus;
  /** Canvas text alternative (A11): the params' alt_text plus the artist's-impression note. */
  readonly altText: string;
  /**
   * The shared field (D-12) the picture is drawn from, for the haptic sources. Null for kinds with
   * no field (nebula, nova) and for refused bodies. Directions are in the body frame; use
   * `worldToBody` to convert a world-space point.
   */
  readonly field: FieldSampler | null;
  /** Point sets in the body frame (nova; nebula haptics were dropped, Q-87), for the point-density haptic source. */
  readonly pointSets: Readonly<Record<string, PointSet>> | null;
  /** World point -> body frame (accounts for the group scale and the gas-giant tilt). */
  worldToBody(p: Vec3): Vec3;
  /** The quality level changed (volume steps and octaves). Optional: baked bodies ignore it. */
  setTier?(tier: TierName): void;
  setSunDirection(dir: Vec3): void;
  setVisibleTags(tags: readonly Tag[]): void;
  /** D-27. Rebuilds what the changed sliders affect; resolves when drawn. */
  setOverrides(overrides: Overrides): Promise<void>;
  dispose(): void;
}
