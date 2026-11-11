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
    // Titan's pressure on the card is 1.467 bar against the prototype's 1.5: within rounding, so the card value's tag wins.
    expect(t.tags.Ps).toBe('measured');
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
