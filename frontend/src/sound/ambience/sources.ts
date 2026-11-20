// §7 sound sources: physics gates, and the BedSpec (with its params) for every source the gates allow, in the §9.4
// priority order. The params keys are exactly the #113 table (contract amendment 2, PARAM_KEYS below). Memory caps,
// caching and loudness belong to #113's palette; this module returns every passing bed.
import { absorption, kinematicViscosity } from './air';
import { bedMembership, SOURCE_TEXT } from './captions';
import { hash32 } from './hash';
import { bubbleFactor, dropPhysics } from './liquids';
import type { AirModel, BedSpec, Place, Refusal, SourceId } from './types';
import {
  A_L,
  A_P,
  A_T,
  A_W,
  BED_N,
  BED_RATE,
  HISS_D_M,
  IU_LAND,
  IU_SEA,
  L_REF,
  PM_H,
  PM_T,
  RE_MIN,
  ROSHKO_A,
  ROSHKO_B,
  ROSHKO_RE_MAX,
  SAND_A,
  SAND_CO2_COHESION,
  SAND_DP,
  SAND_RHO_ORGANIC,
  SAND_RHO_SILICATE,
  SAND_U10_PER_USTAR,
  SPEEDUP,
  GAS_IU,
  ST_HIGH,
  SURF_DB_H04,
  SURF_DB_H2,
  THUNDER_VARIANT_D_M,
  U_E_REF,
  U_REF_MIN,
  U_WAVE_METHANE,
  U_WAVE_WATER,
  WHISTLE_D_M,
  WHITECAP_A,
  WHITECAP_B,
  WHITECAP_MIN_U,
  WHITECAP_RATE0,
  WHITECAP_RATE_U,
} from './tuning';
import { lightningRule, thunderParams } from './weather';

export { bedMembership, SOURCE_TEXT };

/** §9.4 bake priority. */
export const PRIORITY: readonly SourceId[] = [
  'S1_land',
  'S1_sea',
  'S4',
  'S5',
  'S6',
  'S12',
  'S2',
  'S3',
  'S7',
  'S8',
  'S10',
  'S9',
  'thunder',
];

/** §9.2 sample-rate groups. Thunder is in the 29 kHz group so 2^20 samples (36.2 s) hold a 35 s roll. */
export const BED_RATE_OF: Record<SourceId, number> = {
  S1_land: BED_RATE.wind,
  S1_sea: BED_RATE.wind,
  S2: BED_RATE.wind,
  S3: BED_RATE.wind,
  S9: BED_RATE.wind,
  S4: BED_RATE.sea,
  S5: BED_RATE.sea,
  S6: BED_RATE.rain,
  S7: BED_RATE.rain,
  S8: BED_RATE.low,
  S10: BED_RATE.low,
  S12: BED_RATE.low,
  thunder: BED_RATE.low,
};

/** BedSpec.params keys per source: the #113 plan §4 table (frozen, amendment 2). S3 needs at least one optional key. */
export const PARAM_KEYS: Record<SourceId, { req: readonly string[]; opt: readonly string[] }> = {
  S1_land: { req: ['Iu'], opt: [] },
  S1_sea: { req: ['Iu'], opt: [] },
  S2: { req: ['Iu', 'fHiss_Hz'], opt: [] },
  S3: { req: ['Iu'], opt: ['fWhistle1_Hz', 'fWhistle2_Hz', 'fWhistle3_Hz'] },
  S4: { req: ['Hs_m', 'Tp_s', 'mf', 'absK2'], opt: [] },
  S5: { req: ['Hs_m', 'Tp_s', 'mf', 'whitecapRate_per_s'], opt: [] },
  S6: { req: ['rainPitch', 'mf'], opt: [] },
  S7: { req: ['mf'], opt: [] },
  S8: { req: [], opt: [] },
  S9: { req: ['Iu'], opt: ['fHiss_Hz'] },
  S10: { req: ['Iu'], opt: [] },
  S12: { req: [], opt: ['Iu'] },
  thunder: { req: ['fm_Hz', 'dur_s', 'd_m', 'crack', 'absK2'], opt: [] },
};

/** Reynolds number of an obstacle of size d (m) at wind U (m/s) in the reference-level air. */
export function reynolds(air: AirModel, U: number, d: number): number {
  const nu = kinematicViscosity(air.cls, air.T0, air.rho0);
  return nu > 0 ? (U * d) / nu : 0;
}

/** Roshko 1954 Strouhal number; null below the shedding threshold Re 47. */
export function strouhal(Re: number): number | null {
  if (!(Re >= RE_MIN)) return null;
  return Re <= ROSHKO_RE_MAX ? ROSHKO_A * (1 - ROSHKO_B / Re) : ST_HIGH;
}

/** Aeolian tone frequency St(Re) U / d, or null when the obstacle does not shed. */
export function aeolianHz(air: AirModel, U: number, d: number): number | null {
  const st = strouhal(reynolds(air, U, d));
  return st === null ? null : (st * U) / d;
}

/** Pierson-Moskowitz significant height and peak period [SS 2.1]; no fetch cap (no fetch formula in the spec). */
export function wavesPM(U: number, g: number): { Hs: number; Tp: number } {
  return { Hs: (PM_H * U * U) / g, Tp: (PM_T * U) / g };
}

/** Monahan whitecap fraction W = 3.84e-6 U^3.41, zero below 3.5 m/s. */
export function whitecapFraction(U: number): number {
  return U < WHITECAP_MIN_U ? 0 : WHITECAP_A * Math.pow(U, WHITECAP_B);
}

/** Whitecap event rate 0.35 (U/8)^3 per second, zero below 3.5 m/s (Moon). */
export function whitecapRate(U: number): number {
  return U < WHITECAP_MIN_U ? 0 : WHITECAP_RATE0 * Math.pow(U / WHITECAP_RATE_U, 3);
}

/**
 * Wave onset wind, m/s. Methane 0.6 (Hayes et al. 2013); every other fluid reuses water's 1.5 [verify]
 * (inferred_from_analog: the §4.4 table has no liquid viscosity for the (nu_l/nu_water)^(1/3) scaling). With U_ref >= 2 m/s
 * this gate always passes on rocky worlds.
 */
export function uWave(air: AirModel): number {
  return air.fluid === 'methane' ? U_WAVE_METHANE : U_WAVE_WATER;
}

/** Saltation threshold as a 10 m wind (Bagnold, Earth-calibrated; x1.8 cohesion on CO2 worlds [verify]). */
export function uSand(air: AirModel): number {
  const rhoP = air.fluid === 'methane' ? SAND_RHO_ORGANIC : SAND_RHO_SILICATE;
  const ustar = SAND_A * Math.sqrt(((rhoP - air.rho0) * air.gv * SAND_DP) / air.rho0);
  return SAND_U10_PER_USTAR * ustar * (air.cls === 'CO2' ? SAND_CO2_COHESION : 1);
}

/** Bolin & Abom 2010: 60 dB at Hs 0.4 m to 78 dB at 2 m, in log Hs; extrapolated below, held at 78 above (ASSUMPTION). */
export function surfDb(Hs: number): number {
  const h = Math.min(Math.max(Hs, 1e-3), 2);
  return SURF_DB_H04 + ((SURF_DB_H2 - SURF_DB_H04) * Math.log(h / 0.4)) / Math.log(2 / 0.4);
}

function refusedBy(air: AirModel, id: SourceId): boolean {
  return air.refusals.some((r) => r.source === id || r.source === 'all');
}

function seaOK(air: AirModel): boolean {
  return (
    air.airOK && !air.gas && !air.lavaWorld && !!air.liquid && !air.liquid.viscous && air.oceanF > 0
  );
}

export interface Gate {
  pass: boolean;
  reason: string | null;
}

/** §7 gates at the bake wind Uref (m/s). A failed gate with reason null is simply not applicable (no caption). */
export function gates(air: AirModel, Uref: number): Record<SourceId, Gate> {
  const ok = (pass: boolean, reason: string | null = null): Gate => ({
    pass,
    reason: pass ? null : reason,
  });
  const rocky = air.airOK && !air.gas;
  const hiss = rocky && aeolianHz(air, Uref, HISS_D_M) !== null;
  const whistle = rocky && WHISTLE_D_M.some((d) => aeolianHz(air, Uref, d) !== null);
  const allThin = rocky && !hiss && !whistle;
  const surface = rocky && !air.lavaWorld && !!air.liquid && !air.liquid.viscous;
  const maxA = air.locked && !air.res32 ? A_L : Math.max(A_T, A_W, A_P);
  // ASSUMPTION: "U10_max" = the larger of the bake wind and the strongest pattern wind with full hill speed-up
  // (hurricanes are transient and excluded, red review 7).
  const U10max = Math.max(Uref, air.Us * maxA * (1 + SPEEDUP));
  const rule = lightningRule(air, air.presetId);
  return {
    S1_land: ok(rocky),
    S1_sea: ok(seaOK(air) && !refusedBy(air, 'S1_sea')),
    S2: ok(hiss, allThin ? SOURCE_TEXT.whistle : null),
    S3: ok(whistle, allThin ? SOURCE_TEXT.whistle : null),
    S4: ok(
      seaOK(air) && !refusedBy(air, 'S4') && Uref >= uWave(air),
      seaOK(air) ? SOURCE_TEXT.noWaves : null,
    ),
    S5: ok(
      seaOK(air) && !refusedBy(air, 'S5') && Uref >= uWave(air),
      seaOK(air) ? SOURCE_TEXT.noWaves : null,
    ),
    S6: ok(surface && !refusedBy(air, 'S6')),
    S7: ok(surface && !refusedBy(air, 'S7')),
    S8: ok(air.airOK && air.lavaWorld),
    S9: ok(rocky && air.Vmax !== null),
    S10: ok(rocky && U10max >= uSand(air), rocky ? SOURCE_TEXT.noSand : null),
    S12: ok(air.airOK && air.gas),
    thunder: ok(rule.allowed, rule.reason),
  };
}

/** Geometric-mean band centre (Hz) of a bed, used for its absorption (§11.1). */
export function bandCenterHz(id: SourceId, air: AirModel, Uref: number): number {
  const mf = bubbleFactor(air) ?? 1;
  switch (id) {
    case 'S1_land':
    case 'S1_sea':
    case 'S9':
      return Math.sqrt(18 * (40 + 5 * Uref));
    case 'S2':
      return aeolianHz(air, Uref, HISS_D_M) ?? 2000;
    case 'S3':
      return WHISTLE_D_M.map((d) => aeolianHz(air, Uref, d)).find((f) => f !== null) ?? 2000;
    case 'S4':
      return Math.sqrt(45 * 900 * Math.sqrt(mf));
    case 'S5':
      return Math.sqrt(25 * 180);
    case 'S6': {
      const p = dropPhysics(air)?.pitch ?? 1;
      return Math.sqrt(900 * p * 7000 * p);
    }
    case 'S7':
      return Math.sqrt(300 * 4000);
    case 'S8':
      return Math.sqrt(25 * 200);
    case 'S10':
      return Math.sqrt(2000 * 10000);
    case 'S12':
      return Math.sqrt(15 * 120);
    case 'thunder':
      return thunderParams(air, THUNDER_VARIANT_D_M[0]).fm_Hz;
  }
}

/** Earth reference level (§11.3) of a bed, dB SPL. */
export function lrefEarthDb(id: SourceId, g = 9.81): number {
  switch (id) {
    case 'S1_land':
    case 'S1_sea':
    case 'S9':
      return L_REF.wind;
    case 'S2':
    case 'S3':
      return L_REF.wind + L_REF.hissRel;
    case 'S4':
      return surfDb(wavesPM(U_E_REF, g).Hs);
    case 'S5':
      return L_REF.sea;
    case 'S6':
      return L_REF.rain;
    case 'S7':
      return L_REF.river;
    case 'S8':
      return L_REF.lava;
    case 'S10':
      return L_REF.sand;
    case 'S12':
      return L_REF.gas;
    case 'thunder':
      return L_REF.thunder;
  }
}

/** Ground (area) beds; flow beds are local noise at the listener (S1-S3, S9, S12). */
export function isGroundBed(id: SourceId): boolean {
  return id === 'S4' || id === 'S5' || id === 'S6' || id === 'S7' || id === 'S8' || id === 'S10';
}
/** Beds whose energy is mostly below 120 Hz feed the harmonic branch (§11.7). */
export function isHarmonicBed(id: SourceId): boolean {
  return id === 'S1_land' || id === 'S1_sea' || id === 'S8' || id === 'S12' || id === 'thunder';
}

/**
 * The bake wind U_ref (§9.4), one value per world (blue S1): max(Us, 2) on rocky worlds, m.U on gas giants, Vmax for
 * S9. ASSUMPTION: the spec's "U10 at the place the close-up opened" would make the bake depend on the spawn point;
 * the world's own surface scale keeps it deterministic per world (Q- proposal). levels.ts uses the same function.
 */
export function bakeWind(air: AirModel, id: SourceId): number {
  if (id === 'S9') return air.Vmax ?? 0;
  if (air.gas) return air.Uscale;
  return Math.max(air.Us, U_REF_MIN);
}

function paramsFor(
  id: SourceId,
  variant: number,
  air: AirModel,
  place: Place,
  Uref: number,
): Record<string, number> | null {
  const mf = bubbleFactor(air);
  const absK2 = absorption(1000, air.P0, air.T0, air.cls) / 1e6;
  const centreSea = place.samples[0]?.cls === 'sea';
  switch (id) {
    case 'S1_land':
    case 'S2':
    case 'S10':
      if (id === 'S2') {
        const f = aeolianHz(air, Uref, HISS_D_M);
        return f === null ? null : { Iu: IU_LAND, fHiss_Hz: f };
      }
      return { Iu: IU_LAND };
    case 'S1_sea':
      return { Iu: IU_SEA };
    case 'S3': {
      const p: Record<string, number> = { Iu: IU_LAND };
      WHISTLE_D_M.forEach((d, i) => {
        const f = aeolianHz(air, Uref, d);
        if (f !== null) p[`fWhistle${i + 1}_Hz`] = f;
      });
      return Object.keys(p).length > 1 ? p : null;
    }
    case 'S4':
    case 'S5': {
      if (mf === null) return null;
      const { Hs, Tp } = wavesPM(Uref, air.gv);
      return id === 'S4'
        ? { Hs_m: Hs, Tp_s: Tp, mf, absK2 }
        : { Hs_m: Hs, Tp_s: Tp, mf, whitecapRate_per_s: whitecapRate(Uref) };
    }
    case 'S6': {
      const drop = dropPhysics(air);
      return drop && mf !== null ? { rainPitch: drop.pitch, mf } : null;
    }
    case 'S7':
      return mf === null ? null : { mf };
    case 'S8':
      return {};
    case 'S9': {
      const p: Record<string, number> = { Iu: centreSea ? IU_SEA : IU_LAND };
      const f = aeolianHz(air, Uref, HISS_D_M);
      if (f !== null) p.fHiss_Hz = f;
      return p;
    }
    case 'S12':
      return { Iu: GAS_IU };
    case 'thunder': {
      const d = THUNDER_VARIANT_D_M[variant] as number;
      const t = thunderParams(air, d);
      return { fm_Hz: t.fm_Hz, dur_s: t.dur_s, d_m: d, crack: t.crack, absK2 };
    }
  }
}

/** §7 + §9.4: every bed whose gate passes, in priority order, and the refusals to caption. */
export function selectBeds(air: AirModel, place: Place): { beds: BedSpec[]; refusals: Refusal[] } {
  const refusals: Refusal[] = [];
  const seen = new Set<string>();
  const addRefusal = (r: Refusal) => {
    const k = `${r.source}|${r.reason}`;
    if (!seen.has(k)) {
      seen.add(k);
      refusals.push(r);
    }
  };
  air.refusals.forEach(addRefusal);
  if (air.refusals.some((r) => r.source === 'all')) return { beds: [], refusals };

  const beds: BedSpec[] = [];
  const g = gates(air, bakeWind(air, 'S1_land'));
  for (const id of PRIORITY) {
    const Uref = bakeWind(air, id);
    const gate = id === 'S9' ? gates(air, Uref).S9 : g[id];
    if (!gate.pass) {
      if (gate.reason)
        addRefusal({ source: id === 'thunder' ? 'lightning' : id, reason: gate.reason });
      continue;
    }
    const variants = id === 'thunder' ? [0, 1, 2, 3] : id === 'S8' ? [0, 1] : [0];
    for (const variant of variants) {
      const params = paramsFor(id, variant, air, place, Uref);
      if (!params) continue;
      beds.push({
        id,
        variant,
        sampleRate: BED_RATE_OF[id],
        N: BED_N,
        seed: hash32(air.seed, id, variant),
        Uref,
        bandCenterHz: bandCenterHz(id, air, Uref),
        LrefEarth_dB: lrefEarthDb(id),
        params,
      });
    }
  }
  return { beds, refusals };
}
