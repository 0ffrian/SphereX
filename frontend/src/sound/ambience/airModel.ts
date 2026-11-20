// §3 inputs -> AirModel: everything about a world's air and surface that the soundscape needs, with a provenance tag
// per input and the refusals (spec R13 §2 rules 2 and 4). Engine values are read only through WorldEngineLike.
// Nothing is guessed: a missing engine value refuses the whole soundscape with a data-gap reason.
import type { Tag } from '@/contract';
import type { CardToWorldOk } from '@/engine/worlds/cardToWorld';
import type { FluidKey } from '@/engine/worlds/types';
import { classify, density, gammaFor, soundSpeed } from './air';
import { REFUSAL_TEXT } from './captions';
import { liquidFor } from './liquids';
import type { AirModel, Refusal, TaggedInput, WorldEngineLike } from './types';
import { HURRICANE, K_SURF, P_FLOOR, RH_ASSUMED, ROCK_VAPOUR_GAMMA } from './tuning';

export { REFUSAL_TEXT };

/**
 * Saturation vapour pressure of water, Pa: Murphy & Koop 2005 (QJRMS 131:1539) eq. 7 over ice below the triple point,
 * eq. 10 over liquid above, continued by Clausius-Clapeyron above 373.15 K. A port of `psatMK` in core.js on
 * fix/93-engines (#93 3.2), the engine this ships with; origin/main's core still uses the prototype's single-heat line.
 */
export function psatWater(T: number): number {
  if (T < 273.16) return Math.exp(9.550426 - 5723.265 / T + 3.53068 * Math.log(T) - 0.00728332 * T);
  const t = Math.min(T, 373.15);
  const p = Math.exp(
    54.842763 -
      6763.22 / t -
      4.21 * Math.log(t) +
      0.000367 * t +
      Math.tanh(0.0415 * (t - 218.8)) *
        (53.878 - 1331.22 / t - 9.44523 * Math.log(t) + 0.014025 * t),
  );
  // FLUIDS.water.L = 40650 J/mol (the prototype's 373 K heat).
  return T > 373.15 ? p * Math.exp((40650 / 8.314) * (1 / 373.15 - 1 / T)) : p;
}

/** R12: true while the world's climate or rivers are not ready; rebuild the AirModel on the next tick. */
export function isWaiting(air: AirModel): boolean {
  return air.refusals.some((r) => r.source === 'all' && r.reason === REFUSAL_TEXT.waiting);
}

/** The engine's "Strongest hurricane possible" (core.js worldUi), m/s. */
export function hurricaneVmax(Tmax: number, Ps_bar: number): number {
  const qst = (0.622 * psatWater(Tmax)) / (Ps_bar * 1e5);
  return Math.sqrt(
    ((HURRICANE.eff * (Tmax - HURRICANE.To)) / HURRICANE.To) * HURRICANE.Lv * qst * HURRICANE.ck,
  );
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
  const dataOK =
    Ts !== null &&
    Ts > 0 &&
    Hm !== null &&
    Hm > 0 &&
    gv !== null &&
    gv > 0 &&
    U !== null &&
    (gas || Ps !== null);

  // Provenance: a slider value differing from the card's is the user's choice (artistic), not the card's tag.
  const psSlid = !gas && Ps !== null && Ps !== preset.Ps;
  const fluidSlid = fluid !== preset.fluid;
  const psTag: Tag = psSlid ? 'artistic' : (tags.Ps ?? 'model_dependent');
  const fluidTag: Tag = fluidSlid ? 'artistic' : (tags.fluid ?? 'model_dependent');

  const cls = classify(mu, fluid, gas);
  // Review L7: the lava world's assumed rock vapour takes gamma 1.4 (§4.2); its absorption uses the CO2 class (mu 44),
  // labelled inferred_from_analog below.
  const rockVapour = !gas && (Ts ?? 0) > 700 && !!hydro?.lava;
  const gamma = rockVapour ? ROCK_VAPOUR_GAMMA : gammaFor(cls, mu, Ts ?? 0);
  const T0 = Ts ?? 0;
  const P0 = gas ? 1e4 : (Ps ?? 0) * 1e5;
  const H_km = (Hm ?? 0) / 1000;
  // R6: acoustic air is P0 >= P_FLOOR. The engine's `airless` (Ps < 0.02 bar) is a climate threshold (no greenhouse,
  // no rain) and does not gate sound; liquids and rain still follow the engine's state and canLiquid.
  const airOK = dataOK && (gas || P0 >= P_FLOOR);
  const c0 = dataOK ? soundSpeed(gamma, T0, mu) : 0;
  const rho0 = dataOK ? density(P0, T0, mu) : 0;
  const lavaWorld = !gas && T0 > 700 && !!hydro?.lava;
  // R12: the climate and hydro fields arrive after the spin-up (EB.ready). Until then the world is still forming: a
  // transient state the caller re-evaluates each tick (isWaiting), never a permanent refusal.
  const waiting = dataOK && !gas && (!climate?.stats || !hydro);

  // R7 (amended): liquid = canLiquid && (state liquid || open water in the climate). canLiquid is false below the fluid's
  // triple-point pressure (e.g. water at 500 Pa), where the climate grid's ice-free ocean is not liquid (it counts
  // ice-free cells, and on an airless world sea ice never grows). Open water on a world whose mean state is frozen
  // (an eyeball world) is liquid. Not after a runaway.
  const openWater = num(climate?.stats?.liquid);
  const statsOcean = num(climate?.stats?.ocean);
  const runaway = !!m.runaway;
  const canLiquid = m.canLiquid === true;
  const localLiquid =
    !gas &&
    !runaway &&
    canLiquid &&
    m.state !== 'liquid' &&
    statsOcean !== null &&
    statsOcean > 0 &&
    openWater !== null &&
    openWater > 0;
  let liquid = null as AirModel['liquid'];
  if (lavaWorld) liquid = liquidFor(fluid, true);
  else if (!gas && !runaway && canLiquid && (m.state === 'liquid' || localLiquid))
    liquid = liquidFor(fluid, false);

  // Ocean share (coordinator ruling 1): engine climate statistics, else the preset, else 0.
  let oceanF = 0;
  let oceanTag: Tag = 'model_dependent';
  let oceanSrc = 'engine climate (stats.ocean)';
  if (statsOcean !== null) oceanF = statsOcean;
  else if (num(preset.oceanF) !== null) {
    oceanF = preset.oceanF as number;
    oceanTag = tags.oceanF ?? 'model_dependent';
    oceanSrc = 'card world (preset.oceanF)';
  } else oceanSrc = 'not known';
  if (gas) oceanF = 0;

  // R9: the engine's own "Strongest hurricane possible" condition (liquid water, stats.max > 299.65 K, cyclones
  // present), plus Ps >= 0.1 bar and a finite value, clamped to 100 m/s (Emanuel potential intensity rarely exceeds
  // ~90 m/s). model_dependent.
  let Vmax: number | null = null;
  let vmaxClamped = false;
  const Tmax = num(climate?.stats?.max);
  const cyclones = e.weatherFields()?.cyclones?.length ?? 0;
  if (
    airOK &&
    !gas &&
    !lavaWorld &&
    fluid === 'water' &&
    liquid?.name === 'water' &&
    cyclones > 0 &&
    Tmax !== null &&
    Tmax > HURRICANE.Tmin &&
    Ps !== null &&
    Ps >= HURRICANE.PsMin
  ) {
    const v = hurricaneVmax(Tmax, Ps);
    if (Number.isFinite(v) && v > 0) {
      vmaxClamped = v > HURRICANE.VmaxCap;
      Vmax = Math.min(v, HURRICANE.VmaxCap);
    }
  }

  // ---------- refusals ----------
  if (!dataOK) refusals.push({ source: 'all', reason: REFUSAL_TEXT.dataGap });
  else if (!airOK)
    refusals.push({
      source: 'all',
      reason: lavaWorld ? REFUSAL_TEXT.lavaNoAir : REFUSAL_TEXT.noAir,
    });
  else if (waiting) refusals.push({ source: 'all', reason: REFUSAL_TEXT.waiting });
  else if (!gas && !lavaWorld) {
    if (!liquid) {
      const why = runaway ? REFUSAL_TEXT.boiledAway : REFUSAL_TEXT.noLiquid;
      for (const s of ['S1_sea', 'S4', 'S5', 'S6', 'S7'] as const)
        refusals.push({ source: s, reason: why });
    } else {
      if (!(oceanF > 0)) {
        for (const s of ['S1_sea', 'S4', 'S5'] as const)
          refusals.push({ source: s, reason: REFUSAL_TEXT.noSea });
      }
      if (typeof hydro?.n === 'number' && hydro.n === 0)
        refusals.push({ source: 'S7', reason: REFUSAL_TEXT.noRivers });
    }
  }

  // ---------- tagged inputs (§12.3 "What you hear") ----------
  const md: Tag = 'model_dependent';
  if (!gas && Ps !== null)
    inputs.push({
      label: 'Surface pressure',
      value: Ps,
      unit: 'bar',
      tag: psTag,
      source: psSlid ? 'slider' : 'card world',
    });
  else if (gas)
    inputs.push({
      label: 'Reference pressure',
      value: P0 / 1e5,
      unit: 'bar',
      tag: md,
      source: 'engine (gas giant cloud deck, Pref)',
    });
  inputs.push({
    label: 'Surface liquid',
    value: fluid,
    unit: '',
    tag: fluidTag,
    source: fluidSlid ? 'slider' : 'card world',
  });
  inputs.push({
    label: 'Molar mass',
    value: mu,
    unit: 'g/mol',
    tag: tags.mu ?? md,
    source: 'card world',
  });
  if (Ts !== null)
    inputs.push({
      label: 'Air temperature',
      value: Ts,
      unit: 'K',
      tag: md,
      source: 'engine model',
    });
  if (gv !== null)
    inputs.push({ label: 'Gravity', value: gv, unit: 'm/s²', tag: md, source: 'engine model' });
  if (Hm !== null)
    inputs.push({
      label: 'Scale height',
      value: H_km,
      unit: 'km',
      tag: md,
      source: 'engine model',
    });
  if (U !== null) {
    const measuredWind = gas && tags.Umeas === 'measured';
    inputs.push({
      label: 'Wind scale',
      value: U,
      unit: 'm/s',
      tag: measuredWind ? 'measured' : md,
      source: measuredWind ? 'card (measured jets)' : 'engine model',
    });
  }
  inputs.push({
    label: 'Air type',
    value: cls,
    unit: '',
    tag: 'inferred_from_analog',
    source: 'composition class from fluid and molar mass (§3.2)',
  });
  inputs.push({
    label: 'Ratio of specific heats',
    value: gamma,
    unit: '',
    tag: 'inferred_from_analog',
    source: 'class table (§4.2)',
  });
  if (dataOK) {
    inputs.push({
      label: 'Speed of sound',
      value: c0,
      unit: 'm/s',
      tag: 'derived',
      source: 'c0 = √(γ R T0 / M)',
    });
    inputs.push({
      label: 'Air density',
      value: rho0,
      unit: 'kg/m³',
      tag: 'derived',
      source: 'ρ0 = P0 M / (R T0)',
    });
    inputs.push({
      label: 'Acoustic impedance',
      value: rho0 * c0,
      unit: 'kg m⁻² s⁻¹',
      tag: 'derived',
      source: 'Z0 = ρ0 c0',
    });
  }
  if (cls === 'N2')
    inputs.push({
      label: 'Humidity (for absorption)',
      value: RH_ASSUMED * 100,
      unit: '%',
      tag: 'inferred_from_analog',
      source: 'assumed 50 % (ISO 9613-1)',
    });
  if (lavaWorld && airOK) {
    // R6: the lava world's thin rock-vapour air is assumed (cardToWorld ROCK_VAPOUR), so its sound carries that label.
    inputs.push({
      label: 'Atmosphere',
      value: 'thin rock vapour (assumed)',
      unit: '',
      tag: 'inferred_from_analog',
      source: 'assumed atmosphere (Schaefer & Fegley 2009 analog)',
    });
    inputs.push({
      label: 'Sound absorption',
      value: 'CO₂-like (rock vapour analog)',
      unit: '',
      tag: 'inferred_from_analog',
      source: 'CO₂ class absorption for mu 44 (§4.3)',
    });
  }
  if (localLiquid && openWater !== null) {
    inputs.push({
      label: 'Open water share',
      value: openWater,
      unit: '',
      tag: 'model_dependent',
      source: 'engine climate (stats.liquid)',
    });
  }
  if (Vmax !== null) {
    inputs.push({
      label: 'Strongest hurricane',
      value: Vmax,
      unit: 'm/s',
      tag: 'model_dependent',
      source: vmaxClamped ? 'engine formula, capped at 100 m/s' : 'engine formula',
    });
  }
  if (!gas)
    inputs.push({ label: 'Ocean share', value: oceanF, unit: '', tag: oceanTag, source: oceanSrc });

  return {
    gas,
    cls,
    fluid,
    state: typeof m.state === 'string' ? m.state : '',
    T0,
    P0,
    H_km,
    mu,
    gamma,
    gv: gv ?? 0,
    gamK: num(m.gamK) ?? 0,
    c0,
    rho0,
    Z0: rho0 * c0,
    airOK,
    liquid,
    lavaWorld,
    Uscale: U ?? 0,
    Us: K_SURF * (U ?? 0),
    phiH: num(m.phiH) ?? 0,
    Om: num(m.Om) ?? 0,
    locked: !!st.locked,
    res32: deriveRes32(world, gas),
    R_km: preset.Rj * 71492,
    zc_km: num(m.zc),
    regime: typeof m.regime === 'string' ? m.regime : '',
    seed,
    Vmax,
    seed3,
    oceanF,
    presetId: preset.id,
    inputs,
    refusals,
  };
}
