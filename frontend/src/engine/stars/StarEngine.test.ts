import { describe, expect, it } from 'vitest';
import type { ObjectCard } from '@/contract';
import { ARTIFACT_PRESET_BY_CARD_ID, PROTOTYPE_PRESETS, cardToStar } from './cardToStar';
import { StarEngine } from './StarEngine';

const tv = (value: number, tag = 'measured') => ({ value, tag, source: 'test' }) as never;
const card = (o: Partial<ObjectCard>): ObjectCard =>
  ({ id: 'x', name: 'X', type: 'star', ...o }) as ObjectCard;

describe('cardToStar', () => {
  it('refuses without a temperature, and for brown dwarfs and Miras', () => {
    expect(cardToStar(card({}))).toMatchObject({ ok: false, missing: ['teff_K'] });
    expect(cardToStar(card({ type: 'brown_dwarf', teff_K: tv(1500) }))).toMatchObject({
      ok: false,
    });
    expect(cardToStar(card({ type: 'star_mira', teff_K: tv(3000) }))).toMatchObject({ ok: false });
  });
  it('keeps card values and tags, and fills the rest down the tier chain', () => {
    const r = cardToStar(
      card({ teff_K: tv(5772), radius_rsun: tv(1), rot_period_h: tv(25.4 * 24) }),
    );
    if (!r.ok) throw new Error('refused');
    expect(r.teff.tag).toBe('measured');
    expect(r.radius.tag).toBe('measured');
    expect(r.rotation.value).toBeCloseTo(25.4, 6);
    expect(r.mass.tag).toBe('model_dependent');
    expect(r.preset.dwarf).toBe(true);
    const t = cardToStar(card({ teff_K: tv(6550) }));
    if (!t.ok) throw new Error('refused');
    expect(t.radius.tag).toBe('model_dependent');
    expect(t.mass.value).toBeCloseTo(1.33, 2);
    expect(t.rotation.tag).toBe('inferred_from_analog');
    expect(t.assumed.length).toBe(3);
  });
  it('only the Sun maps to an artifact preset; a named star draws from its own card (PR #89 review)', () => {
    expect(Object.keys(ARTIFACT_PRESET_BY_CARD_ID)).toEqual(['ref-sun']);
    const sun = cardToStar(
      card({
        id: 'ref-sun',
        name: 'Sun',
        teff_K: tv(5772),
        radius_rsun: tv(1),
        rot_period_h: tv(25.4 * 24),
      }),
    );
    if (!sun.ok) throw new Error('refused');
    expect(sun.preset).toEqual(PROTOTYPE_PRESETS.g);
    // eps Eri: the card's 5,084 K, 0.735 Rsun and 11.2 d, not the artifact's K row (4,500 K, 0.72 Rsun, 30 d).
    const eri = cardToStar(
      card({
        id: 'simbad-eps-eri',
        name: 'eps Eri',
        teff_K: tv(5084),
        radius_rsun: tv(0.735),
        rot_period_h: tv(11.2 * 24),
      }),
    );
    if (!eri.ok) throw new Error('refused');
    expect(eri.preset).toMatchObject({ id: 'simbad-eps-eri', T: 5084, R: 0.735 });
    expect(eri.preset.P).toBeCloseTo(11.2, 6);
    expect(eri.teff.tag).toBe('measured');
    expect(eri.assumed.some((a) => /artifact/.test(a))).toBe(false);
    // Procyon without a period on its card: a tagged Rossby-number period, not the F row's 8 days.
    const pro = cardToStar(
      card({ id: 'simbad-alf-cmi', name: 'Procyon', teff_K: tv(6530), radius_rsun: tv(2.05) }),
    );
    if (!pro.ok) throw new Error('refused');
    expect(pro.preset).toMatchObject({ T: 6530, R: 2.05 });
    expect(pro.rotation.tag).toBe('inferred_from_analog');
    expect(pro.rotation.note).toMatch(/Rossby/);
    expect(pro.preset.P).toBe(pro.rotation.value);
    expect(pro.preset.P).not.toBe(PROTOTYPE_PRESETS.f!.P);
    expect(Object.keys(PROTOTYPE_PRESETS)).toEqual(['rg', 'm', 'k', 'g', 'f', 'a', 'b']);
  });
  it('treats a giant as not a dwarf, with a typical giant mass', () => {
    const r = cardToStar(card({ teff_K: tv(4286), radius_rsun: tv(25.4) }));
    if (!r.ok) throw new Error('refused');
    expect(r.preset.dwarf).toBe(false);
    expect(r.mass.tag).toBe('inferred_from_analog');
  });
});

describe('StarEngine (no WebGL in jsdom: the prototype logic still runs)', () => {
  const sun = { id: 'g', label: 'Sun', T: 5772, R: 1, M: 1, P: 25.4, dwarf: true };
  it('derives the same readouts and flares from the same star, on every run', () => {
    const run = () => {
      const e = new StarEngine(document.createElement('div'), {
        mode: 'globe',
        reducedMotion: false,
      });
      e.setStar(sun);
      for (let i = 0; i < 200; i++) e.tick(0.05);
      const out = { r: e.readouts(), f: e.latestFlare(), c: e.caption() };
      e.dispose();
      return out;
    };
    const a = run();
    expect(a).toEqual(run());
    expect(a.r.find((x) => x.label === 'Rossby number')?.value).toBe('1.76');
    expect(a.r.find((x) => x.label === 'Average magnetic field')?.value).toMatch(/^9\d G$/);
    expect(a.f).toMatch(/^Class [CMX]/);
    // X10 rate recalibrated to GOES (about one per 800-1,000 days on the Sun): 900 days.
    expect(a.r.find((x) => x.label === 'X10 flare, about every')?.value).toBe('900 days');
  });
  it('fires a flare, toggles lines, and exposes the chart and the notes', () => {
    const e = new StarEngine(document.createElement('div'), { mode: 'closeup' });
    e.setStar(sun);
    expect(e.chart()?.soft.length).toBe(241);
    e.setFlareTime(0.5);
    expect(e.flare()).toMatchObject({ t: 0.5, playing: false, minutes: '30 minutes' });
    e.setFlareKind('closed');
    expect(e.chart()?.open).toBe(false);
    e.setFieldLines(false);
    expect(e.fieldLines).toBe(false);
    expect(e.notes()[0]!.title).toBe('How the star would decide');
    expect(e.notes()[0]!.lines.join(' ')).toMatch(/always a Sun-like star/);
    expect(e.notes()[0]!.lines.join(' ')).not.toMatch(/potential-field/);
    e.dispose();
    const g = new StarEngine(document.createElement('div'), { mode: 'globe' });
    g.setStar(sun);
    g.fireFlare();
    expect(g.latestFlare()).toMatch(/erg/);
    expect(g.notes()[0]!.placeholder).toMatch(/Still placeholders/);
  });
  it('a hot star has no spot groups, so no flares', () => {
    const e = new StarEngine(document.createElement('div'), { mode: 'globe' });
    e.setStar({ id: 'a', label: 'A star', T: 9700, R: 2.2, M: 2.2, P: 1, dwarf: true });
    expect(e.hasFlares()).toBe(false);
    expect(e.readouts().some((r) => r.label === 'Boiling cells')).toBe(true);
  });
});
