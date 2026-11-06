// Types of the render plan: the pure, GPU-free description of what the viewer draws for one
// ObjectCard + RenderParams under one honesty state, view mode and epoch. Renderers produce a
// plan; renderers/build.ts turns it into three.js objects. Tests inspect the plan.
import type { CometEpoch, ObjectType, Tag } from '@/contract';
import type { HonestyState } from './honesty';
import type { LightingPlan } from './lighting';

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
  /** A reference value is still [verify]; nothing is invented in its place. */
  | 'unverified';

export interface MissingItem {
  id: string;
  reason: MissingReason;
  /** Honesty: the tag that is hidden. Data: the missing field names. Other: free text. */
  tag?: Tag;
  fields?: string[];
  detail?: string;
}

export interface LegendEntry {
  id: string;
  tag: Tag;
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
  roughness: number;
  meshUrl: string | null;
  albedoUrl: string | null;
  normalUrl: string | null;
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

export interface ScrubPlan {
  count: number;
  index: number;
  tMjd: number;
  /** 0..1 relative to the brightest usable point. */
  brightness: number;
  /** Points excluded because their flags are non-zero. */
  flagged: number;
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
  spin: SpinPlan | null;
  scrub: ScrubPlan | null;
  relief: 'measured' | 'illustrative';
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
}
