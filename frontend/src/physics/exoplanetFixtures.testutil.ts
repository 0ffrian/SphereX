// Typed local fixtures for issue #68 Track B (not shared/fixtures: Track A owns the card fields and
// their fixtures). Values are the NASA Exoplanet Archive `pscomppars` read of 9 Nov 2026 recorded in
// the issue; the cards are test inputs, not new claims. REMOVE the `PlanetCard` type with
// cardFields.ts when Track A merges.
import type { Tag, TVNumber } from '@/contract';
import { R_EARTH_M, R_JUP_M } from './constants';
import type { PlanetCard } from './cardFields';

const tv = (value: number | null, tag: Tag, source: string): TVNumber => {
  const out: TVNumber = { value, tag, source };
  if (tag === 'derived') out.formula = 'archive-calculated value';
  if (tag === 'model_dependent') out.assumption = 'archive mass-radius relation';
  return out;
};
const rearthToRjup = (r: number): number => (r * R_EARTH_M) / R_JUP_M;

export function trappist1f(): PlanetCard {
  const a = 'Agol et al. 2021';
  return {
    id: 'test:trappist-1-f',
    name: 'TRAPPIST-1 f',
    type: 'planet_rocky',
    radius_rjup: tv(rearthToRjup(1.045), 'measured', a),
    teq_K: tv(217.7, 'derived', 'Ducrot et al. 2020 pl_eqt'),
    mass_mearth: tv(1.039, 'measured', a),
    orbit_au: tv(0.03849, 'measured', a),
    orbital_period_d: tv(9.20754, 'measured', a),
    host_teff_K: tv(2566, 'measured', a),
    host_radius_rsun: tv(0.1192, 'measured', a),
    host_mass_msun: tv(0.0898, 'measured', a),
    host_age_gyr: tv(7.6, 'measured', 'Piaulet-Ghorayeb et al. 2025'),
  };
}

export function kepler186f(): PlanetCard {
  const a = 'Torres et al. 2015';
  return {
    id: 'test:kepler-186-f',
    name: 'Kepler-186 f',
    type: 'planet_rocky',
    radius_rjup: tv(rearthToRjup(1.17), 'measured', a),
    // pl_eqt of 177 K comes from the KOI table and assumes Bond albedo 0.3.
    teq_K: tv(177, 'derived', 'Q1_Q17_DR25_KOI_TABLE koi_teq (albedo 0.3)'),
    mass_mearth: tv(1.71, 'model_dependent', 'M-R relationship'),
    orbit_au: tv(0.432, 'measured', a),
    orbital_period_d: tv(129.9441, 'measured', a),
    host_teff_K: tv(3755, 'measured', a),
    host_radius_rsun: tv(0.523, 'measured', a),
    host_mass_msun: tv(0.544, 'measured', a),
    host_age_gyr: tv(4.0, 'measured', a),
  };
}
