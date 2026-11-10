// Issue #71 stream D (D-36, Q-240 to Q-243): the heavy part of a rocky or water world, in one pure
// function so a Web Worker (worldWorker.ts) can run it and a test can call it. Terrain first (plate
// tectonics, physics/terrain.ts), then the heat / ice / water budget settled for a fixed number of
// steps on that terrain (physics/climateBudget.ts), then the shared field the haptics read (D-01):
// the ONE height field is the terrain, so the picture, the normals and the finger agree.
//
// Deterministic: the result is a function of the params only (card inputs, seed, tier). The step
// count is part of the params' tier; no wall-clock time and no `Math.random` anywhere.
import {
  BUDGET_CHANNELS,
  ClimateBudget,
  SETTLE_DT,
  SETTLE_STEPS,
  worldModel,
  type BudgetStats,
  type WorldInputs,
  type WorldModel,
} from '@/physics/climateBudget';
import { buildTerrain, terrainFromData } from '@/physics/terrain';
import { FIELD_HEIGHT, FIELD_WIDTH, pixelDirection, type FieldData } from './fieldGenerator';

/** Quality of the heavy part: `low` is the phone tier (a quarter of the terrain cells, half the steps). */
export type WorldTier = 'full' | 'low';

export interface WorldParams {
  seed: number;
  inputs: WorldInputs;
  /** Share of the area that is ocean basin, 0..1 (an assumption for any exoplanet, D-36). */
  oceanFraction: number;
  tier: WorldTier;
}

export interface WorldData {
  model: WorldModel;
  terrain: { W: number; H: number; data: Float32Array; plates: number };
  climate: { nx: number; ny: number; out: Float32Array; stats: BudgetStats | null; hash: string };
  /** The shared field (D-12): R height 0..1 (sea level 0.5), ocean, ice and lava masks in B. */
  field: FieldData;
  /** An ocean basin exists (the assumed ocean share is above 0 and the world has air). */
  hasOcean: boolean;
  /** Which tier produced it, for the status line. */
  tier: WorldTier;
}

/** Model heights run about -10 to +10 km; the field stores `0.5 + e / HEIGHT_SPAN_KM`, sea level at 0.5. */
export const HEIGHT_SPAN_KM = 20;

const GRID = {
  full: { tw: 720, th: 360, nx: 180, ny: 90 },
  low: { tw: 360, th: 180, nx: 90, ny: 45 },
} as const;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Null when the analytic model cannot be computed (an input is not usable): the caller refuses the layer. */
/** Grid sizes and settle steps; the tiers' own, or smaller ones for tests that only need a world to exist. */
export interface WorldSize {
  tw: number;
  th: number;
  nx: number;
  ny: number;
  steps: number;
}
export const WORLD_SIZES: Readonly<Record<WorldTier, WorldSize>> = {
  full: { ...GRID.full, steps: SETTLE_STEPS.full },
  low: { ...GRID.low, steps: SETTLE_STEPS.low },
};

export function generateWorld(p: WorldParams, size: WorldSize = WORLD_SIZES[p.tier]): WorldData | null {
  const model = worldModel(p.inputs);
  if (!model) return null;
  const g = size;
  const terr = buildTerrain({ seed: p.seed, oceanFraction: p.oceanFraction, gravity: model.gv, W: g.tw, H: g.th });
  const budget = new ClimateBudget(model, { nx: g.nx, ny: g.ny, oceanFraction: p.oceanFraction }, (lon, lat) => terr.heightAt(lon, lat));
  budget.step(size.steps, SETTLE_DT);

  // Shared field, row 0 = north pole (R6.1): look the terrain and the budget up by direction.
  const a = new Float32Array(FIELD_WIDTH * FIELD_HEIGHT * 4);
  const b = new Float32Array(FIELD_WIDTH * FIELD_HEIGHT * 4);
  const { nx, ny, out } = budget;
  const cellAt = (lon: number, lat: number): number => {
    const cx = Math.min(nx - 1, Math.floor((((lon / (2 * Math.PI) + 0.5) % 1) + 1) % 1 * nx));
    const cy = Math.min(ny - 1, Math.max(0, Math.floor((lat / Math.PI + 0.5) * ny)));
    return (cy * nx + cx) * BUDGET_CHANNELS;
  };
  const Tb = model.canLiquid && model.Tb !== null ? model.Tb : 0;
  const hasBasin = p.oceanFraction > 0 && !model.airless;
  for (let r = 0; r < FIELD_HEIGHT; r++) {
    for (let c = 0; c < FIELD_WIDTH; c++) {
      const d = pixelDirection(c, r, FIELD_WIDTH, FIELD_HEIGHT);
      const lon = Math.atan2(d[2], d[0]);
      const lat = Math.asin(Math.max(-1, Math.min(1, d[1])));
      const e = terr.heightAt(lon, lat);
      const k = cellAt(lon, lat);
      const T = out[k]!;
      const hi = out[k + 1]!;
      const sn = out[k + 2]!;
      const i = (r * FIELD_WIDTH + c) * 4;
      a[i] = clamp01(0.5 + e / HEIGHT_SPAN_KM);
      // Ocean where the basin is below sea level and the fluid has not boiled away (as drawn).
      const basin = hasBasin ? 1 - smooth(-0.07, 0.07, e) : 0;
      const open = 1 - smooth(Tb - 2, Tb + 6, T);
      b[i] = basin * (Tb > 0 ? open : 1);
      // Ice: sea ice by thickness over the basin, frost by amount on land.
      b[i + 1] = basin > 0.5 ? 1 - Math.exp(-hi / 0.55) : 1 - Math.exp(-sn / 0.08);
      b[i + 2] = smooth(1000, 1500, T) * (1 - basin);
    }
  }
  return {
    model,
    terrain: { W: terr.W, H: terr.H, data: terr.data, plates: terr.plates },
    climate: { nx, ny, out, stats: budget.stats, hash: budget.hash() },
    field: { width: FIELD_WIDTH, height: FIELD_HEIGHT, a, b },
    hasOcean: hasBasin,
    tier: p.tier,
  };
}

/** Rebuilds a terrain sampler from the data a worker sent. */
export { terrainFromData };
