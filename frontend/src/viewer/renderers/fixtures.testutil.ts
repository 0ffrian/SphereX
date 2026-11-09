// Test helper: shared synthetic fixtures (shared/fixtures) by type. Test code only.
import type { ObjectCard, RenderParams } from '@/contract';

const load = (files: Record<string, unknown>) =>
  new Map(
    Object.entries(files).map(([path, data]) => [
      path.replace(/^.*\//, '').replace(/\.json$/, ''),
      data,
    ]),
  );
const cards = load(
  import.meta.glob('../../../../shared/fixtures/cards/*.json', { eager: true, import: 'default' }),
);
const params = load(
  import.meta.glob('../../../../shared/fixtures/params/*.json', { eager: true, import: 'default' }),
);

export function fixture(name: string): { card: ObjectCard; params: RenderParams } {
  const card = cards.get(name) as ObjectCard | undefined;
  const p = params.get(name) as RenderParams | undefined;
  if (!card || !p) throw new Error(`no fixture ${name}`);
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
