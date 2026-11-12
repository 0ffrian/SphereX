// Test support for the bake engine (#113). Hand-built AirModels and BedSpecs: these numbers are test inputs only
// (rounded textbook values for Earth and a Titan-like world), not data; the real ones come from #112's airModel and
// sources. Not imported by app code.
import type { AirModel, BedSpec, SourceId } from './types';

export const EARTH_AIR: AirModel = {
  gas: false,
  cls: 'N2',
  fluid: 'water',
  state: 'liquid',
  T0: 288,
  P0: 101325,
  H_km: 8.5,
  mu: 28.97,
  gamma: 1.4,
  gv: 9.81,
  gamK: 6.5,
  c0: 340.3,
  rho0: 1.225,
  Z0: 416.9,
  airOK: true,
  liquid: { name: 'water', rho: 998, sigma: 0.0728, viscous: false, tag: 'measured' },
  lavaWorld: false,
  Uscale: 66.8,
  Us: 7,
  phiH: 0.5,
  Om: 7.29e-5,
  locked: false,
  res32: false,
  R_km: 6371,
  zc_km: 2,
  regime: 'Water clouds',
  seed: 12345,
  Vmax: 70,
  seed3: [12345, 12345, 12345],
  oceanF: 0.7,
  presetId: 'earth',
  inputs: [],
  refusals: [],
};

export const TITAN_AIR: AirModel = {
  ...EARTH_AIR,
  fluid: 'methane',
  T0: 94,
  P0: 146700,
  mu: 28,
  gamma: 1.4,
  gv: 1.35,
  c0: 194,
  rho0: 5.4,
  Z0: 1048,
  liquid: { name: 'methane', rho: 450, sigma: 0.0178, viscous: false, tag: 'inferred_from_analog' },
  seed: 777,
  seed3: [777, 777, 777],
  presetId: 'titan-like',
  regime: 'Methane clouds',
  Vmax: null,
};

/** Mars-like thin CO2 air (ruling R6: thin-air worlds are no longer silent): 600 Pa, 210 K, mu 43.3. */
export const MARS_AIR: AirModel = {
  ...EARTH_AIR,
  cls: 'CO2',
  fluid: 'co2',
  state: 'none',
  T0: 210,
  P0: 600,
  H_km: 11.1,
  mu: 43.3,
  gamma: 1.29,
  gv: 3.71,
  c0: 228,
  rho0: 0.0149,
  Z0: 3.4,
  liquid: null,
  seed: 4242,
  seed3: [4242, 4242, 4242],
  oceanF: 0,
  presetId: 'mars-like',
  regime: 'Dust',
  Vmax: null,
};

/** Titan-like params per #112 (rulings R2/R3): m_f about 2.6, rainPitch about 0.50. */
export const TITAN_MF = 2.6;
export const TITAN_RAIN_PITCH = 0.5;

/** Group sample rates from §9.2 (test copies; #112 owns the real ones). */
export const RATE: Record<SourceId, number> = {
  S1_land: 32000,
  S1_sea: 32000,
  S2: 32000,
  S3: 32000,
  S9: 32000,
  S4: 30000,
  S5: 30000,
  S6: 31000,
  S7: 31000,
  S8: 29000,
  S10: 29000,
  S12: 29000,
  thunder: 29000,
};

/** Minimal valid Earth params per source (the frozen App. D keys). */
export const EARTH_PARAMS: Record<SourceId, Record<string, number>> = {
  S1_land: { Iu: 0.24 },
  S1_sea: { Iu: 0.11 },
  S2: { Iu: 0.24, fHiss_Hz: 350 },
  S3: { Iu: 0.24, fWhistle1_Hz: 233, fWhistle2_Hz: 400, fWhistle3_Hz: 636 },
  S4: { Hs_m: 1.1, Tp_s: 5.1, mf: 1, absK2: 5.8e-10 },
  S5: { Hs_m: 1.1, Tp_s: 5.1, mf: 1, whitecapRate_per_s: 0.234 },
  S6: { rainPitch: 1, mf: 1 },
  S7: { mf: 1 },
  S8: {},
  S9: { Iu: 0.11, fHiss_Hz: 3500 },
  S10: { Iu: 0.24 },
  S12: {},
  thunder: { fm_Hz: 200, dur_s: 10.2, d_m: 400, crack: 1, absK2: 5.8e-10 },
};

export const ALL_LOOP_BEDS: SourceId[] = [
  'S1_land',
  'S1_sea',
  'S2',
  'S3',
  'S4',
  'S5',
  'S6',
  'S7',
  'S8',
  'S9',
  'S10',
  'S12',
];

export function spec(
  id: SourceId,
  N: number,
  over: Partial<BedSpec> & { params?: Record<string, number> } = {},
): BedSpec {
  return {
    id,
    variant: 0,
    sampleRate: RATE[id],
    N,
    seed: 0x5eed + id.length * 7919,
    Uref: id === 'S9' ? 70 : 7,
    bandCenterHz: 500,
    LrefEarth_dB: 55,
    ...over,
    params: over.params ?? { ...EARTH_PARAMS[id] },
  };
}
