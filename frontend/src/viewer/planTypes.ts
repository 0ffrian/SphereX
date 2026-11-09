// Types of the render plan: the pure, GPU-free description of what the viewer draws for one
// ObjectCard + RenderParams under one honesty state, view mode and epoch. Renderers produce a
// plan; renderers/build.ts turns it into three.js objects. Tests inspect the plan.
import type { CometEpoch, ObjectCard, ObjectType, RenderParams, Tag } from '@/contract';
import type { HonestyState } from './honesty';
import type { LightingPlan } from './lighting';
import type { Motion } from './motion/motion';
import type { StarRates } from './bodies/starModel';
import type { GasSwitches } from './renderers/shaderSpec';
import type { Overrides } from './sliders';

export type Rgb = [number, number, number];
export type Vec3 = [number, number, number];

export type ViewModeId = 'visible' | 'spherex_ir';

/** Why a layer or mode was not drawn. Plain-word text lives in app/messages.ts. */
export type MissingReason =
  /** The tag is hidden by the honesty state. */
  | 'honesty'
  /** A field the layer `requires` is missing from the card. */
  | 'data'
  /** The backend listed it in RenderParams.missing. */
  | 'backend'
  /** A mesh or texture failed to load. */
  | 'load'
  /** Not part of the selected comet epoch. */
  | 'epoch'
  /** Not shown in the selected view mode (a baked texture is in visible-palette colour). */
  | 'mode'
  /** A reference value is still [verify]; nothing is invented in its place. */
  | 'unverified';

export interface MissingItem {
  id: string;
  reason: MissingReason;
  /** Honesty: the tag that is hidden. Data: the missing field names. Other: free text. */
  tag?: Tag;
  fields?: string[];
  detail?: string;
  /** An extra plain sentence for the list (why an epoch has nothing). */
  note?: string;
  /**
   * Set when the thing is not drawn from data but IS shown as a display default (the light
   * comes from the front, the glow is at a fixed level). The panel lists it with a Default chip.
   */
  defaultShown?: string;
}

export interface LegendEntry {
  id: string;
  tag: Tag;
  /** Provenance tier 1 to 5 of the layer (D-32), shown next to the badge. */
  tier?: number;
  description: string;
  /** Colour key for layers with several parts (comet gas shells). */
  swatches?: { label: string; css: string }[];
}

export interface ModeInfo {
  id: ViewModeId;
  label: string;
  available: boolean;
  /** The backend's badge text for the mode, e.g. "Estimated visible colour". */
  badge: string;
  tag: Tag | null;
  source: 'gaia_rgb' | 'class_palette' | 'spherex_rgb' | null;
}

export interface Tint {
  rgb: Rgb;
  /** null = plain grey stand-in, no colour data shown. */
  tag: Tag | null;
  source: ModeInfo['source'];
}

export interface SpinPlan {
  periodH: number;
  /** Speed-up factor shown on screen ("×1000"). */
  speedup: number;
}

export interface BodyPlan {
  id: string;
  /** Semi-axes in scene units; the largest is at most 1. */
  axes: Vec3;
  position: Vec3;
  segments: [number, number];
  tint: Rgb;
  /** 0 = lit by the Sun light. Above 0 = self-luminous, colour times this value. */
  emissive: number;
  limbDarkening: boolean;
  /**
   * Linear limb-darkening coefficient `u` of a self-luminous body, `I(mu) = 1 - u (1 - mu)`. Unset:
   * the star's R7.5 value when `limbDarkening` is on.
   */
  limbU?: number | null;
  /**
   * The baked albedo is drawn as brightness only, on the body's own colour (the infrared view of a
   * brown dwarf, issue #62): the pattern is a look, the colour stays the SPHEREx average (R5.2).
   */
  albedoLuma?: boolean;
  roughness: number;
  meshUrl: string | null;
  albedoUrl: string | null;
  normalUrl: string | null;
  /** Baked height map (R6.3) and the displacement it drives, in units of the radius; null = none. */
  heightUrl: string | null;
  displacementScale: number | null;
}

/**
 * How a shape-model asteroid (R7.1) is lit and detailed. Each flag is a drawn layer of the plan:
 * Lommel-Seeliger reflectance always; the rest only when the plan lists them as drawn.
 */
export interface ShapePlan {
  /** Lommel-Seeliger reflectance (A7.4, model_dependent); otherwise a standard material. */
  lommelSeeliger: boolean;
  /** Sun light casts a shadow map: crater rims shadow the surface at low Sun. */
  shadows: boolean;
  /** Baked per-vertex ambient occlusion. */
  ao: boolean;
  /** Fine regolith normals below the model's resolution (tier 5, artistic). */
  regolith: boolean;
}

export interface ShellPlan {
  id: string;
  label: string;
  css: string;
  count: number;
  innerRadius: number;
  outerRadius: number;
  /** 0..1, proportional to Q. */
  brightness: number;
  seed: number;
}

export interface DiscPlan {
  id: string;
  innerRadius: number;
  outerRadius: number;
  inclinationDeg: number;
  /**
   * Flaring (issue #62, R7.5): the half-thickness of the disc is `heightAtInner` at the inner edge
   * and grows as `(r / innerRadius) ^ flareExponent`. Scene units; artistic.
   */
  heightAtInner: number;
  flareExponent: number;
}

export interface ScreenPlan {
  id: string;
  radius: number;
  z: number;
  opacity: number;
}

export interface TrailPlan {
  id: string;
  /** Proper-motion direction (RA, Dec) in mas/yr. */
  pm: [number, number];
  years: number;
}

export interface DustPlan {
  id: string;
  direction: Vec3;
  count: number;
  seed: number;
  tint: Rgb;
}

/** What a ray-marched emission volume shows (issue #43; R7.3 comets, R7.7 remnants and nebulae). */
export type VolumeKind = 'coma' | 'dust' | 'ion_tail' | 'dust_tail' | 'remnant' | 'nebula';

/**
 * One emission-only volume (replaces point sprites). Pure data: `volume/VolumeBody.ts` draws it.
 * The volume lives in a box of semi-axes `halfExtent` (scene units) centred on `center`; `basis`
 * turns the box's local x axis toward `axis` for tails. Every colour and density is a display value
 * and the volume carries its layer's tag.
 */
export interface VolumePlan {
  id: string;
  kind: VolumeKind;
  tag: Tag;
  halfExtent: Vec3;
  center: Vec3;
  /** Tails and the dust cone: unit direction of the box's local +x. Null for symmetric volumes. */
  axis: Vec3 | null;
  /** Tails: unit direction the centre line bends toward (perpendicular to `axis`). */
  bend: Vec3 | null;
  /** Tail bend as a fraction of the tail length (the dust tail); 0 for a straight tail. */
  bendFraction: number;
  seed: number;
  /** Up to three emitters: colour (linear sRGB) and gain in 0..1. */
  emitters: { label: string; rgb: Rgb; gain: number }[];
  /** Strength of the dust absorption lanes, 0..1 (0 = none). */
  dust: number;
  /** Remnant: radius of the line-emitting shell as a fraction of the box half-size, 0..1. */
  shell: number;
}

export interface ScrubPlan {
  count: number;
  index: number;
  tMjd: number;
  /** 0..1 relative to the brightest usable point. */
  brightness: number;
  /** Points excluded because their flags are non-zero. */
  flagged: number;
}

/**
 * The shader-generated kinds (D-01: planet_rocky, planet_water, gas_giant, nebula, nova). The
 * plan holds no geometry; `buildScene` makes a ShaderBody from `card` and `params`, which draws the
 * surface from the shared CPU field (D-12). Everything that shows or hides it is decided here.
 */
export interface ShaderPlan {
  card: ObjectCard;
  params: RenderParams;
  /**
   * What the body is built from (the resolved spec: seed, field, style). Honesty, light and mode
   * are not in it, so a change of those updates the body in place instead of regenerating the field.
   */
  key: string;
  /** The generated surface (or point cloud) is shown at this honesty level. */
  surface: boolean;
  /**
   * Gas giants (issue #62): which of the five layers are drawn (honesty level, refusals and the
   * build animation's holds applied). Null for every other kind; `surface` is true when any is on.
   */
  gas: GasSwitches | null;
  /** The plain grey sphere is shown: the surface is hidden and the size on the card is shown (Q-45). */
  plain: boolean;
  /** Camera distance that frames the body, in scene units (display value). */
  distance: number;
}

/**
 * What the star surface draws (issue #42, R7.5.1). Each flag is one layer of the tier chain (D-32):
 * on only when the layer's tag is shown at this honesty state and its inputs exist. `rates` are the
 * CPU model's inputs (spot lifetime, spin, differential rotation, flare rate), from `dynamics`.
 */
export interface StarSurfacePlan {
  seed: number;
  granulation: boolean;
  spots: boolean;
  faculae: boolean;
  flares: boolean;
  prominences: boolean;
  /** The strand look of the loops (tier 5); off draws one plain arch per group (tier 4). */
  strands: boolean;
  glow: boolean;
  rates: StarRates;
}

/**
 * A brown dwarf drawn by the browser with moving jets instead of the baked band texture (R7.4,
 * issue #42). `cover` is the cloud cover from the light curve (0..1), which changes with the
 * scrub and is applied in place, so it is not part of the scene key.
 */
export interface JetSurfacePlan {
  seed: number;
  /** Band count: from the Rhines rule when the spin and the wind are known (A7.2), else the artist default. */
  bands: number;
  turbulence: number;
  storms: number;
  /** R7.4: clamp(2 * ch4_depth_33, 0.1, 0.8). */
  contrast: number;
  /** Cloud cover patches follow the light curve (layer `cloud_cover`). */
  clouds: boolean;
  cover: number;
  /** Peak zonal wind (m/s) and radius (m) for the storms' drift, or null when the winds do not move. */
  windMs: number | null;
  radiusM: number | null;
  /** Flattening from the spin (0 = round). */
  flattening: number;
  /** Limb darkening coefficient of the self-lit surface (issue #62), or null for none. */
  limbU?: number | null;
}

/** Mira pulsation drawn over time (R7.5, Q-65): the period is data, the amplitude is art. */
export interface PulsationPlan {
  periodD: number;
  amplitude: number;
  /**
   * Phase at clock time 0, radians: the radius starts where the scrubbed light-curve point puts it
   * (a bright point is a large radius), so radius and brightness agree. 0 with no usable point.
   */
  phase: number;
}

export interface RenderPlan {
  id: string;
  type: ObjectType;
  name: string;
  /** False for `candidate` and for types without a renderer here. */
  threeD: boolean;
  message: string | null;
  bodies: BodyPlan[];
  shells: ShellPlan[];
  discs: DiscPlan[];
  screens: ScreenPlan[];
  trails: TrailPlan[];
  dust: DustPlan | null;
  /** Emission volumes drawn instead of point sprites (comet coma and tails). */
  volumes: VolumePlan[];
  drawn: LegendEntry[];
  missing: MissingItem[];
  notes: string[];
  honesty: HonestyState;
  mode: ViewModeId | null;
  modes: ModeInfo[];
  tint: Tint;
  epoch: CometEpoch | null;
  epochs: CometEpoch[];
  lighting: LightingPlan;
  scaleM: number | null;
  sizeTag: Tag | null;
  /** 'upper_limit' when the size is a bound, not a value (comet nucleus, R7.3). */
  sizeQualifier: 'upper_limit' | null;
  /** Formula, else assumption, else source of the size value: the "why?" of the scale bar (A11). */
  sizeWhy: string | null;
  /** True when the view mode's colour is applied to something drawn (so the alt text may name it). */
  tintUsed: boolean;
  /** Largest distance from the origin to anything drawn, in scene units: the camera frames this. */
  extent: number;
  spin: SpinPlan | null;
  scrub: ScrubPlan | null;
  relief: 'measured' | 'illustrative';
  /** Set for the shader kinds only; `bodies` is empty for them. */
  shader: ShaderPlan | null;
  /** Motion rates and animated processes with their tiers (R5.7, D-32, D-34). */
  motion: Motion;
  /** The moving star surface (stars), or null. */
  star: StarSurfacePlan | null;
  /** Moving jets on a brown dwarf, or null (the baked bands are used). */
  jets: JetSurfacePlan | null;
  /** Mira pulsation, or null. */
  pulsation: PulsationPlan | null;
  /** Set for a shape-model asteroid whose mesh is drawn (R7.1); null otherwise. */
  shape: ShapePlan | null;
}

/** User-controlled inputs of a plan, kept apart from the data. */
export interface PlanContext {
  honesty: HonestyState;
  /** Requested mode; the plan falls back to the type's default if it is unavailable. */
  mode: ViewModeId | null;
  epoch: CometEpoch;
  /** Index into the card's light curve (Mira, T Tauri). */
  scrubIndex: number;
  /** Layer ids whose mesh or texture failed to load: refused with reason 'load'. */
  failed: readonly string[];
  /**
   * Issue #60 (build animation): layer ids held back for one moulding stage. A held layer is not
   * drawn and not listed in `missing`; `tint` holds the colour (plain grey). Absent in every normal
   * plan, so the last stage (nothing held) is exactly the normal plan.
   */
  hold?: readonly string[];
  /**
   * D-27 slider overrides. Only the gas giant legend reads them (a slider sets the drawn band
   * count or flattening, so the legend names it `artistic`). Absent: no slider is set.
   */
  overrides?: Overrides;
}
