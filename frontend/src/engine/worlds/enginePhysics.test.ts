// Issue #93 phase 3 (physics): the verbatim engine's CPU model, run headless. Each block names its #93 item.
import { describe, expect, it } from 'vitest';
import type { ObjectCard } from '@/contract';
import { FLUIDS as TS_FLUIDS, boilingPointK, cloudBaseK, fluidState } from '@/physics/fluids';
import { cardToWorld } from './cardToWorld';
import { headlessCore, loadModelOnly, preset } from './coreHarness.testutil';

const tv = (value: number) => ({ value, tag: 'measured', source: 'test' });

const PRESSURES_BAR = [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 100];

describe('#93 3.1 critical points', () => {
  const core = headlessCore();
  it('every engine fluid has a critical point, and the shared fluids match physics/fluids.ts', () => {
    for (const [id, F] of Object.entries(core.FLUIDS)) {
      expect(F.Tc, id).toBeGreaterThan(F.Tt);
      expect(F.Pc, id).toBeGreaterThan(F.Pt);
      const ts = (TS_FLUIDS as Record<string, { Tc: number; Pc: number }>)[id];
      if (ts) {
        expect(F.Tc, id).toBe(ts.Tc);
        expect(F.Pc, id).toBe(ts.Pc);
      }
    }
  });

  it('no fluid is liquid above its critical temperature at any pressure from 0.01 to 100 bar', () => {
    const W = core.W;
    loadModelOnly(core, preset('earth'));
    for (const fluid of Object.keys(core.FLUIDS)) {
      const F = core.FLUIDS[fluid];
      for (const Ps of PRESSURES_BAR) {
        W.fluid = fluid;
        W.Ps = Ps;
        const m = core.worldModel();
        expect(m.Tb, `${fluid} ${Ps} bar`).toBeLessThanOrEqual(F.Tc + 1e-9);
        if (m.state === 'liquid') expect(m.Ts, `${fluid} ${Ps} bar`).toBeLessThan(F.Tc);
        // TS copy: the same rule, swept over temperature too.
        const tf = (TS_FLUIDS as Record<string, (typeof TS_FLUIDS)['water']>)[fluid];
        if (tf) {
          const tb = boilingPointK(tf, Ps * 1e5);
          if (tb !== null) expect(tb).toBeLessThanOrEqual(tf.Tc);
          for (let T = tf.Tt; T < tf.Tc * 1.5; T += 5) {
            const st = fluidState(tf, T, Ps * 1e5, false);
            if (T >= tf.Tc) expect(st, `${fluid} ${Ps} bar ${T} K`).not.toBe('liquid');
          }
        }
      }
    }
  });

  it('nitrogen at 100 bar on a 165 K world is supercritical, not a boiling sea (the issue example)', () => {
    expect(fluidState(TS_FLUIDS.nitrogen, 165, 100e5, false)).toBe('supercritical');
    const W = core.W;
    loadModelOnly(core, preset('tit'));
    W.fluid = 'nitrogen';
    W.Ps = 100;
    W.orbit = 0.55; // brings Titan's surface above 126 K under 100 bar
    const m = core.worldModel();
    expect(m.Ts).toBeGreaterThan(126.19);
    expect(m.state).toBe('supercritical');
    core.W.m = m;
    core.worldUi();
    const row = (core.W.rows as [string, string][]).find((r) => r[0] === 'Surface fluid');
    expect(row?.[1]).toMatch(/supercritical/);
  });

  it('#93 3.2: the engine saturation curve is the same as physics/fluids.ts (Murphy and Koop for water, Lv for CO2)', () => {
    // Compared through the cloud base, which follows the adiabat until psat(T) <= q P: the same curve and inputs
    // give the same cloud-base temperature (both step 0.5 K from the surface).
    loadModelOnly(core, preset('earth'));
    for (const [fluid, Ps] of [
      ['water', 1],
      ['water', 3],
      ['co2', 20],
    ] as const) {
      core.W.fluid = fluid;
      core.W.Ps = Ps;
      // CO2: the first orbit (1.0 to 3.0 au) where the CO2 air condenses at all.
      let m = core.worldModel();
      for (let o = 1; fluid === 'co2' && o <= 3; o += 0.1) {
        core.W.orbit = o;
        m = core.worldModel();
        if (m.Tc !== null) break;
      }
      const f = TS_FLUIDS[fluid];
      const tc = cloudBaseK({ ...f, q: core.FLUIDS[fluid].q }, m.Ts, Ps * 1e5);
      expect(m.Tc, `${fluid} ${Ps} bar`).not.toBeNull();
      expect(Math.abs(m.Tc - tc!), `${fluid} ${Ps} bar`).toBeLessThanOrEqual(0.5);
    }
  });

  it('below the critical pressure the line is unchanged: water boils at 373 K at 1 bar', () => {
    loadModelOnly(core, preset('earth'));
    const m = core.worldModel();
    expect(m.Tb).toBeGreaterThan(372);
    expect(m.Tb).toBeLessThan(374);
    expect(m.state).toBe('liquid');
  });
});

describe('#93 3.3 tides read the preset orbit (p.ob) before the ORB table', () => {
  const T1E_CARD = {
    // Not one of ARTIFACT_PRESETS (those keep the prototype's own ORB row), so the generic path builds p.ob.
    id: 'simbad-test-rocky',
    name: 'Test rocky world (TRAPPIST-1 e values)',
    type: 'planet_rocky',
    host_mass_msun: tv(0.0898),
    host_radius_rsun: tv(0.1192),
    host_teff_K: tv(2566),
    mass_mearth: tv(0.692),
    orbit_au: tv(0.02925),
    orbital_period_d: tv(6.101013),
    radius_rjup: tv(0.08207751457505734),
  } as unknown as ObjectCard;

  it('cardToWorld fills ob.Ms from the card host_mass_msun', () => {
    const r = cardToWorld(T1E_CARD);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.preset.ob?.Ms).toBe(0.0898);
  });

  it('the tidal heat scales with the p.ob host mass squared, without touching the ORB table', () => {
    const core = headlessCore();
    const base = { ...preset('t1e'), id: 'card-only-world' };
    expect(core.ORB['card-only-world']).toBeUndefined();
    const heat = (Ms: number): number => {
      loadModelOnly(core, { ...base, ob: { Ms, e: 0.05, obl: 0 } });
      return core.worldModel().tide;
    };
    expect(heat(0.0898)).toBeGreaterThan(0);
    expect(heat(0.2) / heat(0.1)).toBeCloseTo(4, 6);
  });

  it('setPreset takes eccentricity and obliquity from p.ob; a prototype preset keeps its ORB row', () => {
    const core = headlessCore();
    core.setPreset({ ...preset('earth'), id: 'card-only-earth', ob: { Ms: 1, e: 0.2, obl: 0.3 } });
    expect(core.W.ecc).toBe(0.2);
    expect(core.W.obl).toBe(0.3);
    core.setPreset(preset('earth'));
    expect(core.W.ecc).toBe(0.0167);
  });
});
