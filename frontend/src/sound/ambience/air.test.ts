// §16 test 1: air physics anchors (R5 for Mars).
import { describe, expect, it } from 'vitest';
import {
  absorption,
  airAt,
  ceilingKm,
  classify,
  density,
  earthRef,
  gammaFor,
  isoDbPerM,
  lowpassHz,
  soundSpeed,
} from './air';
import { earthAir, makeAir, marsAir } from './fakeEngine.testutil';
import type { CompClass } from './types';

const within = (v: number, target: number, frac: number) =>
  expect(Math.abs(v - target)).toBeLessThanOrEqual(Math.abs(target) * frac);

describe('air: sound speed, density, impedance', () => {
  it('Earth reference air: c 340 m/s ±1 %, rho ≈ 1.2', () => {
    const a = earthAir();
    within(a.c0, 340, 0.01);
    within(a.rho0, 1.2, 0.03);
    within(earthRef().Z, 417.3, 0.005);
  });

  it('R5: Mars-like air (600 Pa, 210 K, mu 43.3, gamma 1.29) gives Z in [3.3, 4.8] and ground level -20 ±2 dB', () => {
    const m = marsAir();
    expect(m.gamma).toBe(1.29);
    expect(m.Z0).toBeGreaterThanOrEqual(3.3);
    expect(m.Z0).toBeLessThanOrEqual(4.8);
    const dL = 10 * Math.log10(m.Z0 / earthRef().Z);
    expect(dL).toBeGreaterThanOrEqual(-22);
    expect(dL).toBeLessThanOrEqual(-18);
  });

  it('Earth, Titan and Venus Z within 5 % of Petculescu & Lueptow 2007 at their stated conditions', () => {
    // P&L 2007 §3: Earth 290 K, 1 atm (mu 28.97); Titan 95 K, 1.6 atm, 95 % N2 5 % CH4 (mu 27.41); Venus 730 K, 90 atm,
    // 96 % CO2 3.5 % N2 (mu 43.23). Their Z: 407, 1186, 26 960 kg m^-2 s^-1.
    const z = (T: number, P: number, mu: number, fluid: 'water' | 'co2') => {
      const cls = classify(mu, fluid, false);
      return density(P, T, mu) * soundSpeed(gammaFor(cls, mu, T), T, mu);
    };
    within(z(290, 101325, 28.97, 'water'), 407, 0.05);
    within(z(95, 1.6 * 101325, 27.41, 'water'), 1186, 0.05);
    within(z(730, 90 * 101325, 43.23, 'co2'), 26960, 0.05);
  });
});

describe('air: absorption anchors (§4.3)', () => {
  it('Titan N2 class (94 K, 1.5 bar) at 15 kHz: 0.014 dB/m ±10 % (ISO 9613-1 relaxation terms vanish)', () => {
    const dbm = absorption(15000, 1.5e5, 94, 'N2') * 8.686;
    within(dbm, 0.014, 0.1);
  });

  it('Mars (600 Pa, 210 K) inside the Maurice et al. 2022 95 % intervals', () => {
    const a = (f: number) => absorption(f, 600, 210, 'CO2');
    expect(a(4500)).toBeGreaterThanOrEqual(0.17);
    expect(a(4500)).toBeLessThanOrEqual(0.25);
    expect(a(8500)).toBeGreaterThanOrEqual(0.29);
    expect(a(8500)).toBeLessThanOrEqual(0.39);
    expect(a(13000)).toBeGreaterThanOrEqual(0.38);
    expect(a(13000)).toBeLessThanOrEqual(0.48);
  });

  it('Venus thick end matches the P&L anchors at 100 Hz and 15 kHz', () => {
    within(absorption(100, 9.2e6, 737, 'CO2'), 4.645e-4, 0.01);
    within(absorption(15000, 9.2e6, 737, 'CO2'), 0.18, 0.02);
  });

  it('CO2 interpolation is continuous at both ends and monotone (falling) in P at 1 kHz, as classical and relaxation loss both fall with P', () => {
    within(absorption(1000, 600 * 1.0001, 210, 'CO2'), absorption(1000, 600, 210, 'CO2'), 0.001);
    within(
      absorption(1000, 9.2e6 * 0.9999, 210, 'CO2'),
      absorption(1000, 9.2e6, 210, 'CO2'),
      0.001,
    );
    let last = Infinity;
    for (const P of [600, 2e3, 1e4, 1e5, 1e6, 9.2e6]) {
      const a = absorption(1000, P, 210, 'CO2');
      expect(a).toBeLessThanOrEqual(last);
      last = a;
    }
  });

  it('ISO sanity: Earth 20 °C, 50 % RH, 1 kHz ≈ 4.7 dB/km', () => {
    within(isoDbPerM(1000, 101325, 293.15) * 1000, 4.7, 0.15);
  });

  it('never NaN: finite and >= 0, or Infinity, on a wide grid', () => {
    const classes: CompClass[] = ['N2', 'CO2', 'H2'];
    for (const cls of classes)
      for (const P of [0, 1e-3, 1, 600, 1e5, 9.2e6, 1e8])
        for (const T of [20, 94, 210, 288, 737, 2000])
          for (const f of [20, 1e3, 16e3]) {
            const a = absorption(f, P, T, cls);
            expect(Number.isNaN(a)).toBe(false);
            expect(a).toBeGreaterThanOrEqual(0);
          }
  });
});

describe('air: profile and ceiling (§4.1)', () => {
  it('Earth silence ceiling ≈ 97 km; above it airAt is silent', () => {
    const a = earthAir();
    within(ceilingKm(a), 97, 0.02);
    expect(airAt(a, 90).silent).toBe(false);
    expect(airAt(a, 100).silent).toBe(true);
  });

  it('temperature floors at 0.6 T0 and the pressure falls with height', () => {
    const a = makeAir({ T0: 300, P0: 1e5, mu: 29, gamK: 10 });
    expect(airAt(a, 50).T).toBeCloseTo(180, 9);
    expect(airAt(a, 10).P).toBeLessThan(airAt(a, 1).P);
  });

  it('classes and gamma follow the §3.2 and §4.2 tables', () => {
    expect(classify(44, 'water', false)).toBe('CO2');
    expect(classify(29, 'co2', false)).toBe('CO2');
    expect(classify(2.3, 'ammonia', true)).toBe('H2');
    expect(classify(18, 'water', false)).toBe('N2');
    expect(gammaFor('N2', 18, 300)).toBe(1.33);
    expect(gammaFor('N2', 29, 300)).toBe(1.4);
    expect(gammaFor('H2', 2.3, 120)).toBe(1.43);
  });

  it('lowpassHz: 16 kHz at no distance, falling with distance', () => {
    const al = (f: number) => absorption(f, 101325, 288, 'N2');
    expect(lowpassHz(al, 0)).toBe(16000);
    const a = lowpassHz(al, 100);
    const b = lowpassHz(al, 1000);
    const c = lowpassHz(al, 10000);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(al(b) * 1000).toBeCloseTo(0.3466, 3);
  });
});
