// Shared types of the world engine (D-37). The preset object is the prototype's own (sculptor-preview-next.html WP).
import type { Tag } from '@/contract';

export type FluidKey = 'water' | 'ammoniaWater' | 'methane' | 'ammonia' | 'nitrogen' | 'co2';
export type SpinMode = 'auto' | 'lock' | 'res32' | 'rot';

/** One world, in the prototype's fields. Units: Ts K, Rs R_sun, a AU, P and Prot days, Rj R_jup, Me M_earth, Ps bar, mu g/mol. */
export interface WorldPreset {
  id: string;
  label: string;
  type: 'rock' | 'gas';
  Ts: number;
  Rs: number;
  a: number;
  P: number;
  Prot?: number;
  Rj: number;
  Me: number;
  locked: boolean;
  fluid: FluidKey;
  Ps: number;
  mu: number;
  sea?: number;
  seed: number;
  ocean?: boolean;
  A?: number;
  Tint?: number;
  axis?: number;
  roll?: number;
  rings?: boolean;
  L?: number[];
  pal?: { z: number[]; b: number[]; s: number[]; d: number[]; p: number[] };
  /** Orbit extras the prototype keeps in its ORB table: host mass (solar), eccentricity, obliquity (rad). */
  ob?: { Ms: number; e: number; obl: number };
  /** Ocean share of the surface (the prototype's OCEANF table). */
  oceanF?: number;
  /** Measured peak jet speed, m/s; replaces the engine's thermal-wind estimate (Jupiter, Saturn; #89 review 5). */
  Umeas?: number;
  /** Measured flattening; replaces the engine's 0.7 q (Jupiter, Saturn; #89 review 6). */
  fMeas?: number;
}

export interface EngineOverrides {
  fluid?: FluidKey;
  Ps?: number;
  /** Spin state: 'auto' | 'lock' | 'res32' | 'rot' (the prototype's Spin pills). */
  spin?: SpinMode;
  /** Crust: 'auto' | 'plates' | 'lid'. */
  tect?: 'auto' | 'plates' | 'lid';
  co2?: boolean;
  obl?: number;
  ecc?: number;
  Tstar?: number;
  /** Orbit scale relative to the preset's a (1 = as measured). */
  orbit?: number;
  season?: number;
  /** 0 Surface, 1 Plates, 2 Rainfall, 3 Currents, 4 Water. */
  overlay?: number;
  clouds?: boolean;
  zoom?: number;
  yaw?: number;
  pitch?: number;
  /** Simulated seconds per real second for gas giants (300 or 86400 in the prototype). */
  timeSec?: number;
}

export interface TaggedAssumption {
  field: string;
  value: number | string | boolean;
  tag: Tag;
  note: string;
}

export interface EngineOptions {
  /** Make the drawing buffer readable after the frame (toDataURL, capture). Parity and test pages only. */
  preserveDrawingBuffer?: boolean;
}

export type ReadoutRow = [label: string, value: string];
export interface Readouts {
  rows: ReadoutRow[];
  caption: string;
  tag: string;
  provenance: 'model_dependent';
  /** Gas giants hide the canvas while the spin-up runs. */
  building: boolean;
  spinup: number;
  step: number;
  /** The model object (equilibrium temperature etc.), the prototype's worldModel() result. */
  model: any;
  stats: any;
}
