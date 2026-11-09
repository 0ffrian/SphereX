// Issue #68 Part 3a, A7.1: tidal locking. `t_lock = omega a^6 I Q / (3 G M_star^2 k2 R^5)` with
// `I = 0.4 m_p R^2` (Gladman et al. 1996, Icarus 122, 166, doi:10.1006/icar.1996.0117). The planet
// is locked when `t_lock < age`. Pure and deterministic.
//
// FORMULA STATUS (Q-155): the ticket's form is kept. It is NOT confirmed against Gladman 1996 (the
// paper could not be read). The only citable quotation, Grundy et al. 2012 (arXiv:1204.3923, Eq. 1),
// has the prefactor 16 pi / 15 = 3.351, while this form with I = 0.4 m R^2 gives 16 pi^2 / 45 = 3.509:
// a factor pi / 3 (4.7%) higher. With the quoted prefactor Kepler-186 f computes about 3.99 Gyr
// against 4.0 Gyr, i.e. locked (eyeball, T_ss 281.8 K, theta_ice about 28 degrees); with this form
// 4.17 Gyr, not locked. The prefactor and Q are the two choices Moon may overturn. The result is always at least
// `model_dependent`: Q, k2 and the initial spin are assumptions (Q-119 a, Q-155).
import type { ObjectCard, Tag } from '@/contract';
import { weakestTag } from '@/viewer/motion/motion';
import { AU_M, G, GM_EARTH, GM_SUN, HOUR_S, R_EARTH_M, R_JUP_M, YEAR_S } from './constants';
import { InputReader } from './tagging';
import { rockyMassForRadius } from './zeng2019';

// ---- Named constants ([verify]; `null` refuses the rule, Q-110, Q-119 a) --------------------------

/**
 * Tidal Love number of a rocky planet, 0.3. Barnes 2017, Celest. Mech. Dyn. Astron. 129, 509
 * (doi:10.1007/s10569-017-9783-7), Sec 2.5, which takes it from Lambeck 1977 and others. Read from the
 * arXiv preprint (1708.02981). [verify] An Earth-calibrated value, not measured for exoplanets.
 */
export const TIDAL_K2: number | null = 0.3;
/**
 * Tidal quality factor of a rocky planet, 100: Kasting et al. 1993 via Barnes 2017 (introduction; second-hand). Barnes' own Q = 12 is the modern Earth's, dominated by ocean dissipation, and
 * he calls it not necessarily representative; it is the LOWER bound (faster locking), kept in
 * `TIDAL_Q_LOWER_BOUND` for the comment and the sensitivity test only. [verify] Q is not measured
 * for any exoplanet.
 */
export const TIDAL_Q: number | null = 100;
export const TIDAL_Q_LOWER_BOUND = 12;
/**
 * Initial spin period of the planet, 13.5 h (Kasting et al. 1993 via Barnes 2017, p. 3; second-hand;
 * Barnes gives no single default of his own). [verify] An assumption.
 */
export const INITIAL_SPIN_H: number | null = 13.5;
/**
 * Age used when the card has no `host_age_gyr`: 1 Gyr. A project choice, NOT a published floor (no
 * source states one; Barnes 2017 says only that locking times of habitable-zone planets are
 * "< 1 Gyr in almost all cases", which is a locking time). Always listed in `assumed`. [verify]
 */
export const AGE_FALLBACK_GYR: number | null = 1;

/** `I = 0.4 m_p R^2`: the moment of inertia of a uniform sphere is 0.4; the real planet is more centrally condensed (Earth 0.33). */
export const MOMENT_OF_INERTIA_FACTOR = 0.4;

export const TIDES_FORMULA =
  't_lock = omega a^6 I Q / (3 G M_star^2 k2 R^5), I = 0.4 m_p R^2 (Gladman et al. 1996); locked if t_lock < age';

/** Plain-number form. Units: ω rad/s, a m, planet mass kg, radius m, star mass kg. Returns seconds. */
export function lockingTimeS(
  omegaRadS: number,
  semiMajorM: number,
  planetMassKg: number,
  radiusM: number,
  starMassKg: number,
  q: number,
  k2: number,
): number | null {
  const ok = [omegaRadS, semiMajorM, planetMassKg, radiusM, starMassKg, q, k2].every(
    (x) => Number.isFinite(x) && x > 0,
  );
  if (!ok) return null;
  const inertia = MOMENT_OF_INERTIA_FACTOR * planetMassKg * radiusM ** 2;
  return (
    (omegaRadS * semiMajorM ** 6 * inertia * q) / (3 * G * starMassKg ** 2 * k2 * radiusM ** 5)
  );
}

export type LockResult =
  | {
      ok: true;
      locked: boolean;
      tLockGyr: number;
      ageGyr: number;
      tag: Tag;
      formula: string;
      /** Every assumed input, by name (Q-110). */
      assumed: Record<string, number | string>;
    }
  | { ok: false; needs: string[] };

/**
 * Locked or not, from the card. Inputs: `orbit_au`, `host_mass_msun`, the radius (`radius_rjup`),
 * `mass_mearth` (else the Earth-like rocky mass for the radius, Zeng 2019, `model_dependent`) and
 * `host_age_gyr` (else `AGE_FALLBACK_GYR`, assumed). Refused (with the names it lacked) when an input
 * is missing or a [verify] constant is `null`: nothing is invented.
 */
export function deriveLocking(card: ObjectCard): LockResult {
  const needs: string[] = [];
  const reader = new InputReader(card, {});
  const orbit = reader.readCard('orbit_au')?.value ?? null;
  const hostMass = reader.readCard('host_mass_msun')?.value ?? null;
  const radiusRj = card.radius_rjup?.value;
  const radiusRe =
    typeof radiusRj === 'number' && Number.isFinite(radiusRj) && radiusRj > 0
      ? (radiusRj * R_JUP_M) / R_EARTH_M
      : null;
  if (orbit === null) needs.push('orbit_au');
  if (hostMass === null) needs.push('host_mass_msun');
  if (radiusRe === null) needs.push('radius_rjup');
  if (TIDAL_K2 === null) needs.push('TIDAL_K2');
  if (TIDAL_Q === null) needs.push('TIDAL_Q');
  if (INITIAL_SPIN_H === null) needs.push('INITIAL_SPIN_H');

  const assumed: Record<string, number | string> = {
    tidal_Q: TIDAL_Q ?? 'null',
    tidal_k2: TIDAL_K2 ?? 'null',
    initial_spin_h: INITIAL_SPIN_H ?? 'null',
    moment_of_inertia: `${MOMENT_OF_INERTIA_FACTOR} m R^2 (uniform sphere)`,
  };
  const tags: Tag[] = ['model_dependent'];

  const massIn = reader.readCard('mass_mearth');
  let massE = massIn?.value ?? null;
  if (massE !== null) {
    tags.push(massIn!.tag);
  } else if (radiusRe !== null) {
    massE = rockyMassForRadius(radiusRe);
    if (massE === null) needs.push('mass_mearth');
    else
      assumed.mass_mearth = `${massE.toPrecision(3)} Earth masses: the Earth-like rocky mass for the radius (Zeng et al. 2019); a lighter, watery planet would lock sooner`;
  } else {
    needs.push('mass_mearth');
  }

  const ageIn = reader.readCard('host_age_gyr');
  let ageGyr = ageIn?.value ?? null;
  if (ageGyr !== null) {
    tags.push(ageIn!.tag);
  } else if (AGE_FALLBACK_GYR !== null) {
    ageGyr = AGE_FALLBACK_GYR;
    assumed.host_age_gyr = `${AGE_FALLBACK_GYR} Gyr: a project choice, not a published floor`;
  } else {
    needs.push('host_age_gyr');
  }
  for (const k of ['orbit_au', 'host_mass_msun'] as const) {
    const input = reader.readCard(k);
    if (input) tags.push(input.tag);
  }
  if (card.radius_rjup) tags.push(card.radius_rjup.tag);

  if (needs.length > 0 || ageGyr === null) return { ok: false, needs };
  const omega = (2 * Math.PI) / (INITIAL_SPIN_H! * HOUR_S);
  const t = lockingTimeS(
    omega,
    orbit! * AU_M,
    (massE! * GM_EARTH) / G,
    radiusRe! * R_EARTH_M,
    (hostMass! * GM_SUN) / G,
    TIDAL_Q!,
    TIDAL_K2!,
  );
  if (t === null) return { ok: false, needs: ['orbit_au', 'host_mass_msun', 'mass_mearth'] };
  const tLockGyr = t / (1e9 * YEAR_S);
  return {
    ok: true,
    locked: tLockGyr < ageGyr,
    tLockGyr,
    ageGyr,
    tag: weakestTag(tags),
    formula: TIDES_FORMULA,
    assumed,
  };
}
