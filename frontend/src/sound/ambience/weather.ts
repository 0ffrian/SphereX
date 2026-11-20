// §8.1–8.4 weather sound: which worlds may have lightning, the strike rate and its seeded schedule, thunder
// parameters, and the §8.5 frame the overlay draws (shared with the mixer). Pure; the scheduler holds its own
// seeded state. Place features (cnv, rain, phase, cyclone) come from place.ts (T4) as data.
import type { Tag } from '@/contract';
import { FLUIDS } from '@/engine/worlds/presets.js';
import { absorption, airAt, earthRef, lowpassHz, meanPathAir } from './air';
import { LIGHTNING_TEXT } from './captions';
import { dropPhysics } from './liquids';
import type { AirModel, Place, Strike, WeatherVisualFrame } from './types';
import {
  CLOUD_BASE_DEFAULT_KM,
  DB_PER_NP,
  EARTH_REF,
  FLASH_MIN_GAP_S,
  JUPITER_IDS,
  JUPITER_LAT_DEG,
  JUPITER_LOW_LAT_FACTOR,
  LIGHTNING_CNV_MIN,
  LIGHTNING_MAX_PER_MIN,
  LIGHTNING_OBSERVED,
  LIGHTNING_SEED_XOR,
  RAIN_CNV_BOOST,
  RAIN_VIS_FULL,
  RAIN_VIS_MIN,
  SNOW_FALL_MS,
  STRIKE_STALE_S,
  THUNDER_BASE_S,
  THUNDER_CRACK_M,
  THUNDER_FEW_K,
  THUNDER_FM_EARTH,
  THUNDER_L1KM_DB,
  THUNDER_LOSS_NP,
  THUNDER_MAX_S,
  THUNDER_RANGE_CAP_KM,
  THUNDER_ROLL_K,
  THUNDER_VARIANT_D_M,
  TINT_GREY,
  TINT_MIX,
} from './tuning';

export { LIGHTNING_TEXT };

export interface LightningRule {
  allowed: boolean;
  tag: Tag | null;
  reason: string | null;
}

/** §8.2 lightning rule table, in order. Keyed on the fluid, not the composition class (a mu-44 water world is not "Venus-like"). */
export function lightningRule(air: AirModel, presetId: string): LightningRule {
  const refuse = (reason: string): LightningRule => ({ allowed: false, tag: null, reason });
  if (!air.airOK) return refuse(LIGHTNING_TEXT.other);
  // R11 / red M1: the observed row applies only to the world as observed; a slid Ps or fluid (tagged artistic, source
  // "slider") falls through to the exoplanet rows. 'measured' is the fact that lightning is observed there; strike
  // timing and placement stay artistic.
  const slid = air.inputs.some((i) => i.source === 'slider');
  if (!slid && (LIGHTNING_OBSERVED as readonly string[]).includes(presetId))
    return { allowed: true, tag: 'measured', reason: null };
  if (air.gas) {
    return air.regime === 'Water clouds' || air.regime === 'Ammonia clouds'
      ? { allowed: true, tag: 'inferred_from_analog', reason: null }
      : refuse(LIGHTNING_TEXT.other);
  }
  if (air.fluid === 'methane') return refuse(LIGHTNING_TEXT.titan);
  if (air.fluid === 'co2') return refuse(LIGHTNING_TEXT.co2);
  // Review L4: liquid is local (R7), so an eyeball world that rains can have storms.
  if (
    (air.fluid === 'water' || air.fluid === 'ammoniaWater') &&
    !!air.liquid &&
    !air.liquid.viscous
  ) {
    return { allowed: true, tag: 'inferred_from_analog', reason: null };
  }
  return refuse(LIGHTNING_TEXT.other);
}

/**
 * §8.3 flashes per minute inside the audible radius. R11: every world, observed ones included, needs convection near
 * the listener: max(cnv, cnvRing) > 0.3 on rocky worlds (ASSUMPTION: per-sample cnv is not in PlaceSample), and
 * max(cnvRing, stormNear) > 0.3 on gas giants (place.ts fills cnvRing with cnvG).
 */
export function lightningRate(air: AirModel, place: Place, rule: LightningRule): number {
  if (!rule.allowed) return 0;
  const f = place.features;
  const conv = air.gas ? Math.max(f.cnvRing, f.stormNear) : Math.max(f.cnv, f.cnvRing);
  if (!air.airOK || !(conv > LIGHTNING_CNV_MIN)) return 0;
  let rate = LIGHTNING_MAX_PER_MIN * Math.max(0, Math.min(1, f.cnvRing));
  if ((JUPITER_IDS as readonly string[]).includes(air.presetId)) {
    rate *= Math.abs(place.lat) > (JUPITER_LAT_DEG * Math.PI) / 180 ? 1 : JUPITER_LOW_LAT_FACTOR;
  }
  return rate;
}

/** Few 1969 energy per unit length, J/m, chosen so the Earth reference air peaks at THUNDER_FM_EARTH. */
export function thunderEnergyPerLength(): number {
  const c = earthRef().c;
  return EARTH_REF.P * Math.pow((THUNDER_FEW_K * c) / THUNDER_FM_EARTH, 2);
}

/** §8.4 thunder peak frequency f_m = 0.63 c0 sqrt(P0/E_l), Hz. */
export function thunderFm(air: AirModel): number {
  return THUNDER_FEW_K * air.c0 * Math.sqrt(air.P0 / thunderEnergyPerLength());
}

/** §8.3 audible radius R_aud (m): where alpha(f_m) d = 3.45 Np (30 dB), capped at 25 km. */
export function audibleRadiusM(air: AirModel, z_km: number): number {
  const { P, T } = meanPathAir(air, z_km);
  const a = absorption(thunderFm(air), P, T, air.cls);
  const cap = THUNDER_RANGE_CAP_KM * 1000;
  if (!(a > 0)) return cap;
  return Math.min(THUNDER_LOSS_NP / a, cap);
}

export interface ThunderParams {
  delay_s: number;
  fm_Hz: number;
  dur_s: number;
  crack: 0 | 1;
  level_dB: number;
  lowpassHz: number;
  absK2: number;
  tag: Tag;
}

/** §8.4 thunder at slant distance d (m), listener at z km. Delay uses c at mid-path height. */
export function thunderParams(air: AirModel, d_m: number, z_km = 0): ThunderParams {
  const d = Math.max(d_m, 1);
  const fm = thunderFm(air);
  const cMid = airAt(air, z_km / 2).c;
  const { P, T } = meanPathAir(air, z_km);
  const aFm = absorption(fm, P, T, air.cls);
  const Zr = earthRef().Z;
  const lossDb = Number.isFinite(aFm) ? DB_PER_NP * aFm * d : Infinity;
  return {
    delay_s: d / cMid,
    fm_Hz: fm,
    dur_s: Math.min(THUNDER_BASE_S + d / (THUNDER_ROLL_K * air.c0), THUNDER_MAX_S),
    crack: d < THUNDER_CRACK_M ? 1 : 0,
    // Review L10: the listener-height impedance, as for the ground beds (§11.3).
    level_dB:
      THUNDER_L1KM_DB -
      20 * Math.log10(d / 1000) -
      lossDb +
      10 * Math.log10(airAt(air, z_km).Z / Zr),
    lowpassHz: lowpassHz((f) => absorption(f, P, T, air.cls), d),
    absK2: absorption(1000, air.P0, air.T0, air.cls) / 1e6,
    tag: 'derived',
  };
}

/** mulberry32 (the prototype's rng32). */
export function rng32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * §8.3 seeded Poisson strike schedule as an integrated hazard: each gap is a unit exponential E consumed at rate
 * lambda; a change of lambda therefore rescales the pending interval by lambda_old/lambda_new (memoryless), and strike
 * times do not depend on how the time is split into ticks. Strikes older than STRIKE_STALE_S when a tick arrives (after a
 * pause) are drawn and dropped, so the sequence stays deterministic, and at most one strike is returned per call.
 * Flashes are limited to one per FLASH_MIN_GAP_S (WCAG 2.3.1).
 */
export class StrikeScheduler {
  private readonly rng: () => number;
  private E: number;
  private acc = 0;
  private tPrev: number | null = null;
  private lastFlash = -Infinity;
  private variants: number[] = [0, 1, 2, 3];

  constructor(seed: number) {
    this.rng = rng32((seed ^ LIGHTNING_SEED_XOR) >>> 0);
    this.E = this.unitExp();
  }

  /** The thunder variants that are baked; strikes choose only among them (falls back to the nearest distance). */
  setVariants(baked: readonly number[]): void {
    this.variants = baked.filter((v) => v >= 0 && v < THUNDER_VARIANT_D_M.length);
  }

  private unitExp(): number {
    return -Math.log(1 - this.rng());
  }

  private pickVariant(d: number, u: number): number {
    const near = d < THUNDER_CRACK_M;
    const group = this.variants.filter(
      (v) => (THUNDER_VARIANT_D_M[v] as number) < THUNDER_CRACK_M === near,
    );
    if (group.length)
      return group[Math.min(group.length - 1, Math.floor(u * group.length))] as number;
    if (!this.variants.length) return near ? 0 : 2;
    let best = this.variants[0] as number;
    for (const v of this.variants) {
      if (
        Math.abs((THUNDER_VARIANT_D_M[v] as number) - d) <
        Math.abs((THUNDER_VARIANT_D_M[best] as number) - d)
      )
        best = v;
    }
    return best;
  }

  /** Advance to `now` (s, audio clock) at `ratePerMin`; returns the strike due in this tick, if any. */
  next(now: number, ratePerMin: number, air: AirModel, place: Place): Strike[] {
    if (this.tPrev === null || now < this.tPrev) {
      this.tPrev = now;
      return [];
    }
    const lam = Math.max(0, ratePerMin) / 60;
    let t = this.tPrev;
    let due: Strike | null = null;
    const zm = Math.max(place.features.z_km, 0) * 1000;
    while (lam > 0 && lam * (now - t) >= this.E - this.acc) {
      const t0 = t + (this.E - this.acc) / lam;
      const bearing = this.rng() * 2 * Math.PI;
      const s = audibleRadiusM(air, place.features.z_km) * Math.sqrt(this.rng());
      const d = Math.sqrt(s * s + zm * zm);
      const variant = this.pickVariant(d, this.rng());
      const seed = Math.floor(this.rng() * 4294967296) >>> 0;
      this.acc = 0;
      this.E = this.unitExp();
      t = t0;
      if (t0 >= now - STRIKE_STALE_S) due = { t0, d_m: d, bearing, seed, variant, flash: false };
    }
    if (lam > 0) this.acc += lam * (now - t);
    this.tPrev = now;
    if (!due) return [];
    if (due.t0 - this.lastFlash >= FLASH_MIN_GAP_S) {
      due.flash = true;
      this.lastFlash = due.t0;
    }
    return [due];
  }
}

function mix3(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  return [0, 1, 2].map((i) => (a[i] ?? 0) * (1 - t) + (b[i] ?? 0) * t) as [number, number, number];
}

/**
 * §8.5 the overlay's frame. `rain.density` is the share (0..1) of the overlay's own maximum count (600 streaks for rain,
 * 400 flakes for snow). Snow falls at SNOW_FALL_MS x sqrt(g_E/g) as the spec states (a Q- proposal questions the sign).
 */
export function weatherVisualFrame(
  air: AirModel,
  place: Place,
  strikes: Strike[],
): WeatherVisualFrame {
  const f = place.features;
  const base = air.zc_km ?? CLOUD_BASE_DEFAULT_KM;
  const aboveClouds = f.z_km >= base;
  let rain: WeatherVisualFrame['rain'] = null;
  const falling = f.precipPhase !== 'none' && f.rainRate > RAIN_VIS_MIN && !f.cyclone?.inEye;
  if (air.airOK && !air.gas && falling && !aboveClouds) {
    const snow = f.precipPhase === 'snow';
    const drop = dropPhysics(air);
    const vt = snow ? SNOW_FALL_MS * Math.sqrt(EARTH_REF.g / air.gv) : (drop?.vt ?? null);
    if (vt !== null && vt > 0) {
      const density = Math.min(
        Math.max(0, Math.min(1, f.rainRate / RAIN_VIS_FULL)) * (1 + RAIN_CNV_BOOST * f.cnv),
        1,
      );
      const liq = (FLUIDS[air.fluid]?.liq as number[] | undefined) ?? TINT_GREY;
      rain = {
        density,
        vt,
        slantRad: Math.atan(f.wind.U10 / vt),
        tint: mix3(liq, TINT_GREY, TINT_MIX),
        snow,
      };
    }
  }
  return { rain, strikes, aboveClouds, zc_km: air.zc_km };
}
