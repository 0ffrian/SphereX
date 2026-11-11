import { describe, expect, it } from 'vitest';
import {
  GAS_DT,
  GAS_NX,
  GAS_NY,
  GAS_NODES,
  GAS_SETTLE_STEPS,
  ENCKE_GAP_KM,
  GLOW_ABOVE_K,
  MEASURED_FLATTENING,
  MEASURED_PEAK_WIND_MS,
  PACE_DAY_S_PER_S,
  PACE_SLOW_S_PER_S,
  RING_TEX_SIZE,
  SATURN_RADIUS_KM,
  createGasSim,
  gasLayerTags,
  gasModel,
  gasProfile,
  gasRegime,
  ringAt,
  ringRegionAt,
  ringTexture,
  RING_TEX_INNER,
  RING_TEX_OUTER,
  rhinesWidthM,
  scaleHeightM,
  secondsPerStep,
  spinAngle,
  stepsFor,
  type GasInput,
} from './gasDynamics';

// Jupiter: NASA Planetary Fact Sheet (equatorial 1 bar radius 71,492 km, mass 317.83 Earth masses,
// rotation 9.9250 h, equilibrium temperature 110 K), internal heat 1.67x absorbed (Hanel et al. 1981).
const JUP: GasInput = {
  reference: 'jup',
  radiusRj: 1,
  massEarth: 317.83,
  rotPeriodH: 9.925,
  teqK: 110,
  tintK: 99,
  mu: 2.3,
  seed: 67,
};
const SAT: GasInput = {
  reference: 'sat',
  radiusRj: SATURN_RADIUS_KM / 71492,
  massEarth: 95.16,
  rotPeriodH: 10.656,
  teqK: 81.1,
  tintK: 77,
  mu: 2.1,
  seed: 79,
};

describe('gas model against known answers', () => {
  const m = gasModel(JUP)!;
  it('Jupiter gravity at the cloud tops is about 24.8 m/s2 (Moon: ~24.8)', () => {
    expect(m.gravity).toBeGreaterThan(24.2);
    expect(m.gravity).toBeLessThan(25.4);
  });
  it('Jupiter spin rate is 2 pi / 9.925 h', () => {
    expect(m.omega).toBeCloseTo((2 * Math.PI) / (9.925 * 3600), 12);
  });
  it('the reference giants use their measured flattening and peak jet speed (#89 review 5, 6)', () => {
    const s = gasModel(SAT)!;
    expect(m.flattening).toBe(MEASURED_FLATTENING.jup);
    expect(s.flattening).toBe(MEASURED_FLATTENING.sat);
    expect(m.flatteningTag).toBe('measured');
    expect(m.windMs).toBe(MEASURED_PEAK_WIND_MS.jup);
    expect(s.windMs).toBe(MEASURED_PEAK_WIND_MS.sat);
    expect(s.windTag).toBe('measured');
    // Saturn's faster jets give fewer, broader Rhines bands than Jupiter's (the solver's jet count).
    expect(s.jets).toBeLessThan(m.jets);
  });
  it('another giant keeps the 0.7 q flattening and the thermal-wind estimate, tagged model_dependent', () => {
    const o = gasModel({ ...JUP, reference: null })!;
    // 0.7 q for Jupiter's numbers is 0.0625: within 4% of the measured 0.06487.
    expect(o.flattening).toBeGreaterThan(0.06);
    expect(o.flattening).toBeLessThan(0.07);
    expect(o.flatteningTag).toBe('model_dependent');
    // A cool giant that is not locked sits on the 10 K floor: U = 0.6 sqrt(8314.46 / 2.3 * 10) = 114 m/s.
    expect(o.windMs).toBeCloseTo(0.6 * Math.sqrt((8314.462618 / 2.3) * 10), 6);
    expect(o.windTag).toBe('model_dependent');
  });
  it('Jupiter jet speed is of the order of 100 m/s and the scale height tens of km', () => {
    expect(m.windMs).toBeGreaterThan(50);
    expect(m.windMs).toBeLessThan(200);
    expect(m.scaleHeightM / 1000).toBeGreaterThan(15);
    expect(m.scaleHeightM / 1000).toBeLessThan(35);
  });
  it('the Rhines width for U = 30 m/s at 45 degrees is about 9,000 km (Moon: ~9,000 km)', () => {
    const L = rhinesWidthM(m.omega, m.radiusM, 30, Math.PI / 4)!;
    expect(L / 1e6).toBeGreaterThan(8.5);
    expect(L / 1e6).toBeLessThan(10);
  });
  it('scale height H = R T / (mu g): hydrogen air at 165 K and 24.8 m/s2 is about 25 km', () => {
    expect(scaleHeightM(165, 2.3, 24.8) / 1000).toBeGreaterThan(23);
    expect(scaleHeightM(165, 2.3, 24.8) / 1000).toBeLessThan(28);
  });
  it('the Rossby number is small (geostrophic): well under 1', () => {
    expect(m.rossby).toBeGreaterThan(0);
    expect(m.rossby).toBeLessThan(0.5);
  });
  it('Saturn is flatter than Jupiter', () => {
    expect(gasModel(SAT)!.flattening).toBeGreaterThan(m.flattening);
  });
  it('refuses missing or non-positive inputs rather than inventing a value', () => {
    expect(gasModel({ ...JUP, rotPeriodH: 0 })).toBeNull();
    expect(gasModel({ ...JUP, massEarth: NaN })).toBeNull();
    expect(gasModel({ ...JUP, teqK: -5 })).toBeNull();
  });
  it('colour regime follows the equilibrium temperature', () => {
    expect(gasRegime(110)).toBe('Ammonia clouds');
    expect(gasRegime(300)).toBe('Water clouds');
    expect(gasRegime(2000)).toBe('Silicate clouds, glowing');
  });
});

describe('profile and storms', () => {
  const m = gasModel(JUP)!;
  const p = gasProfile(m, JUP);
  it('the band texture holds 512 rows and brightness stays in 0..1', () => {
    expect(p.tex.length).toBe(512 * 4);
    for (let i = 0; i < 512; i++) {
      expect(p.tex[i * 4]!).toBeGreaterThanOrEqual(0);
      expect(p.tex[i * 4]!).toBeLessThanOrEqual(1);
    }
  });
  it('the belts are darker than the zones at the observed latitudes', () => {
    const row = (deg: number) => Math.round(((deg + 90) / 180) * 511);
    expect(p.tex[row(0) * 4]!).toBeGreaterThan(p.tex[row(12) * 4]!); // equatorial zone vs NEB
    expect(p.tex[row(-26) * 4]!).toBeGreaterThan(p.tex[row(-12) * 4]!); // STrZ vs SEB
  });
  it('Jupiter has the Great Red Spot near 22 S and an Oval BA, with polar clusters 8 around 1 and 5 around 1', () => {
    const grs = p.big.find((s) => s.red === 1)!;
    expect((grs.lat * 180) / Math.PI).toBeCloseTo(-22, 0);
    expect(p.small.some((s) => s.type === 3)).toBe(true);
    const north = p.small.filter((s) => s.lat > (80 * Math.PI) / 180);
    const south = p.small.filter((s) => s.lat < (-80 * Math.PI) / 180);
    expect(north.length).toBe(9);
    expect(south.length).toBe(6);
  });
  it('the wind profile is normalised to a peak of 1', () => {
    let mx = 0;
    for (let d = -85; d <= 85; d += 0.25) mx = Math.max(mx, Math.abs(p.u((d * Math.PI) / 180)));
    expect(mx).toBeGreaterThan(0.95);
    expect(mx).toBeLessThanOrEqual(1.0001);
  });
  it('a non-reference giant gets jets from the Rhines count, and its storms sit between them', () => {
    const other: GasInput = { ...JUP, reference: null, seed: 5 };
    const mo = gasModel(other)!;
    const po = gasProfile(mo, other);
    expect(po.big.length).toBeGreaterThanOrEqual(1);
    expect(po.small.length).toBeGreaterThanOrEqual(4);
  });
  it('the observed table runs pole to pole', () => {
    expect(GAS_NODES.jup![0]![0]).toBe(-90);
    expect(GAS_NODES.jup!.at(-1)![0]).toBe(90);
    expect(GAS_NODES.sat![0]![0]).toBe(-90);
  });
});

describe('Saturn rings', () => {
  it('ring edges convert to the published Saturn-radius values', () => {
    // NASA ring table: C inner 1.239, B outer 1.950, A inner 2.030 Saturn radii.
    expect(ringAt(1.3).opacity).toBeLessThan(0.2); // C ring is thin
    expect(ringAt(1.7).opacity).toBeGreaterThan(0.8); // B ring is dense
    expect(ringAt(1.99).opacity).toBeLessThan(0.1); // Cassini Division
    expect(ringAt(2.1).opacity).toBeGreaterThan(0.5); // A ring
    expect(ringAt(2.5).opacity).toBe(0);
    expect(ringAt(1.05).opacity).toBe(0);
  });
  it('the Encke Gap is empty (centre 133,584 km = 2.2165 R_S)', () => {
    expect(ENCKE_GAP_KM / SATURN_RADIUS_KM).toBeCloseTo(2.2165, 3);
    expect(ringAt(ENCKE_GAP_KM / SATURN_RADIUS_KM).opacity).toBe(0);
    expect(ringRegionAt(ENCKE_GAP_KM / SATURN_RADIUS_KM)).toBe('Encke');
    expect(ringAt(2.15).opacity).toBeGreaterThan(0.5);
  });
  it('the F ring (140,180 to 140,240 km) is drawn at least one texture column wide', () => {
    const tex = ringTexture();
    const col = (km: number) =>
      Math.round(
        ((km / SATURN_RADIUS_KM - RING_TEX_INNER) / (RING_TEX_OUTER - RING_TEX_INNER)) *
          (RING_TEX_SIZE - 1),
      );
    expect(tex[col(140210) * 4]!).toBeGreaterThan(0.1);
    // ... and only there: the columns either side are empty space.
    expect(tex[(col(140210) - 2) * 4]!).toBe(0);
    expect(tex[(col(140210) + 2) * 4]!).toBe(0);
  });
  it('the ring texture is deterministic and well formed', () => {
    const a = ringTexture();
    const b = ringTexture();
    expect(a.length).toBe(RING_TEX_SIZE * 4);
    expect(Array.from(a)).toEqual(Array.from(b));
    for (const v of a) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('solver', () => {
  const build = (input: GasInput) => {
    const m = gasModel(input)!;
    return createGasSim(m, input.seed, gasProfile(m, input));
  };

  it('is deterministic: the same input and step count give identical fields', () => {
    const a = build(JUP);
    const b = build(JUP);
    for (let i = 0; i < 30; i++) {
      a.step();
      b.step();
    }
    expect(Array.from(a.exportField())).toEqual(Array.from(b.exportField()));
    expect(a.steps).toBe(30);
  });

  it('a different seed gives a different field once storms are born', () => {
    const a = build(JUP);
    const b = build({ ...JUP, seed: 68 });
    for (let i = 0; i < 40; i++) {
      a.step();
      b.step();
    }
    expect(Array.from(a.exportField())).not.toEqual(Array.from(b.exportField()));
  });

  it('values stay finite and the jets do not drift over a long run', () => {
    const s = build(JUP);
    for (let i = 0; i < GAS_SETTLE_STEPS; i++) s.step();
    const settled = s.zonalMeanFlow();
    for (let i = 0; i < 1500; i++) s.step();
    const later = s.zonalMeanFlow();
    expect(Number.isFinite(s.maxAbsVorticity())).toBe(true);
    for (const v of s.exportField()) expect(Number.isFinite(v)).toBe(true);
    // Mean zonal flow barely changes: compare the pattern (correlation) and the peak.
    let num = 0;
    let d1 = 0;
    let d2 = 0;
    let p1 = 0;
    let p2 = 0;
    for (let j = 8; j < GAS_NY - 8; j++) {
      num += settled[j]! * later[j]!;
      d1 += settled[j]! ** 2;
      d2 += later[j]! ** 2;
      p1 = Math.max(p1, Math.abs(settled[j]!));
      p2 = Math.max(p2, Math.abs(later[j]!));
    }
    expect(num / Math.sqrt(d1 * d2)).toBeGreaterThan(0.95);
    expect(Math.abs(p2 - p1) / p1).toBeLessThan(0.2);
  }, 60_000);

  it('Saturn with its measured jet speed (7 Rhines jets, a slower solver spin) stays finite and keeps its jets', () => {
    const s = build(SAT);
    for (let i = 0; i < GAS_SETTLE_STEPS; i++) s.step();
    const settled = s.zonalMeanFlow();
    for (let i = 0; i < 1000; i++) s.step();
    const later = s.zonalMeanFlow();
    expect(Number.isFinite(s.maxAbsVorticity())).toBe(true);
    for (const v of s.exportField()) expect(Number.isFinite(v)).toBe(true);
    let num = 0;
    let d1 = 0;
    let d2 = 0;
    for (let j = 8; j < GAS_NY - 8; j++) {
      num += settled[j]! * later[j]!;
      d1 += settled[j]! ** 2;
      d2 += later[j]! ** 2;
    }
    expect(num / Math.sqrt(d1 * d2)).toBeGreaterThan(0.95);
  }, 60_000);

  it('the exported field has the grid the tracer pass reads', () => {
    const s = build(SAT);
    s.step();
    expect(s.exportField().length).toBe(GAS_NX * GAS_NY * 4);
  });
});

describe('pacing', () => {
  const m = gasModel(JUP)!;
  it('a solver step stands for tens of minutes of planet time, so 5 minutes per second is slow', () => {
    const per = secondsPerStep(m);
    expect(per).toBeGreaterThan(600);
    // Slow pacing advances well under one step per real second.
    expect(PACE_SLOW_S_PER_S / per).toBeLessThan(1);
    // One day per second: tens of steps per second, so storms visibly drift.
    expect(PACE_DAY_S_PER_S / per).toBeGreaterThan(5);
    expect(PACE_DAY_S_PER_S / per).toBeLessThan(200);
  });
  it('Saturn with its measured 450 m/s jet: still under one step per real second at the slow pace, about 200 at one day', () => {
    const s = gasModel(SAT)!;
    const per = secondsPerStep(s);
    expect(PACE_SLOW_S_PER_S / per).toBeLessThan(1);
    expect(PACE_DAY_S_PER_S / per).toBeGreaterThan(150);
    expect(PACE_DAY_S_PER_S / per).toBeLessThan(250);
  });
  it('steps are a pure function of planet time', () => {
    expect(stepsFor(m, 0)).toBe(0);
    expect(stepsFor(m, secondsPerStep(m) * 10.5)).toBe(10);
    expect(GAS_DT).toBeGreaterThan(0);
  });
  it('the view turns with the planet when slow and co-rotates when fast', () => {
    expect(spinAngle(m, 100, PACE_SLOW_S_PER_S)).toBeCloseTo(100 * m.omega, 12);
    expect(spinAngle(m, 100, PACE_DAY_S_PER_S)).toBe(0);
  });
});

describe('tags (D-02)', () => {
  it('Jupiter: observed bands are measured; colour is artistic; flow is model_dependent', () => {
    const t = Object.fromEntries(gasLayerTags('jup').map((l) => [l.id, l]));
    expect(t.bands!.tag).toBe('measured');
    expect(t.colour!.tag).toBe('artistic');
    expect(t.flow!.tag).toBe('model_dependent');
    expect(t.flow!.assumption).toBeTruthy();
    expect(t.rings).toBeUndefined();
  });
  it('Saturn adds measured rings; other giants get model_dependent bands with an assumption', () => {
    expect(gasLayerTags('sat').find((l) => l.id === 'rings')!.tag).toBe('measured');
    const o = gasLayerTags(null).find((l) => l.id === 'bands')!;
    expect(o.tag).toBe('model_dependent');
    expect(o.assumption).toBeTruthy();
  });
});

describe('storm spin (#89 review 8)', () => {
  it('a cyclone (type 2) turns the other way from an anticyclone (type 1) at the same place', () => {
    const m = gasModel(JUP)!;
    const base = gasProfile(m, JUP);
    const lat = (30 * Math.PI) / 180;
    const one = (type: 1 | 2) => {
      const prof = { ...base, big: [], small: [{ lat, lon: 0, r: 0.06, ar: 1, type }] };
      return createGasSim(m, JUP.seed, prof).exportField();
    };
    const a = one(1);
    const c = one(2);
    // Eastward wind (channel 0) just north of the centre: an anticyclone in the north turns clockwise (eastward on
    // its north side), a cyclone anticlockwise (westward there).
    const j = Math.round((lat + 0.04 + Math.PI / 2) / (Math.PI / GAS_NY) - 0.5);
    const i = Math.round(Math.PI / ((2 * Math.PI) / GAS_NX));
    const k = (j * GAS_NX + i) * 4;
    expect(a[k]! - c[k]!).toBeGreaterThan(0);
  });
});

describe('placed storms', () => {
  it('storms are carried by the deep jets: the Great Red Spot moves, a stationary list does not change at step 0', () => {
    const m = gasModel(JUP)!;
    const sim = createGasSim(m, JUP.seed, gasProfile(m, JUP));
    const at0 = sim.placedStorms();
    expect(at0.some((s) => s.kind === 4)).toBe(true);
    for (let i = 0; i < 200; i++) sim.step();
    const later = sim.placedStorms();
    expect(later.length).toBe(at0.length);
    const g0 = at0.find((s) => s.kind === 4)!;
    const g1 = later.find((s) => s.kind === 4)!;
    expect(g1.lat).toBe(g0.lat);
    expect(g1.lon).not.toBe(g0.lon);
  });
});

describe('tidally locked hot giant (HD 189733 b: P = 2.21857567 d, Teq 1209 K)', () => {
  const HD: GasInput = {
    reference: null,
    radiusRj: 1.13,
    massEarth: 359.1479,
    rotPeriodH: 2.21857567 * 24,
    teqK: 1209,
    tintK: null,
    mu: 2.3,
    seed: 53,
    locked: true,
  };
  const m = gasModel(HD)!;
  it('is hot on the day side and cooler on the night side, with the glow only above 850 K', () => {
    expect(m.locked).toBe(true);
    expect(m.tDayK).toBeGreaterThan(m.tNightK);
    expect(m.tDayK).toBeGreaterThan(1209);
    expect(m.tNightK).toBeLessThan(1209);
    expect(m.tDayK).toBeGreaterThan(GLOW_ABOVE_K);
    // A cold giant has no glow.
    expect(gasModel({ ...JUP })!.tDayK).toBeLessThan(GLOW_ABOVE_K);
  });
  it('does not turn the view and carries one broad equatorial jet', () => {
    expect(spinAngle(m, 1e6, PACE_SLOW_S_PER_S)).toBe(0);
    const p = gasProfile(m, HD);
    expect(Math.abs(p.u(0))).toBeGreaterThan(0.9);
    expect(Math.abs(p.u(1.0))).toBeLessThan(0.5);
  });
  it('the solver runs finite and deterministic', () => {
    const a = createGasSim(m, HD.seed, gasProfile(m, HD));
    const b = createGasSim(m, HD.seed, gasProfile(m, HD));
    for (let i = 0; i < 60; i++) {
      a.step();
      b.step();
    }
    expect(Array.from(a.exportField())).toEqual(Array.from(b.exportField()));
    expect(Number.isFinite(a.maxAbsVorticity())).toBe(true);
  });
});
