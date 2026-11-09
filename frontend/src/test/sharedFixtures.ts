// Test helper (src/test/ is test-only code): the SYNTHETIC ObjectCards and RenderParams in
// shared/fixtures/, keyed by file name (`comet`, `asteroid_shape`, ...). Test code only: app
// modules must never import this (fixtures.test.ts checks it).
import type { ObjectCard, RenderParams } from '@/contract';

const load = <T>(files: Record<string, unknown>): Map<string, T> =>
  new Map(
    Object.entries(files).map(([path, data]) => [
      path.replace(/^.*\//, '').replace(/\.json$/, ''),
      data as T,
    ]),
  );

const cards = load<ObjectCard>(
  import.meta.glob('../../../shared/fixtures/cards/*.json', { eager: true, import: 'default' }),
);
const params = load<RenderParams>(
  import.meta.glob('../../../shared/fixtures/params/*.json', { eager: true, import: 'default' }),
);

/** Names of the fixtures that have both a card and params. */
export const FIXTURE_NAMES: string[] = [...cards.keys()].filter((k) => params.has(k)).sort();

/** The baked types of this issue (R7.1 to R7.6). */
export const BAKED_NAMES = [
  'asteroid_shape',
  'asteroid_procedural',
  'comet',
  'brown_dwarf',
  'brown_dwarf_binary',
  'star',
  'star_mira',
  'star_ttauri',
  'candidate',
] as const;

/** A fresh deep copy, so a test can edit it. */
export function fixture(name: string): { card: ObjectCard; params: RenderParams } {
  const card = cards.get(name);
  const p = params.get(name);
  if (!card || !p) throw new Error(`no fixture named ${name}`);
  return { card: structuredClone(card), params: structuredClone(p) };
}

/**
 * A copy of a fixture card with the issue #68 exoplanet fields (host star, orbit, mass) removed:
 * the same planet as a solar-system body. The shared `planet_water` fixture now carries those
 * fields, so it resolves a climate scenario, starlight and a locked pose. Tests of the unchanged
 * solar-system path use this instead.
 */
export function withoutExoplanetFields<T extends { card: ObjectCard }>(f: T): T {
  const card = f.card as unknown as Record<string, unknown>;
  for (const k of [
    'mass_mearth',
    'orbit_au',
    'orbital_period_d',
    'host_teff_K',
    'host_radius_rsun',
    'host_mass_msun',
    'host_age_gyr',
  ])
    delete card[k];
  return f;
}
