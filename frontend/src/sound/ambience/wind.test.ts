// §6.5 / §6.6 planetary wind model (the wind items of §16 test 4 that live in wind.ts).
import { describe, expect, it } from 'vitest';
import { earthAir, makeAir } from './fakeEngine.testutil';
import { compass8, fromDeg, localBasis, rankineV, substellar, windAt, type WindCtx } from './wind';

const ctx = (o: Partial<WindCtx> = {}): WindCtx => ({
  exposure: 0, relief: 0, z_km: 0.01, cyclone: null, landT: null, seaT: null, sCoast_km: null, overSea: false, jetU: null, ...o,
});

describe('local frame (amendment 3)', () => {
  it('east = normalize(cross(Y, up)), north = cross(up, east)', () => {
    const b = localBasis(0, 0);
    expect(b.up[0]).toBeCloseTo(1, 12);
    expect(b.east[2]).toBeCloseTo(-1, 12);
    expect(b.north[1]).toBeCloseTo(1, 12);
    const c = localBasis(1.1, 0.4);
    const dot = (a: number[], d: number[]) => a[0]! * d[0]! + a[1]! * d[1]! + a[2]! * d[2]!;
    expect(dot(c.east, c.up)).toBeCloseTo(0, 12);
    expect(dot(c.north, c.up)).toBeCloseTo(0, 12);
    expect(dot(c.north, c.east)).toBeCloseTo(0, 12);
  });

  it('dirDeg is where the wind comes from, clockwise from north', () => {
    expect(fromDeg(1, 0)).toBe(270); // blowing east -> from the west
    expect(fromDeg(0, -1)).toBe(0); // blowing south -> from the north
    expect(fromDeg(-1, 0)).toBe(90);
    expect(compass8(45)).toBe('north-east');
    expect(compass8(359)).toBe('north');
  });
});

describe('rotating worlds: three cells', () => {
  const air = earthAir();
  it('Earth calibration: westerly peak 7.01 m/s at 1.5 phiH, trade peak 4.91 m/s at phiH/2', () => {
    expect(windAt(air, 0, 1.5 * air.phiH, ctx()).U10).toBeCloseTo(7.014, 1);
    const t = windAt(air, 0, 0.5 * air.phiH, ctx());
    expect(t.U10).toBeCloseTo(4.91, 1);
    expect(compass8(t.dirDeg)).toBe('north-east');
    expect(compass8(windAt(air, 0, -0.5 * air.phiH, ctx()).dirDeg)).toBe('south-east');
    expect(compass8(windAt(air, 0, 1.5 * air.phiH, ctx()).dirDeg)).toBe('south-west');
  });

  it('calm doldrums at the equator and at the horse latitudes', () => {
    expect(windAt(air, 0, 0, ctx()).U10).toBeCloseTo(0.3, 9);
    expect(windAt(air, 0, air.phiH, ctx()).U10).toBeLessThan(0.31);
  });

  it('hill speed-up on an exposed ridge, shelter in a hollow', () => {
    const base = windAt(air, 0, 0.8, ctx()).U10;
    expect(windAt(air, 0, 0.8, ctx({ exposure: 1, relief: 1 })).U10).toBeCloseTo(base * 1.8, 6);
    expect(windAt(air, 0, 0.8, ctx({ exposure: -1 })).U10).toBeCloseTo(base * 0.6, 6);
  });

  it('a sea breeze adds wind near a warm coast and fades inland', () => {
    const near = windAt(air, 0, 0, ctx({ landT: 300, seaT: 290, sCoast_km: 0 }));
    const far = windAt(air, 0, 0, ctx({ landT: 300, seaT: 290, sCoast_km: 100 }));
    expect(near.U10).toBeGreaterThan(far.U10);
    expect(near.parts[0]?.kind).toBe('breeze');
  });

  it('log law: wind grows with height', () => {
    let last = 0;
    for (const z of [0.002, 0.01, 0.1, 0.5, 1, 3, 10]) {
      const u = windAt(air, 0, 0.8, ctx({ z_km: z })).Uz;
      expect(u).toBeGreaterThanOrEqual(last);
      last = u;
    }
  });
});

describe('tidally locked worlds', () => {
  const air = makeAir({ T0: 250, P0: 1.2e5, mu: 29, locked: true, U: 60 });
  const S = substellar();
  const lonS = Math.atan2(S[2], S[0]);
  const latS = Math.asin(S[1]);
  it('calm under the star, gale at the terminator', () => {
    expect(windAt(air, lonS, latS, ctx()).U10).toBeCloseTo(0.3, 6);
    // a point 90 degrees away from the substellar point on the same meridian plane
    const term = windAt(air, lonS + Math.PI / 2, 0, ctx());
    expect(term.parts[0]?.kind).toBe('terminator');
    expect(term.U10).toBeGreaterThan(0.8 * 1.2 * air.Us);
  });
});

describe('hurricanes', () => {
  const air = earthAir({ Vmax: 70 });
  it('Rankine profile peaks at Rm', () => {
    expect(rankineV(0, 1, 70)).toBe(0);
    expect(rankineV(1, 1, 70)).toBe(70);
    expect(rankineV(0.5, 1, 70)).toBeLessThan(70);
    expect(rankineV(2, 1, 70)).toBeLessThan(70);
  });
  it('the eye is calm; the eyewall roars', () => {
    const r = 0.05;
    const Rm = 0.15 * r;
    const eye = windAt(air, 0, 0.3, ctx({ cyclone: { delta: 0.3 * Rm, r, Rm, inEye: true } }));
    expect(eye.U10).toBeLessThanOrEqual(0.3);
    const wall = windAt(air, 0, 0.3, ctx({ cyclone: { delta: Rm, r, Rm, inEye: false } }));
    expect(wall.U10).toBeCloseTo(70, 6);
    expect(wall.parts[0]?.kind).toBe('hurricane');
  });
});

describe('gas giants and airless worlds', () => {
  it('the jet wind is jetU (already m/s), never rescaled', () => {
    const gas = makeAir({ T0: 130, P0: 1e4, mu: 2.3, gas: true, U: 150 });
    const w = windAt(gas, 0, 0.3, ctx({ jetU: 120 }));
    expect(w.U10).toBe(120);
    expect(w.dirDeg).toBe(270);
    expect(windAt(gas, 0, 0.3, ctx({ jetU: null })).U10).toBe(0);
  });
  it('no air, no wind', () => {
    const a = { ...earthAir(), airOK: false };
    expect(windAt(a, 0, 0.8, ctx()).U10).toBe(0);
  });
});
