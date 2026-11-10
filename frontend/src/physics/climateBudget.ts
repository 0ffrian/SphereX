// Issue #71 stream D (D-36, Q-240): temperature, greenhouse, phase and the heat / ice / water
// budget of a rocky or water world. Ported from the approved prototype (`worldModel`, `ebInit`,
// `ebStep`, `ebStats`). Pure and deterministic: the state is a function of the inputs, the terrain
// and the number of steps. No `Math.random`, no `Date`, no frame time.
//
// What is physics and what is an assumption (each carries a tag in `worldReadouts`):
//  - Insolation `S = sigma Tstar^4 (Rstar / a)^2` and `Teq = Tstar sqrt(Rstar / 2a) (1 - A)^(1/4)`
//    are `derived` from the card's star and orbit; the Bond albedo `A` is an assumption.
//  - A grey greenhouse `Ts = Teq (1 + 0.75 tau)^(1/4)` (Pierrehumbert 2010, eq. 3.11 form) with
//    `tau = GREENHOUSE_TAU_PER_BAR * Ps`. The coefficient is calibrated to Earth (see below) and is
//    `model_dependent`; the surface pressure is an assumption for every exoplanet (D-36).
//  - The budget (diffusion coefficients, heat capacities, latent heat) is a one-layer energy
//    balance model in the style of North, Cahalan and Coakley (1981, Rev. Geophys. 19, 91) with a
//    mixed-layer ocean and thermodynamic sea ice (Semtner 1976); the coefficients are tuned values
//    from the prototype, expressed in units of the linearised outgoing-radiation slope `B`.
//    They are `model_dependent` and say so.
//
// No step functions: insolation follows `max(cos z, 0)`, albedo follows the smooth ice thickness
// `1 - exp(-h / 0.15)`, cloud albedo ramps over relative humidity 0.7 to 1, and the output the
// renderer reads is smoothed by a 5 x 5 kernel. The tests check the neighbour jumps.
import { FLUIDS, SIGMA_SB, boilingPointK, cloudBaseK, fluidState, psatFn, skyColours, visFraction, type Fluid, type FluidId, type FluidState, type Rgb3 } from './fluids';
import { G, R_SUN_M, AU_M } from './constants';

const TAU = 6.283185307179586;

/** Earth's mean surface temperature 288 K and Teq 255 K (NASA Earth Fact Sheet) give `1 + 0.75 tau = (288 / 255)^4 = 1.63`, i.e. tau = 0.84 at 1 bar; 0.8 is the rounded prototype value. */
export const GREENHOUSE_TAU_PER_BAR = 0.8;
/** CO2 absorbs more per bar than N2/O2 air: multiplier on tau (artistic; no source) [verify]. */
export const CO2_GREENHOUSE_FACTOR = 1.8;
/** Below this pressure (bar) the world counts as airless (no greenhouse, no weather). */
export const AIRLESS_BELOW_BAR = 0.02;
/** Default Bond albedo when the card gives none: Earth's 0.3 (NASA Earth Fact Sheet). ASSUMPTION. */
export const DEFAULT_BOND_ALBEDO = 0.3;
/** Default mean molar mass, g/mol (Earth dry air 28.97). ASSUMPTION. */
export const DEFAULT_MOLAR_MASS = 29;
/** Default surface pressure, bar, and fluid for any exoplanet: Earth's. ASSUMPTION (D-36). */
export const DEFAULT_PRESSURE_BAR = 1;
export const DEFAULT_FLUID: FluidId = 'water';

/** Tags the same five as the app (D-02). */
export type WorldTag = 'measured' | 'derived' | 'model_dependent' | 'inferred_from_analog' | 'artistic';

export interface WorldInputs {
  starTeffK: number;
  starRadiusRsun: number;
  /** Orbit radius in au, already multiplied by the orbit slider. */
  orbitAu: number;
  radiusM: number;
  massKg: number;
  bondAlbedo: number;
  pressureBar: number;
  fluid: FluidId;
  locked: boolean;
  /** Rotation period, days (the orbit period when locked). */
  rotPeriodD: number;
  /** Mean molar mass of the air, g/mol. */
  molarMass: number;
}

export interface WorldModel {
  fluid: Fluid;
  S: number;
  Teq: number;
  Ts: number;
  tau: number;
  gv: number;
  H: number;
  /** Dry adiabatic lapse rate, K per km. */
  gamK: number;
  airless: boolean;
  Pa: number;
  canLiquid: boolean;
  Tb: number | null;
  state: FluidState;
  /** Cloud-base temperature and height (km); null: no condensation. */
  Tc: number | null;
  zc: number | null;
  runaway: boolean;
  /** Typical cloud cover 0..1 (artistic placeholder per state, from the prototype). */
  cov: number;
  sky: Rgb3;
  sun: Rgb3;
  haze: number;
  hazeC: Rgb3;
  /** Rotation rate, rad/s, and the Rhines jet count sqrt(2 Om R / U) clamped to 2..22 (Rhines 1975, J. Fluid Mech. 69, 417). */
  Om: number;
  jets: number;
  /** Day-night heat redistribution efficiency 0..1 and the wind speed, m/s (scales cloud drift). */
  eps: number;
  U: number;
  /** Visible share of the starlight (sets the ice albedo). */
  visFrac: number;
  locked: boolean;
  /** Star light reaching the world, W/m^2. */
  insolation: number;
}

/** `sstep` as in the prototype: smoothstep of a clamped ratio. */
const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const sstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * The analytic part of the world: temperature, greenhouse, phase, scale height, cloud level, sky
 * colour. Cheap (no grid), so the plan can call it too. `null` when an input is not usable.
 */
export function worldModel(i: WorldInputs): WorldModel | null {
  const need = [i.starTeffK, i.starRadiusRsun, i.orbitAu, i.radiusM, i.massKg, i.rotPeriodD, i.molarMass];
  if (need.some((v) => !(v > 0) || !Number.isFinite(v))) return null;
  if (!(i.bondAlbedo >= 0 && i.bondAlbedo < 1) || !(i.pressureBar > 0)) return null;
  const F = FLUIDS[i.fluid];
  const Rs = (i.starRadiusRsun * R_SUN_M) / AU_M; // star radius in au
  const Teq = i.starTeffK * Math.sqrt(Rs / (2 * i.orbitAu)) * Math.pow(1 - i.bondAlbedo, 0.25);
  const S = SIGMA_SB * Math.pow(i.starTeffK, 4) * Math.pow(Rs / i.orbitAu, 2);
  const Ps = i.pressureBar;
  const airless = Ps < AIRLESS_BELOW_BAR;
  const tau = airless ? 0 : GREENHOUSE_TAU_PER_BAR * Ps * (i.fluid === 'co2' ? CO2_GREENHOUSE_FACTOR : 1);
  const Ts = Teq * Math.pow(1 + 0.75 * tau, 0.25);
  const gv = (G * i.massKg) / (i.radiusM * i.radiusM);
  const Rg = 8314.462618 / i.molarMass; // J/(kg K)
  const cp = Rg * 3.5; // diatomic ideal gas
  const H = (Rg * Ts) / gv;
  const Om = TAU / (i.rotPeriodD * 86400);
  const Pref = Math.max(Ps, 0.005) * 1e5;
  const tRad = (cp * Pref) / (gv * 4 * SIGMA_SB * Math.pow(Ts, 3));
  let U = 100;
  let eps = 1;
  for (let k = 0; k < 6; k++) {
    const tAdv = Math.min(i.radiusM / U, i.locked ? 1e13 : 1 / Om);
    eps = airless ? 1 : clamp(tAdv / (tAdv + tRad), 0.02, 1);
    const dT = i.locked ? eps * 0.6 * Ts : 0.15 * Ts;
    U = Math.max(1, 0.6 * Math.sqrt(Rg * dT));
  }
  const Pa = Ps * 1e5;
  const Tb = airless ? null : boilingPointK(F, Pa);
  const state = fluidState(F, Ts, Pa, airless);
  const Tc = !airless ? cloudBaseK(F, Ts, Pa) : null;
  const gam = gv / cp;
  const zc = Tc !== null ? (Ts - Tc) / gam / 1000 : null;
  const runaway = i.fluid === 'water' && state === 'vapour' && Ps >= 0.1;
  const cov = airless
    ? 0
    : state === 'liquid'
      ? 0.3 + 0.42 * sstep(F.Tt, Math.min(Tb ?? F.Tt, F.Tt + 70), Ts)
      : state === 'frozen'
        ? 0.12
        : runaway
          ? 0.95
          : 0.06;
  // Methane absorbs red light: depth 2.1 at 640 nm (artistic placeholder; the prototype value).
  const { sky, sun } = skyColours(i.starTeffK, i.fluid === 'methane' ? 2.1 : 0);
  const haze = i.fluid === 'methane' && Ps >= 0.3 ? 0.75 : runaway ? 0.9 : 0;
  const hazeC: Rgb3 = runaway ? [0.92, 0.9, 0.86] : [0.74, 0.46, 0.16];
  return {
    fluid: F, S, Teq, Ts, tau, gv, H, gamK: (gam * 1000) as number, airless, Pa,
    canLiquid: Tb !== null, Tb, Om, jets: Math.max(2, Math.round(clamp(Math.sqrt((2 * Om * i.radiusM) / U), 1, 22))), state, Tc, zc, runaway, cov, sky, sun, haze, hazeC, eps, U,
    visFrac: visFraction(i.starTeffK), locked: i.locked, insolation: S,
  };
}

// ---- the grid budget ------------------------------------------------------------------------

export interface BudgetStats {
  mean: number;
  max: number;
  min: number;
  /** Share of the surface that is ocean basin; of that, the share that is ice-covered and open. */
  ocean: number;
  ice: number;
  liquid: number;
  /** Share of land under frost. */
  frost: number;
}

/** Output channels per cell: T (K), ice thickness, frost, relative humidity. */
export const BUDGET_CHANNELS = 4;

/**
 * Elevation at a cell centre (m above sea level, negative below), from the terrain. The budget
 * needs only whether the cell is ocean basin and how high land is (for the lapse rate).
 */
export type ElevationAt = (lonRad: number, latRad: number) => number;

export interface BudgetOptions {
  nx: number;
  ny: number;
  /** Share of the area that is ocean basin; 0 means no ocean cells at all. */
  oceanFraction: number;
}

export class ClimateBudget {
  readonly nx: number;
  readonly ny: number;
  private readonly T: Float32Array;
  private readonly Tw: Float32Array;
  private readonly h: Float32Array;
  private readonly s: Float32Array;
  private readonly q: Float32Array;
  /** Running mean of precipitation per cell (relative units), for the river model. */
  private readonly rainEma: Float32Array;
  /** Rain 0..1 relative to 60% of the wettest cell; the hydrology reads it. Row 0 = south. */
  readonly rain: Float32Array;
  private readonly land: Uint8Array;
  private readonly elev: Float32Array;
  /** Smoothed output: T, ice thickness, frost, relative humidity. Length nx*ny*4, row 0 = south. */
  readonly out: Float32Array;
  stats: BudgetStats | null = null;
  stepCount = 0;

  constructor(
    private readonly m: WorldModel,
    private readonly opts: BudgetOptions,
    elevationAt: ElevationAt,
  ) {
    const n = opts.nx * opts.ny;
    this.nx = opts.nx;
    this.ny = opts.ny;
    this.T = new Float32Array(n).fill(m.Ts);
    this.Tw = new Float32Array(n).fill(m.Ts);
    this.h = new Float32Array(n);
    this.s = new Float32Array(n);
    this.q = new Float32Array(n);
    this.rainEma = new Float32Array(n);
    this.rain = new Float32Array(n);
    this.land = new Uint8Array(n);
    this.elev = new Float32Array(n);
    this.out = new Float32Array(n * BUDGET_CHANNELS);
    for (let j = 0; j < opts.ny; j++) {
      for (let i = 0; i < opts.nx; i++) {
        const k = j * opts.nx + i;
        const lon = ((i + 0.5) / opts.nx - 0.5) * TAU;
        const lat = ((j + 0.5) / opts.ny - 0.5) * Math.PI;
        const e = elevationAt(lon, lat);
        this.land[k] = opts.oceanFraction > 0 && e < 0 ? 0 : 1;
        this.elev[k] = Math.max(e, 0);
      }
    }
    this.step(1, 1);
    this.stepCount = 0;
  }

  /** Runs `n` explicit-implicit steps of `dt` (the prototype uses 1.4 to settle, 0.7 to play). */
  step(n: number, dt: number): void {
    const { nx: NX, ny: NY, m, T, Tw, h, s, q, land, elev } = this;
    const F = m.fluid;
    const Tf = F.Tt;
    const Ts0 = Math.max(m.Ts, 40);
    const B = 4 * SIGMA_SB * Ts0 * Ts0 * Ts0;
    const dp = Math.PI / NY;
    const dl = TAU / NX;
    const air = !m.airless;
    const D = air ? 0.28 * B * Math.sqrt(Math.min(m.Pa / 1e5, 30)) : 0;
    const Do = 0.22 * B;
    const Co = 100 * B;
    const Cl = 8 * B;
    const Ci = 4 * B;
    const L = 4500 * B;
    const kI = 0.4 * B;
    const gamma = 0.3 * B;
    // Ice is as dark as open water for a hot star's infrared-poor light and brighter for a cool
    // star: albedo rises from 0.15 with the visible share of the starlight (stream D, Q-240).
    const aIce = 0.15 + 0.85 * m.visFrac;
    const aFrost = Math.min(0.85, aIce + 0.1);
    const eps0 = 1 / (1 + 0.75 * m.tau);
    const S = m.S;
    const lock = m.locked;
    const psat = psatFn(F);
    const qRef = psat(Tf + 15);
    const Tb = m.canLiquid && m.Tb !== null ? m.Tb : 0;
    const Lv = 2 * B;
    const oceanW = this.opts.oceanFraction > 0;
    // The star-facing point of a locked world is +X in the body frame (SUBSTELLAR_DIRECTION).
    const sx = 1;
    for (let st = 0; st < n; st++) {
      for (let j = 0; j < NY; j++) {
        const la = ((j + 0.5) / NY - 0.5) * Math.PI;
        const cj = Math.cos(la);
        const cn = Math.cos(la + dp / 2);
        const cs = Math.cos(la - dp / 2);
        let an = cn / (cj * dp * dp);
        let as = cs / (cj * dp * dp);
        const ae = (lock ? 1.6 : 1) / (Math.max(cj * cj, 0.0025) * dl * dl);
        if (j === NY - 1) an = 0;
        if (j === 0) as = 0;
        for (let i = 0; i < NX; i++) {
          const k = j * NX + i;
          const ke = j * NX + ((i + 1) % NX);
          const kw = j * NX + ((i + NX - 1) % NX);
          const kn = j < NY - 1 ? k + NX : k;
          const ks = j > 0 ? k - NX : k;
          const isO = land[k] === 0;
          const lo = ((i + 0.5) / NX - 0.5) * TAU;
          const mu = lock ? Math.max(cj * Math.cos(lo) * sx, 0) : cj / Math.PI;
          const Tc = T[k]!;
          const qk = q[k]!;
          const hk = h[k]!;
          const qs = air ? Math.min(psat(Math.max(Tc, 20)) / qRef, 6) : 0;
          const rh = qs > 1e-9 ? qk / qs : 0;
          const ic = 1 - Math.exp(-hk / 0.15);
          const fs = 1 - Math.exp(-s[k]! / 0.05);
          const a0 = isO ? 0.07 + (aIce - 0.07) * ic : 0.22 + (aFrost - 0.22) * fs;
          const cc = clamp((rh - 0.7) / 0.3, 0, 1) * 0.6 * (air ? 1 : 0);
          const alb = a0 + (0.48 - a0) * cc;
          const asr = S * mu * (1 - alb);
          const eps = eps0 / (1 + 0.3 * Math.min(rh, 1) * (air ? 1 : 0));
          const olr = eps * SIGMA_SB * Tc * Tc * Tc * Tc;
          const Bl = 4 * eps * SIGMA_SB * Tc * Tc * Tc;
          const open = isO && hk <= 0 && Tc < (Tb || 1e9);
          const E = air && open ? 0.5 * Math.max(qs - qk, 0) : 0;
          const P = air ? 0.25 * Math.max(qk - qs, 0) : 0;
          let nb = D * (ae * (T[ke]! + T[kw]!) + an * T[kn]! + as * T[ks]!);
          let sum = D * (2 * ae + an + as);
          const Cx = isO ? (hk > 0 ? Ci : Co) : Cl;
          let G2 = 0;
          const lat = Lv * (P - E);
          if (isO && hk <= 0) {
            const oe = land[ke] ? 0 : 1;
            const ow = land[kw] ? 0 : 1;
            const on = land[kn] ? 0 : 1;
            const os = land[ks] ? 0 : 1;
            nb += Do * (ae * (oe * Tw[ke]! + ow * Tw[kw]!) + an * on * Tw[kn]! + as * os * Tw[ks]!);
            sum += Do * (ae * (oe + ow) + an * on + as * os);
          }
          if (isO && hk > 0) G2 = kI / (hk + 0.05);
          const den = Cx / dt + Bl + sum + G2;
          let nT = ((Cx / dt) * Tc + asr - olr + Bl * Tc + nb + G2 * Tf + lat) / den;
          if (isO && oceanW) {
            if (hk <= 0) {
              // An ocean current carries heat eastward along the equator (locked worlds).
              const eq = Math.abs(la) < 0.5 ? 0.3 * (1 - Math.abs(la) / 0.5) * (lock ? 1 : 0) : 0;
              if (eq > 0 && !land[kw]) nT = nT * (1 - eq) + Tw[kw]! * eq;
              Tw[k] = nT;
              if (nT < Tf) {
                h[k] = ((Tf - nT) * Co) / L;
                nT = Tf;
                Tw[k] = Tf;
              }
            } else {
              if (nT > Tf) {
                h[k] = hk - ((nT - Tf) * den * dt) / L;
                nT = Tf;
              }
              h[k] = h[k]! + (G2 * (Tf - nT) * dt) / L;
              let tw =
                ((Co / dt) * Tw[k]! + Do * (ae * (Tw[ke]! + Tw[kw]!) + an * Tw[kn]! + as * Tw[ks]!)) /
                (Co / dt + Do * (2 * ae + an + as));
              const Fb = gamma * Math.max(tw - Tf, 0);
              tw -= (Fb * dt) / Co;
              h[k] = h[k]! - (Fb * dt) / L;
              Tw[k] = Math.max(tw, Tf);
              if (h[k]! <= 0) {
                h[k] = 0;
                nT = Tw[k]!;
              }
            }
            h[k] = Math.min(h[k]!, 8);
          } else if (!isO) {
            if (nT > Tf && s[k]! > 0) {
              const mlt = Math.min(s[k]!, (nT - Tf) * 0.01);
              s[k] = s[k]! - mlt;
              nT -= mlt * 40;
            }
            if (air && s[k]! > 0) s[k] = Math.max(0, s[k]! - 0.002 * Math.max(qs - qk, 0));
          }
          T[k] = clamp(nT, 10, 6000);
          if (air) {
            const Tsn = T[k]! - elev[k]! * m.gamK;
            if (P > 0 && Tsn < Tf) {
              if (isO && oceanW) h[k] = h[k]! + P * 0.4 * dt;
              else s[k] = Math.min(s[k]! + P * 3 * dt, 6);
            }
            const qn = (D / B) * 0.35;
            const nq = qn * (ae * (q[ke]! + q[kw]!) + an * q[kn]! + as * q[ks]!);
            const sq = qn * (2 * ae + an + as);
            q[k] = Math.max(0, (qk + (E - P) * dt + nq * dt * 0.2) / (1 + sq * dt * 0.2));
            this.rainEma[k] = this.rainEma[k]! + (P - this.rainEma[k]!) * 0.02;
          }
        }
      }
      // Ice and frost creep slowly from thick to thin.
      for (let j = 1; j < NY - 1; j++) {
        for (let i = 0; i < NX; i++) {
          const k2 = j * NX + i;
          const ke2 = j * NX + ((i + 1) % NX);
          const kn2 = k2 + NX;
          for (let ep = 0; ep < 2; ep++) {
            const b0 = ep ? kn2 : ke2;
            if (land[k2] === land[b0]) {
              if (!land[k2]) {
                const fl = 0.04 * (h[k2]! - h[b0]!) * Math.min(1, Math.min(h[k2]!, h[b0]!) + 0.3);
                h[k2] = h[k2]! - fl;
                h[b0] = h[b0]! + fl;
              } else {
                const fl = 0.03 * (s[k2]! - s[b0]!);
                s[k2] = s[k2]! - fl;
                s[b0] = s[b0]! + fl;
              }
            }
          }
        }
      }
      this.stepCount++;
    }
    let rmx = 0;
    for (const r of this.rainEma) if (r > rmx) rmx = r;
    const rden = Math.max(rmx * 0.6, 1e-6);
    for (let i = 0; i < this.rain.length; i++) this.rain[i] = this.rainEma[i]! / rden;
    this.writeOutput(qRef, psat, air);
    this.computeStats();
  }

  /** Smoothed output for the renderer: a 5 x 5 inverse-distance kernel on ice and frost. */
  private writeOutput(qRef: number, psat: (T: number) => number, air: boolean): void {
    const { nx: NX, ny: NY, T, h, s, q, out } = this;
    for (let i = 0; i < NX * NY; i++) {
      const yy = Math.floor(i / NX);
      const xx = i - yy * NX;
      let hs = 0;
      let ss = 0;
      let wt = 0;
      for (let oy = -2; oy <= 2; oy++) {
        const y2 = clamp(yy + oy, 0, NY - 1);
        for (let ox = -2; ox <= 2; ox++) {
          const k3 = y2 * NX + ((xx + ox + NX) % NX);
          const w3 = 1 / (1 + oy * oy + ox * ox);
          hs += h[k3]! * w3;
          ss += s[k3]! * w3;
          wt += w3;
        }
      }
      out[i * 4] = T[i]!;
      out[i * 4 + 1] = hs / wt;
      out[i * 4 + 2] = ss / wt;
      const qs2 = air ? Math.min(psat(Math.max(T[i]!, 20)) / qRef, 6) : 1;
      out[i * 4 + 3] = air ? clamp(q[i]! / Math.max(qs2, 1e-9), 0, 1.2) : 0;
    }
  }

  private computeStats(): void {
    const { nx: NX, ny: NY, m, T, h, s, land } = this;
    const Tb = m.canLiquid && m.Tb !== null ? m.Tb : 0;
    let tw = 0;
    let tT = 0;
    let mx = 0;
    let mn = 1e9;
    let oA = 0;
    let oI = 0;
    let oO = 0;
    let lA = 0;
    let lF = 0;
    for (let j = 0; j < NY; j++) {
      const c = Math.cos(((j + 0.5) / NY - 0.5) * Math.PI);
      for (let i = 0; i < NX; i++) {
        const k = j * NX + i;
        const t = T[k]!;
        tw += c;
        tT += t * c;
        if (t > mx) mx = t;
        if (t < mn) mn = t;
        if (!land[k]) {
          oA += c;
          if (h[k]! > 0.02) oI += c;
          else if (t < (Tb || 1e9)) oO += c;
        } else {
          lA += c;
          if (s[k]! > 0.02) lF += c;
        }
      }
    }
    this.stats = {
      mean: tT / tw, max: mx, min: mn, ocean: oA / tw,
      ice: oA ? oI / oA : 0, liquid: oA ? oO / oA : 0, frost: lA ? lF / lA : 0,
    };
  }

  /** FNV-1a over the state arrays: the determinism check. */
  hash(): string {
    let hh = 0x811c9dc5;
    for (const arr of [this.T, this.h, this.s, this.q, this.rainEma]) {
      const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      for (let i = 0; i < bytes.length; i++) hh = Math.imul(hh ^ bytes[i]!, 0x01000193) >>> 0;
    }
    return hh.toString(16).padStart(8, '0');
  }

  /** Surface temperature and land flag at a cell, for tests and haptics. */
  isLand(k: number): boolean {
    return this.land[k] === 1;
  }
}

/** The steps the world settles for: spin-up 900 at dt 1.4 (full grid) as in the prototype. */
export const SETTLE_STEPS = { full: 900, low: 450 } as const;
export const SETTLE_DT = 1.4;

// ---- readouts and provenance -----------------------------------------------------------------

export interface WorldReadout {
  id: string;
  label: string;
  value: number | string;
  unit: string;
  tag: WorldTag;
  /** `derived` values state their formula; `model_dependent` and `artistic` ones their assumption. */
  formula?: string;
  assumption?: string;
}

/** Where each input came from, so a readout can carry the weakest tag of what fed it. */
export interface WorldInputSources {
  star: WorldTag;
  orbit: WorldTag;
  planet: WorldTag;
  albedo: WorldTag;
  pressure: WorldTag;
  fluid: WorldTag;
  /** A slider was moved: the value is the visitor's setting (Q-58). */
  sliders: readonly string[];
}

const ORDER: readonly WorldTag[] = ['measured', 'derived', 'model_dependent', 'inferred_from_analog', 'artistic'];
/** The weakest tag of a set (the last in the D-02 order wins), as `weakestTag` in the motion code. */
export function weakest(tags: readonly WorldTag[]): WorldTag {
  let w = 0;
  for (const t of tags) w = Math.max(w, ORDER.indexOf(t));
  return ORDER[w]!;
}

/**
 * The numbers of the world panel in plain words with their tags (D-02, D-36). Slider-fed values are
 * `artistic` with "(your setting)" (Q-58). Pressure and surface fluid are assumptions for any
 * exoplanet, so an unset one is `model_dependent` with the assumption stated.
 */
export function worldReadouts(
  m: WorldModel,
  src: WorldInputSources,
  stats: BudgetStats | null,
  hydro: { rivers: number; lakes: number; salt: number } | null = null,
): WorldReadout[] {
  const moved = (keys: readonly string[]) => keys.filter((k) => src.sliders.includes(k));
  /** The weakest of the base tags, and `artistic` when any slider in `keys` fed the value (Q-58). */
  const tagOf = (base: readonly WorldTag[], keys: readonly string[]): WorldTag =>
    weakest(moved(keys).length ? [...base, 'artistic'] : base);
  /** "<key> (your setting)" for every slider that fed the value, else the plain assumption text. */
  const assume = (text: string, keys: readonly string[]): string =>
    [text, ...moved(keys).map((k) => `${k} (your setting)`)].filter(Boolean).join('; ');
  const out: WorldReadout[] = [];
  const starKeys = ['star_teff_K', 'semi_major_axis_au'] as const;
  out.push({
    id: 'insolation', label: 'Starlight here', value: Math.round(m.S), unit: 'W/m\u00b2',
    tag: tagOf([src.star, src.orbit, 'derived'], starKeys),
    formula: 'S = sigma Tstar^4 (Rstar / a)^2',
    ...(moved(starKeys).length ? { assumption: assume('', starKeys) } : {}),
  });
  out.push({
    id: 'teq', label: 'Equilibrium temperature', value: Math.round(m.Teq), unit: 'K',
    tag: tagOf([src.star, src.orbit, src.albedo, 'derived'], [...starKeys, 'bond_albedo']),
    formula: 'Teq = Tstar sqrt(Rstar / 2a) (1 - A)^(1/4)',
    ...(src.albedo !== 'measured' || moved([...starKeys, 'bond_albedo']).length
      ? { assumption: assume(src.albedo === 'measured' ? '' : 'Bond albedo assumed (Earth-like 0.3 unless the card has one)', [...starKeys, 'bond_albedo']) }
      : {}),
  });
  out.push({
    id: 'ts', label: 'Average surface temperature', value: Math.round(stats?.mean ?? m.Ts), unit: 'K',
    tag: tagOf(['model_dependent', src.pressure], ['surface_pressure_bar', ...starKeys, 'bond_albedo']),
    assumption: assume(
      `grey greenhouse, optical depth ${m.tau.toFixed(2)} (${GREENHOUSE_TAU_PER_BAR} per bar, calibrated to Earth); surface pressure ${src.pressure === 'measured' ? 'measured' : 'assumed'}`,
      ['surface_pressure_bar'],
    ),
  });
  out.push({
    id: 'fluid_state', label: `${m.fluid.label} at the surface`, value: m.state, unit: '',
    tag: tagOf(['model_dependent', src.fluid, src.pressure], ['surface_fluid', 'surface_pressure_bar']),
    assumption: assume('surface fluid and pressure are assumed for any exoplanet; phase from Clausius-Clapeyron', ['surface_fluid', 'surface_pressure_bar']),
  });
  out.push({
    id: 'scale_height', label: 'Scale height', value: Math.round(m.H / 100) / 10, unit: 'km',
    tag: 'model_dependent', assumption: 'H = R T / (mu g), mean molar mass assumed, model surface temperature',
  });
  out.push({
    id: 'cloud_base', label: 'Clouds form at',
    value: m.airless ? 'no air' : m.zc !== null ? Math.round(m.zc * 10) / 10 : 'no condensation',
    unit: m.zc !== null && !m.airless ? 'km up' : '',
    tag: 'model_dependent', assumption: 'dry adiabat from the surface until the fluid saturates; mixing ratio assumed',
  });
  if (stats) {
    out.push({
      id: 'ocean_open', label: 'Ocean that is open', value: Math.round(stats.liquid * 100), unit: '%',
      tag: 'model_dependent', assumption: 'energy-balance model; ocean area is an assumption',
    });
    out.push({
      id: 'frost', label: 'Land under frost', value: Math.round(stats.frost * 100), unit: '%',
      tag: 'model_dependent', assumption: 'energy-balance model with moisture transport',
    });
  }
  if (hydro) {
    out.push({
      id: 'rivers', label: 'Rivers drawn', value: hydro.rivers, unit: '',
      tag: 'model_dependent',
      assumption: 'drainage on the model terrain, runoff from the model rain (Budyko curve); the land roughness that steers it is artistic',
    });
    out.push({
      id: 'lakes', label: 'Lakes and salt flats', value: `${hydro.lakes} lakes, ${hydro.salt} salt flats`, unit: '',
      tag: 'model_dependent', assumption: 'closed basins at least 30 m deep and 3 cells wide; lake or salt flat from inflow against evaporation',
    });
  }
  return out;
}
