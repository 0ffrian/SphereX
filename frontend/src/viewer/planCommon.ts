// Shared helpers for building a RenderPlan: the "refuse rather than invent" rules in one place.
// A layer is drawn only when (1) the backend offered it in RenderParams.layers, (2) every field
// it `requires` is present on the card, (3) its tag passes the honesty state, and (4) its mesh or
// texture did not fail to load. Otherwise it goes to `missing` with the reason. Never throws.
import type { CometEpoch, Layer, ObjectCard, RenderParams, Tag } from '@/contract';
import { isTagShown } from './honesty';
import { planLighting } from './lighting';
import { chooseMode, resolveModes, resolveTint } from './modes';
import type { LegendEntry, MissingItem, PlanContext, RenderPlan, Rgb, Vec3 } from './planTypes';

export interface PlanInput {
  card: ObjectCard;
  params: RenderParams;
  ctx: PlanContext;
}

/** True when a card value is present: a TV with a non-null value, a non-empty array, or an object holding one. */
export function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') {
    if ('value' in v) return (v as { value: unknown }).value !== null;
    return Object.values(v).some(isPresent);
  }
  return true;
}

export function missingFields(card: ObjectCard, requires: readonly string[]): string[] {
  const rec = card as unknown as Record<string, unknown>;
  return requires.filter((f) => !isPresent(rec[f]));
}

/** Numeric value of a TV field, or null. */
export function numberField(card: ObjectCard, field: keyof ObjectCard): number | null {
  const v = card[field] as { value?: unknown } | undefined;
  return typeof v?.value === 'number' && Number.isFinite(v.value) ? v.value : null;
}

/** R6.2: ellipsoid axes from the light-curve amplitude, a/b = 10^(0.4 A), c = b (model_dependent). Largest axis = 1. */
export function ellipsoidAxes(ampMag: number | null): Vec3 {
  if (ampMag === null || ampMag < 0) return [1, 1, 1];
  const ratio = Math.pow(10, 0.4 * ampMag);
  const b = 1 / ratio;
  return [1, b, b];
}

export type SizeField = 'diameter_km' | 'radius_rjup' | 'radius_rsun' | 'nucleus_radius_km_max';

export class PlanBuilder {
  readonly drawn: LegendEntry[] = [];
  readonly missing: MissingItem[] = [];
  readonly notes: string[] = [];
  readonly layers: Map<string, Layer>;
  readonly modeInfo: ReturnType<typeof resolveModes>;
  readonly mode: ReturnType<typeof chooseMode>;
  readonly tint: ReturnType<typeof resolveTint>;
  readonly lighting: ReturnType<typeof planLighting>;
  sizeTag: Tag | null = null;
  /** Add a legend line for the colour mode's tint (off where a named layer already is the colour). */
  tintLegend = true;
  private readonly evaluated = new Map<string, boolean>();

  constructor(readonly input: PlanInput) {
    const { card, params, ctx } = input;
    this.layers = new Map(params.layers.map((l) => [l.id, l]));
    this.modeInfo = resolveModes(params);
    this.missing.push(...this.modeInfo.missing);
    this.mode = chooseMode(ctx.mode, params.type, this.modeInfo.modes);
    this.tint = resolveTint(params, this.mode, ctx.honesty);
    this.lighting = planLighting(params, card);
    if (params.lighting.mode === 'sun' && this.lighting.source !== 'phase_angle') {
      this.refuse({ id: 'lighting', reason: 'data', fields: ['phase_angle_deg'] });
      this.notes.push(
        'No phase angle: the light comes from the front, which is a display default.',
      );
    }
    if (this.tint.tag === null && this.mode !== null) {
      this.notes.push('Colour is plain grey: no colour data is shown at this honesty level.');
    }
  }

  get card(): ObjectCard {
    return this.input.card;
  }
  get params(): RenderParams {
    return this.input.params;
  }
  get ctx(): PlanContext {
    return this.input.ctx;
  }

  has(id: string): boolean {
    return this.layers.has(id);
  }

  isDrawn(id: string): boolean {
    return this.evaluated.get(id) === true;
  }

  refuse(item: MissingItem): void {
    if (!this.missing.some((m) => m.id === item.id)) this.missing.push(item);
  }

  /**
   * Decide whether layer `id` is drawn. Returns false (and records why) if not. A layer the
   * backend did not offer is simply absent: not drawn and not listed.
   */
  draw(
    id: string,
    opts: { swatches?: LegendEntry['swatches']; asset?: string | null } = {},
  ): boolean {
    const cached = this.evaluated.get(id);
    if (cached !== undefined) return cached;
    const layer = this.layers.get(id);
    if (!layer) return false;
    let ok = false;
    const fields = missingFields(this.card, layer.requires);
    if (this.params.missing.includes(id)) {
      this.refuse({ id, reason: 'backend' });
    } else if (this.ctx.failed.includes(id)) {
      this.refuse({ id, reason: 'load' });
    } else if (fields.length > 0) {
      this.refuse({ id, reason: 'data', fields });
    } else if (!isTagShown(this.ctx.honesty, layer.tag)) {
      this.refuse({ id, reason: 'honesty', tag: layer.tag });
    } else if (opts.asset === null) {
      // The layer needs a mesh or texture and the data holds no usable address for it.
      this.refuse({ id, reason: 'load', detail: 'There is no usable file address for it.' });
    } else {
      ok = true;
      this.drawn.push({
        id,
        tag: layer.tag,
        description: layer.description,
        swatches: opts.swatches,
      });
    }
    this.evaluated.set(id, ok);
    return ok;
  }

  /** True when layer `id` could be drawn: offered, not refused, data present, tag shown. */
  ready(id: string): boolean {
    const layer = this.layers.get(id);
    return (
      layer !== undefined &&
      !this.params.missing.includes(id) &&
      !this.ctx.failed.includes(id) &&
      missingFields(this.card, layer.requires).length === 0 &&
      isTagShown(this.ctx.honesty, layer.tag)
    );
  }

  /** Refuse layer `id` for a reason of the caller's own (e.g. an unverified reference value). */
  reject(item: MissingItem): void {
    this.evaluated.set(item.id, false);
    this.refuse(item);
  }

  /** Nothing to draw it on: move every drawn layer to `missing` (the body itself was refused). */
  dropDrawn(): void {
    for (const d of this.drawn.splice(0)) {
      this.evaluated.set(d.id, false);
      this.refuse({ id: d.id, reason: 'data', detail: 'There is no body to draw it on.' });
    }
  }

  /** Like draw() for a part that exists only in some comet epochs. */
  refuseForEpoch(id: string, epoch: CometEpoch): void {
    if (this.layers.has(id)) {
      this.evaluated.set(id, false);
      this.refuse({ id, reason: 'epoch', detail: epoch });
    }
  }

  /**
   * The plain sphere/ellipsoid at the size on the card (R5.3: "a plain sphere/ellipsoid at
   * measured size" is what Measured only keeps). Needs scale_m and the size field; its tag is the
   * size value's own tag, so an estimated size is hidden in Measured only.
   */
  body(sizeField: SizeField): boolean {
    const tv = this.card[sizeField];
    if (this.params.scale_m === null || !isPresent(tv)) {
      this.refuse({
        id: 'body',
        reason: 'data',
        fields: [sizeField],
        detail: this.params.scale_m === null ? 'The physical size is unknown.' : undefined,
      });
      return false;
    }
    if (!isTagShown(this.ctx.honesty, tv!.tag)) {
      this.refuse({ id: 'body', reason: 'honesty', tag: tv!.tag });
      return false;
    }
    this.sizeTag = tv!.tag;
    return true;
  }

  /** Legend line for the plain body, for plans where no named layer covers it. */
  legendBody(description: string): void {
    if (this.sizeTag) this.drawn.push({ id: 'body', tag: this.sizeTag, description });
  }

  build(over: Partial<RenderPlan>): RenderPlan {
    // Backend refusals not already evaluated.
    for (const id of this.params.missing) this.refuse({ id, reason: 'backend' });
    const hasBody = (over.bodies?.length ?? 0) > 0;
    if (hasBody && this.tintLegend && this.tint.tag !== null) {
      const info = this.modeInfo.modes.find((m) => m.id === this.mode);
      this.drawn.push({
        id: 'tint',
        tag: this.tint.tag,
        description: info?.badge || 'Body colour',
      });
    }
    // A size whose tag the honesty state hides (or that was refused) is not shown anywhere,
    // including the scale bar and the alt text: no unlabelled estimated number.
    const sizeTag = 'sizeTag' in over ? (over.sizeTag ?? null) : this.sizeTag;
    return {
      id: this.params.id,
      type: this.params.type,
      name: this.card.name,
      threeD: true,
      message: null,
      bodies: [],
      shells: [],
      discs: [],
      screens: [],
      trails: [],
      dust: null,
      drawn: this.drawn,
      missing: this.missing,
      notes: this.notes,
      honesty: this.ctx.honesty,
      mode: this.mode,
      modes: this.modeInfo.modes,
      tint: this.tint,
      epoch: null,
      epochs: [],
      lighting: this.lighting,
      scaleM: sizeTag !== null ? this.params.scale_m : null,
      sizeTag,
      spin: null,
      scrub: null,
      relief: 'illustrative',
      ...over,
    };
  }
}

export const DEFAULT_SEGMENTS: [number, number] = [64, 32];

/** Lit body with a flat tint. */
export function litBody(
  id: string,
  axes: Vec3,
  tint: Rgb,
  extra: Partial<import('./planTypes').BodyPlan> = {},
): import('./planTypes').BodyPlan {
  return {
    id,
    axes,
    position: [0, 0, 0],
    segments: DEFAULT_SEGMENTS,
    tint,
    emissive: 0,
    limbDarkening: false,
    roughness: 0.95,
    meshUrl: null,
    albedoUrl: null,
    normalUrl: null,
    ...extra,
  };
}

/** Median of a list of numbers; null for an empty list. */
export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
