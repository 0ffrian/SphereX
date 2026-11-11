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
/** The GL half of the engine (WorldGL): only the issue #93 compile hooks are typed. */
export interface CoreGL {
  /** True once every submitted program has finished compiling and is linked; throws the compile or link log. */
  poll(): boolean;
  /** Link now (blocks until the driver is done); with fly, also submit the fly program if this instance has none. */
  link(fly?: boolean): void;
  /** Number of programs submitted so far. */
  programs(): number;
}
export function createCore(
  canvas: HTMLCanvasElement,
  opt?: { role?: 'globe' | 'fly' | 'both' },
): Core;
