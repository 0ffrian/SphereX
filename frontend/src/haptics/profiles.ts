// R8.5 per-type haptic profiles (D-12, D-21). `buildHaptics` reads `params.haptics` (the backend's
// HapticProfile) and the card, and builds at most one texture source and one data source for any of
// the 14 ObjectTypes. Anything the data cannot back is refused and listed in `missing`, never
// invented (R1 principle 3). `TouchHaptics` drives the two sources from the probe's samples:
// moving gives texture events, holding still gives the data pulse (R8.5 "holding still").
//
// Tags (R8.2): texture events carry `texture_tag`; data events carry `data_tag`, except
// `teq_pulse` (teq_K's own tag, D-12) and the binary pulse (spectral_class's tag, Q-81). The
// honesty filter is the engine's (D-21): sources never check it, so Measured only silences every
// non-`measured` event in one place.
//
// Shader kinds reuse the body's own field and point sets (BodyRenderer.field, .pointSets): they
// include the D-27 slider overrides, which a fresh requestField / requestPoints would miss.
import type { CometEpoch, ObjectCard, RenderParams, Tag } from '@/contract';
import type { FieldSampler } from '@/viewer/fields/fieldGenerator';
import type { BodyPlan } from '@/viewer/planTypes';
import { numberField } from '@/viewer/planCommon';
import { BROWN_DWARF_CONFIG, binaryClasses } from '@/viewer/renderers/BrownDwarf';
import { COMET_EPOCHS, GAS_STYLE, gasQForEpoch } from '@/viewer/renderers/Comet';
import type { PointSet } from '@/viewer/renderers/pointClouds';
import { isShaderKind, resolveShaderSpec } from '@/viewer/renderers/shaderSpec';
import type { Overrides } from '@/viewer/sliders';
import type { ProbeBody, TouchProbeOptions } from './probe';
import {
  BinaryPulseSource,
  binaryRates,
  HoldPulseSource,
  normaliseTeq,
  pulseRateHz,
} from './sources/dataPulse';
import { CometFieldSource, PointDensitySource } from './sources/field';
import { FlowSource } from './sources/flow';
import {
  CRATER_RIMS_MISSING,
  HeightMapSource,
  isHydrated,
  type HeightGrid,
} from './sources/heightMap';
import {
  hasUsableLightcurve,
  MiraHeartbeatSource,
  TTauriDimmingSource,
} from './sources/lightcurve';
import { MeshNormalSource } from './sources/meshNormal';
import { TerrainSource } from './sources/terrain';
import type { HapticSink, HapticSource, TouchSample, Vec3 } from './sources/types';
import { HOLD_STILL_MS, HOLD_STILL_TOLERANCE_PX } from './tuning';

/** The parts of a BodyRenderer (renderers/bodyRenderer.ts) the haptics read. */
export interface HapticBody {
  readonly field: FieldSampler | null;
  readonly pointSets: Readonly<Record<string, PointSet>> | null;
  worldToBody(p: readonly [number, number, number]): readonly [number, number, number];
}

export type CometGas = (typeof GAS_STYLE)[number]['key'];

/** The parts of a RenderPlan body (planTypes.ts BodyPlan) the haptics read. */
export type PlanBodyLike = Pick<BodyPlan, 'id' | 'axes'>;

export interface BuildHapticsOptions {
  /**
   * D-27 slider overrides the body was built with. Required (pass `{}` for none): the gas-giant
   * wind, storms and rings are re-derived from them, and the BodyRenderer does not expose its
   * field parameters, so a missing value would let the felt flow drift from the drawn bands.
   */
  overrides: Overrides;
  /** The built RenderPlan's bodies (planned kinds). The comet's felt nucleus is its `nucleus` body. */
  planBodies?: readonly PlanBodyLike[];
  /**
   * asteroid_shape: true once the viewer fills `TouchSample.normal` from a real mesh raycast
   * (three-mesh-bvh). Until then the mesh texture is refused (a bounding sphere is not the shape).
   */
  meshNormals?: boolean;
  /** Comet: the selected epoch. Default: the first epoch of COMET_EPOCHS with any Q. */
  epoch?: CometEpoch;
  /** Comet: the gas selected on the spectrum. Default: the first gas (CO₂, H₂O, CO) with Q. */
  gas?: CometGas;
  /** asteroid_procedural: the decoded `height.bin` (`loadHeightGrid`). */
  heightGrid?: HeightGrid | null;
  /** Brown dwarf `flux_45um` reference. Default: BROWN_DWARF_CONFIG.flux45Reference (R12 #15). */
  flux45Reference?: number | null;
}

export interface HapticsBuild {
  texture: HapticSource | null;
  data: HapticSource | null;
  /** Gas giant rings are drawn and felt: the probe must report the ring radius (`shaderProbeOptions`). */
  rings: boolean;
  /** Haptics refused for missing or unverified data (ids, as RenderParams.missing). */
  missing: string[];
}

/** `missing` ids. The profile's own names, except where a layer already uses the name. */
export const MISSING = {
  height: 'height',
  craterRims: CRATER_RIMS_MISSING,
  meshNormals: 'mesh_normals',
  nucleus: 'nucleus_tick',
  bands: 'band_ticks',
  terrain: 'terrain',
  flow: 'flow',
  field: 'field',
  teq: 'teq_pulse',
  flux: 'flux_pulse',
  binary: 'binary_pulse',
  heartbeat: 'heartbeat',
  dimming: 'dimming',
  motion: 'motion',
  detections: 'detections',
} as const;

function cardTag(card: ObjectCard, field: keyof ObjectCard): Tag | null {
  const v = card[field] as { tag?: Tag } | undefined;
  return v?.tag ?? null;
}

/** Comet Q for (epoch, gas) ÷ the largest Q of any gas in any epoch (`planShells`), or null. */
export function cometQNorm(card: ObjectCard, epoch: CometEpoch, gas?: CometGas): number | null {
  const qv = (e: CometEpoch, g: CometGas): number | null => {
    const v = gasQForEpoch(card, e)?.[g]?.value;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  };
  let qMax = 0;
  for (const e of COMET_EPOCHS) for (const g of GAS_STYLE) qMax = Math.max(qMax, qv(e, g.key) ?? 0);
  if (qMax === 0) return null;
  const key = gas ?? GAS_STYLE.find((g) => qv(epoch, g.key) !== null)?.key;
  const q = key ? qv(epoch, key) : null;
  return q === null ? null : q / qMax;
}

function defaultEpoch(card: ObjectCard): CometEpoch {
  return COMET_EPOCHS.find((e) => cometQNorm(card, e) !== null) ?? COMET_EPOCHS[0]!;
}

/** Radius of the drawn comet nucleus (the plan's `nucleus` body), or null when not given. */
export function drawnNucleusRadius(bodies: readonly PlanBodyLike[] | undefined): number | null {
  const n = bodies?.find((b) => b.id === 'nucleus');
  return n ? Math.max(n.axes[0], n.axes[1], n.axes[2]) : null;
}

/**
 * Build the texture and data sources of one object (R8.5). Pure apart from the sources it makes;
 * call it again when the body, the overrides, the epoch or the selected gas change.
 * `body` is the shader kinds' BodyRenderer (null for the planned kinds, or while it is refused).
 */
export function buildHaptics(
  engine: HapticSink,
  params: RenderParams,
  card: ObjectCard,
  body: HapticBody | null,
  options: BuildHapticsOptions,
): HapticsBuild {
  const profile = params.haptics;
  const missing: string[] = [];
  const refuse = (id: string): null => {
    if (!missing.includes(id)) missing.push(id);
    return null;
  };
  const num = (k: string): number | undefined => {
    const v = profile.params[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };

  // ---- texture
  let texture: HapticSource | null = null;
  let rings = false;
  const tt = profile.texture_tag;
  switch (profile.texture) {
    case 'none':
      break;
    case 'height': {
      // R8.4 item 3 needs a crater mask the bake does not ship: refused (Q-78).
      refuse(MISSING.craterRims);
      const grid = options.heightGrid ?? null;
      texture = grid
        ? new HeightMapSource(engine, grid, tt, {
            tauFraction: num('tau'),
            hydrated: isHydrated(card),
          })
        : refuse(MISSING.height);
      break;
    }
    case 'mesh':
      // Only a real mesh raycast can say where a face turns or where the silhouette is; a bounding
      // sphere would invent `measured` ticks. Refused until the viewer provides the normals (Q-78).
      texture = options.meshNormals
        ? new MeshNormalSource(engine, tt)
        : refuse(MISSING.meshNormals);
      break;
    case 'bands':
      // Brown dwarf bands are only in the baked albedo image; the client has no band index to
      // tick on, so the band-boundary ticks are refused (Q-82).
      texture = refuse(MISSING.bands);
      break;
    case 'terrain': {
      const field = body?.field ?? null;
      texture = field
        ? new TerrainSource(engine, field, tt, {
            tauFraction: num('tau'),
            lava: params.type === 'planet_rocky',
          })
        : refuse(MISSING.terrain);
      break;
    }
    case 'flow': {
      const field = body?.field ?? null;
      const spec =
        isShaderKind(params.type) && card.type === params.type
          ? resolveShaderSpec(card, params, options.overrides)
          : null;
      if (field && spec?.field?.kind === 'gas') {
        const flow = new FlowSource(engine, field, spec.field, tt, {
          k: num('k'),
          // A solved gas world (issue #71) says itself whether it has rings.
          rings: field.flow ? (field.flow.ring ? 1 : 0) : (spec.gas?.rings ?? 0),
        });
        rings = flow.feelsRings;
        texture = flow;
      } else {
        texture = refuse(MISSING.flow);
      }
      break;
    }
  }

  // ---- data
  let data: HapticSource | null = null;
  const dt = profile.data_tag;
  switch (profile.data) {
    case 'none':
      break;
    case 'teq_pulse': {
      const teq = numberField(card, 'teq_K');
      const tag = cardTag(card, 'teq_K');
      data =
        teq !== null && tag !== null
          ? new HoldPulseSource(
              engine,
              'teq_pulse',
              tag,
              pulseRateHz(normaliseTeq(teq), num('maxRateHz')),
            )
          : refuse(MISSING.teq);
      break;
    }
    case 'flux_pulse': {
      if (params.type === 'brown_dwarf_binary') {
        const rates = binaryRates(binaryClasses(card.spectral_class?.value));
        const tag = cardTag(card, 'spectral_class');
        data = rates && tag ? new BinaryPulseSource(engine, tag, rates) : refuse(MISSING.binary);
        break;
      }
      const ref =
        options.flux45Reference !== undefined
          ? options.flux45Reference
          : BROWN_DWARF_CONFIG.flux45Reference;
      const flux = numberField(card, 'flux_45um');
      // R12 #15: no verified normalisation, no pulse.
      data =
        ref !== null && ref > 0 && flux !== null
          ? new HoldPulseSource(engine, 'flux_pulse', dt, pulseRateHz(flux / ref, num('maxRateHz')))
          : refuse(MISSING.flux);
      break;
    }
    case 'field': {
      if (params.type === 'comet') {
        const epoch = options.epoch ?? defaultEpoch(card);
        const qNorm = cometQNorm(card, epoch, options.gas);
        // The felt nucleus is the drawn one (the plan's `nucleus` body); without it, no tick.
        const nucleus = drawnNucleusRadius(options.planBodies);
        if (qNorm !== null && nucleus === null) refuse(MISSING.nucleus);
        data =
          qNorm !== null
            ? new CometFieldSource(engine, dt, {
                qNorm,
                nucleusRadius: nucleus ?? -1,
                k: num('k'),
                maxRateHz: num('maxRateHz'),
              })
            : refuse(MISSING.field);
      } else {
        const sets = body?.pointSets ?? null;
        data =
          sets && Object.keys(sets).length > 0
            ? new PointDensitySource(engine, sets, dt, { maxRateHz: num('maxRateHz') })
            : refuse(MISSING.field);
      }
      break;
    }
    case 'heartbeat':
      data = hasUsableLightcurve(card)
        ? new MiraHeartbeatSource(engine, card, dt)
        : refuse(MISSING.heartbeat);
      break;
    case 'dimming': {
      const src = new TTauriDimmingSource(engine, card, dt);
      data = src.depthAt(0) !== null ? src : refuse(MISSING.dimming);
      break;
    }
    case 'motion':
      // R12 #16: the SPHEREx baseline (STAR_CONFIG.spherexBaselineYears) is unverified, so the
      // trail is refused and there is nothing to trace.
      data = refuse(MISSING.motion);
      break;
    case 'detections':
      // The flipbook frames carry no detection field: nothing to tick on.
      data = refuse(MISSING.detections);
      break;
  }

  return { texture, data, rings, missing };
}

/**
 * Probe set-up for a shader kind's BodyRenderer: one unit sphere in the body frame, and the ring
 * plane exactly when `build` feels the rings (one source for both).
 */
export function shaderProbeOptions(
  body: HapticBody,
  build: Pick<HapticsBuild, 'rings'>,
): TouchProbeOptions {
  return {
    bodies: [{ id: 'body', position: [0, 0, 0], axes: [1, 1, 1] }],
    toBody: (p) => body.worldToBody(p),
    rings: build.rings,
  };
}

/** Probe bodies for the planned kinds, from RenderPlan.bodies (scene units). */
export function planProbeBodies(bodies: readonly BodyPlan[]): ProbeBody[] {
  return bodies.map((b) => ({ id: b.id, position: toTriple(b.position), axes: toTriple(b.axes) }));
}

function toTriple(v: readonly number[]): Vec3 {
  return [v[0]!, v[1]!, v[2]!];
}

/**
 * Drives one object's sources in Touch mode (R8.5).
 *   - `move` on every pointermove: texture events, and the 'move' data sources (comet, clouds,
 *     binary). Moving more than HOLD_STILL_TOLERANCE_PX stops a held data pulse.
 *   - `poll(now)` from the frame loop while a finger is down: once it has been still for
 *     HOLD_STILL_MS, the 'hold' data pulse starts (pointermove does not fire while still, and the
 *     sources own no timers).
 *   - `scrub(index)` / `endScrub()` from the light-curve scrubber.
 *   - `release()` on pointerup, pointercancel or pointerleave.
 * One train plays at a time (engine rule): the data pulse replaces a texture train while held.
 */
export class TouchHaptics {
  private anchorX = NaN;
  private anchorY = NaN;
  private anchorT = 0;
  private holding = false;
  private last: TouchSample | null = null;

  constructor(
    readonly build: HapticsBuild,
    private readonly holdMs: number = HOLD_STILL_MS,
    private readonly tolerancePx: number = HOLD_STILL_TOLERANCE_PX,
  ) {}

  get isHolding(): boolean {
    return this.holding;
  }

  move(s: TouchSample): void {
    const { texture, data } = this.build;
    this.last = s;
    const moved =
      !Number.isFinite(this.anchorX) ||
      Math.hypot(s.xPx - this.anchorX, s.yPx - this.anchorY) > this.tolerancePx;
    if (moved) {
      this.anchorX = s.xPx;
      this.anchorY = s.yPx;
      this.anchorT = s.timeMs;
      if (this.holding) {
        this.holding = false;
        data?.release();
      }
    }
    if (this.holding) return; // still: the data pulse keeps playing
    texture?.move(s);
    if (data && data.trigger !== 'scrub') data.move(s);
    this.poll(s.timeMs);
  }

  poll(nowMs: number): void {
    const data = this.build.data;
    if (this.holding || !this.last || data?.trigger !== 'hold') return;
    if (nowMs - this.anchorT < this.holdMs) return;
    this.holding = true;
    data.hold?.(this.last);
  }

  scrub(index: number): void {
    const data = this.build.data;
    if (data?.trigger === 'scrub') data.scrub?.(index);
  }

  endScrub(): void {
    const data = this.build.data;
    if (data?.trigger === 'scrub') data.release();
  }

  release(): void {
    const data = this.build.data;
    this.build.texture?.release();
    if (data && data.trigger !== 'scrub') data.release();
    this.holding = false;
    this.last = null;
    this.anchorX = NaN;
    this.anchorY = NaN;
  }
}
