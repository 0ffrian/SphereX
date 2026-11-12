// Test fixtures for the ambience physics core: a complete fake WorldEngineLike, a CardToWorldOk builder, AirModel
// builders at stated conditions, and synthetic places on the §6.2 pattern. Numbers are test inputs unless a comment
// names a source.
import type { Tag } from '@/contract';
import type { CardToWorldOk } from '@/engine/worlds/cardToWorld';
import type { EngineOverrides, FluidKey, WorldPreset } from '@/engine/worlds/types';
import { classify, density, gammaFor, soundSpeed } from './air';
import { liquidFor } from './liquids';
import { patternSamples } from './levels';
import type { AirModel, Place, PlaceFeatures, PlaceSample, SampleClass, WindResult, WorldEngineLike } from './types';
import { K_SURF } from './tuning';

export interface FakeEngineInit {
  model?: Record<string, unknown>;
  state?: Partial<{ Ps: number; fluid: FluidKey; gas: boolean; locked: boolean }>;
  climate?: unknown;
  hydro?: unknown;
  /** Cyclones present (weatherFields), for the R9 hurricane gate. */
  cyclones?: number;
}

/** Engine model of the `earth` calibration preset (values of the order core.js worldModel gives; test inputs). */
export const EARTH_MODEL = {
  Ts: 288, H: 8430, gv: 9.81, U: 66.8, phiH: 0.534, Om: 7.27e-5, airless: false, state: 'liquid', canLiquid: true,
  zc: 1.5, regime: 'Water clouds', gamK: 6.5,
};

export function makeFakeEngine(init: FakeEngineInit = {}): WorldEngineLike {
  const model = init.model ?? EARTH_MODEL;
  const state = { Ps: 1, fluid: 'water' as FluidKey, gas: false, locked: false, ...init.state };
  return {
    fly: { alt: 1, lon: 0, lat: 0, head: 0, pitch: 0, auto: false },
    readouts: () => ({ model }),
    state: () => state,
    cpuFields: () => ({
      terrain: null,
      climate: init.climate === undefined ? { stats: { ocean: 0.71, max: 295 } } : init.climate,
      hydro: init.hydro === undefined ? { n: 12, lava: false } : init.hydro,
    }),
    weatherFields: () =>
      init.cyclones
        ? {
            NX: 1, NY: 1, iceH: new Float32Array(1), snow: new Float32Array(1), out: new Float32Array(4), out2: new Float32Array(4),
            cyclones: Array.from({ length: init.cyclones }, () => ({ lon: 0, lat: 0.3, r: 0.05, s: 1 })),
          }
        : null,
    gasField: () => null,
    groundKm: () => 0,
    flyCameraBasis: () => null,
    altRange: () => [0.3, 3000],
  };
}

export function makeWorld(preset: Partial<WorldPreset> = {}, tags: Record<string, Tag> = {}, overrides: EngineOverrides = {}): CardToWorldOk {
  const p: WorldPreset = {
    id: 'earth', label: 'Earth (calibration)', type: 'rock', Ts: 5772, Rs: 1, a: 1, P: 365.25, Prot: 1, Rj: 0.0892,
    Me: 1, locked: false, fluid: 'water', Ps: 1, mu: 29, sea: 0.5, seed: 101, ...preset,
  };
  return { ok: true, preset: p, overrides, tags, assumptions: [], missing: [], mismatches: [], measured: [] };
}

export interface AirInit {
  T0: number; P0: number; mu: number; fluid?: FluidKey; gas?: boolean; H_km?: number; gv?: number; gamK?: number;
  U?: number; phiH?: number; locked?: boolean; res32?: boolean; liquidState?: boolean; oceanF?: number; Vmax?: number | null;
  presetId?: string; regime?: string; zc_km?: number | null; state?: string; lavaWorld?: boolean;
}

/** An AirModel at stated conditions, built with the same formulas buildAirModel uses. */
export function makeAir(i: AirInit): AirModel {
  const fluid = i.fluid ?? 'water';
  const gas = i.gas ?? false;
  const cls = classify(i.mu, fluid, gas);
  const gamma = gammaFor(cls, i.mu, i.T0);
  const c0 = soundSpeed(gamma, i.T0, i.mu);
  const rho0 = density(i.P0, i.T0, i.mu);
  const state = i.state ?? (gas ? 'gas' : i.liquidState === false ? 'frozen' : 'liquid');
  const lavaWorld = i.lavaWorld ?? false;
  const liquid = lavaWorld ? liquidFor(fluid, true) : !gas && state === 'liquid' ? liquidFor(fluid, false) : null;
  const U = i.U ?? 66.8;
  return {
    gas, cls, fluid, state, T0: i.T0, P0: i.P0, H_km: i.H_km ?? 8.43, mu: i.mu, gamma, gv: i.gv ?? 9.81, gamK: i.gamK ?? 6.5,
    c0, rho0, Z0: rho0 * c0, airOK: true, liquid, lavaWorld, Uscale: U, Us: K_SURF * U, phiH: i.phiH ?? 0.534, Om: 7.27e-5,
    locked: i.locked ?? false, res32: i.res32 ?? false, R_km: 6378, zc_km: i.zc_km === undefined ? 1.5 : i.zc_km,
    regime: i.regime ?? 'Water clouds', seed: 101, Vmax: i.Vmax ?? null, seed3: [101, 101, 101],
    oceanF: i.oceanF ?? (gas ? 0 : 0.71), presetId: i.presetId ?? 'test', inputs: [], refusals: [],
  };
}

export const earthAir = (o: Partial<AirInit> = {}) => makeAir({ T0: 288, P0: 101325, mu: 29, presetId: 'earth', ...o });
/** Mars-like air at the R4/R5 conditions: 600 Pa, 210 K, mu 43.3, CO2 (gamma 1.29). */
export const marsAir = (o: Partial<AirInit> = {}) =>
  makeAir({ T0: 210, P0: 600, mu: 43.3, fluid: 'co2', gv: 3.71, H_km: 11.1, liquidState: false, oceanF: 0, ...o });
/** Titan-like air: 94 K, 1.5 bar, mu 28, methane seas, g 1.352 (engine `tit`-like; test inputs). */
export const titanAir = (o: Partial<AirInit> = {}) =>
  makeAir({ T0: 94, P0: 1.5e5, mu: 28, fluid: 'methane', gv: 1.352, H_km: 20.6, oceanF: 0.18, ...o });
/** Venus-like thick CO2 air at the thick-end anchor pressure. */
export const venusAir = (o: Partial<AirInit> = {}) =>
  makeAir({ T0: 737, P0: 9.2e6, mu: 43.45, fluid: 'co2', gv: 8.87, H_km: 15.9, liquidState: false, oceanF: 0, ...o });

export function makeWind(o: Partial<WindResult> = {}): WindResult {
  return { U10: 7, Uz: 7, Iu: 0.24, dirDeg: 45, parts: [{ kind: 'trade', U: 7 }], tag: 'model_dependent', ...o };
}

export function makeFeatures(o: Partial<PlaceFeatures> = {}): PlaceFeatures {
  return {
    z_km: 0.3, relief: 0.1, exposure: 0, slope: 0.01, snowCover: 0, iceCover: 0, rainRate: 0, RH: 0.5, Tloc: 288,
    cnv: 0, cnvRing: 0, precipPhase: 'none', cyclone: null, stormNear: 0, vort: 0, wind: makeWind(), ...o,
  };
}

type SampleFn = (s: { s_km: number; bearing: number; index: number }) => Partial<PlaceSample> & { cls?: SampleClass };

/** A place on the exact §6.2 pattern at height z; `fn` sets each sample's class and extras. */
export function makePlace(z_km: number, fn: SampleFn = () => ({}), features: Partial<PlaceFeatures> = {}, head = 0): Place {
  const samples: PlaceSample[] = patternSamples(z_km, head).map((p, index) => ({
    lon: 0, lat: 0, s_km: p.s_km, bearing: p.bearing, d_m: p.d_m, area_m2: 1, h_km: 0, cls: 'land', coast: false,
    rain: 0, T: 288, riverQ: 0, vent: false, ...fn({ s_km: p.s_km, bearing: p.bearing, index }),
  }));
  return { lon: 0, lat: 0, head, samples, features: makeFeatures({ z_km, ...features }) };
}

export interface FlyEngineInit {
  fly?: Partial<WorldEngineLike['fly']>;
  spinup?: number;
  /** R12: the climate and hydro fields are not there yet (cpuFields returns null for both). */
  forming?: boolean;
  /** Ground height, km (uniform). */
  elev?: number;
  rain?: number;
}

/**
 * A fake engine with real grids (terrain, climate, hydro, weather) so the REAL buildAirModel and samplePlace run on it
 * (#116 code review M1, m4: the loop test at 400 km and the spin-up bench). Earth calibration model; uniform land.
 * `calls` counts readouts() (buildAirModel's worldUi cost). Mutate `spinup`, `forming` and `fly` between ticks.
 */
export function makeFlyEngine(init: FlyEngineInit = {}) {
  const W = 360,
    H = 180,
    NX = 90,
    NY = 45,
    RW = 128,
    RH = 64;
  const data = new Float32Array(W * H * 2).fill(init.elev ?? 0.2);
  for (let k = 1; k < data.length; k += 2) data[k] = 0;
  const n = NX * NY;
  const T = new Float32Array(n).fill(288);
  const out = new Float32Array(n * 4),
    out2 = new Float32Array(n * 4);
  for (let k = 0; k < n; k++) {
    out[k * 4] = 288;
    out[k * 4 + 3] = 0.5;
    out2[k * 4] = init.rain ?? 0;
  }
  const hydro = { img: new Uint8Array(RW * RH * 4), RW, RH, lava: false, hM: 0, n: 12 };
  const st = { Ps: 1, fluid: 'water' as FluidKey, gas: false, locked: false };
  const eng = {
    spinup: init.spinup ?? 0,
    forming: init.forming ?? false,
    calls: 0,
    fly: { alt: 1, lon: 0.3, lat: 0.2, head: 0.5, pitch: -0.1, auto: false, ...init.fly },
    readouts: () => {
      eng.calls++;
      return { model: EARTH_MODEL };
    },
    state: () => st,
    cpuFields: () => ({
      terrain: { W, H, data },
      climate: eng.forming ? null : { NX, NY, T, land: new Uint8Array(n).fill(1), stats: { ocean: 0.71, max: 295 } },
      hydro: eng.forming ? null : hydro,
    }),
    weatherFields: () => ({ NX, NY, iceH: new Float32Array(n), snow: new Float32Array(n), out, out2, cyclones: [] }),
    gasField: () => null,
    groundKm: () => init.elev ?? 0.2,
    flyCameraBasis: () => null,
    altRange: (): [number, number] => [0.3, 3000],
  };
  return eng;
}
