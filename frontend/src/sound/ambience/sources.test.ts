// §16 test 5: source gates and bake parameters (R2, R3, R4), and the #113 params contract (amendment 2).
import { describe, expect, it } from 'vitest';
import { buildAirModel } from './airModel';
import { earthRef } from './air';
import { EARTH_MODEL, makeFakeEngine, makeWorld } from './fakeEngine.testutil';
import { earthAir, makeAir, makeFeatures, makePlace, makeWind, marsAir, titanAir } from './fakeEngine.testutil';
import { bubbleFactor, dropPhysics } from './liquids';
import {
  aeolianHz, BED_RATE_OF, gates, PARAM_KEYS, PRIORITY, reynolds, selectBeds, SOURCE_TEXT, strouhal, uSand, wavesPM,
  whitecapFraction,
} from './sources';
import type { SourceId } from './types';

describe('R4: the whistle gate, size by size', () => {
  it('Mars-like air at 8 m/s: the 4 mm hiss is gated out, the 6 mm tone survives with St ≈ 0.15', () => {
    const m = marsAir();
    // Re(4 mm) ≈ 45.0 against 47: a ~4 % margin that rests on the Sutherland CO2 constants [verify].
    expect(reynolds(m, 8, 0.004)).toBeLessThan(47);
    expect(reynolds(m, 8, 0.004)).toBeGreaterThan(43);
    const re6 = reynolds(m, 8, 0.006);
    expect(re6).toBeGreaterThan(47);
    expect(strouhal(re6)).toBeCloseTo(0.145, 2);
    expect(aeolianHz(m, 8, 0.0035)).toBeNull();
    expect(aeolianHz(m, 8, 0.0022)).toBeNull();
    const g = gates(m, 8);
    expect(g.S2.pass).toBe(false);
    expect(g.S2.reason).toBeNull(); // no "too thin" caption while one size still sings
    expect(g.S3.pass).toBe(true);
  });

  it('the refusal caption appears only when every size is gated out', () => {
    // Test input: 300 Pa CO2 at 2 m/s puts every size (Re 6 mm ≈ 9) below 47.
    const thin = makeAir({ T0: 200, P0: 300, mu: 43.3, fluid: 'co2', liquidState: false, oceanF: 0 });
    const g = gates(thin, 2);
    expect(g.S2).toEqual({ pass: false, reason: SOURCE_TEXT.whistle });
    expect(g.S3).toEqual({ pass: false, reason: SOURCE_TEXT.whistle });
  });

  it('Roshko St at Re 100 = 0.212 (1 - 21.2/100)', () => {
    expect(strouhal(100)).toBeCloseTo(0.212 * (1 - 0.212), 12);
    expect(strouhal(46.9)).toBeNull();
    expect(strouhal(500)).toBe(0.2);
  });
});

describe('R2 / R3: bubbles and rain', () => {
  it('Titan bubble pitch factor m_f in [2.0, 2.7] (table values: rho 450, sigma 0.0178; P0 1.5 bar; gamma 1.40)', () => {
    const mf = bubbleFactor(titanAir()) as number;
    expect(mf).toBeGreaterThanOrEqual(2.0);
    expect(mf).toBeLessThanOrEqual(2.7);
    expect(bubbleFactor(earthAir()) as number).toBeCloseTo(1, 2);
  });

  it('Titan largest drop in [4.75, 6.6] mm; fall speed consistent with it', () => {
    // Inputs: methane rho_l 450, sigma 0.0178 (§4.4), g 1.352, air 94 K, 1.5 bar, mu 28 (rho_a 5.37), C_D 0.8.
    const t = titanAir();
    const d = dropPhysics(t)!;
    expect(d.r_m).toBeGreaterThanOrEqual(4.75e-3);
    expect(d.r_m).toBeLessThanOrEqual(6.6e-3);
    const drho = 450 - t.rho0;
    expect(d.vt).toBeCloseTo(Math.sqrt((8 * d.r_m * drho * 1.352) / (3 * 0.8 * t.rho0)), 12);
    // At r ≈ 6.48 mm these inputs give 1.55 m/s (Lorenz 1993: 1.6 m/s at 4.75 mm with rho_l ~600; spread [verify]).
    expect(Math.abs(d.vt - 1.55) / 1.55).toBeLessThan(0.03);
  });

  it('Earth: 3.25 mm, 9.2 m/s ±10 %', () => {
    const d = dropPhysics(earthAir())!;
    expect(d.r_m).toBeCloseTo(3.25e-3, 9);
    expect(Math.abs(d.vt - 9.2) / 9.2).toBeLessThan(0.1);
    expect(d.pitch).toBeCloseTo(1, 9);
  });
});

describe('waves, whitecaps, sand', () => {
  it('Pierson-Moskowitz at 10 m/s on Earth', () => {
    const w = wavesPM(10, 9.81);
    expect(w.Hs).toBeCloseTo(2.243, 3);
    expect(w.Tp).toBeCloseTo(7.278, 3);
    expect(whitecapFraction(3.4)).toBe(0);
  });
  it('saltation threshold on Earth: u*t 0.2 m/s -> U10 ≈ 4.55 m/s; x1.8 on CO2 worlds', () => {
    expect(Math.abs(uSand(earthAir()) - 4.55) / 4.55).toBeLessThan(0.02);
    const m = marsAir();
    expect(uSand(m)).toBeGreaterThan(20);
  });
});

function earthPlace(U10 = 8) {
  return makePlace(0.3, (s) => ({ cls: s.s_km > 1.5 ? 'sea' : 'land', coast: s.s_km > 1.5 }), { wind: makeWind({ U10, Uz: U10 }) });
}

describe('selectBeds', () => {
  it('Earth with a hurricane and lightning: every bed in §9.4 order, params exactly the #113 keys', () => {
    const air = earthAir({ Vmax: 70 });
    const { beds } = selectBeds(air, earthPlace());
    const ids = beds.map((b) => b.id);
    const order = ids.map((id) => PRIORITY.indexOf(id));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const id of ['S1_land', 'S1_sea', 'S4', 'S5', 'S6', 'S2', 'S3', 'S7', 'S9', 'thunder'] as SourceId[]) {
      expect(ids).toContain(id);
    }
    for (const b of beds) {
      const k = PARAM_KEYS[b.id];
      const keys = Object.keys(b.params);
      for (const r of k.req) expect(keys).toContain(r);
      for (const key of keys) expect([...k.req, ...k.opt]).toContain(key);
      for (const v of Object.values(b.params)) expect(Number.isFinite(v)).toBe(true);
      if (b.id === 'S3') expect(keys.some((x) => x.startsWith('fWhistle'))).toBe(true);
      expect(b.sampleRate).toBe(BED_RATE_OF[b.id]);
      expect(b.N).toBe(2 ** 20);
      expect(Number.isFinite(b.bandCenterHz) && b.bandCenterHz > 0).toBe(true);
    }
  });

  it('thunder: four variants at 400/800/5000/12000 m, cracks only below 1 km, rolls that fit the loop', () => {
    const t = selectBeds(earthAir(), earthPlace()).beds.filter((b) => b.id === 'thunder');
    expect(t.map((b) => b.params.d_m)).toEqual([400, 800, 5000, 12000]);
    expect(t.map((b) => b.params.crack)).toEqual([1, 1, 0, 0]);
    for (const b of t) {
      expect(b.sampleRate).toBe(29000);
      expect(b.params.dur_s as number).toBeLessThanOrEqual(b.N / b.sampleRate - 0.5);
      expect(b.params.fm_Hz).toBeCloseTo(200, 6);
    }
  });

  it('seeds are deterministic and differ per bed and variant', () => {
    const a = selectBeds(earthAir(), earthPlace()).beds.map((b) => b.seed);
    const b = selectBeds(earthAir(), earthPlace()).beds.map((x) => x.seed);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  it('no sea beds on a world without a sea; a gas giant bakes only S12 (and thunder where lightning is observed)', () => {
    const dry = selectBeds(earthAir({ oceanF: 0 }), earthPlace()).beds.map((b) => b.id);
    expect(dry).not.toContain('S1_sea');
    expect(dry).not.toContain('S4');
    expect(dry).not.toContain('S5');
    const jup = makeAir({ T0: 130, P0: 1e4, mu: 2.3, gas: true, U: 150, presetId: 'jup', regime: 'Ammonia clouds' });
    const r = selectBeds(jup, makePlace(50, () => ({}), { wind: makeWind({ U10: 150, Uz: 150, parts: [{ kind: 'jet', U: 150 }] }) }));
    expect([...new Set(r.beds.map((b) => b.id))]).toEqual(['S12', 'thunder']);
    expect(r.refusals.filter((x) => x.source !== 'lightning')).toEqual([]);
  });

  it('a refused world bakes nothing and passes its refusal through', () => {
    const air = { ...earthAir(), airOK: false, refusals: [{ source: 'all' as const, reason: 'No air here, so there is no sound.' }] };
    expect(selectBeds(air, earthPlace())).toEqual({ beds: [], refusals: air.refusals });
  });

  it('Methane world: thunder refused with the Titan reason', () => {
    const r = selectBeds(titanAir(), makePlace(0.3, () => ({}), { ...makeFeatures(), z_km: 0.3 }));
    expect(r.refusals).toContainEqual({ source: 'lightning', reason: 'No lightning has ever been detected on Titan, so there is no thunder here.' });
  });

  it('R6: a real-Mars card at 0.006 bar gets wind beds, about 20 dB quieter than Earth for ground sources', () => {
    const e = makeFakeEngine({
      model: { ...EARTH_MODEL, Ts: 210, H: 11100, gv: 3.71, U: 70, airless: true, state: 'frozen', canLiquid: false, zc: null },
      state: { Ps: 0.006, fluid: 'co2' },
      climate: { stats: { ocean: 0, max: 260 } },
      hydro: { n: 0, lava: false },
    });
    const air = buildAirModel(makeWorld({ id: 'mars', Ps: 0.006, mu: 43.3, fluid: 'co2' }), e);
    const { beds, refusals } = selectBeds(air, makePlace(0.3, () => ({}), { wind: makeWind({ U10: 8, Uz: 8 }) }));
    expect(beds.map((b) => b.id)).toContain('S1_land');
    expect(refusals.some((r) => r.source === 'all')).toBe(false);
    for (const id of ['S4', 'S5', 'S6', 'S7']) expect(beds.map((b) => b.id)).not.toContain(id);
    const dL = 10 * Math.log10(air.Z0 / earthRef().Z);
    expect(Math.abs(dL + 20)).toBeLessThanOrEqual(2);
  });

  it('R6: the lava preset (0.005 bar rock vapour) gets wind, lava and vent beds with the assumed-atmosphere label', () => {
    const e = makeFakeEngine({
      model: { ...EARTH_MODEL, Ts: 1800, H: 30000, gv: 23, U: 300, airless: true, state: 'vapour', canLiquid: false, zc: null },
      state: { Ps: 0.005, locked: true },
      climate: { stats: { ocean: 0, max: 2500 } },
      hydro: { n: 4, lava: true },
    });
    const air = buildAirModel(makeWorld({ id: 'lava', Ps: 0.005, mu: 44, locked: true, sea: 0 }), e);
    expect(air.lavaWorld).toBe(true);
    expect(air.inputs.find((i) => i.label === 'Atmosphere')?.tag).toBe('inferred_from_analog');
    const ids = selectBeds(air, makePlace(0.3, () => ({ cls: 'lava' }), { wind: makeWind({ U10: 8, Uz: 8 }) })).beds.map((b) => `${b.id}|${b.variant}`);
    expect(ids).toContain('S1_land|0');
    expect(ids).toContain('S8|0');
    expect(ids).toContain('S8|1');
  });

  it('R6: P0 = 0.5 Pa refuses everything', () => {
    const e = makeFakeEngine({ model: { ...EARTH_MODEL, Ts: 210, airless: true, state: 'frozen' }, state: { Ps: 5e-6 } });
    const air = buildAirModel(makeWorld({ Ps: 5e-6 }), e);
    const r = selectBeds(air, makePlace(0.3));
    expect(r.beds).toEqual([]);
    expect(r.refusals).toEqual([{ source: 'all', reason: 'No air here, so there is no sound.' }]);
  });
});
