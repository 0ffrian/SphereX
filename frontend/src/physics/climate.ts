// Issue #68 Part 3c, A7.1: the climate scenario of a rocky or water planet, by deterministic rules
// (Q-156). `climateScenario` is the pure table (first match wins); `deriveClimate` feeds it from a
// card and adds the provenance. No LLM, no Math.random, no Date.
import type { Tag } from '@/contract';
import { weakestTag } from '@/viewer/motion/motion';
import { extraTv, readExtra, type PlanetCard } from './cardFields';
import { LAVA_START_K } from './constants';
import {
  OCEANS_REMOVED_ABOVE_K,
  SUBSTELLAR_ASSUMED,
  SUBSTELLAR_FORMULA,
  WATER_FREEZES_K,
  equilibriumTempK,
  iceAngleRad,
  substellarTempK,
} from './planets';
import { deriveLocking, type LockResult } from './tides';

export type Scenario = 'lava' | 'hot_dry' | 'eyeball' | 'snowball' | 'temperate';

export interface ClimateInputs {
  /** Which surface: a water world has ocean inside the eyeball, a rocky one bare ground. */
  kind: 'planet_rocky' | 'planet_water';
  /** The card's `teq_K` (lava and hot_dry use it). */
  teqK: number;
  /** Tidally locked, or null when the rule was refused (then the planet is treated as not locked). */
  locked: boolean | null;
  /** Temperature at the star-facing point, K; null when it could not be computed. */
  tssK: number | null;
}

export interface ClimateOutcome {
  scenario: Scenario;
  /** `acos((273 / T_ss)^4)`: the open-water cap of an eyeball; null for every other scenario. */
  iceAngleRad: number | null;
}

/**
 * The scenario table, first match wins:
 * lava (`Teq > 700 K`), hot_dry (`Teq > 450 K`), eyeball (locked and `T_ss > 273 K`),
 * snowball (locked and `T_ss <= 273 K`), temperate (otherwise). A planet that is not known to be
 * locked keeps today's polar-ice rule (`temperate`); with no greenhouse a Teq-only test would
 * freeze an Earth twin (Teq about 255 K).
 */
export function climateScenario(i: ClimateInputs): ClimateOutcome {
  if (i.teqK > LAVA_START_K) return { scenario: 'lava', iceAngleRad: null };
  if (i.teqK > OCEANS_REMOVED_ABOVE_K) return { scenario: 'hot_dry', iceAngleRad: null };
  if (i.locked === true && i.tssK !== null && Number.isFinite(i.tssK)) {
    if (i.tssK > WATER_FREEZES_K) return { scenario: 'eyeball', iceAngleRad: iceAngleRad(i.tssK) };
    return { scenario: 'snowball', iceAngleRad: null };
  }
  return { scenario: 'temperate', iceAngleRad: null };
}

export const SCENARIO_FORMULA =
  'lava if Teq > 700 K; hot_dry if Teq > 450 K; eyeball if locked and T_ss > 273 K (open water within acos((273 / T_ss)^4) of the star-facing point); snowball if locked and T_ss <= 273 K; else temperate';

export interface ClimateDerivation extends ClimateOutcome {
  /** Locking verdict: null when the rule was not evaluated or was refused. */
  lock: LockResult | null;
  locked: boolean | null;
  teqCardK: number;
  /** Full-redistribution Teq the temperature map used, K (null when the planet was not tested for locking). */
  teqMapK: number | null;
  teqMapSource: 'zero_albedo_recomputed' | 'card_teq_K' | null;
  tssK: number | null;
  /** Weakest of the card Teq tag, the locking tag, the map's inputs and `model_dependent`. */
  tag: Tag;
  formula: string;
  assumed: Record<string, number | string>;
}

/**
 * The scenario of `card`, or null when the card has no `teq_K` (nothing is invented). Locking is
 * tested only when the scenario table can reach it (`Teq <= 450 K`). The map's Teq is a zero-albedo
 * Teq recomputed from `host_teff_K`, `host_radius_rsun` and `orbit_au` when all three are present,
 * because the archive's `pl_eqt` may assume albedo 0.3 (Kepler-186 f: 177 K); else the card's
 * `teq_K`, with the caveat in `assumed`. `lava` and `hot_dry` always use the card's `teq_K`.
 */
export function deriveClimate(
  card: PlanetCard,
  kind: ClimateInputs['kind'],
): ClimateDerivation | null {
  const teqTv = card.teq_K;
  const teqCardK = teqTv?.value;
  if (!teqTv || typeof teqCardK !== 'number' || !Number.isFinite(teqCardK) || !(teqCardK > 0))
    return null;

  const tags: Tag[] = ['model_dependent', teqTv.tag];
  const assumed: Record<string, number | string> = {};
  let lock: LockResult | null = null;
  let teqMapK: number | null = null;
  let teqMapSource: ClimateDerivation['teqMapSource'] = null;
  let tssK: number | null = null;

  if (teqCardK <= OCEANS_REMOVED_ABOVE_K) {
    lock = deriveLocking(card);
    if (lock.ok) {
      Object.assign(assumed, lock.assumed);
      tags.push(lock.tag);
      if (lock.locked) {
        const teff = readExtra(card, 'host_teff_K');
        const rad = readExtra(card, 'host_radius_rsun');
        const orbit = readExtra(card, 'orbit_au');
        const recomputed =
          teff !== null && rad !== null && orbit !== null
            ? equilibriumTempK(teff, rad, orbit, 0)
            : null;
        if (recomputed !== null) {
          teqMapK = recomputed;
          teqMapSource = 'zero_albedo_recomputed';
          for (const k of ['host_teff_K', 'host_radius_rsun', 'orbit_au'] as const)
            tags.push(extraTv(card, k)!.tag);
        } else {
          teqMapK = teqCardK;
          teqMapSource = 'card_teq_K';
          assumed.teq_K =
            "the card's own value, because the star and orbit are not all on the card; if it assumes a nonzero albedo (the archive's koi_teq assumes 0.3) T_ss is too low";
        }
        tssK = substellarTempK(teqMapK);
        Object.assign(assumed, SUBSTELLAR_ASSUMED);
      }
    }
  }

  const out = climateScenario({
    kind,
    teqK: teqCardK,
    locked: lock?.ok ? lock.locked : null,
    tssK,
  });
  return {
    ...out,
    lock,
    locked: lock?.ok ? lock.locked : null,
    teqCardK,
    teqMapK,
    teqMapSource,
    tssK,
    tag: weakestTag(tags),
    formula: tssK !== null ? `${SCENARIO_FORMULA}; ${SUBSTELLAR_FORMULA}` : SCENARIO_FORMULA,
    assumed,
  };
}
