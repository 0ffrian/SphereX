// §16 test 6: lightning rule table, the seeded strike schedule, thunder parameters, the overlay frame.
import { describe, expect, it } from 'vitest';
import { earthAir, makeAir, makePlace, makeWind, titanAir, venusAir } from './fakeEngine.testutil';
import { dropPhysics } from './liquids';
import {
  audibleRadiusM, LIGHTNING_TEXT, lightningRate, lightningRule, StrikeScheduler, thunderFm, thunderParams,
  weatherVisualFrame,
} from './weather';
import type { Strike } from './types';

describe('§8.2 lightning rule table', () => {
  it('observed worlds (earth, jup, sat and the card aliases) are allowed, measured', () => {
    for (const id of ['earth', 'jup', 'sat', 'ref-jupiter', 'ref-saturn']) {
      const gas = id !== 'earth';
      const air = gas ? makeAir({ T0: 130, P0: 1e4, mu: 2.3, gas: true, regime: 'Methane-rich air, blue' }) : earthAir();
      expect(lightningRule(air, id)).toEqual({ allowed: true, tag: 'measured', reason: null });
    }
  });
  it('rocky water or ammonia-water exoplanet with liquid: allowed by analog', () => {
    expect(lightningRule(earthAir(), 't1e')).toEqual({ allowed: true, tag: 'inferred_from_analog', reason: null });
    expect(lightningRule(earthAir({ fluid: 'ammoniaWater' }), 'x').allowed).toBe(true);
    // keyed on the fluid, not the class: a mu-44 water world is not "Venus-like"
    expect(lightningRule(makeAir({ T0: 300, P0: 1e5, mu: 44 }), 'x').allowed).toBe(true);
  });
  it('gas exoplanets: water or ammonia clouds only', () => {
    const g = (regime: string) => makeAir({ T0: 300, P0: 1e4, mu: 2.3, gas: true, regime });
    expect(lightningRule(g('Water clouds'), 'hd').tag).toBe('inferred_from_analog');
    expect(lightningRule(g('Ammonia clouds'), 'hd').allowed).toBe(true);
    expect(lightningRule(g('Cloudless, deep blue'), 'hd')).toEqual({ allowed: false, tag: null, reason: LIGHTNING_TEXT.other });
  });
  it('methane, CO2 and the rest are refused with their strings', () => {
    expect(lightningRule(titanAir(), 'tit').reason).toBe(LIGHTNING_TEXT.titan);
    expect(lightningRule(venusAir(), 'venus').reason).toBe(LIGHTNING_TEXT.co2);
    expect(lightningRule(earthAir({ liquidState: false }), 'x').reason).toBe(LIGHTNING_TEXT.other);
    expect(lightningRule({ ...earthAir(), airOK: false }, 'earth').allowed).toBe(false);
  });
});

describe('§8.3 rate', () => {
  it('rocky exoplanets need deep convection; Jupiter is quieter at low latitude', () => {
    const air = earthAir({ presetId: 't1e' });
    const rule = lightningRule(air, air.presetId);
    expect(lightningRate(air, makePlace(1, () => ({}), { cnv: 0.2, cnvRing: 0.2 }), rule)).toBe(0);
    expect(lightningRate(air, makePlace(1, () => ({}), { cnv: 0.5, cnvRing: 0.5 }), rule)).toBeCloseTo(3, 12);
    const jup = makeAir({ T0: 130, P0: 1e4, mu: 2.3, gas: true, presetId: 'jup' });
    const r = lightningRule(jup, 'jup');
    const eq = makePlace(60, () => ({}), { cnvRing: 1 });
    expect(lightningRate(jup, eq, r)).toBeCloseTo(6 * 0.3, 12);
    expect(lightningRate(jup, { ...eq, lat: 1 }, r)).toBeCloseTo(6, 12);
  });
});

describe('StrikeScheduler', () => {
  const air = earthAir();
  const place = makePlace(1, () => ({}), { cnvRing: 1, wind: makeWind() });
  const run = (seed: number, rate: number, T: number, dt: number) => {
    const s = new StrikeScheduler(seed);
    const out: Strike[] = [];
    for (let t = 0; t <= T + 1e-9; t += dt) out.push(...s.next(t, rate, air, place));
    return out;
  };

  it('is deterministic for a seed and differs between seeds', () => {
    const a = run(7, 6, 600, 0.1);
    expect(a.length).toBeGreaterThan(20);
    expect(run(7, 6, 600, 0.1)).toEqual(a);
    expect(run(8, 6, 600, 0.1)).not.toEqual(a);
  });

  it('strike times do not depend on how the time is split into ticks', () => {
    const fine = run(11, 6, 300, 0.01);
    const coarse = run(11, 6, 300, 0.1);
    expect(coarse.length).toBe(fine.length);
    coarse.forEach((s, i) => expect(s.t0).toBeCloseTo(fine[i]!.t0, 9));
  });

  it('a rate change rescales the pending interval by lambda_old/lambda_new', () => {
    const a = new StrikeScheduler(3);
    a.next(0, 6, air, place);
    let tStar = -1;
    for (let t = 0.05; tStar < 0 && t < 600; t += 0.05) {
      const s = a.next(t, 6, air, place);
      if (s.length) tStar = s[0]!.t0;
    }
    expect(tStar).toBeGreaterThan(0);
    const tc = tStar / 2;
    const b = new StrikeScheduler(3);
    b.next(0, 6, air, place);
    b.next(tc, 6, air, place);
    const expected = tc + 2 * (tStar - tc);
    let got = -1;
    for (let t = tc + 0.05; got < 0 && t < expected + 1; t += 0.05) {
      const s = b.next(t, 3, air, place);
      if (s.length) got = s[0]!.t0;
    }
    expect(got).toBeCloseTo(expected, 9);
  });

  it('after a pause, old strikes are dropped and at most one is returned', () => {
    const s = new StrikeScheduler(5);
    s.next(0, 6, air, place);
    const out = s.next(600, 6, air, place);
    expect(out.length).toBeLessThanOrEqual(1);
    if (out.length) expect(out[0]!.t0).toBeGreaterThanOrEqual(599);
  });

  it('never two flashes within 2 s, even at a high rate', () => {
    const flashes = run(9, 600, 120, 0.05).filter((s) => s.flash).map((s) => s.t0);
    expect(flashes.length).toBeGreaterThan(10);
    for (let i = 1; i < flashes.length; i++) expect(flashes[i]! - flashes[i - 1]!).toBeGreaterThanOrEqual(2);
  });

  it('chooses only baked variants; near/far split at the crack distance', () => {
    const s = new StrikeScheduler(13);
    s.setVariants([2]);
    const out: Strike[] = [];
    for (let t = 0; t < 600; t += 0.1) out.push(...s.next(t, 60, air, place));
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((x) => x.variant === 2)).toBe(true);
    const all = run(17, 60, 600, 0.1);
    for (const x of all) expect(x.d_m < 1000).toBe(x.variant < 2);
  });
});

describe('§8.4 thunder', () => {
  it('Earth peaks at 200 Hz; f_m scales with c0 sqrt(P0)', () => {
    const e = earthAir();
    const t = titanAir();
    expect(thunderFm(e)).toBeCloseTo(200, 9);
    expect(thunderFm(t) / thunderFm(e)).toBeCloseTo((t.c0 * Math.sqrt(t.P0)) / (e.c0 * Math.sqrt(e.P0)), 12);
  });
  it('R_aud is capped at 25 km on Earth and shorter in thick CO2', () => {
    expect(audibleRadiusM(earthAir(), 0)).toBe(25000);
    expect(audibleRadiusM(venusAir(), 0)).toBeLessThan(25000);
  });
  it('duration capped at 35 s; a crack only within 1 km; delay = d/c', () => {
    const e = earthAir();
    expect(thunderParams(e, 100000).dur_s).toBe(35);
    expect(thunderParams(e, 999).crack).toBe(1);
    expect(thunderParams(e, 1000).crack).toBe(0);
    expect(thunderParams(e, 3400).delay_s).toBeCloseTo(3400 / e.c0, 6);
    expect(thunderParams(e, 2000).level_dB).toBeLessThan(thunderParams(e, 1000).level_dB);
  });
});

describe('§8.5 overlay frame', () => {
  const air = earthAir({ zc_km: 2 });
  const rainy = { precipPhase: 'rain' as const, rainRate: 1, wind: makeWind({ U10: 9 }) };
  it('rain below the clouds, with the drop fall speed and a downwind slant', () => {
    const f = weatherVisualFrame(air, makePlace(0.5, () => ({}), rainy), []);
    expect(f.rain?.vt).toBeCloseTo(dropPhysics(air)!.vt, 12);
    expect(f.rain?.slantRad).toBeCloseTo(Math.atan(9 / dropPhysics(air)!.vt), 12);
    expect(f.rain?.snow).toBe(false);
    expect(f.aboveClouds).toBe(false);
  });
  it('no rain drawn above the clouds or in the eye', () => {
    expect(weatherVisualFrame(air, makePlace(3, () => ({}), rainy), []).rain).toBeNull();
    const eye = { ...rainy, cyclone: { delta: 0, r: 0.05, Rm: 0.0075, inEye: true } };
    expect(weatherVisualFrame(air, makePlace(0.5, () => ({}), eye), []).rain).toBeNull();
  });
  it('snow falls at 1 m/s x sqrt(g_E/g) (the spec rule)', () => {
    const f = weatherVisualFrame(air, makePlace(0.5, () => ({}), { ...rainy, precipPhase: 'snow' }), []);
    expect(f.rain?.snow).toBe(true);
    expect(f.rain?.vt).toBeCloseTo(1, 9);
  });
});
