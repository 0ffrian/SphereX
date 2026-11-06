// A7.1 Planets: equilibrium temperature, bulk density, surface gravity, escape speed, whether an
// atmosphere is kept, and the ice / ocean / lava thresholds. Used by planet_rocky, planet_water and
// gas_giant (gas giants add A7.2 in gasGiants.ts). Pure functions; same inputs, same outputs.
import type { ObjectCard } from '@/contract';
import { AMU_KG, AU_M, GM_EARTH, K_B, R_EARTH_M, R_JUP_M, R_SUN_M } from './constants';
import type { Overrides } from './sliders';
import {
  asInput,
  InputReader,
  need,
  positive,
  ResultBuilder,
  type PhysicsInput,
  type PhysicsResult,
} from './tagging';

// ---- Rule constants given by A7.1 ----------------------------------------------------------

/** A7.1: `rho = 5.51 * M / R^3` g/cm^3 with M, R in Earth units (5.51 = Earth's mean density). */
export const EARTH_DENSITY_G_CM3 = 5.51;
/** A7.1: keep a gas if v_esc is "about 6 times" its thermal speed (rule of thumb). */
export const ATMOSPHERE_RETENTION_FACTOR = 6;
/** A7.1: polar ice below about 330 K, oceans removed above about 450 K, lava glow near 700 K. */
export const POLAR_ICE_BELOW_K = 330;
export const OCEANS_REMOVED_ABOVE_K = 450;
export const LAVA_GLOW_FROM_K = 700;

/**
 * Gases tested for retention, molar mass in g/mol (standard atomic weights).
 * ASSUMPTION: A7.1 names no gases; these five span the light (H2, He) to heavy (CO2) range.
 */
export const ATMOSPHERE_GASES = {
  H2: 2.016,
  He: 4.0026,
  H2O: 18.015,
  N2: 28.014,
  CO2: 44.009,
} as const;
export type AtmosphereGas = keyof typeof ATMOSPHERE_GASES;

// ---- Formula functions (SI or the stated units; null when an input is not usable) ----------

/** `Teq = T_star * sqrt(R_star / (2a)) * (1 - A)^(1/4)`; R_star in R_sun, a in au. */
export function equilibriumTempK(
  starTeffK: number,
  starRadiusRsun: number,
  semiMajorAxisAu: number,
  bondAlbedo: number,
): number | null {
  if (!positive(starTeffK, starRadiusRsun, semiMajorAxisAu)) return null;
  if (!Number.isFinite(bondAlbedo) || bondAlbedo < 0 || bondAlbedo >= 1) return null;
  const ratio = (starRadiusRsun * R_SUN_M) / (2 * semiMajorAxisAu * AU_M);
  return starTeffK * Math.sqrt(ratio) * Math.pow(1 - bondAlbedo, 0.25);
}

/** `rho = 5.51 * M / R^3` g/cm^3, M in Earth masses, R in Earth radii. */
export function bulkDensityGcm3(massMearth: number, radiusRearth: number): number | null {
  if (!positive(massMearth, radiusRearth)) return null;
  return (EARTH_DENSITY_G_CM3 * massMearth) / radiusRearth ** 3;
}

/** `g = G M / R^2`, m/s^2 (M in Earth masses, R in metres). */
export function surfaceGravityMs2(massMearth: number, radiusM: number): number | null {
  if (!positive(massMearth, radiusM)) return null;
  return (GM_EARTH * massMearth) / radiusM ** 2;
}

/** `v_esc = sqrt(2 G M / R)`, m/s (M in Earth masses, R in metres). */
export function escapeSpeedMs(massMearth: number, radiusM: number): number | null {
  if (!positive(massMearth, radiusM)) return null;
  return Math.sqrt((2 * GM_EARTH * massMearth) / radiusM);
}

/** Gas thermal speed `sqrt(2 k T / m)`, m/s, for molar mass in g/mol. */
export function thermalSpeedMs(temperatureK: number, molarMassGmol: number): number | null {
  if (!positive(temperatureK, molarMassGmol)) return null;
  return Math.sqrt((2 * K_B * temperatureK) / (molarMassGmol * AMU_KG));
}

/** A7.1 rule of thumb: the gas is kept when v_esc >= 6 * thermal speed. */
export function keepsGas(escapeMs: number, thermalMs: number): boolean {
  return escapeMs >= ATMOSPHERE_RETENTION_FACTOR * thermalMs;
}

export const rjupToRearth = (rjup: number): number => (rjup * R_JUP_M) / R_EARTH_M;

// ---- Family function --------------------------------------------------------------------------

const S = 'A7.1';
const SURFACE_TYPES = new Set(['planet_rocky', 'planet_water']);
const STAR_KEYS = ['star_teff_K', 'star_radius_rsun', 'semi_major_axis_au', 'bond_albedo'] as const;

/**
 * Teq input: a slider value wins; else Teq from the four star/orbit sliders when all are set;
 * else the card's `teq_K` (Exoplanet Archive `pl_eqt` or the backend's A7.1 value, D-12).
 * Star sliders that are set but unused are reported: shadowed by the `teq_K` slider they go in
 * `ignored`; when only some are set, `teq_from_star` is refused and names the ones still needed.
 * A Teq that is not above 0 K is not usable and is treated as missing.
 */
function readTeq(r: InputReader, out: ResultBuilder): PhysicsInput | null {
  const slider = r.read('teq_K');
  if (slider) {
    for (const k of STAR_KEYS) if (r.has(k)) r.ignore(k);
    return slider;
  }
  const star = need({
    star_teff_K: r.read('star_teff_K'),
    star_radius_rsun: r.read('star_radius_rsun'),
    semi_major_axis_au: r.read('semi_major_axis_au'),
    bond_albedo: r.read('bond_albedo'),
  });
  if (star.ok) {
    const { star_teff_K, star_radius_rsun, semi_major_axis_au, bond_albedo } = star.v;
    const inputs = [star_teff_K, star_radius_rsun, semi_major_axis_au, bond_albedo];
    const tv = out.put(
      'teq_K',
      equilibriumTempK(
        star_teff_K.value,
        star_radius_rsun.value,
        semi_major_axis_au.value,
        bond_albedo.value,
      ),
      inputs,
      { section: S, formula: 'Teq = T_star * sqrt(R_star / (2a)) * (1 - A)^(1/4)' },
    );
    if (tv) return asInput('teq_K', tv);
  } else if (STAR_KEYS.some((k) => r.has(k))) {
    out.refuse('teq_from_star', star.absent);
  }
  const card = r.readCard('teq_K');
  return card && positive(card.value) ? card : null;
}

/** A7.1 values for one planet. Returns `values`, the refused quantities and ignored overrides. */
export function derivePlanet(card: ObjectCard, overrides: Overrides): PhysicsResult {
  const r = new InputReader(card, overrides);
  const out = new ResultBuilder();
  derivePlanetInto(card, r, out);
  return out.build(r);
}

/** The body inputs derivePlanetInto resolved, for gasGiants.ts to reuse (read once). */
export interface PlanetInputs {
  radius: PhysicsInput | null;
  mass: PhysicsInput | null;
}

/** Shared with gasGiants.ts; returns the resolved radius and mass so they are read once. */
export function derivePlanetInto(
  card: ObjectCard,
  r: InputReader,
  out: ResultBuilder,
): PlanetInputs {
  const teq = readTeq(r, out);
  const radius = r.read('radius_rjup', 'radius_rjup');
  const mass = r.read('mass_mearth');

  const body = need({ mass_mearth: mass, radius_rjup: radius });
  if (body.ok) {
    const { mass_mearth: m, radius_rjup: rj } = body.v;
    const rM = rj.value * R_JUP_M;
    const inputs = [m, rj];
    out.put('density_g_cm3', bulkDensityGcm3(m.value, rjupToRearth(rj.value)), inputs, {
      section: S,
      formula: 'rho = 5.51 * M / R^3 (Earth units)',
    });
    out.put('gravity_m_s2', surfaceGravityMs2(m.value, rM), inputs, {
      section: S,
      formula: 'g = G M / R^2',
    });
    const v = escapeSpeedMs(m.value, rM);
    out.put('escape_speed_km_s', v === null ? null : v / 1000, inputs, {
      section: S,
      formula: 'v_esc = sqrt(2 G M / R)',
    });
    if (v !== null) deriveAtmosphere(v, inputs, teq, out);
    else
      for (const gas of Object.keys(ATMOSPHERE_GASES))
        out.refuse(`keeps_${gas}`, ['mass_mearth', 'radius_rjup']);
  } else {
    for (const id of ['density_g_cm3', 'gravity_m_s2', 'escape_speed_km_s'])
      out.refuse(id, body.absent);
    for (const gas of Object.keys(ATMOSPHERE_GASES))
      out.refuse(`keeps_${gas}`, teq ? body.absent : [...body.absent, 'teq_K']);
  }

  if (SURFACE_TYPES.has(card.type)) deriveSurface(teq, out);
  return { radius, mass };
}

function deriveAtmosphere(
  vEsc: number,
  bodyInputs: PhysicsInput[],
  teq: PhysicsInput | null,
  out: ResultBuilder,
): void {
  for (const [gas, molar] of Object.entries(ATMOSPHERE_GASES)) {
    const id = `keeps_${gas}`;
    const vt = teq ? thermalSpeedMs(teq.value, molar) : null;
    if (!teq || vt === null) {
      out.refuse(id, ['teq_K']);
      continue;
    }
    out.put(id, keepsGas(vEsc, vt), [...bodyInputs, teq], {
      section: S,
      formula: `kept if v_esc >= ${ATMOSPHERE_RETENTION_FACTOR} * sqrt(2 k T / m), m(${gas}) = ${molar} u`,
      assumption: 'T = Teq; the upper atmosphere where gas escapes is usually hotter',
    });
  }
}

function deriveSurface(teq: PhysicsInput | null, out: ResultBuilder): void {
  const ids = ['polar_ice', 'oceans', 'lava_glow'] as const;
  // readTeq only returns a Teq above 0 K, so a bad card value is refused here, not flagged.
  if (!teq) {
    for (const id of ids) out.refuse(id, ['teq_K']);
    return;
  }
  const t = teq.value;
  const rules: Record<(typeof ids)[number], [boolean, string]> = {
    polar_ice: [t < POLAR_ICE_BELOW_K, `Teq < ${POLAR_ICE_BELOW_K} K`],
    oceans: [t <= OCEANS_REMOVED_ABOVE_K, `Teq <= ${OCEANS_REMOVED_ABOVE_K} K`],
    lava_glow: [t >= LAVA_GLOW_FROM_K, `Teq >= ${LAVA_GLOW_FROM_K} K`],
  };
  for (const id of ids) {
    const [value, formula] = rules[id];
    out.put(id, value, [teq], { section: S, formula });
  }
}
