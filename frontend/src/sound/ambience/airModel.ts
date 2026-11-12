// §3 inputs -> AirModel: everything about a world's air and surface that the soundscape needs, with a provenance tag
// per input and the refusals (spec R13 §2 rules 2 and 4). Engine values are read only through WorldEngineLike.
// Nothing is guessed: a missing engine value refuses the whole soundscape with a data-gap reason.
import type { Tag } from '@/contract';
import type { CardToWorldOk } from '@/engine/worlds/cardToWorld';
import type { FluidKey } from '@/engine/worlds/types';
import { classify, density, gammaFor, soundSpeed } from './air';
import { liquidFor } from './liquids';
import type { AirModel, Refusal, TaggedInput, WorldEngineLike } from './types';
import { HURRICANE, K_SURF, P_FLOOR, RH_ASSUMED } from './tuning';

/** Exact refusal and data-gap strings (§7, §13). New strings (not in the spec) are proposed as Q- entries for T1. */
export const REFUSAL_TEXT = {
  /** R6: only below P_FLOOR (1 Pa). */
  noAir: 'No air here, so there is no sound.',
  /** R6: only below P_FLOOR. */
  lavaNoAir: 'The magma glows, but with almost no air, it makes no sound you could hear.',
  noLiquid: 'No liquid can exist on the surface here, so there are no waves, rain or rivers.',
  dataGap: 'Sound needs the surface view.',
  /** New (Q- proposal). */
  noSea: 'There is no sea on this world, so there are no waves.',
  /** New (Q- proposal). */
  seaUnknown: 'The sea is not known yet, so there are no waves.',
  /** New (Q- proposal). */
  noRivers: 'No rivers flow here.',
  /** New (Q- proposal): the fluid can be liquid but the air never brings rain (engine canLiquid false). */
  noRain: 'Rain cannot fall here.',
} as const;

/**
 * Saturation vapour pressure of water, Pa: Murphy & Koop 2005 (QJRMS 131:1539) eq. 7 over ice below the triple point,
 * eq. 10 over liquid above, continued by Clausius-Clapeyron above 373.15 K. A port of `psatMK` in core.js on
 * fix/93-engines (#93 3.2), the engine this ships with; origin/main's core still uses the prototype's single-heat line.
 */
export function psatWater(T: number): number {
  if (T < 273.16) return Math.exp(9.550426 - 5723.265 / T + 3.53068 * Math.log(T) - 0.00728332 * T);
  const t = Math.min(T, 373.15);
  const p = Math.exp(
    54.842763 - 6763.22 / t - 4.21 * Math.log(t) + 0.000367 * t +
      Math.tanh(0.0415 * (t - 218.8)) * (53.878 - 1331.22 / t - 9.44523 * Math.log(t) + 0.014025 * t),
  );
  // FLUIDS.water.L = 40650 J/mol (the prototype's 373 K heat).
  return T > 373.15 ? p * Math.exp((40650 / 8.314) * (1 / 373.15 - 1 / T)) : p;
}

/** The engine's "Strongest hurricane possible" (core.js worldUi), m/s. */
export function hurricaneVmax(Tmax: number, Ps_bar: number): number {
  const qst = (0.622 * psatWater(Tmax)) / (Ps_bar * 1e5);
  return Math.sqrt(((HURRICANE.eff * (Tmax - HURRICANE.To)) / HURRICANE.To) * HURRICANE.Lv * qst * HURRICANE.ck);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * res32 is not exposed by state() or worldModel(): mirror core.js applySpin. ecc falls back to 0 where the core
 * would read its ORB table; every ORB eccentricity is below 0.15, so the result is the same (ASSUMPTION).
 */
function deriveRes32(world: CardToWorldOk, gas: boolean): boolean {
  if (gas) return false;
  const spin = world.overrides.spin ?? 'auto';
  const ecc = world.overrides.ecc ?? world.preset.ob?.e ?? 0;
  return spin === 'res32' || (spin === 'auto' && world.preset.locked && ecc >= 0.15);
}

/** §3, §4: build the AirModel once per world (and again on the §9.6 triggers). Pure. */
export function buildAirModel(world: CardToWorldOk, e: WorldEngineLike): AirModel {
  const preset = world.preset;
  const tags = world.tags;
  const st = e.state();
  const m = e.readouts().model ?? {};
  const cpu = e.cpuFields();
  const climate = cpu?.climate ?? null;
  const hydro = cpu?.hydro ?? null;
  const gas = !!st.gas;
  const fluid: FluidKey = st.fluid;
  const mu = preset.mu;
  const seed = preset.seed;
  const seed3raw = (preset as { seed3?: unknown }).seed3;
  const seed3: [number, number, number] =
    Array.isArray(seed3raw) && seed3raw.length === 3 && seed3raw.every((v) => typeof v === 'number')
      ? [seed3raw[0] as number, seed3raw[1] as number, seed3raw[2] as number]
      : [seed, seed, seed];

  const Ts = num(m.Ts);
  const Hm = num(m.H);
  const gv = num(m.gv);
  const U = num(m.U);
  const Ps = num(st.Ps);
  const refusals: Refusal[] = [];
  const inputs: TaggedInput[] = [];
  const dataOK = Ts !== null && Ts > 0 && Hm !== null && Hm > 0 && gv !== null && gv > 0 && U !== null && (gas || Ps !== null);

  // Provenance: a slider value differing from the card's is the user's choice (artistic), not the card's tag.
  const psSlid = !gas && Ps !== null && Ps !== preset.Ps;
  const fluidSlid = fluid !== preset.fluid;
  const psTag: Tag = psSlid ? 'artistic' : (tags.Ps ?? 'model_dependent');
  const fluidTag: Tag = fluidSlid ? 'artistic' : (tags.fluid ?? 'model_dependent');

  const cls = classify(mu, fluid, gas);
  const gamma = gammaFor(cls, mu, Ts ?? 0);
  const T0 = Ts ?? 0;
  const P0 = gas ? 1e4 : (Ps ?? 0) * 1e5;
  const H_km = (Hm ?? 0) / 1000;
  // R6: acoustic air is P0 >= P_FLOOR. The engine's `airless` (Ps < 0.02 bar) is a climate threshold (no greenhouse,
  // no rain) and does not gate sound; liquids and rain still follow the engine's state and canLiquid.
  const airOK = dataOK && (gas || P0 >= P_FLOOR);
  const c0 = dataOK ? soundSpeed(gamma, T0, mu) : 0;
  const rho0 = dataOK ? density(P0, T0, mu) : 0;
  const lavaWorld = !gas && T0 > 700 && !!hydro?.lava;

  let liquid = null as AirModel['liquid'];
  if (lavaWorld) liquid = liquidFor(fluid, true);
  else if (!gas && m.state === 'liquid') liquid = liquidFor(fluid, false);

  // Ocean share (coordinator ruling 1): engine climate statistics, else the preset, else 0 with a refusal note.
  let oceanF = 0;
  let oceanTag: Tag = 'model_dependent';
  let oceanSrc = 'engine climate (stats.ocean)';
  const statsOcean = num(climate?.stats?.ocean);
  if (statsOcean !== null) oceanF = statsOcean;
  else if (num(preset.oceanF) !== null) {
    oceanF = preset.oceanF as number;
    oceanTag = tags.oceanF ?? 'model_dependent';
    oceanSrc = 'card world (preset.oceanF)';
  } else oceanSrc = 'not known yet';
  if (gas) oceanF = 0;

  let Vmax: number | null = null;
  const Tmax = num(climate?.stats?.max);
  if (airOK && !gas && fluid === 'water' && Tmax !== null && Tmax > HURRICANE.Tmin && Ps !== null && Ps > 0) {
    Vmax = hurricaneVmax(Tmax, Ps);
  }

  // ---------- refusals ----------
  if (!dataOK) refusals.push({ source: 'all', reason: REFUSAL_TEXT.dataGap });
  else if (!airOK) refusals.push({ source: 'all', reason: !gas && T0 > 700 ? REFUSAL_TEXT.lavaNoAir : REFUSAL_TEXT.noAir });
  else if (!gas && !lavaWorld) {
    if (!liquid) {
      for (const s of ['S1_sea', 'S4', 'S5', 'S6', 'S7'] as const) refusals.push({ source: s, reason: REFUSAL_TEXT.noLiquid });
    } else {
      if (statsOcean === null && num(preset.oceanF) === null) {
        for (const s of ['S1_sea', 'S4', 'S5'] as const) refusals.push({ source: s, reason: REFUSAL_TEXT.seaUnknown });
      } else if (!(oceanF > 0)) {
        for (const s of ['S1_sea', 'S4', 'S5'] as const) refusals.push({ source: s, reason: REFUSAL_TEXT.noSea });
      }
      if (m.canLiquid === false) refusals.push({ source: 'S6', reason: REFUSAL_TEXT.noRain });
      if (hydro && typeof hydro.n === 'number' && hydro.n === 0) refusals.push({ source: 'S7', reason: REFUSAL_TEXT.noRivers });
    }
  }

  // ---------- tagged inputs (§12.3 "What you hear") ----------
  const md: Tag = 'model_dependent';
  if (!gas && Ps !== null) inputs.push({ label: 'Surface pressure', value: Ps, unit: 'bar', tag: psTag, source: psSlid ? 'slider' : 'card world' });
  else if (gas) inputs.push({ label: 'Reference pressure', value: P0 / 1e5, unit: 'bar', tag: md, source: 'engine (gas giant cloud deck, Pref)' });
  inputs.push({ label: 'Surface liquid', value: fluid, unit: '', tag: fluidTag, source: fluidSlid ? 'slider' : 'card world' });
  inputs.push({ label: 'Molar mass', value: mu, unit: 'g/mol', tag: tags.mu ?? md, source: 'card world' });
  if (Ts !== null) inputs.push({ label: 'Air temperature', value: Ts, unit: 'K', tag: md, source: 'engine model' });
  if (gv !== null) inputs.push({ label: 'Gravity', value: gv, unit: 'm/s²', tag: md, source: 'engine model' });
  if (Hm !== null) inputs.push({ label: 'Scale height', value: H_km, unit: 'km', tag: md, source: 'engine model' });
  if (U !== null) {
    const measuredWind = gas && tags.Umeas === 'measured';
    inputs.push({ label: 'Wind scale', value: U, unit: 'm/s', tag: measuredWind ? 'measured' : md, source: measuredWind ? 'card (measured jets)' : 'engine model' });
  }
  inputs.push({ label: 'Air type', value: cls, unit: '', tag: 'inferred_from_analog', source: 'composition class from fluid and molar mass (§3.2)' });
  inputs.push({ label: 'Ratio of specific heats', value: gamma, unit: '', tag: 'inferred_from_analog', source: 'class table (§4.2)' });
  if (dataOK) {
    inputs.push({ label: 'Speed of sound', value: c0, unit: 'm/s', tag: 'derived', source: 'c0 = √(γ R T0 / M)' });
    inputs.push({ label: 'Air density', value: rho0, unit: 'kg/m³', tag: 'derived', source: 'ρ0 = P0 M / (R T0)' });
    inputs.push({ label: 'Acoustic impedance', value: rho0 * c0, unit: 'kg m⁻² s⁻¹', tag: 'derived', source: 'Z0 = ρ0 c0' });
  }
  if (cls === 'N2') inputs.push({ label: 'Humidity (for absorption)', value: RH_ASSUMED * 100, unit: '%', tag: 'inferred_from_analog', source: 'assumed 50 % (ISO 9613-1)' });
  if (lavaWorld && airOK) {
    // R6: the lava world's thin rock-vapour air is assumed (cardToWorld ROCK_VAPOUR), so its sound carries that label.
    inputs.push({ label: 'Atmosphere', value: 'thin rock vapour (assumed)', unit: '', tag: 'inferred_from_analog', source: 'assumed atmosphere (Schaefer & Fegley 2009 analog)' });
  }
  if (!gas) inputs.push({ label: 'Ocean share', value: oceanF, unit: '', tag: oceanTag, source: oceanSrc });

  return {
    gas, cls, fluid, state: typeof m.state === 'string' ? m.state : '',
    T0, P0, H_km, mu, gamma, gv: gv ?? 0, gamK: num(m.gamK) ?? 0,
    c0, rho0, Z0: rho0 * c0,
    airOK, liquid, lavaWorld,
    Uscale: U ?? 0, Us: K_SURF * (U ?? 0), phiH: num(m.phiH) ?? 0, Om: num(m.Om) ?? 0,
    locked: !!st.locked, res32: deriveRes32(world, gas),
    R_km: preset.Rj * 71492, zc_km: num(m.zc), regime: typeof m.regime === 'string' ? m.regime : '',
    seed, Vmax, seed3, oceanF, presetId: preset.id,
    inputs, refusals,
  };
}
