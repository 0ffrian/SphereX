// Types for the generated core.js (see frontend/scripts/extract-world-engine.py). The verbatim prototype
// state `W` is deliberately loose: it is the prototype's own object (D-37).
import type { WorldPreset } from './types';

export interface Core {
  W: any;
  EB: any;
  ORB: Record<string, { Ms: number; e: number; obl: number }>;
  OCEANF: Record<string, number>;
  GAS_NODES: Record<string, number[][]>;
  FLUIDS: Record<string, any>;
  getGS(): any;
  /** #93: the energy budget (prototype ebStep, ebStats, ebInit), exposed for headless tests. */
  ebStep(m: any, n: number, dt: number): void;
  ebStats(m: any): void;
  ebInit(m: any, terr: any): void;
  worldModel(): any;
  worldUi(): void;
  resetWorld(): void;
  setPreset(p: WorldPreset): void;
  applySpin(p: WorldPreset): WorldPreset;
  flyMove(dKm: number, side: number): void;
  globePick(px: number, py: number): { lon: number; lat: number } | null;
  flyCamera(m: any, tilt: number, spin: number, L: number[]): any;
  groundKm(lon: number, lat: number): number;
  flyAimPeak(): boolean;
  flyAimDefault(): void;
  altRange(): [number, number];
  altToS(a: number): number;
  sToAlt(v: number): number;
}
export function createCore(canvas: HTMLCanvasElement): Core;
