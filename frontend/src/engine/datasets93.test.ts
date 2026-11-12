// Issue #93 section 5 A-C: the new card fields reach the engines' inputs (eccentricity, host luminosity,
// insolation, star luminosity and mass, flare rate) and the phase-curve values show as readouts.
import { describe, expect, it } from 'vitest';
import type { ObjectCard, RenderParams } from '@/contract';
import { cardToWorld, measuredReadouts } from './worlds/cardToWorld';
import { cardToStar } from './stars/cardToStar';
import { resolveRate } from '@/viewer/motion/motion';

type T = 'measured' | 'derived' | 'model_dependent';
const tv = (value: number | null, tag: T = 'measured', err?: number) => ({
  value,
  tag,
  source: 'test source, 4.5 um',
  ...(err !== undefined ? { err } : {}),
  ...(tag === 'derived' ? { formula: 'f' } : {}),
  ...(tag === 'model_dependent' ? { assumption: 'a' } : {}),
});
const card = (o: Record<string, unknown>) => o as unknown as ObjectCard;

// WASP-39 b as served (archive values, 11 Nov 2026), on the generic path (no artifact preset).
const WASP = {
  id: 'simbad-wasp-39b',
  name: 'WASP-39 b',
  type: 'gas_giant',
  host_teff_K: tv(5485),
  host_radius_rsun: tv(0.932),
  host_mass_msun: tv(0.913),
  mass_mearth: tv(89.0),
  orbit_au: tv(0.04828),
  orbital_period_d: tv(4.055),
  radius_rjup: tv(1.27),
};

describe('cardToWorld (issue #93)', () => {
  it('passes a measured eccentricity to the engine, tagged with the card tag', () => {
    const w = cardToWorld(card({ ...WASP, orbit_ecc: tv(0.05, 'measured', 0.03) }));
    if (!w.ok) throw new Error('refused');
    expect(w.preset.ob?.e).toBe(0.05);
    expect(w.tags['ob.e']).toBe('measured');
    expect(w.assumptions.some((a) => a.field === 'ob.e')).toBe(false);
  });

  it('keeps the circular default when the card has no eccentricity', () => {
    const w = cardToWorld(card({ ...WASP, orbit_ecc: tv(null) }));
    if (!w.ok) throw new Error('refused');
    expect(w.preset.ob?.e).toBe(0);
    expect(w.assumptions.some((a) => a.field === 'ob.e')).toBe(true);
  });

  it('sets the starlight from a measured host luminosity (R = sqrt(L) (5772/T)^2)', () => {
    const w = cardToWorld(card({ ...WASP, host_lum_lsun: tv(0.7449) }));
    if (!w.ok) throw new Error('refused');
    expect(w.preset.Rs).toBeCloseTo(Math.sqrt(0.7449) * Math.pow(5772 / 5485, 2), 10);
    expect(w.tags.Rs).toBe('derived');
    // sigma T^4 R^2 in solar units gives back the luminosity.
    expect(w.preset.Rs ** 2 * (5485 / 5772) ** 4).toBeCloseTo(0.7449, 10);
  });

  it('falls back to the insolation, then to the card radius', () => {
    const s = cardToWorld(card({ ...WASP, insolation_searth: tv(316.269, 'derived') }));
    if (!s.ok) throw new Error('refused');
    expect(s.preset.Rs).toBeCloseTo(Math.sqrt(316.269 * 0.04828 ** 2) * (5772 / 5485) ** 2, 10);
    const r = cardToWorld(card(WASP));
    if (!r.ok) throw new Error('refused');
    expect(r.preset.Rs).toBe(0.932);
  });

  it('prefers the insolation over L / a^2 and lists a disagreement over 5 % (#93 A5)', () => {
    const both = { ...WASP, insolation_searth: tv(316.269, 'derived'), host_lum_lsun: tv(0.7449) };
    const w = cardToWorld(card(both));
    if (!w.ok) throw new Error('refused');
    expect(w.preset.Rs).toBeCloseTo(Math.sqrt(316.269 * 0.04828 ** 2) * (5772 / 5485) ** 2, 10);
    // 0.7449 / 0.04828^2 = 319.6 S_earth: within 5 %, no line.
    expect(w.mismatches).toEqual([]);
    const off = cardToWorld(card({ ...both, host_lum_lsun: tv(0.9) }));
    if (!off.ok) throw new Error('refused');
    expect(off.preset.Rs).toBeCloseTo(w.preset.Rs, 12);
    expect(off.mismatches).toHaveLength(1);
    expect(off.mismatches[0]).toMatch(
      /insolation_searth = 316\.3 .*host_lum_lsun \/ orbit_au\^2 = 386\.1/,
    );
  });

  it('lists a model-dependent eccentricity (an archive limit) among the filled-in values (#93 A6)', () => {
    const lim = {
      ...tv(0.0063, 'model_dependent'),
      assumption: 'archive limit flag: an upper or lower limit, not a measured value',
    };
    const w = cardToWorld(card({ ...WASP, orbit_ecc: lim }));
    if (!w.ok) throw new Error('refused');
    expect(w.preset.ob?.e).toBe(0.0063);
    expect(w.tags['ob.e']).toBe('model_dependent');
    const a = w.assumptions.find((x) => x.field === 'ob.e');
    expect(a?.tag).toBe('model_dependent');
    expect(a?.note).toMatch(/archive limit flag/);
  });

  it('a model-dependent luminosity makes the radius model-dependent too (D-32)', () => {
    const w = cardToWorld(card({ ...WASP, host_lum_lsun: tv(0.7, 'model_dependent') }));
    if (!w.ok) throw new Error('refused');
    expect(w.tags.Rs).toBe('model_dependent');
  });

  it('shows day, night and hotspot values as readouts with their band, and skips nulls', () => {
    const c = card({
      ...WASP,
      dayside_temp_K: tv(1192, 'measured', 9),
      nightside_temp_K: tv(null),
      hotspot_offset_deg: tv(20.1, 'derived', 5.5),
    });
    const rows = measuredReadouts(c);
    expect(rows.map((r) => r.field)).toEqual(['dayside_temp_K', 'hotspot_offset_deg']);
    expect(rows[0]!.label).toBe('Day side (brightness temperature)');
    expect(rows[0]!.value).toBe('1192 ± 9 K at 4.5 µm');
    expect(rows[1]!.label).toBe('Hottest point');
    expect(rows[1]!.value).toBe('20.1 ± 5.5° east of noon at 4.5 µm');
    expect(rows.map((r) => r.tag)).toEqual(['measured', 'derived']);
    // The tag badge says how a value is known; the label never claims it (#93 A10).
    expect(rows.some((r) => /measured/i.test(r.label))).toBe(false);
    const w = cardToWorld(c);
    if (!w.ok) throw new Error('refused');
    expect(w.measured).toHaveLength(2);
  });

  it("labels 55 Cnc e's dayside as the hot-spot hemisphere, from its registry note (#93 A10)", () => {
    const day = {
      ...tv(2700, 'measured', 270),
      source:
        'literature: Demory et al. 2016, Abstract: warmest hemisphere 2700 +/- 270 K at 4.5 um. This is the hot-spot hemisphere (the hemisphere centred on the hot spot)',
    };
    const night = { ...tv(1380, 'measured', 400), source: 'literature: Demory et al. 2016' };
    const rows = measuredReadouts(card({ ...WASP, dayside_temp_K: day, nightside_temp_K: night }));
    expect(rows[0]!.label).toBe('Hot-spot hemisphere (brightness temperature)');
    expect(rows[0]!.value).toBe('2700 ± 270 K at 4.5 µm');
    expect(rows[1]!.label).toBe('Night side (brightness temperature)');
    expect(rows[1]!.value).toBe('1380 ± 400 K'); // no band in the source: none invented
  });
});

describe('cardToStar (issue #93)', () => {
  const EPS = {
    id: 'simbad-eps-eri',
    name: 'eps Eri',
    type: 'star',
    teff_K: tv(5076, 'derived'),
    radius_rsun: tv(0.7761, 'model_dependent'),
  };
  it("uses the card's FLAME mass when present", () => {
    const s = cardToStar(card({ ...EPS, mass_msun: tv(0.8112, 'model_dependent') }));
    if (!s.ok) throw new Error('refused');
    expect(s.mass.value).toBe(0.8112);
    expect(s.preset.M).toBe(0.8112);
  });
  it('the FLAME luminosity is not an engine input: the turnover time uses R and T (#93 A9)', () => {
    const a = cardToStar(card(EPS));
    const b = cardToStar(card({ ...EPS, lum_lsun: tv(0.34, 'model_dependent') }));
    if (!a.ok || !b.ok) throw new Error('refused');
    expect(b.preset).toEqual(a.preset);
    expect('luminosity' in b).toBe(false);
  });
  it('uses a measured rotation period from the card', () => {
    const s = cardToStar(card({ ...EPS, rot_period_h: tv(278.88, 'measured', 3.6) }));
    if (!s.ok) throw new Error('refused');
    expect(s.rotation).toMatchObject({ value: 11.62, tag: 'measured' });
  });
});

describe('flare rate from the card (issue #93)', () => {
  const params = { type: 'star', dynamics: {} } as unknown as RenderParams;
  it('a measured card flare rate answers rung 1', () => {
    const r = resolveRate(
      'flare_rate_per_d',
      card({ id: 'x', name: 'x', type: 'star', flare_rate_per_d: tv(0.26) }),
      params,
    );
    expect(r).toMatchObject({ value: 0.26, tag: 'measured', tier: 1, via: 'card' });
  });
  it('a null card value answers nothing', () => {
    const r = resolveRate(
      'flare_rate_per_d',
      card({ id: 'x', name: 'x', type: 'star', flare_rate_per_d: tv(null) }),
      params,
    );
    expect(r).toBeNull();
  });
});
