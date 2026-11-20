// §16 test 2: AirModel from a fake engine — refusals, tags, amendment-1 fields, res32, Vmax.
import { describe, expect, it } from 'vitest';
import { buildAirModel, hurricaneVmax, isWaiting, psatWater, REFUSAL_TEXT } from './airModel';
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

  it('R6: below P_FLOOR (0.5 Pa) everything is refused; the lava wording when the rock is molten', () => {
    const e = makeFakeEngine({
      model: { ...EARTH_MODEL, airless: true, Ts: 250, state: 'frozen' },
      state: { Ps: 5e-6 },
    });
    const air = buildAirModel(makeWorld({ Ps: 5e-6 }), e);
    expect(air.P0).toBeCloseTo(0.5, 9);
    expect(air.airOK).toBe(false);
    expect(air.refusals).toEqual([{ source: 'all', reason: REFUSAL_TEXT.noAir }]);
    const lava = buildAirModel(
      makeWorld({ id: 'lava', Ps: 5e-6, mu: 44 }),
      makeFakeEngine({
        model: { ...EARTH_MODEL, airless: true, Ts: 1800, state: 'vapour' },
        state: { Ps: 5e-6 },
        hydro: { n: 0, lava: true },
      }),
    );
    expect(lava.refusals).toEqual([{ source: 'all', reason: REFUSAL_TEXT.lavaNoAir }]);
  });

  it("R6: the engine's airless flag (Ps < 0.02 bar) does not silence a world with air", () => {
    const e = makeFakeEngine({
      model: { ...EARTH_MODEL, airless: true, Ts: 210, state: 'frozen' },
      state: { Ps: 0.006, fluid: 'co2' },
    });
    const air = buildAirModel(makeWorld({ Ps: 0.006, mu: 43.3, fluid: 'co2' }), e);
    expect(air.airOK).toBe(true);
    expect(air.refusals.some((r) => r.source === 'all')).toBe(false);
    expect(air.liquid).toBeNull();
  });

  it.each(['frozen', 'vapour', 'supercritical'])(
    'a %s fluid refuses the liquid sources with the §7 string',
    (state) => {
      const air = buildAirModel(makeWorld(), makeFakeEngine({ model: { ...EARTH_MODEL, state } }));
      expect(air.liquid).toBeNull();
      for (const s of ['S4', 'S5', 'S6', 'S7']) {
        expect(air.refusals).toContainEqual({ source: s, reason: REFUSAL_TEXT.noLiquid });
      }
    },
  );

  it('a missing engine value refuses with the data-gap reason only (never "no air")', () => {
    const air = buildAirModel(
      makeWorld(),
      makeFakeEngine({ model: { ...EARTH_MODEL, Ts: undefined } }),
    );
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
    expect(buildAirModel(makeWorld({ locked: true, ob }, {}, { spin: 'rot' }), e).res32).toBe(
      false,
    );
    expect(buildAirModel(makeWorld({ locked: true }, {}, { spin: 'res32' }), e).res32).toBe(true);
    expect(
      buildAirModel(makeWorld({ locked: true, ob: { Ms: 1, e: 0.05, obl: 0 } }), e).res32,
    ).toBe(false);
  });

  it('R9: Vmax only under the engine condition (water, stats.max > 299.65 K, cyclones), Ps >= 0.1 bar, capped at 100 m/s', () => {
    expect(buildAirModel(makeWorld(), makeFakeEngine({ cyclones: 2 })).Vmax).toBeNull();
    expect(
      buildAirModel(makeWorld(), makeFakeEngine({ climate: { stats: { ocean: 0.7, max: 303 } } }))
        .Vmax,
    ).toBeNull();
    const thin = buildAirModel(
      makeWorld({ Ps: 0.05 }),
      makeFakeEngine({
        state: { Ps: 0.05 },
        cyclones: 2,
        climate: { stats: { ocean: 0.7, max: 303 } },
      }),
    );
    expect(thin.Vmax).toBeNull();
    const scorching = buildAirModel(
      makeWorld(),
      makeFakeEngine({ cyclones: 1, climate: { stats: { ocean: 0.7, max: 360 } } }),
    );
    expect(scorching.Vmax).toBe(100);
    expect(scorching.inputs.find((i) => i.label === 'Strongest hurricane')?.source).toContain(
      'capped',
    );
    const hot = buildAirModel(
      makeWorld(),
      makeFakeEngine({ cyclones: 3, climate: { stats: { ocean: 0.7, max: 303 } } }),
    );
    expect(hot.Vmax).toBeCloseTo(hurricaneVmax(303, 1), 9);
    expect(hot.Vmax as number).toBeGreaterThan(70);
    expect(hot.Vmax as number).toBeLessThan(90);
    const meth = buildAirModel(
      makeWorld({ fluid: 'methane' }),
      makeFakeEngine({
        state: { fluid: 'methane' },
        cyclones: 1,
        climate: { stats: { ocean: 0.2, max: 303 } },
      }),
    );
    expect(meth.Vmax).toBeNull();
  });

  it('psatWater (Murphy & Koop 2005) at 30 °C ≈ 4247 Pa', () => {
    expect(Math.abs(psatWater(303.15) - 4247) / 4247).toBeLessThan(0.005);
  });

  it('ocean share: engine climate, else the preset, else 0', () => {
    const fromPreset = buildAirModel(
      makeWorld({ oceanF: 0.4 }, { oceanF: 'model_dependent' }),
      makeFakeEngine({ climate: { stats: { max: 280 } } }),
    );
    expect(fromPreset.oceanF).toBe(0.4);
    const dry = buildAirModel(
      makeWorld(),
      makeFakeEngine({ climate: { stats: { ocean: 0, max: 280 } } }),
    );
    expect(dry.refusals).toContainEqual({ source: 'S5', reason: REFUSAL_TEXT.noSea });
  });

  it('is deterministic', () => {
    const a = buildAirModel(makeWorld(), makeFakeEngine());
    const b = buildAirModel(makeWorld(), makeFakeEngine());
    expect(a).toEqual(b);
  });

  it('R12: climate or rivers not ready yet -> a transient waiting state, not a physical refusal', () => {
    const early = buildAirModel(makeWorld(), makeFakeEngine({ climate: null }));
    expect(isWaiting(early)).toBe(true);
    expect(early.refusals).toEqual([{ source: 'all', reason: REFUSAL_TEXT.waiting }]);
    expect(isWaiting(buildAirModel(makeWorld(), makeFakeEngine({ hydro: null })))).toBe(true);
    expect(isWaiting(buildAirModel(makeWorld(), makeFakeEngine()))).toBe(false);
  });

  it('R7: open water on a world whose mean state is frozen (eyeball) is liquid; a runaway ocean has boiled away', () => {
    const eyeball = buildAirModel(
      makeWorld({ id: 't1e', locked: true }),
      makeFakeEngine({
        model: { ...EARTH_MODEL, Ts: 262, state: 'frozen' },
        climate: { stats: { ocean: 0.65, liquid: 1, max: 290 } },
      }),
    );
    expect(eyeball.liquid?.name).toBe('water');
    expect(eyeball.refusals).toEqual([]);
    expect(eyeball.inputs.find((i) => i.label === 'Open water share')?.tag).toBe('model_dependent');
    const iced = buildAirModel(
      makeWorld(),
      makeFakeEngine({
        model: { ...EARTH_MODEL, state: 'frozen' },
        climate: { stats: { ocean: 0.7, liquid: 0, max: 250 } },
      }),
    );
    expect(iced.liquid).toBeNull();
    expect(iced.refusals).toContainEqual({ source: 'S4', reason: REFUSAL_TEXT.noLiquid });
    const boiled = buildAirModel(
      makeWorld({ id: 'k218', Ps: 8, mu: 18 }),
      makeFakeEngine({
        model: { ...EARTH_MODEL, Ts: 401, state: 'vapour', runaway: true },
        state: { Ps: 8 },
        climate: { stats: { ocean: 1, liquid: 1, max: 420 } },
        cyclones: 2,
      }),
    );
    expect(boiled.liquid).toBeNull();
    expect(boiled.Vmax).toBeNull();
    expect(boiled.refusals).toContainEqual({ source: 'S5', reason: REFUSAL_TEXT.boiledAway });
  });

  it('R7 amended: below the triple point (Earth slid to 500 Pa) the ice-free ocean is not liquid', () => {
    const air = buildAirModel(
      makeWorld({}, { Ps: 'measured' }),
      makeFakeEngine({
        model: { ...EARTH_MODEL, airless: true, canLiquid: false, state: 'frozen' },
        state: { Ps: 0.005 },
        climate: { stats: { ocean: 0.7, liquid: 1, max: 280 } },
      }),
    );
    expect(air.airOK).toBe(true);
    expect(air.liquid).toBeNull();
    for (const s of ['S4', 'S5', 'S6', 'S7'])
      expect(air.refusals).toContainEqual({ source: s, reason: REFUSAL_TEXT.noLiquid });
  });

  it('review L7: the lava world rock vapour takes gamma 1.4 and labels its absorption as an analog', () => {
    const lava = buildAirModel(
      makeWorld({ id: 'lava', Ps: 0.005, mu: 44 }),
      makeFakeEngine({
        model: { ...EARTH_MODEL, airless: true, Ts: 1800, state: 'vapour', canLiquid: false },
        state: { Ps: 0.005 },
        hydro: { n: 0, lava: true },
      }),
    );
    expect(lava.gamma).toBe(1.4);
    expect(lava.inputs.find((i) => i.label === 'Sound absorption')?.tag).toBe(
      'inferred_from_analog',
    );
  });
});
