// A7 physics layer: known values (testing.md "Physics functions"), provenance, refusal, and
// D-02 / D-26 / D-27 slider rules. Card objects here are test inputs, not physical claims.
import { describe, expect, it } from 'vitest';
import { assertTagged, OBJECT_TYPES, type ObjectCard, type ObjectType, type TV } from '@/contract';
import { minElongation, spinLimitH } from './asteroids';
import { spectralLetterFromTeff } from './brownDwarfs';
import { AMU_KG, E51_J, PC_M, YEAR_S } from './constants';
import { bandCount, flattening, mearthToKg, rhinesLengthM, spinRateRadS } from './gasGiants';
import {
  BAKED_SLIDER_GROUPS,
  derivePhysics,
  isValidOverride,
  selectPhysics,
  SHADER_KINDS,
  SLIDER_REGISTRY,
  slidersFor,
  type Overrides,
} from './index';
import {
  bulkDensityGcm3,
  equilibriumTempK,
  escapeSpeedMs,
  rjupToRearth,
  surfaceGravityMs2,
  thermalSpeedMs,
} from './planets';
import { sedovRadiusPc } from './snr';

/** A7.5 SI form `R = 1.15 * (E t^2 / rho)^(1/5)`, metres. Test-only cross-check of the typical form. */
const sedovRadiusM = (energyJ: number, ageS: number, densityKgM3: number): number =>
  1.15 * Math.pow((energyJ * ageS ** 2) / densityKgM3, 1 / 5);
import { R_EARTH_M, R_JUP_M } from './constants';

const CARDS = import.meta.glob<ObjectCard>('../../../shared/fixtures/cards/*.json', {
  eager: true,
  import: 'default',
});

/** A fresh copy of the shared fixture card for `type` (D-29: build against fixtures). */
const fixture = (type: ObjectType): ObjectCard => {
  const card = CARDS[`../../../shared/fixtures/cards/${type}.json`];
  if (!card) throw new Error(`no fixture card for ${type}`);
  return structuredClone(card);
};

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
};

const tvNum = (v: TV<number | boolean | string> | undefined): number => {
  expect(v).toBeDefined();
  return v!.value as number;
};

// ---- Known values -----------------------------------------------------------------------------

describe('A7.2 Jupiter band count', () => {
  it('gives about 22 bands for the spec inputs (Omega 1.76e-4 /s, R 7e7 m, U 50 m/s)', () => {
    const n = bandCount(1.76e-4, 7e7, 50)!;
    expect(n).toBeCloseTo(22.2, 1);
    expect(Math.round(n)).toBe(22);
  });

  it('Rhines length is pi sqrt(U / beta), about 9,900 km for Jupiter', () => {
    expect(rhinesLengthM(1.76e-4, 7e7, 50)! / 1000).toBeCloseTo(9906, -1);
  });

  it('Jupiter flattening from f = 0.7 q is close to the observed 0.065', () => {
    const omega = spinRateRadS(9.925)!; // System III period
    expect(omega).toBeCloseTo(1.7585e-4, 7);
    const f = flattening(omega, R_JUP_M, mearthToKg(317.83))!;
    expect(f).toBeGreaterThan(0.06);
    expect(f).toBeLessThan(0.065);
  });

  it('derivePhysics gives a tagged band count for a Jupiter-like gas giant card', () => {
    const card = fixture('gas_giant'); // radius 1 R_J
    const res = derivePhysics(card, { rot_period_h: 9.9, zonal_wind_ms: 50, mass_mearth: 317.83 });
    const n = res.values.band_count!;
    expect(Math.round(n.value as number)).toBe(22); // R = 7.1492e7 m, P = 9.9 h: about 22.4
    expect(n.tag).toBe('derived');
    expect(n.formula).toMatch(/sqrt\(2 Omega R \/ U\)/);
    expect(res.values.flattening).toBeDefined();
  });
});

describe('A7.5 Sedov radius', () => {
  it('typical form gives 12.4 pc for E51 = 1, n = 1 cm^-3, t = 10^4 yr', () => {
    expect(sedovRadiusPc(1, 1, 1e4)).toBeCloseTo(12.4, 10);
  });

  it('scales as t^(2/5) and (E/n)^(1/5)', () => {
    expect(sedovRadiusPc(1, 1, 1e5)! / sedovRadiusPc(1, 1, 1e4)!).toBeCloseTo(10 ** 0.4, 10);
    expect(sedovRadiusPc(32, 1, 1e4)!).toBeCloseTo(24.8, 10);
  });

  it('SI form R = 1.15 (E t^2 / rho)^(1/5) agrees with the typical form within 2%', () => {
    // Test data: rho = 1.4 m_H n for n = 1 cm^-3 (cosmic mix). Not used by the app.
    const rho = 1.4 * 1.00784 * AMU_KG * 1e6;
    const r = sedovRadiusM(E51_J, 1e4 * YEAR_S, rho) / PC_M;
    expect(Math.abs(r / 12.4 - 1)).toBeLessThan(0.02);
    expect(PC_M).toBeCloseTo(3.0857e16, -12);
  });

  it('nova body: tagged artistic (D-12), formula kept; refused without its sliders', () => {
    const card = fixture('nova');
    const res = derivePhysics(card, { age_yr: 1e4, energy_e51: 1, ambient_density_cm3: 1 });
    expect(res.values.sedov_radius_pc!.value).toBeCloseTo(12.4, 10);
    expect(res.values.sedov_radius_pc!.tag).toBe('artistic');
    expect(res.values.sedov_radius_pc!.formula).toMatch(/12\.4 pc/);

    const bare = derivePhysics(card, {});
    expect(bare.values.sedov_radius_pc).toBeUndefined();
    expect(bare.missing).toEqual(['sedov_radius_pc']);
    expect(bare.needs.sedov_radius_pc).toEqual(['age_yr', 'energy_e51', 'ambient_density_cm3']);
  });
});

describe('A7.4 rubble-pile spin limit', () => {
  it('is about 2.3 h for rho = 2000 kg/m^3', () => {
    expect(spinLimitH(2000)!).toBeCloseTo(2.334, 2);
  });

  it('scales as rho^(-1/2)', () => {
    expect(spinLimitH(500)! / spinLimitH(2000)!).toBeCloseTo(2, 10);
  });

  it('flags a body spinning faster than the barrier', () => {
    const card = fixture('asteroid_procedural'); // rot_period_h 5 on the card
    const slow = derivePhysics(card, { bulk_density_kg_m3: 2000 });
    expect(tvNum(slow.values.spin_limit_h)).toBeCloseTo(2.334, 2);
    expect(slow.values.faster_than_spin_limit!.value).toBe(false);
    const fast = derivePhysics(card, { bulk_density_kg_m3: 2000, rot_period_h: 1 });
    expect(fast.values.faster_than_spin_limit!.value).toBe(true);
  });

  it('is refused, not defaulted, when no density is set', () => {
    const res = derivePhysics(fixture('asteroid_shape'), {});
    expect(res.values.spin_limit_h).toBeUndefined();
    expect(res.missing).toContain('spin_limit_h');
    expect(res.needs.spin_limit_h).toEqual(['bulk_density_kg_m3']);
  });

  it('names every missing input when neither density nor period is set', () => {
    const card = fixture('asteroid_shape');
    const noPeriod: ObjectCard = { ...card, rot_period_h: undefined };
    const res = derivePhysics(noPeriod, {});
    expect(res.needs.faster_than_spin_limit).toEqual(['bulk_density_kg_m3', 'rot_period_h']);
    const withRho = derivePhysics(noPeriod, { bulk_density_kg_m3: 2000 });
    expect(withRho.values.spin_limit_h).toBeDefined();
    expect(withRho.needs.faster_than_spin_limit).toEqual(['rot_period_h']);
  });

  it('elongation lower limit a/b = 10^(dm / 2.5)', () => {
    expect(minElongation(0.5)!).toBeCloseTo(10 ** 0.2, 10);
    const res = derivePhysics(fixture('asteroid_procedural'), {});
    expect(tvNum(res.values.elongation_min)).toBeCloseTo(1.585, 3);
    // asteroid_shape fixture has no amplitude
    expect(derivePhysics(fixture('asteroid_shape'), {}).missing).toContain('elongation_min');
  });
});

describe('A7.1 planets', () => {
  it('Earth: Teq about 254 K, rho 5.51, g 9.8 m/s^2, v_esc 11.2 km/s', () => {
    expect(equilibriumTempK(5772, 1, 1, 0.306)!).toBeCloseTo(254, 0);
    expect(bulkDensityGcm3(1, 1)).toBe(5.51);
    expect(surfaceGravityMs2(1, R_EARTH_M)!).toBeCloseTo(9.8, 1);
    expect(escapeSpeedMs(1, R_EARTH_M)! / 1000).toBeCloseTo(11.18, 2);
    expect(rjupToRearth(1)).toBeCloseTo(11.209, 3);
  });

  it('thermal speed sqrt(2kT/m): H2 at 300 K is about 1.57 km/s', () => {
    expect(thermalSpeedMs(300, 2.016)! / 1000).toBeCloseTo(1.573, 2);
  });

  it('atmosphere rule: Earth mass and size keep N2 and CO2, lose H2 at 1,000 K (model_dependent)', () => {
    const card: ObjectCard = { id: 't', name: 't', type: 'planet_rocky' };
    const earth = { radius_rjup: R_EARTH_M / R_JUP_M, mass_mearth: 1 };
    const hot = derivePhysics(card, { ...earth, teq_K: 1000 });
    expect(hot.values.keeps_N2!.value).toBe(true);
    expect(hot.values.keeps_CO2!.value).toBe(true);
    expect(hot.values.keeps_H2!.value).toBe(false); // 6 * 2.87 km/s > 11.2 km/s
    expect(hot.values.keeps_N2!.tag).toBe('model_dependent');
    expect(hot.values.keeps_N2!.assumption).toMatch(/T = Teq/);
    expect(hot.values.lava_glow!.value).toBe(true);

    // At Teq = 255 K the rule (with T = Teq) keeps even H2: that is why it is model_dependent.
    const cool = derivePhysics(card, { ...earth, teq_K: 255 });
    expect(cool.values.keeps_H2!.value).toBe(true);
    expect(cool.values.polar_ice!.value).toBe(true);
    expect(cool.values.oceans!.value).toBe(true);
    expect(cool.values.lava_glow!.value).toBe(false);
  });

  it('computes Teq from the star sliders when all four are set', () => {
    const card = fixture('planet_rocky'); // teq_K value null on the card
    const res = derivePhysics(card, {
      star_teff_K: 5772,
      star_radius_rsun: 1,
      semi_major_axis_au: 1,
      bond_albedo: 0.306,
    });
    expect(tvNum(res.values.teq_K)).toBeCloseTo(254, 0);
    expect(res.values.teq_K!.tag).toBe('derived');
  });

  it('refuses mass-based values when no mass is set (the card has no mass field)', () => {
    const res = derivePhysics(fixture('planet_water'), {});
    expect(res.missing).toEqual(
      expect.arrayContaining(['density_g_cm3', 'gravity_m_s2', 'escape_speed_km_s', 'keeps_H2']),
    );
    expect(res.needs.density_g_cm3).toEqual(['mass_mearth']);
    // Teq 300 K on the card still drives the surface thresholds.
    expect(res.values.polar_ice!.value).toBe(true);
  });

  it('a null teq_K on the card refuses the surface thresholds without crashing', () => {
    const res = derivePhysics(fixture('planet_rocky'), {});
    expect(res.missing).toEqual(expect.arrayContaining(['polar_ice', 'oceans', 'lava_glow']));
  });

  it('a non-physical card Teq (<= 0 K) is refused, not turned into surface flags', () => {
    const card = fixture('gas_giant');
    const bad: ObjectCard = { ...card, type: 'planet_rocky', teq_K: { ...card.teq_K!, value: -5 } };
    const res = derivePhysics(bad, {});
    expect(res.values.polar_ice).toBeUndefined();
    expect(res.values.oceans).toBeUndefined();
    expect(res.needs.polar_ice).toEqual(['teq_K']);
  });

  it('only some star sliders set: Teq falls back to the card and teq_from_star names the rest', () => {
    const card = fixture('gas_giant'); // teq_K 100 on the card
    const res = derivePhysics(card, { star_teff_K: 6000 });
    expect(res.missing).toContain('teq_from_star');
    expect(res.needs.teq_from_star).toEqual([
      'star_radius_rsun',
      'semi_major_axis_au',
      'bond_albedo',
    ]);
    expect(res.values.teq_K).toBeUndefined();
  });

  it('a teq_K slider shadows the star sliders, which are reported as ignored', () => {
    const res = derivePhysics(fixture('gas_giant'), {
      teq_K: 500,
      star_teff_K: 6000,
      bond_albedo: 0.3,
    });
    expect(res.ignored).toEqual(['star_teff_K', 'bond_albedo']);
    expect(res.missing).not.toContain('teq_from_star');
  });

  it('an unusable input (radius 0) refuses the quantities instead of dropping them', () => {
    const card = fixture('gas_giant');
    const zero: ObjectCard = { ...card, radius_rjup: { ...card.radius_rjup!, value: 0 } };
    const res = derivePhysics(zero, { mass_mearth: 300, rot_period_h: 10, zonal_wind_ms: 50 });
    for (const id of [
      'density_g_cm3',
      'gravity_m_s2',
      'escape_speed_km_s',
      'keeps_H2',
      'band_count',
      'rhines_length_km',
      'flattening',
    ]) {
      expect(res.values[id], id).toBeUndefined();
      expect(res.missing, id).toContain(id);
    }
    expect(res.needs.density_g_cm3).toEqual(['mass_mearth', 'radius_rjup']);
  });
});

describe('A7.3 brown dwarfs', () => {
  it('L / T / Y boundaries', () => {
    expect(spectralLetterFromTeff(2000)).toBe('L');
    expect(spectralLetterFromTeff(1400)).toBe('T');
    expect(spectralLetterFromTeff(500)).toBe('T');
    expect(spectralLetterFromTeff(300)).toBe('Y');
    expect(spectralLetterFromTeff(Number.NaN)).toBeNull();
  });

  it('no teff_K on the card: refused; card radius present: no radius rule', () => {
    const res = derivePhysics(fixture('brown_dwarf'), {});
    expect(res.missing).toEqual(['spectral_letter']);
    expect(res.values.radius_rjup).toBeUndefined();
  });

  it('card without a radius gets the ~1 R_J rule as model_dependent', () => {
    const card: ObjectCard = {
      id: 't',
      name: 't',
      type: 'brown_dwarf',
      teff_K: { value: 800, tag: 'measured', source: 'test input' },
    };
    const res = derivePhysics(card, {});
    expect(res.values.spectral_letter!.value).toBe('T');
    expect(res.values.spectral_letter!.tag).toBe('derived');
    expect(res.values.radius_rjup!.value).toBe(1);
    expect(res.values.radius_rjup!.tag).toBe('model_dependent');
  });
});

// ---- Provenance, purity, determinism ------------------------------------------------------

const RICH: Partial<Record<ObjectType, Overrides>> = {
  planet_rocky: { teq_K: 800, mass_mearth: 2, radius_rjup: 0.12 },
  planet_water: { mass_mearth: 3 },
  gas_giant: { rot_period_h: 10, zonal_wind_ms: 50, mass_mearth: 300 },
  asteroid_procedural: { bulk_density_kg_m3: 1500 },
  asteroid_shape: { bulk_density_kg_m3: 2500, rot_period_h: 2 },
  nova: { age_yr: 500, energy_e51: 1, ambient_density_cm3: 1 },
};

describe('physics results', () => {
  it.each(OBJECT_TYPES)('%s: every value passes assertTagged, no crash on the fixture', (type) => {
    const res = derivePhysics(fixture(type), RICH[type] ?? {});
    for (const [id, tv] of Object.entries(res.values)) {
      expect(() => assertTagged(tv, id)).not.toThrow();
      expect(tv.formula, id).toBeTruthy();
      expect(tv.source).toMatch(/^physics layer A7\./);
    }
    expect(res.ignored).toEqual([]);
  });

  it('never mutates the card or the overrides (D-02)', () => {
    for (const type of OBJECT_TYPES) {
      const card = deepFreeze(fixture(type));
      const before = JSON.stringify(card);
      const o = deepFreeze({ ...(RICH[type] ?? {}) });
      expect(() => derivePhysics(card, o)).not.toThrow();
      expect(JSON.stringify(card)).toBe(before);
    }
  });

  it('is deterministic: same card and overrides give identical output', () => {
    const card = fixture('gas_giant');
    const o = RICH.gas_giant!;
    expect(JSON.stringify(derivePhysics(card, o))).toBe(JSON.stringify(derivePhysics(card, o)));
  });

  it('a slider value wins over the card, and clearing overrides restores the card value', () => {
    const card = fixture('gas_giant'); // radius_rjup 1 (card)
    const o = { rot_period_h: 10, zonal_wind_ms: 50 };
    const base = tvNum(derivePhysics(card, o).values.band_count);
    const edited = tvNum(derivePhysics(card, { ...o, radius_rjup: 2 }).values.band_count);
    expect(edited / base).toBeCloseTo(Math.SQRT2, 10);
    expect(derivePhysics(card, o).values.band_count!.source).toMatch(
      /radius_rjup \(card, measured\)/,
    );
    expect(card.radius_rjup!.value).toBe(1);
  });

  it('ignores out-of-range or inapplicable overrides, never clamps them', () => {
    const card = fixture('gas_giant');
    const res = derivePhysics(card, { rot_period_h: 10, zonal_wind_ms: 5000, radius_rjup: 1 });
    expect(res.ignored).toEqual(['zonal_wind_ms']);
    expect(res.missing).toContain('band_count');
    // bulk density does not apply to gas giants
    expect(derivePhysics(card, { bulk_density_kg_m3: 2000 }).ignored).toEqual([]);
    expect(isValidOverride('gas_giant', 'bulk_density_kg_m3', 2000)).toBe(false);
    expect(isValidOverride('asteroid_shape', 'bulk_density_kg_m3', Number.NaN)).toBe(false);
  });

  it('reports an invalid override even when no A7 rule reads it (viewer-only spin)', () => {
    const res = derivePhysics(fixture('brown_dwarf'), { rot_period_h: 5000 });
    expect(res.ignored).toEqual(['rot_period_h']);
  });

  it('selectPhysics returns null without a card', () => {
    expect(selectPhysics({ card: null, overrides: {} })).toBeNull();
    expect(selectPhysics({ card: fixture('star'), overrides: {} })).toEqual({
      values: {},
      missing: [],
      needs: {},
      ignored: [],
    });
  });
});

// ---- Slider registry (D-26, D-27) ---------------------------------------------------------

describe('slider registry', () => {
  it('keys are unique and every range is sane', () => {
    const keys = SLIDER_REGISTRY.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of SLIDER_REGISTRY) {
      expect(s.min, s.key).toBeLessThan(s.max);
      expect(s.step, s.key).toBeGreaterThan(0);
      expect(s.appliesTo.length, s.key).toBeGreaterThan(0);
    }
  });

  it('D-26: baked types only get colour, lighting and spin sliders', () => {
    for (const type of OBJECT_TYPES) {
      if (SHADER_KINDS.includes(type)) continue;
      for (const s of slidersFor(type))
        expect(BAKED_SLIDER_GROUPS, `${type}/${s.key}`).toContain(s.group);
    }
  });

  it('D-27: unknown slider keys fail the type check', () => {
    const ok: Overrides = { rot_period_h: 5 };
    // @ts-expect-error -- "albedo" is not a registered slider key
    const bad: Overrides = { albedo: 0.5 };
    expect(ok).toBeDefined();
    expect(bad).toBeDefined();
  });
});
