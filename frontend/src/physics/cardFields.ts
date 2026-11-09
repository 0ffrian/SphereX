// TEMPORARY SHIM (issue #68 Track B). Track A adds these card fields to shared/schemas and
// `contract/generated.ts` on its own branch. Until that merges, `ObjectCard` does not have them, so
// this file extends it with the same value shape (`TVNumber`) and reads them without a cast at
// each call site.
//
// REMOVE AFTER TRACK A MERGES: delete this file, use `ObjectCard` directly, and switch
// `readExtra(card, key)` calls to `InputReader.readCard(key)` / `numberField(card, key)`:
//   - physics/planets.ts      (`readExtra` for `mass_mearth` in derivePlanetInto)
//   - physics/climate.ts      (`PlanetCard`, `readExtra`)
//   - viewer/lighting.ts      (`PlanetCard`, `readExtra` for `host_teff_K`)
//   - viewer/planCommon.ts    (`isExoplanetCard`)
//   - viewer/renderers/shaderSpec.ts (`PlanetCard`)
import type { ObjectCard, TVNumber } from '@/contract';

/** The card fields Track A adds (issue #68 Part 1). Same value shape as every other card field. */
export const EXTRA_CARD_FIELDS = [
  'mass_mearth',
  'orbit_au',
  'orbital_period_d',
  'host_teff_K',
  'host_radius_rsun',
  'host_mass_msun',
  'host_age_gyr',
] as const;
export type ExtraCardField = (typeof EXTRA_CARD_FIELDS)[number];

export type PlanetCard = ObjectCard & { [K in ExtraCardField]?: TVNumber };

/** The tagged value of an extra field, or undefined when the card has none. */
export function extraTv(card: ObjectCard, key: ExtraCardField): TVNumber | undefined {
  return (card as PlanetCard)[key];
}

/** The usable number of an extra field (finite, not null), or null. */
export function readExtra(card: ObjectCard, key: ExtraCardField): number | null {
  const v = extraTv(card, key)?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * True when the card carries any of the new fields, even as `value: null` with a reason. That is
 * what an exoplanet card from the new pipeline looks like; a solar-system body has none of them,
 * so its layers are neither drawn nor listed as missing (solar-system bodies stay unchanged).
 * ASSUMPTION: the pipeline writes a missing value as `value: null` (Part 1), not by omitting the key.
 */
export function isExoplanetCard(card: ObjectCard): boolean {
  return EXTRA_CARD_FIELDS.some((k) => extraTv(card, k) !== undefined);
}
