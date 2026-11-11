// Issue #71 stream C: the star surface physics against known answers (the Sun, an M dwarf, a giant,
// a hot star), determinism, refusals, and the spot-group interface stream G builds on.
import { describe, expect, it } from 'vitest';
import {
  AREA_SPLIT,
  GROUP_AREA_MEAN,
  MAX_GROUPS_DRAWN,
  RO_SATURATION,
  SUN_COVERAGE,
  beltLatitude,
  cellsForScale,
  convectionFraction,
  luminosityLsun,
  turnoverTimeDays,
  discRadiusFromArea,
  granuleVisibility,
  meanFieldG,
  starCaption,
  starReadouts,
  massFromTeff,
  radiusFromTeff,
  sunRossby,
  stellarModel,
  type StellarInput,
  type StellarModel,
} from './stellar';

const SUN: StellarInput = {
  teffK: 5772,
  radiusRsun: 1,
  massMsun: 1,
  rotationPeriodD: 25.4,
  seed: 5,
};
const model = (i: StellarInput): StellarModel => {
  const r = stellarModel(i);
  if (!r.model) throw new Error(`refused: ${r.missing.join(',')}`);
  return r.model;
};
const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

describe('the Sun', () => {
  const m = model(SUN);
  it('gravity, scale height and cell size', () => {
    expect(m.gravityMS2).toBeCloseTo(274, 0); // known: 274 m/s^2
    expect(m.logg).toBeCloseTo(4.44, 1); // known: log g = 4.438
    expect(m.scaleHeightKm).toBeGreaterThan(110); // photospheric H is about 120 to 150 km
    expect(m.scaleHeightKm).toBeLessThan(160);
    expect(m.cellSizeKm).toBeCloseTo(8 * m.scaleHeightKm, 6);
    expect(m.cellSizeKm).toBeGreaterThan(900); // granules are about 1000 km
    expect(m.cellSizeKm).toBeLessThan(1300);
    expect(m.cellsPerRadius).toBeGreaterThan(500);
  });
  it('Rossby number, field and coverage', () => {
    // #93 3.4: Reiners et al. 2022 define tau_c = 12.3 d (L/Lsun)^-1/2; the Sun (L = 1) has 12.3 d.
    expect(turnoverTimeDays(1, 5772)).toBeCloseTo(12.3, 9);
    expect(m.rossby).toBeCloseTo(25.4 / 12.3, 6);
    expect(m.fieldG).toBeGreaterThan(70); // 199 Ro^-1.26 at Ro 2.07: about 80 G
    expect(m.fieldG).toBeLessThan(90);
    expect(m.coverage).toBeCloseTo(SUN_COVERAGE, 6); // the anchor
    expect(m.nGroupsReal).toBeCloseTo(SUN_COVERAGE / GROUP_AREA_MEAN, 6);
  });
  it('is tagged, and a derived value has a formula, a model_dependent value an assumption', () => {
    for (const [k, t] of Object.entries(m.tags)) {
      if (t.tag === 'derived') expect(t.formula, k).toBeTruthy();
      if (t.tag === 'model_dependent') expect(t.assumption, k).toBeTruthy();
    }
    expect(m.tags.coverage!.tag).toBe('inferred_from_analog');
    expect(m.tags.coverage!.assumption).toMatch(/PLACEHOLDER/);
  });
});

describe('#93 3.4 turnover time (Reiners et al. 2022)', () => {
  it('Barnard’s Star (0.1867 Rsun, 3195 K; about 0.0035 Lsun) has tau_c near 208 d', () => {
    // Known answer (issue #93): 208 d with the Reiners law against 101 d with the Wright et al. 2011 mass fit.
    const L = luminosityLsun(0.1867, 3195);
    expect(L).toBeGreaterThan(0.003);
    expect(L).toBeLessThan(0.0037);
    const tau = turnoverTimeDays(0.1867, 3195);
    expect(tau).toBeGreaterThan(200);
    expect(tau).toBeLessThan(216);
  });
  it('scales as L^-1/2', () => {
    expect(turnoverTimeDays(2, 5772) / turnoverTimeDays(1, 5772)).toBeCloseTo(0.5, 9);
  });
});

describe('field law', () => {
  it('is continuous at saturation and falls with Rossby number', () => {
    const lo = meanFieldG(RO_SATURATION * 0.999);
    const hi = meanFieldG(RO_SATURATION * 1.001);
    expect(Math.abs(lo - hi) / lo).toBeLessThan(0.02);
    expect(meanFieldG(1)).toBeCloseTo(199, 6);
    expect(meanFieldG(0.01)).toBeLessThan(meanFieldG(0.05) * 1.2); // flat when saturated
    expect(meanFieldG(2)).toBeLessThan(meanFieldG(1));
  });
});

describe('other stars', () => {
  it('a fast M dwarf has a strong field, big coverage and huge cells for its size', () => {
    const m = model({ teffK: 3200, radiusRsun: 0.19, massMsun: 0.16, rotationPeriodD: 1, seed: 1 });
    expect(m.gravityMS2).toBeGreaterThan(1000);
    expect(m.fieldG!).toBeGreaterThan(1500);
    expect(m.coverage).toBeGreaterThan(0.01);
    expect(m.coverage).toBeLessThanOrEqual(0.25);
    expect(m.groups.length).toBe(MAX_GROUPS_DRAWN);
    expect(m.nGroupsReal).toBeGreaterThan(MAX_GROUPS_DRAWN);
  });
  it('a hot star has no convection, no field, no spots, and says so', () => {
    const m = model({ teffK: 9000, radiusRsun: 1.8, massMsun: 2, rotationPeriodD: 1.5, seed: 1 });
    expect(convectionFraction(9000)).toBe(0);
    expect(m.convection).toBe(0);
    expect(m.fieldG).toBeNull();
    expect(m.groups).toEqual([]);
    expect(starReadouts(m).some((r) => r.label === 'Boiling cells')).toBe(true);
    expect(starCaption(m, 'enlarged')).toMatch(/no boiling cells/);
  });
  it('a red giant has a few huge cells and no spots', () => {
    const m = model({ teffK: 3050, radiusRsun: 300, massMsun: 1, rotationPeriodD: 400, seed: 1 });
    expect(m.dwarf).toBe(false);
    expect(m.cellsPerRadius).toBeLessThan(10);
    expect(m.cellsPerRadius).toBeGreaterThan(1);
    expect(m.cellSizeKm).toBeGreaterThan(1e7);
    expect(m.groups).toEqual([]);
    expect(m.notes.join(' ')).toMatch(/dwarf/);
  });
  it('convection fades smoothly between 6500 and 8200 K', () => {
    expect(convectionFraction(6000)).toBe(1);
    const mid = convectionFraction(7350);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });
});

describe('refusals and the tier chain', () => {
  it('only a missing Teff refuses', () => {
    expect(stellarModel({ ...SUN, teffK: 0 })).toEqual({ model: null, missing: ['teff_K'] });
    expect(stellarModel({ ...SUN, teffK: NaN })).toMatchObject({ missing: ['teff_K'] });
  });
  it('a card with everything assumes nothing', () => {
    expect(model(SUN).assumed).toEqual({});
  });
  it('a missing mass comes from the radius, else from Teff, tagged model_dependent', () => {
    const fromR = model({ ...SUN, massMsun: null, radiusRsun: 0.2022, teffK: 3243 });
    expect(fromR.massMsun).toBeGreaterThan(0.15);
    expect(fromR.massMsun).toBeLessThan(0.19);
    expect(fromR.assumed.mass).toMatch(/from the radius/);
    expect(fromR.radiusRsun).toBe(0.2022);
    expect(fromR.tags.mass!.tag).toBe('model_dependent');
    expect(fromR.tags.mass!.assumption).toMatch(/radius/);
    const fromT = model({ ...SUN, massMsun: null, radiusRsun: null, teffK: 3885 });
    expect(fromT.assumed.mass).toMatch(/from the temperature/);
    expect(fromT.assumed.radius).toMatch(/not for the size shown/);
    expect(fromT.tags.radius!.tag).toBe('model_dependent');
    expect(fromT.tags.gravity!.tag).toBe('model_dependent');
  });
  it('a giant radius gets no assumed mass', () => {
    expect(stellarModel({ ...SUN, massMsun: null, radiusRsun: 300 })).toMatchObject({
      model: null,
      missing: ['mass_msun'],
    });
  });
  it('a missing rotation assumes the Sun\u2019s Rossby number and tags it inferred_from_analog', () => {
    const m = model({ ...SUN, rotationPeriodD: null });
    expect(m.rossby).toBeCloseTo(sunRossby(), 9);
    expect(m.assumed.rotation).toMatch(/Rossby/);
    expect(m.tags.rossby!.tag).toBe('inferred_from_analog');
    expect(m.tags.field!.tag).toBe('inferred_from_analog');
    expect(m.groups.length).toBeGreaterThan(0);
  });
  it('the main-sequence table is monotone and gives the Sun back', () => {
    expect(massFromTeff(5770)).toBeCloseTo(1, 6);
    expect(radiusFromTeff(5770)).toBeCloseTo(1.012, 6);
    expect(massFromTeff(3000)).toBeLessThan(massFromTeff(4000));
    expect(radiusFromTeff(4000)).toBeLessThan(radiusFromTeff(6000));
  });
});

describe('determinism', () => {
  it('same input gives the same model; another seed gives other groups but the same physics', () => {
    expect(model(SUN)).toEqual(model(SUN));
    const other = model({ ...SUN, seed: 6 });
    expect(other.groups).not.toEqual(model(SUN).groups);
    expect(other.fieldG).toBe(model(SUN).fieldG);
    expect(other.coverage).toBe(model(SUN).coverage);
  });
});

describe('spot groups (the interface for stream G)', () => {
  const m = model({ teffK: 3800, radiusRsun: 0.6, massMsun: 0.6, rotationPeriodD: 10, seed: 9 });
  it('areas add up to the coverage, largest first, split between the spots', () => {
    expect(m.groups.length).toBeGreaterThan(2);
    const total = m.groups.reduce((s, g) => s + g.areaFraction, 0);
    if (m.nGroupsReal <= MAX_GROUPS_DRAWN) expect(total).toBeCloseTo(m.coverage, 9);
    for (let i = 1; i < m.groups.length; i++)
      expect(m.groups[i - 1]!.areaFraction).toBeGreaterThanOrEqual(m.groups[i]!.areaFraction);
    expect(AREA_SPLIT.leader + AREA_SPLIT.follower + 2 * AREA_SPLIT.pore).toBeCloseTo(1, 9);
  });
  it('vectors are unit, the axes are tangent and perpendicular, and the spots are on the sphere', () => {
    for (const g of m.groups) {
      for (const v of [g.centre, g.polarityAxis, g.crossAxis, g.leader.centre, g.follower.centre])
        expect(Math.hypot(...v)).toBeCloseTo(1, 9);
      expect(dot(g.centre, g.polarityAxis)).toBeCloseTo(0, 9);
      expect(dot(g.polarityAxis, g.crossAxis)).toBeCloseTo(0, 9);
      expect(g.separationRad).toBeGreaterThan(0.015);
      expect(Math.acos(dot(g.leader.centre, g.follower.centre))).toBeGreaterThan(0);
    }
  });
  it("Joy's law: the follower is nearer the pole than the leader, in both hemispheres", () => {
    const hemis = new Set<number>();
    for (const g of m.groups) {
      hemis.add(g.hemisphere);
      expect(Math.abs(g.follower.centre[1])).toBeGreaterThan(Math.abs(g.leader.centre[1]));
      expect(Math.sign(g.leader.centre[1])).toBe(g.hemisphere);
    }
    expect(hemis.size).toBe(2);
  });
  it('the leader and follower are 1 separation apart (within the chord approximation)', () => {
    for (const g of m.groups)
      expect(Math.acos(dot(g.leader.centre, g.follower.centre))).toBeCloseTo(g.separationRad, 1);
  });
  it('butterfly: the belt moves towards the equator over the cycle and is wider for active stars', () => {
    expect(beltLatitude(0.0015, 0)).toBeGreaterThan(beltLatitude(0.0015, 1));
    expect(beltLatitude(0.2, 0.5)).toBeGreaterThan(beltLatitude(0.0015, 0.5));
    // The Sun: from about 30 deg at the start of a cycle to about 8 deg at its end.
    expect((beltLatitude(0.0015, 0) * 180) / Math.PI).toBeGreaterThan(20);
    expect((beltLatitude(0.0015, 1) * 180) / Math.PI).toBeLessThan(10);
  });
  it('the number of drawn groups is capped (reduced tier)', () => {
    expect(model({ ...SUN, maxGroups: 4 }).groups).toHaveLength(4);
  });
  it('disc radius from area: a = (1 - cos r) / 2 for small discs', () => {
    const r = discRadiusFromArea(1e-4);
    expect((1 - Math.cos(r)) / 2).toBeCloseTo(1e-4, 7);
  });
});

describe('views', () => {
  const sun = model(SUN);
  it('enlarged cells are artistic only when they are changed', () => {
    expect(cellsForScale(sun, 'enlarged')).toEqual({ cells: 30, artistic: true });
    expect(cellsForScale(sun, 'true')).toEqual({ cells: sun.cellsPerRadius, artistic: false });
    const giant = model({
      teffK: 3050,
      radiusRsun: 300,
      massMsun: 1,
      rotationPeriodD: 400,
      seed: 1,
    });
    expect(cellsForScale(giant, 'enlarged').artistic).toBe(false);
  });
  it('true-scale cells of a dwarf average out on a whole-star view, not in a close-up', () => {
    expect(granuleVisibility(sun.cellsPerRadius)).toBe(0);
    expect(granuleVisibility(30)).toBe(1);
    expect(granuleVisibility(sun.cellsPerRadius, 15 / sun.cellsPerRadius)).toBeGreaterThan(0.99);
  });
  it('readouts are plain words with a tag on every number', () => {
    const rows = starReadouts(sun);
    expect(rows.map((r) => r.label)).toEqual(
      expect.arrayContaining(['Surface gravity', 'Size of one cell', 'Average magnetic field']),
    );
    expect(rows.find((r) => r.label.startsWith('Surface covered'))?.label).toMatch(
      /rough estimate/,
    );
    for (const r of rows) expect(r.tag).not.toBeUndefined();
  });
});
