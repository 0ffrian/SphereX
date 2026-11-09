// Shared helpers for building a RenderPlan: the "refuse rather than invent" rules in one place.
// A layer is drawn only when (1) the backend offered it in RenderParams.layers, (2) every field
// it `requires` is present on the card, (3) its tag passes the honesty state, and (4) its mesh or
// texture did not fail to load. Otherwise it goes to `missing` with the reason. Never throws.
import type { CometEpoch, Layer, ObjectCard, RenderParams, Tag } from '@/contract';
import { isTagShown } from './honesty';
import { planLighting } from './lighting';
import { chooseMode, NEUTRAL_TINT, resolveModes, resolveTint } from './modes';
import type { LegendEntry, MissingItem, PlanContext, RenderPlan, Rgb, Vec3 } from './planTypes';
import { STILL_MOTION, TIER_OF_TAG } from './motion/motion';

const GREY_COLOUR_NOTE = 'Colour is plain grey: no colour data is shown at this honesty level.';

/** Pseudo layer id a moulding stage holds to show the body in plain grey (issue #60). */
export const HOLD_TINT = 'tint';

/** Half the length of the proper-motion line of a star, in scene units. A display value (artistic). */
export const TRAIL_HALF_LENGTH = 2.5;

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

/**
 * R6.2: ellipsoid axes from the light-curve amplitude, a/b = 10^(0.4 A), c = b (model_dependent).
 * Largest axis = 1. A light curve fixes a/b only: c is unconstrained, so c = b draws a cigar and a
 * disc fits the same data (the backend's `ellipsoid` layer says so in `assumed.c_axis`, Q-153).
 * There is no cap on the ratio: A = 2.5 mag (Meech et al. 2017, 'Oumuamua) gives a/b = 10, axes
 * [1, 0.1, 0.1].
 */
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
  /** Formula, else assumption, else source of the size value. */
  sizeWhy: string | null = null;
  /** Set false by a planner whose mode colour is not applied to anything drawn. */
  tintUsed = true;
  /** Add a legend line for the colour mode's tint (off where a named layer already is the colour). */
  tintLegend = true;
  private readonly evaluated = new Map<string, boolean>();

  constructor(readonly input: PlanInput) {
    const { card, params, ctx } = input;
    this.layers = new Map(params.layers.map((l) => [l.id, l]));
    this.modeInfo = resolveModes(params);
    this.missing.push(...this.modeInfo.missing);
    this.mode = chooseMode(ctx.mode, params.type, this.modeInfo.modes, ctx.honesty);
    // Issue #60 moulding: a held `tint` shows the plain grey stand-in until the Colour step.
    this.tint = ctx.hold?.includes(HOLD_TINT)
      ? { rgb: NEUTRAL_TINT, tag: null, source: null }
      : resolveTint(params, this.mode, ctx.honesty);
    this.lighting = planLighting(params, card);
    if (params.lighting.mode === 'sun' && this.lighting.source !== 'phase_angle') {
      // The body is lit anyway, from a display default, so the panel lists this as a default.
      this.refuse({
        id: 'lighting',
        reason: 'data',
        fields: ['phase_angle_deg'],
        defaultShown: 'There is no phase angle, so the light comes from the front.',
      });
    }
    if (this.tint.tag === null && this.mode !== null) {
      this.notes.push(GREY_COLOUR_NOTE);
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

  /**
   * A named layer is the colour (the gas giant's `colour`), so the "plain grey" note, written
   * before any layer is decided, no longer describes the screen: take it back.
   */
  colourIsDrawnByLayer(): void {
    const i = this.notes.indexOf(GREY_COLOUR_NOTE);
    if (i >= 0) this.notes.splice(i, 1);
  }

  has(id: string): boolean {
    return this.layers.has(id);
  }

  /**
   * Issue #60: a layer held back by the build animation (`ctx.hold`). It is not drawn and not
   * listed anywhere: the stage plan is a presentation step, the panel shows the full plan.
   */
  held(id: string): boolean {
    return this.ctx.hold?.includes(id) === true;
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
    if (this.held(id)) {
      this.evaluated.set(id, false);
      return false;
    }
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
        tier: layer.tier,
        description: layer.description,
        swatches: opts.swatches,
      });
    }
    this.evaluated.set(id, ok);
    return ok;
  }

  /**
   * A layer the viewer itself adds (shadows, baked AO, regolith, volumes): not offered by the
   * backend, so it is decided here from its own tag and the honesty state. Records it as drawn, or
   * as refused with reason `honesty`. A load failure (`ctx.failed`) refuses it with reason `load`.
   */
  drawLocal(id: string, tag: Tag, description: string): boolean {
    const cached = this.evaluated.get(id);
    if (cached !== undefined) return cached;
    if (this.held(id)) {
      this.evaluated.set(id, false);
      return false;
    }
    let ok = false;
    if (this.ctx.failed.includes(id)) this.refuse({ id, reason: 'load' });
    else if (!isTagShown(this.ctx.honesty, tag)) this.refuse({ id, reason: 'honesty', tag });
    else {
      ok = true;
      this.drawn.push({ id, tag, description });
    }
    this.evaluated.set(id, ok);
    return ok;
  }

  /** True when layer `id` could be drawn: offered, not refused, data present, tag shown. */
  ready(id: string): boolean {
    const layer = this.layers.get(id);
    return (
      layer !== undefined &&
      !this.held(id) &&
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
  refuseForEpoch(id: string, epoch: CometEpoch, note?: string): void {
    if (this.layers.has(id)) {
      this.evaluated.set(id, false);
      this.refuse({ id, reason: 'epoch', detail: epoch, note });
    }
  }

  /**
   * The plain body at the size on the card. R5.3 (as edited in issue #7, Q-45): Measured only
   * keeps the body "only when its size value is `measured`". Needs scale_m and the size field; its
   * tag is the size value's own tag, so an estimated size is hidden in Measured only.
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
    this.sizeWhy = tv!.formula ?? tv!.assumption ?? tv!.source ?? null;
    return true;
  }

  /**
   * Like body(), for a type whose size is optional (R7.5 star). A missing size is not a reason to
   * lose the body: it is drawn as a unit sphere with no scale bar, and `size` is listed as not
   * drawn. A size that is present but hidden by the honesty state is still refused (R5.3).
   */
  bodyOptionalSize(sizeField: SizeField): { ok: boolean; sizeKnown: boolean } {
    const tv = this.card[sizeField];
    if (this.params.scale_m === null || !isPresent(tv)) {
      this.refuse({
        id: 'size',
        reason: 'data',
        fields: [sizeField],
        detail: 'The size is unknown, so the sphere has no scale bar.',
      });
      return { ok: true, sizeKnown: false };
    }
    const ok = this.body(sizeField);
    return { ok, sizeKnown: ok };
  }

  /**
   * A drawn baked texture (albedo, bands) is in the backend's visible palette, so it is shown in
   * the visible mode only (colour = white, so the tint is not applied twice) and dropped in the
   * infrared mode, where the colour is the whole-body SPHEREx average (R5.2). Refused with
   * reason 'mode' in that case.
   */
  drawBaked(id: string, asset: string | null | undefined): boolean {
    if (!this.layers.has(id)) return false;
    if (this.mode === 'spherex_ir' && this.ready(id)) {
      this.reject({
        id,
        reason: 'mode',
        detail: 'Its colours are the visible palette, so it is left out of the infrared view.',
      });
      return false;
    }
    const ok = this.draw(id, { asset: asset ?? null });
    if (ok) this.tintLegend = false; // the texture is the colour; no second colour line
    return ok;
  }

  /** Legend line for the plain body, for plans where no named layer covers it. */
  legendBody(description: string): void {
    if (this.sizeTag)
      this.drawn.push({
        id: 'body',
        tag: this.sizeTag,
        tier: TIER_OF_TAG[this.sizeTag],
        description,
      });
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
        tier: TIER_OF_TAG[this.tint.tag],
        description: info?.badge || 'Body colour',
      });
    }
    // A size whose tag the honesty state hides (or that was refused) is not shown anywhere,
    // including the scale bar and the alt text: no unlabelled estimated number.
    const sizeTag = 'sizeTag' in over ? (over.sizeTag ?? null) : this.sizeTag;
    const sizeWhy =
      sizeTag === null ? null : 'sizeWhy' in over ? (over.sizeWhy ?? null) : this.sizeWhy;
    const plan: RenderPlan = {
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
      volumes: [],
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
      sizeQualifier: null,
      sizeWhy,
      tintUsed: this.tintUsed,
      extent: 1,
      spin: null,
      scrub: null,
      relief: 'illustrative',
      shader: null,
      motion: STILL_MOTION,
      star: null,
      jets: null,
      pulsation: null,
      shape: null,
      ...over,
    };
    plan.sizeWhy = sizeWhy;
    plan.extent = over.extent ?? sceneExtent(plan);
    return plan;
  }
}

/** True when the plan puts something on screen: a body, or a generated body with a part shown. */
export function showsBody(plan: RenderPlan): boolean {
  return (
    plan.bodies.length > 0 || (plan.shader !== null && (plan.shader.surface || plan.shader.plain))
  );
}

/** The largest distance from the origin to anything the plan draws (at least 1, the unit sphere). */
export function sceneExtent(plan: RenderPlan): number {
  let e = 1;
  for (const b of plan.bodies) {
    e = Math.max(e, Math.hypot(...b.position) + Math.max(...b.axes));
  }
  for (const s of plan.shells) e = Math.max(e, s.outerRadius);
  for (const d of plan.discs) e = Math.max(e, d.outerRadius);
  for (const s of plan.screens) e = Math.max(e, Math.hypot(s.radius, s.z));
  if (plan.trails.length > 0) e = Math.max(e, TRAIL_HALF_LENGTH);
  if (plan.dust) e = Math.max(e, 1);
  for (const v of plan.volumes) {
    e = Math.max(e, Math.hypot(...v.center) + Math.hypot(...v.halfExtent));
  }
  return e;
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
    heightUrl: null,
    displacementScale: null,
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
