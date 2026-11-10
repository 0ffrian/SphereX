// Issue #68 Part 3c: the scenario table, every branch, and its provenance (Q-156).
import { describe, expect, it } from 'vitest';
import { climateScenario, deriveClimate, type ClimateInputs } from './climate';
import { kepler186f, trappist1f } from './exoplanetFixtures.testutil';
import { OCEANS_REMOVED_ABOVE_K, iceAngleRad, substellarTempK, tempAtAngleK } from './planets';
import { LAVA_START_K } from './constants';

const base: ClimateInputs = { kind: 'planet_rocky', teqK: 250, locked: false, tssK: null };
const deg = (r: number | null) => (r === null ? null : (r * 180) / Math.PI);

describe('climateScenario: the table, first match wins', () => {
  it('lava above 700 K, whatever the locking', () => {
    expect(climateScenario({ ...base, teqK: 701 }).scenario).toBe('lava');
    expect(climateScenario({ ...base, teqK: 701, locked: true, tssK: 1000 }).scenario).toBe('lava');
  });
  it('exactly 700 K is not lava (the glow starts above LAVA_START_K)', () => {
    expect(climateScenario({ ...base, teqK: LAVA_START_K }).scenario).toBe('hot_dry');
  });
  it('hot_dry above 450 K, and a locked planet that hot is hot_dry, not eyeball', () => {
    expect(climateScenario({ ...base, teqK: 451 }).scenario).toBe('hot_dry');
    expect(climateScenario({ ...base, teqK: 451, locked: true, tssK: 600 }).scenario).toBe(
      'hot_dry',
    );
  });
  it('exactly 450 K falls through to the locking rows', () => {
    expect(climateScenario({ ...base, teqK: OCEANS_REMOVED_ABOVE_K }).scenario).toBe('temperate');
    expect(
      climateScenario({ ...base, teqK: OCEANS_REMOVED_ABOVE_K, locked: true, tssK: 300 }).scenario,
    ).toBe('eyeball');
  });
  it('eyeball when locked and T_ss > 273 K, with the open cap acos((273/T_ss)^4)', () => {
    const r = climateScenario({ ...base, locked: true, tssK: 307.94 });
    expect(r.scenario).toBe('eyeball');
    expect(deg(r.iceAngleRad)).toBeCloseTo(51.85, 1);
  });
  it('snowball when locked and T_ss <= 273 K, exactly 273 included', () => {
    expect(climateScenario({ ...base, locked: true, tssK: 273 })).toEqual({
      scenario: 'snowball',
      iceAngleRad: null,
    });
    expect(climateScenario({ ...base, locked: true, tssK: 200 }).scenario).toBe('snowball');
  });
  it('just above 273 K the open cap is small but present', () => {
    const r = climateScenario({ ...base, locked: true, tssK: 273.5 });
    expect(r.scenario).toBe('eyeball');
    expect(r.iceAngleRad!).toBeGreaterThan(0);
    expect(deg(r.iceAngleRad)!).toBeLessThan(25);
  });
  it('temperate when not locked, however cold: an Earth twin is not a snowball', () => {
    expect(climateScenario({ ...base, teqK: 255, locked: false }).scenario).toBe('temperate');
    expect(climateScenario({ ...base, teqK: 100, locked: false }).scenario).toBe('temperate');
  });
  it('temperate when the locking rule was refused (null), and when T_ss is unknown', () => {
    expect(climateScenario({ ...base, locked: null }).scenario).toBe('temperate');
    expect(climateScenario({ ...base, locked: true, tssK: null }).scenario).toBe('temperate');
  });
  it('a water world and a rocky one get the same scenario', () => {
    const a = climateScenario({ ...base, kind: 'planet_water', locked: true, tssK: 300 });
    const b = climateScenario({ ...base, kind: 'planet_rocky', locked: true, tssK: 300 });
    expect(a).toEqual(b);
  });
});

describe('locked-planet temperature map', () => {
  it('T_ss = sqrt(2) Teq, T(theta) = T_ss cos(theta)^(1/4), 273 K at the ice angle', () => {
    expect(substellarTempK(200)).toBeCloseTo(282.84, 2);
    expect(substellarTempK(0)).toBeNull();
    expect(tempAtAngleK(300, 0)).toBe(300);
    expect(tempAtAngleK(300, Math.PI / 2)).toBeLessThan(0.1);
    expect(tempAtAngleK(300, Math.PI)).toBe(0);
    const th = iceAngleRad(307.94)!;
    expect(tempAtAngleK(307.94, th)).toBeCloseTo(273, 8);
    expect(iceAngleRad(273)).toBeNull();
    expect(iceAngleRad(250)).toBeNull();
  });
});

describe('deriveClimate on the two demo planets', () => {
  it('TRAPPIST-1 f: locked, zero-albedo Teq recomputed, T_ss 307.9 K, theta_ice 51.9 degrees, eyeball', () => {
    const d = deriveClimate(trappist1f(), 'planet_rocky')!;
    expect(d.locked).toBe(true);
    expect(d.scenario).toBe('eyeball');
    expect(d.teqMapSource).toBe('zero_albedo_recomputed');
    expect(d.teqMapK!).toBeCloseTo(217.7, 0);
    expect(d.tssK!).toBeCloseTo(307.9, 0);
    expect(deg(d.iceAngleRad)!).toBeCloseTo(51.9, 0);
    expect(d.tag).toBe('model_dependent');
    expect(d.assumed).toMatchObject({
      albedo: expect.any(String),
      heat_redistribution: 'none',
      greenhouse: 'none',
    });
    expect(d.assumed.tidal_Q).toBe(100);
  });

  it('Kepler-186 f: locked at the constants (KNIFE EDGE, 3.99 vs 4.0 Gyr), so an eyeball with T_ss 282 K', () => {
    const d = deriveClimate(kepler186f(), 'planet_rocky')!;
    expect(d.locked).toBe(true);
    expect(d.scenario).toBe('eyeball');
    expect(d.tssK!).toBeCloseTo(281.8, 0);
    expect(d.tag).toBe('model_dependent');
  });

  it('Kepler-186 f with a younger star (3 Gyr) is not locked, so temperate with no T_ss', () => {
    const c = kepler186f();
    c.host_age_gyr = { value: 3, tag: 'measured', source: 'test: younger than t_lock' };
    const d = deriveClimate(c, 'planet_rocky')!;
    expect(d.locked).toBe(false);
    expect(d.scenario).toBe('temperate');
    expect(d.tssK).toBeNull();
  });

  it('Kepler-186 f: the recomputed 199 K gives T_ss 282 K and an eyeball, where the archive 177 K would give 250 K and a snowball', () => {
    const c = kepler186f();
    const d = deriveClimate(c, 'planet_rocky')!;
    expect(d.locked).toBe(true);
    expect(d.teqMapK!).toBeCloseTo(199.2, 0);
    expect(d.tssK!).toBeCloseTo(281.8, 0);
    expect(d.scenario).toBe('eyeball');
    // Without the star fields the card's 177 K is used, with the albedo caveat.
    delete c.host_radius_rsun;
    const e = deriveClimate(c, 'planet_rocky')!;
    expect(e.teqMapSource).toBe('card_teq_K');
    expect(e.tssK!).toBeCloseTo(250.3, 0);
    expect(e.scenario).toBe('snowball');
    expect(String(e.assumed.teq_K)).toContain('albedo');
  });
});

describe('deriveClimate: branches from a card', () => {
  it('snowball for a locked planet around a cold star', () => {
    const c = trappist1f();
    c.host_teff_K = { value: 1800, tag: 'measured', source: 'test' };
    const d = deriveClimate(c, 'planet_water')!;
    expect(d.scenario).toBe('snowball');
    expect(d.tssK!).toBeLessThan(273);
  });
  it('lava and hot_dry use the card teq_K and skip the locking rule', () => {
    const c = trappist1f();
    c.teq_K = { value: 900, tag: 'measured', source: 'test' };
    const lava = deriveClimate(c, 'planet_rocky')!;
    expect(lava.scenario).toBe('lava');
    expect(lava.lock).toBeNull();
    c.teq_K = { value: 500, tag: 'measured', source: 'test' };
    expect(deriveClimate(c, 'planet_rocky')!.scenario).toBe('hot_dry');
  });
  it('is null without a teq_K: nothing is invented', () => {
    const c = trappist1f();
    delete c.teq_K;
    expect(deriveClimate(c, 'planet_rocky')).toBeNull();
    c.teq_K = { value: null, tag: 'derived', source: 'empty', formula: 'x' };
    expect(deriveClimate(c, 'planet_rocky')).toBeNull();
  });
  it('falls back to temperate when the locking rule is refused', () => {
    const c = trappist1f();
    delete c.orbit_au;
    const d = deriveClimate(c, 'planet_rocky')!;
    expect(d.scenario).toBe('temperate');
    expect(d.lock).toEqual({ ok: false, needs: ['orbit_au'] });
    expect(d.locked).toBeNull();
  });
  it('is never stronger than the weakest input', () => {
    const c = trappist1f();
    c.teq_K = { value: 217.7, tag: 'artistic', source: 'slider-like' };
    expect(deriveClimate(c, 'planet_rocky')!.tag).toBe('artistic');
  });
});
