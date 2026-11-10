// Issue #68 Part 3a: tidal locking. The outcomes follow from the named constants; they are not
// hard-coded anywhere (see the knife-edge test).
import { describe, expect, it } from 'vitest';
import { AU_M, G, GM_EARTH, GM_SUN, HOUR_S, R_EARTH_M } from './constants';
import { exoplanetSentences } from '@/viewer/planCommon';
import { kepler186f, trappist1f } from './exoplanetFixtures.testutil';
import {
  LOCK_NEAR_FRACTION,
  AGE_FALLBACK_GYR,
  INITIAL_SPIN_H,
  TIDAL_K2,
  TIDAL_Q,
  TIDAL_Q_LOWER_BOUND,
  deriveLocking,
  lockingTimeS,
} from './tides';

const GYR_S = 1e9 * 365.25 * 86400;

describe('tidal constants', () => {
  it('are the rulings: k2 0.3, Q 100, 13.5 h, 1 Gyr fallback (Q 12 is the lower bound)', () => {
    expect(TIDAL_K2).toBe(0.3);
    expect(TIDAL_Q).toBe(100);
    expect(TIDAL_Q_LOWER_BOUND).toBe(12);
    expect(INITIAL_SPIN_H).toBe(13.5);
    expect(AGE_FALLBACK_GYR).toBe(1);
  });
});

describe('lockingTimeS (Gladman et al. 1996 as quoted by Grundy et al. 2012, Eq. 1: 16 pi / 15)', () => {
  it('scales as a^6 and 1/M_star^2', () => {
    const base = lockingTimeS(1e-4, 1e10, 6e24, 6.4e6, 2e30, 100, 0.3)!;
    expect(lockingTimeS(1e-4, 2e10, 6e24, 6.4e6, 2e30, 100, 0.3)! / base).toBeCloseTo(64, 8);
    expect(lockingTimeS(1e-4, 1e10, 6e24, 6.4e6, 4e30, 100, 0.3)! / base).toBeCloseTo(0.25, 8);
  });
  it('refuses a non-positive or non-finite input', () => {
    expect(lockingTimeS(0, 1e10, 6e24, 6.4e6, 2e30, 100, 0.3)).toBeNull();
    expect(lockingTimeS(1e-4, 1e10, 6e24, NaN, 2e30, 100, 0.3)).toBeNull();
  });
});

describe('deriveLocking on the two demo planets', () => {
  it('TRAPPIST-1 f: t_lock about 6.2e-5 Gyr, locked (Q = 100)', () => {
    const r = deriveLocking(trappist1f());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tLockGyr).toBeGreaterThan(6.1e-5);
    expect(r.tLockGyr).toBeLessThan(6.4e-5);
    expect(r.ageGyr).toBe(7.6);
    expect(r.locked).toBe(true);
    expect(r.tag).toBe('model_dependent');
    expect(r.assumed).toMatchObject({ tidal_Q: 100, tidal_k2: 0.3, initial_spin_h: 13.5 });
  });

  it('Kepler-186 f: t_lock about 3.99 Gyr against 4.0 Gyr, so locked. KNIFE EDGE (0.3%): follows from the constants only', () => {
    const r = deriveLocking(kepler186f());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tLockGyr).toBeGreaterThan(3.97);
    expect(r.tLockGyr).toBeLessThan(4.0);
    expect(r.locked).toBe(true);
    // Nothing is hard-coded: the ticket's older prefactor (3 instead of pi in the denominator,
    // pi / 3 higher) gives 4.17 Gyr, i.e. not locked.
    expect(r.tLockGyr * (Math.PI / 3)).toBeGreaterThan(r.ageGyr);
    // A 0.4% smaller age, or a 0.4% larger Q, would flip the verdict.
    expect(r.tLockGyr / r.ageGyr).toBeGreaterThan(0.99);
    // At the lower-bound Q = 12 it is locked with a wide margin: t_lock scales linearly with Q.
    expect(r.tLockGyr * (TIDAL_Q_LOWER_BOUND / TIDAL_Q!)).toBeLessThan(r.ageGyr);
  });

  it('matches the formula written out by hand', () => {
    const c = trappist1f();
    const r = deriveLocking(c);
    if (!r.ok) throw new Error('refused');
    const omega = (2 * Math.PI) / (13.5 * HOUR_S);
    const a = 0.03849 * AU_M;
    const mp = (1.039 * GM_EARTH) / G;
    const R = c.radius_rjup!.value! * 7.1492e7;
    const Ms = (0.0898 * GM_SUN) / G;
    const t = (omega * a ** 6 * 0.4 * mp * R ** 2 * 100) / (Math.PI * G * Ms ** 2 * 0.3 * R ** 5);
    expect(r.tLockGyr).toBeCloseTo(t / GYR_S, 10);
    expect(R / R_EARTH_M).toBeCloseTo(1.045, 3);
  });
});

describe('deriveLocking: missing data, fallbacks and tags', () => {
  it('refuses, naming the field, when the orbit or the host mass is missing', () => {
    const c = trappist1f();
    delete c.orbit_au;
    expect(deriveLocking(c)).toEqual({ ok: false, needs: ['orbit_au'] });
    const d = trappist1f();
    d.host_mass_msun = { value: null, tag: 'measured', source: 'archive: empty' };
    expect(deriveLocking(d)).toEqual({ ok: false, needs: ['host_mass_msun'] });
  });

  it('uses the Earth-like rocky mass for the radius when the card has no mass (model_dependent, assumed)', () => {
    const c = kepler186f();
    delete c.mass_mearth;
    const r = deriveLocking(c);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(String(r.assumed.mass_mearth)).toContain('Zeng');
    expect(r.tag).toBe('model_dependent');
  });

  it('refuses when there is no mass and the radius is off the Zeng table', () => {
    const c = kepler186f();
    delete c.mass_mearth;
    c.radius_rjup = { value: 0.5, tag: 'measured', source: 'test' };
    expect(deriveLocking(c)).toEqual({ ok: false, needs: ['mass_mearth'] });
  });

  it('assumes 1 Gyr, and says so, when the card has no age', () => {
    const c = trappist1f();
    delete c.host_age_gyr;
    const r = deriveLocking(c);
    expect(r.ok && r.ageGyr).toBe(1);
    expect(r.ok && String(r.assumed.host_age_gyr)).toContain('project choice');
  });

  it('is never stronger than model_dependent, and weaker inputs weaken it', () => {
    const c = trappist1f();
    c.mass_mearth = { value: 1, tag: 'artistic', source: 'test' };
    const r = deriveLocking(c);
    expect(r.ok && r.tag).toBe('artistic');
  });

  it('is deterministic', () => {
    expect(deriveLocking(kepler186f())).toEqual(deriveLocking(kepler186f()));
  });
});

describe('a verdict close to the threshold says so (Q-155, PR #70 review)', () => {
  it('flags Kepler-186 f, whose t_lock is 0.3% from its age, and leaves the verdict alone', () => {
    const r = deriveLocking(kepler186f());
    if (!r.ok) throw new Error('refused');
    expect(r.locked).toBe(true);
    expect(r.nearThreshold).toBe(true);
  });

  it('does not flag TRAPPIST-1 f, which is locked by orders of magnitude', () => {
    const r = deriveLocking(trappist1f());
    if (!r.ok) throw new Error('refused');
    expect(r.nearThreshold).toBe(false);
  });

  it('the margin covers the gap between the published forms (pi G against 3 G)', () => {
    expect(LOCK_NEAR_FRACTION).toBeGreaterThan(Math.PI / 3 - 1);
  });

  it('the climate sentences say it only when asked', () => {
    const base = {
      kind: 'planet_rocky',
      scenario: 'eyeball',
      teffK: null,
      starlight: null,
      climateShown: true,
    } as const;
    expect(exoplanetSentences({ ...base, lockNearThreshold: true }).join(' ')).toContain(
      'close to call',
    );
    expect(exoplanetSentences(base).join(' ')).not.toContain('close to call');
  });
});
