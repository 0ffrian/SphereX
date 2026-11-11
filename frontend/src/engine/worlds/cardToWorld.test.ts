import { describe, expect, it } from 'vitest';
import type { ObjectCard } from '@/contract';
import { ARTIFACT_PRESETS, cardToWorld, seedFromId } from './cardToWorld';
import { WP } from './presets.js';

const tv = (value: number, tag: 'measured' | 'derived' = 'measured') => ({
  value,
  tag,
  source: 'test',
});
const ts = (value: string) => ({ value, tag: 'measured' as const, source: 'test' });
const card = (o: Record<string, unknown>) => o as unknown as ObjectCard;
const proto = (id: string) => WP.find((p) => p.id === id)!;

// Values as served by the backend for the demo objects (10 Nov 2026).
const T1E = card({
  id: 'simbad-trappist-1e',
  name: 'TRAPPIST-1 e',
  type: 'planet_rocky',
  host_age_gyr: tv(7.6),
  host_mass_msun: tv(0.0898),
  host_radius_rsun: tv(0.1192),
  host_teff_K: tv(2566),
  mass_mearth: tv(0.692),
  orbit_au: tv(0.02925),
  orbital_period_d: tv(6.101013),
  radius_rjup: tv(0.08207751457505734),
});
const TITAN = card({
  id: 'ref-titan',
  name: 'Titan',
  type: 'planet_rocky',
  host_radius_rsun: tv(1),
  host_teff_K: tv(5772),
  mass_mearth: tv(0.02253),
  orbit_au: tv(9.5726),
  radius_rjup: tv(0.03602),
  rot_period_h: tv(382.69, 'derived'),
  surface_fluid: ts('methane'),
  surface_pressure_bar: tv(1.467),
});
const JUP = card({
  id: 'ref-jupiter',
  name: 'Jupiter',
  type: 'gas_giant',
  mass_mearth: tv(317.828),
  orbit_au: tv(5.2038),
  orbital_period_d: tv(4332.589),
  radius_rjup: tv(1),
  rot_period_h: tv(9.925),
});
const K218 = card({
  id: 'simbad-k2-18b',
  name: 'K2-18 b',
  type: 'planet_water',
  host_mass_msun: tv(0.359),
  host_radius_rsun: tv(0.411),
  host_teff_K: tv(3457),
  mass_mearth: tv(8.92),
  orbit_au: tv(0.1429),
  orbital_period_d: tv(32.939623),
  radius_rjup: tv(0.2114388),
});
const OWN = card({
  id: 'user-own-1',
  name: 'My planet',
  type: 'planet_rocky',
  host_mass_msun: tv(0.9),
  host_radius_rsun: tv(0.9),
  host_teff_K: tv(5200),
  host_age_gyr: tv(5),
  mass_mearth: tv(2),
  orbit_au: tv(1.1),
  orbital_period_d: tv(420),
  radius_rjup: tv(0.11),
  rot_period_h: tv(30),
});

describe('cardToWorld: artifact objects reproduce the prototype preset (D-37)', () => {
  it('TRAPPIST-1 e: preset whole, seed 11, card values equal within rounding', () => {
    const r = cardToWorld(T1E);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.artifact).toBe('t1e');
    const p = proto('t1e');
    for (const k of [
      'id',
      'type',
      'Ts',
      'Rs',
      'a',
      'Rj',
      'Me',
      'locked',
      'fluid',
      'Ps',
      'mu',
      'seed',
    ] as const)
      expect(r.preset[k]).toEqual(p[k]);
    expect(r.preset.P).toBeCloseTo(p.P, 2);
    expect(r.preset.seed).toBe(11);
    expect(r.mismatches).toEqual([]);
    expect(r.tags.Ts).toBe('measured');
    expect(r.assumptions.some((a) => a.field === 'mu' && a.tag === 'model_dependent')).toBe(true);
  });
  it('Titan, Jupiter and K2-18 b take the prototype values the card lacks', () => {
    const t = cardToWorld(TITAN);
    const j = cardToWorld(JUP);
    const k = cardToWorld(K218);
    expect(t.ok && j.ok && k.ok).toBe(true);
    if (!t.ok || !j.ok || !k.ok) return;
    expect(t.preset.seed).toBe(83);
    expect(t.preset.A).toBe(0.22);
    expect(t.preset.fluid).toBe('methane');
    expect(j.preset.id).toBe('jup');
    expect(j.preset.pal).toEqual(proto('jup').pal);
    expect(j.preset.rings).toBeUndefined();
    expect(
      cardToWorld(
        card({
          ...JUP,
          id: 'ref-saturn',
          name: 'Saturn',
          orbit_au: tv(9.58),
          radius_rjup: tv(0.843),
          mass_mearth: tv(95.16),
          orbital_period_d: tv(10759),
          rot_period_h: tv(10.66),
        }),
      ),
    ).toMatchObject({ ok: true, preset: { id: 'sat', rings: true, seed: 79 } });
    expect(k.preset).toMatchObject({ Ps: 8, mu: 18, sea: 2, locked: true, seed: 41 });
    expect(k.assumptions.find((a) => a.field === 'Ps')?.note).toMatch(/artifact example setting/);
    // Titan's pressure on the card is 1.467 bar against the prototype's 1.5 (#89 review 10): the preset's 1.5 is the
    // artifact's setting, not the measurement, so it must not carry the measured tag, and the note says what the card says.
    expect(t.preset.Ps).toBe(1.5);
    expect(t.tags.Ps).toBe('inferred_from_analog');
    expect(t.assumptions.find((a) => a.field === 'Ps')?.note).toMatch(/the card says 1\.467/);
    expect(t.mismatches).toEqual([]);
    // Values the preset holds to its own rounding keep the card's tag.
    expect(t.tags.Rj).toBe('measured');
  });
  it("Titan uses one orbit: the heliocentric one (P = Saturn's year), its 15.95-day orbit around Saturn is the spin", () => {
    const t = cardToWorld(TITAN);
    if (!t.ok) throw new Error('refused');
    expect(t.preset.a).toBe(9.58);
    expect(t.preset.P).toBeCloseTo(365.25 * Math.pow(9.58, 1.5), 6);
    expect(t.tags.P).toBe('derived');
    expect(t.preset.Prot).toBe(15.95);
  });
  it('Jupiter and Saturn carry their measured peak jet speed and flattening to the engine (#89 review 5, 6)', () => {
    const j = cardToWorld(JUP);
    if (!j.ok) throw new Error('refused');
    expect(j.preset.Umeas).toBe(150);
    expect(j.preset.fMeas).toBe(0.06487);
    expect(j.tags.Umeas).toBe('measured');
    expect(j.tags.fMeas).toBe('measured');
  });
  it('ref-earth is not mapped (no backend object)', () => {
    expect(ARTIFACT_PRESETS['ref-earth']).toBeUndefined();
  });
  it('reports a card value that disagrees with the preset instead of choosing silently', () => {
    const r = cardToWorld(card({ ...T1E, radius_rjup: tv(0.2) }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mismatches.join(' ')).toMatch(/Rj: card radius_rjup = 0.2/);
    expect(r.preset.Rj).toBe(proto('t1e').Rj);
  });
  it('every table entry points at a real prototype preset', () => {
    for (const id of Object.values(ARTIFACT_PRESETS)) expect(proto(id)).toBeDefined();
  });
});

describe('cardToWorld: any other exoplanet goes through general defaults', () => {
  it('maps a user planet, tags every field, lists assumptions', () => {
    const r = cardToWorld(OWN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.artifact).toBeUndefined();
    expect(r.preset).toMatchObject({
      id: 'user-own-1',
      type: 'rock',
      Ts: 5200,
      Rs: 0.9,
      a: 1.1,
      P: 420,
      Rj: 0.11,
      Me: 2,
      fluid: 'water',
      Ps: 1,
      mu: 29,
      sea: 0.5,
      locked: false,
    });
    expect(r.preset.Prot).toBeCloseTo(30 / 24, 6);
    expect(r.preset.seed).toBe(seedFromId('user-own-1'));
    for (const k of Object.keys(r.preset))
      if (!['ob', 'oceanF', 'Prot', 'label', 'sea'].includes(k)) expect(r.tags[k], k).toBeDefined();
    expect(r.assumptions.filter((a) => a.tag === 'model_dependent').map((a) => a.field)).toEqual(
      expect.arrayContaining(['fluid', 'Ps', 'mu', 'sea']),
    );
  });
  it("does not invert the card's Teq into an albedo: a catalogue Teq assumes A = 0 itself (#93 3.5)", () => {
    const r = cardToWorld(card({ ...OWN, teq_K: tv(200, 'derived') }));
    if (!r.ok) throw new Error('refused');
    expect(r.preset.A).toBeUndefined();
    expect(r.tags.A).toBe('model_dependent');
    expect(r.assumptions.find((a) => a.field === 'A')).toMatchObject({
      value: 0.3,
      tag: 'model_dependent',
    });
    expect(r.assumptions.find((a) => a.field === 'A')?.note).toMatch(
      /200 K, derived\) is not inverted/,
    );
    // Without a temperature or albedo the prototype's 0.3 is listed as an assumption, not applied silently.
    const d = cardToWorld(OWN);
    if (!d.ok) throw new Error('refused');
    expect(d.assumptions.find((a) => a.field === 'A')).toMatchObject({
      value: 0.3,
      tag: 'model_dependent',
    });
  });
  it('a card albedo is used with a note that a geometric albedo is not a Bond albedo', () => {
    const r = cardToWorld(card({ ...OWN, albedo: tv(0.4) }));
    if (!r.ok) throw new Error('refused');
    expect(r.preset.A).toBe(0.4);
    expect(r.assumptions.find((a) => a.field === 'A')?.note).toMatch(/geometric albedo/);
  });
  it('55 Cnc e (hotter than molten rock, no pressure on the card) gets a thin rock-vapour atmosphere, not 1 bar of water', () => {
    const cnc = card({
      id: 'simbad-rho01-cnc-e',
      name: '55 Cnc e',
      type: 'planet_rocky',
      host_age_gyr: tv(5.5),
      host_mass_msun: tv(0.905),
      host_radius_rsun: tv(0.943),
      host_teff_K: tv(5172),
      mass_mearth: tv(7.99),
      orbit_au: tv(0.01544),
      orbital_period_d: tv(0.7365474),
      radius_rjup: tv(0.16727754329155708),
      teq_K: tv(1958),
    });
    const r = cardToWorld(cnc);
    if (!r.ok) throw new Error('refused');
    // Below the engine's 0.02 bar "airless" line and the 0.1 bar runaway line: no steam haze over the magma.
    expect(r.preset).toMatchObject({ Ps: 0.005, mu: 44, sea: 0, oceanF: 0 });
    expect(r.tags.Ps).toBe('inferred_from_analog');
    // #93 3.5: the catalogue Teq (which assumes A = 0) is no longer inverted into A = 0; the prototype's 0.3 is
    // assumed and listed. The Teq still marks it a lava world (above).
    expect(r.preset.A).toBeUndefined();
    expect(r.assumptions.find((a) => a.field === 'A')).toMatchObject({
      value: 0.3,
      tag: 'model_dependent',
    });
    expect(r.assumptions.find((a) => a.field === 'A')?.note).toMatch(/not inverted/);
  });
  it('a giant other than Jupiter or Saturn lists its wind as an estimate, with the 10 K floor stated', () => {
    const r = cardToWorld(
      card({
        ...JUP,
        id: 'x-gas',
        name: 'X',
        host_teff_K: tv(5772),
        host_radius_rsun: tv(1),
        host_mass_msun: tv(1),
        teq_K: tv(120),
      }),
    );
    if (!r.ok) throw new Error('refused');
    expect(r.preset.Umeas).toBeUndefined();
    expect(r.assumptions.find((a) => a.field === 'U')?.note).toMatch(/10 K floor/);
    expect(r.assumptions.find((a) => a.field === 'flat')?.tag).toBe('model_dependent');
  });
  it('is deterministic', () => {
    expect(JSON.stringify(cardToWorld(OWN))).toBe(JSON.stringify(cardToWorld(OWN)));
    expect(seedFromId('a')).toBe(seedFromId('a'));
    expect(seedFromId('a')).not.toBe(seedFromId('b'));
  });
  it('refuses with the list of what is missing', () => {
    const thin = cardToWorld(
      card({ id: 'simbad-kepler-22b', name: 'Kepler-22b', type: 'candidate' }),
    );
    expect(thin.ok).toBe(false);
    const noOrbit = cardToWorld(card({ ...OWN, orbit_au: undefined, host_teff_K: undefined }));
    expect(noOrbit.ok).toBe(false);
    if (!noOrbit.ok)
      expect(noOrbit.missing).toEqual(expect.arrayContaining(['orbit_au', 'host_teff_K']));
  });
  it('a gas giant that is neither locked nor has a rotation period refuses (no invented spin)', () => {
    const r = cardToWorld(
      card({
        ...JUP,
        id: 'x-gas',
        name: 'X',
        rot_period_h: undefined,
        host_teff_K: tv(5772),
        host_radius_rsun: tv(1),
        host_mass_msun: tv(1),
        host_age_gyr: tv(1),
      }),
    );
    expect(r.ok).toBe(false);
  });
});
