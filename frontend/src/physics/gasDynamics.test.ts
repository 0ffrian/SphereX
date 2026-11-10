import { describe, expect, it } from 'vitest';
import {
  GAS_DT,
  GAS_NX,
  GAS_NY,
  GAS_NODES,
  GAS_SETTLE_STEPS,
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
  ringTexture,
  rhinesWidthM,
  scaleHeightM,
  secondsPerStep,
  spinAngle,
  stepsFor,
  type GasInput,
} from './gasDynamics';

// Jupiter: NASA Planetary Fact Sheet (equatorial 1 bar radius 71,492 km, mass 317.83 Earth masses,
// rotation 9.9250 h, equilibrium temperature 110 K), internal heat 1.67x absorbed (Li et al. 2018).
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
  it('Jupiter flattening from 0.7 q is within 8% of the observed 0.065', () => {
    expect(m.flattening).toBeGreaterThan(0.06);
    expect(m.flattening).toBeLessThan(0.07);
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
    // C ring inner 74,658 km = 1.239 R_S, B outer 117,580 km = 1.951 R_S, A inner 2.027 R_S.
    expect(ringAt(1.3).opacity).toBeLessThan(0.2); // C ring is thin
    expect(ringAt(1.7).opacity).toBeGreaterThan(0.8); // B ring is dense
    expect(ringAt(1.99).opacity).toBeLessThan(0.1); // Cassini Division
    expect(ringAt(2.1).opacity).toBeGreaterThan(0.5); // A ring
    expect(ringAt(2.5).opacity).toBe(0);
    expect(ringAt(1.05).opacity).toBe(0);
  });
  it('the Encke Gap is empty', () => {
    expect(ringAt(133589 / SATURN_RADIUS_KM).opacity).toBe(0);
    expect(ringAt(2.15).opacity).toBeGreaterThan(0.5);
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
