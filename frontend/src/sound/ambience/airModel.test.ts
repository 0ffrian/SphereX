// §16 test 2: AirModel from a fake engine — refusals, tags, amendment-1 fields, res32, Vmax.
import { describe, expect, it } from 'vitest';
import { buildAirModel, hurricaneVmax, psatWater, REFUSAL_TEXT } from './airModel';
import { EARTH_MODEL, makeFakeEngine, makeWorld } from './fakeEngine.testutil';

describe('buildAirModel', () => {
  it('Earth: air, class, amendment-1 fields, ocean share from the engine climate', () => {
    const air = buildAirModel(makeWorld({}, { Ps: 'measured' }), makeFakeEngine());
    expect(air.airOK).toBe(true);
    expect(air.cls).toBe('N2');
    expect(air.presetId).toBe('earth');
    expect(air.seed3).toEqual([101, 101, 101]);
    expect(air.oceanF).toBe(0.71);
    expect(air.liquid?.name).toBe('water');
    expect(air.refusals).toEqual([]);
    expect(air.Us).toBeCloseTo(0.105 * 66.8, 9);
  });

  it('seed3 comes from the preset when the card world has one', () => {
    const w = makeWorld({ seed: 5 });
    (w.preset as unknown as { seed3: number[] }).seed3 = [1, 2, 3];
    expect(buildAirModel(w, makeFakeEngine()).seed3).toEqual([1, 2, 3]);
  });

  it('refuses everything on an airless world (Ps 0.005), with the lava wording when the rock is molten', () => {
    const e = makeFakeEngine({ model: { ...EARTH_MODEL, airless: true, Ts: 250, state: 'frozen' }, state: { Ps: 0.005 } });
    const air = buildAirModel(makeWorld({ Ps: 0.005 }), e);
    expect(air.airOK).toBe(false);
    expect(air.refusals).toEqual([{ source: 'all', reason: REFUSAL_TEXT.noAir }]);
    const lava = buildAirModel(
      makeWorld({ id: 'lava', Ps: 0.005, mu: 44 }),
      makeFakeEngine({ model: { ...EARTH_MODEL, airless: true, Ts: 1800, state: 'vapour' }, state: { Ps: 0.005 }, hydro: { n: 0, lava: true } }),
    );
    expect(lava.refusals).toEqual([{ source: 'all', reason: REFUSAL_TEXT.lavaNoAir }]);
    expect(lava.lavaWorld).toBe(true);
  });

  it.each(['frozen', 'vapour', 'supercritical'])('a %s fluid refuses the liquid sources with the §7 string', (state) => {
    const air = buildAirModel(makeWorld(), makeFakeEngine({ model: { ...EARTH_MODEL, state } }));
    expect(air.liquid).toBeNull();
    for (const s of ['S4', 'S5', 'S6', 'S7']) {
      expect(air.refusals).toContainEqual({ source: s, reason: REFUSAL_TEXT.noLiquid });
    }
  });

  it('a missing engine value refuses with the data-gap reason only (never "no air")', () => {
    const air = buildAirModel(makeWorld(), makeFakeEngine({ model: { ...EARTH_MODEL, Ts: undefined } }));
    expect(air.airOK).toBe(false);
    expect(air.refusals).toEqual([{ source: 'all', reason: REFUSAL_TEXT.dataGap }]);
  });

  it('tags pass through; a slider value is the user choice (artistic); derived values carry their formula', () => {
    const w = makeWorld({}, { Ps: 'measured', fluid: 'measured' });
    const card = buildAirModel(w, makeFakeEngine());
    const ps = card.inputs.find((i) => i.label === 'Surface pressure');
    expect(ps?.tag).toBe('measured');
    expect(card.inputs.find((i) => i.label === 'Surface liquid')?.tag).toBe('measured');
    const c0 = card.inputs.find((i) => i.label === 'Speed of sound');
    expect(c0?.tag).toBe('derived');
    expect(c0?.source).toContain('√(γ R T0 / M)');
    expect(card.inputs.find((i) => i.label === 'Air type')?.tag).toBe('inferred_from_analog');
    expect(card.inputs.find((i) => i.label === 'Air temperature')?.tag).toBe('model_dependent');
    const slid = buildAirModel(w, makeFakeEngine({ state: { Ps: 2 } }));
    const p2 = slid.inputs.find((i) => i.label === 'Surface pressure');
    expect(p2?.tag).toBe('artistic');
    expect(p2?.source).toBe('slider');
  });

  it('res32 mirrors applySpin', () => {
    const e = makeFakeEngine({ state: { locked: true } });
    const ob = { Ms: 1, e: 0.2, obl: 0 };
    expect(buildAirModel(makeWorld({ locked: true, ob }), e).res32).toBe(true);
    expect(buildAirModel(makeWorld({ locked: true, ob }, {}, { spin: 'rot' }), e).res32).toBe(false);
    expect(buildAirModel(makeWorld({ locked: true }, {}, { spin: 'res32' }), e).res32).toBe(true);
    expect(buildAirModel(makeWorld({ locked: true, ob: { Ms: 1, e: 0.05, obl: 0 } }), e).res32).toBe(false);
  });

  it('Vmax only for water with stats.max above 299.65 K, equal to the engine formula', () => {
    expect(buildAirModel(makeWorld(), makeFakeEngine()).Vmax).toBeNull();
    const hot = buildAirModel(makeWorld(), makeFakeEngine({ climate: { stats: { ocean: 0.7, max: 303 } } }));
    expect(hot.Vmax).toBeCloseTo(hurricaneVmax(303, 1), 9);
    expect(hot.Vmax as number).toBeGreaterThan(70);
    expect(hot.Vmax as number).toBeLessThan(90);
    const meth = buildAirModel(makeWorld({ fluid: 'methane' }), makeFakeEngine({ state: { fluid: 'methane' }, climate: { stats: { ocean: 0.2, max: 303 } } }));
    expect(meth.Vmax).toBeNull();
  });

  it('psatWater (Murphy & Koop 2005) at 30 °C ≈ 4247 Pa', () => {
    expect(Math.abs(psatWater(303.15) - 4247) / 4247).toBeLessThan(0.005);
  });

  it('ocean share: engine climate, else the preset, else 0 with a refusal note', () => {
    const fromPreset = buildAirModel(makeWorld({ oceanF: 0.4 }, { oceanF: 'model_dependent' }), makeFakeEngine({ climate: null }));
    expect(fromPreset.oceanF).toBe(0.4);
    const unknown = buildAirModel(makeWorld(), makeFakeEngine({ climate: null }));
    expect(unknown.oceanF).toBe(0);
    expect(unknown.refusals).toContainEqual({ source: 'S4', reason: REFUSAL_TEXT.seaUnknown });
    const dry = buildAirModel(makeWorld(), makeFakeEngine({ climate: { stats: { ocean: 0, max: 280 } } }));
    expect(dry.refusals).toContainEqual({ source: 'S5', reason: REFUSAL_TEXT.noSea });
  });

  it('is deterministic', () => {
    const a = buildAirModel(makeWorld(), makeFakeEngine());
    const b = buildAirModel(makeWorld(), makeFakeEngine());
    expect(a).toEqual(b);
  });
});
