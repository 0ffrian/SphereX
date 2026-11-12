// Shared contract for the flyover soundscape and weather (spec R13, Q-431 to Q-444). Copy verbatim; change only by
// amending the spec, so parallel tickets stay compatible. Pure data types: no imports beyond Tag and FluidKey.
import type { Tag } from '@/contract';
import type { FluidKey } from '@/engine/worlds/types';

export type CompClass = 'N2' | 'CO2' | 'H2';
export type SourceId =
  | 'S1_land' | 'S1_sea' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8' | 'S9' | 'S10' | 'S12' | 'thunder';
export type SampleClass = 'land' | 'sea' | 'ice' | 'river' | 'lake' | 'lava' | 'crust';

export interface LiquidProps { name: string; rho: number; sigma: number; viscous: boolean; tag: Tag }
export interface Refusal { source: SourceId | 'all' | 'lightning'; reason: string }
export interface TaggedInput { label: string; value: number | string; unit: string; tag: Tag; source: string }

/** §3, §4: everything about a world's air and surface that sound needs; built once per world (and on §9.6 triggers). */
export interface AirModel {
  gas: boolean; cls: CompClass; fluid: FluidKey; state: string;
  T0: number; P0: number; H_km: number; mu: number; gamma: number; gv: number; gamK: number;
  c0: number; rho0: number; Z0: number;
  airOK: boolean; liquid: LiquidProps | null; lavaWorld: boolean;
  Uscale: number; Us: number; phiH: number; Om: number; locked: boolean; res32: boolean;
  R_km: number; zc_km: number | null; regime: string; seed: number; Vmax: number | null;
  /** Contract amendment 1 (12 Nov): the fly shader's noise seed: preset.seed3 for card worlds, else [seed, seed, seed]. */
  seed3: [number, number, number];
  /** Contract amendment 1: ocean share of the surface (preset.oceanF, i.e. core OCEANF[id]); 0 = no sea. */
  oceanF: number;
  /** Contract amendment 1: preset id (lightning rule table, §8.2). */
  presetId: string;
  inputs: TaggedInput[]; refusals: Refusal[];
}

/** §4.1 air at height z above the reference level. */
export interface AirAt { P: number; T: number; rho: number; c: number; Z: number; silent: boolean }

/** §6.2/6.3 one place sample. */
export interface PlaceSample {
  lon: number; lat: number; s_km: number; bearing: number; d_m: number; area_m2: number;
  h_km: number; cls: SampleClass; coast: boolean; rain: number; T: number; riverQ: number; vent: boolean;
}

/** §6.5 wind result. */
export interface WindResult {
  U10: number; Uz: number; Iu: number; dirDeg: number;
  parts: { kind: 'trade' | 'westerly' | 'polar' | 'terminator' | 'breeze' | 'hurricane' | 'jet'; U: number }[];
  tag: Tag;
}

/** §6.4 + §6.6 features at the listener. */
export interface PlaceFeatures {
  z_km: number; relief: number; exposure: number; slope: number;
  snowCover: number; iceCover: number; rainRate: number; RH: number; Tloc: number;
  cnv: number; cnvRing: number; precipPhase: 'rain' | 'snow' | 'none';
  cyclone: { delta: number; r: number; Rm: number; inEye: boolean } | null;
  stormNear: number; vort: number; wind: WindResult;
}

export interface Place { lon: number; lat: number; head: number; samples: PlaceSample[]; features: PlaceFeatures }

/** §9 what to bake. */
export interface BedSpec {
  id: SourceId; variant: number; sampleRate: number; N: number; seed: number;
  Uref: number; bandCenterHz: number; LrefEarth_dB: number; params: Record<string, number>;
}
export interface BakeResult { id: SourceId; variant: number; L: Float32Array; R: Float32Array; sampleRate: number; ms: number; lufs: number }

/** §11 one bed's live settings for this tick. */
export interface BedLevel {
  id: SourceId; variant: number; trueDb: number; gainDb: number; lowpassHz: number; shelfDb: number;
  pan: number; playbackRate: number; harmonic: boolean;
}

export interface CaptionModel { line: string; heard: { id: SourceId; phrase: string; relDb: number }[]; levelNote: string | null; silentReason: string | null }

/** §10 one mixer tick. */
export interface MixFrame { beds: BedLevel[]; presentOffsetDb: number; silent: boolean; caption: CaptionModel }

/** §8.3/8.4 a scheduled strike. */
export interface Strike { t0: number; d_m: number; bearing: number; seed: number; variant: number; flash: boolean }

/** §8.5 what the overlay draws this frame (shared with the mixer). */
export interface WeatherVisualFrame {
  rain: { density: number; vt: number; slantRad: number; tint: [number, number, number]; snow: boolean } | null;
  strikes: Strike[]; aboveClouds: boolean; zc_km: number | null;
}

/** The engine surface the ambience reads (WorldEngine implements it; tests fake it). */
export interface WorldEngineLike {
  readonly fly: { alt: number; lon: number; lat: number; head: number; pitch: number; auto: boolean };
  readouts(): { model: any };
  state(): { Ps: number; fluid: FluidKey; gas: boolean; locked: boolean };
  cpuFields(): { terrain: any; climate: any; hydro: any };
  weatherFields(): {
    NX: number; NY: number; iceH: Float32Array; snow: Float32Array; out: Float32Array; out2: Float32Array;
    cyclones: { lon: number; lat: number; r: number; s: number }[];
  } | null;
  gasField(): Float32Array | null;
  groundKm(lon: number, lat: number): number;
  flyCameraBasis(): { cam: [number, number, number]; fwd: [number, number, number]; rt: [number, number, number]; up: [number, number, number]; rkm: number; ex: number; fov: number } | null;
  altRange(): [number, number];
}
