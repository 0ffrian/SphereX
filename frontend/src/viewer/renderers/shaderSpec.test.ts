// R7.7, D-26, D-27: card + params -> shader spec. Refusal, palette source, overrides.
import { describe, expect, it } from 'vitest';
import type { ObjectCard, RenderParams } from '@/contract';
import { keyed, GASK } from './shaderPalette';
import { resolveShaderSpec } from './shaderSpec';
import { SLIDER_REGISTRY, sliderValue } from '../sliders';
import { fixture } from './fixtures.testutil';

describe('resolveShaderSpec', () => {
  it('draws every fixture except the rocky planet with no size problem, all artistic', () => {
    for (const k of ['planet_rocky', 'planet_water', 'gas_giant', 'nebula', 'nova'] as const) {
      const f = fixture(k);
      const spec = resolveShaderSpec(f.card, f.params);
      expect(spec.drawable, k).toBe(true);
      expect(spec.tag).toBe('artistic');
    }
  });

  it('passes RenderParams.missing through (rocky fixture: teq_pulse)', () => {
    const f = fixture('planet_rocky');
    expect(resolveShaderSpec(f.card, f.params).missing).toEqual(['teq_pulse']);
  });

  it('refuses the surface when scale_m is null (Q-33)', () => {
    const f = fixture('gas_giant');
    const spec = resolveShaderSpec(f.card, { ...f.params, scale_m: null });
    expect(spec.drawable).toBe(false);
    expect(spec.missing).toContain('surface');
  });

  it('refuses the surface when the radius is unknown', () => {
    const f = fixture('planet_water');
    const card: ObjectCard = { ...f.card, radius_rjup: { ...f.card.radius_rjup!, value: null } };
    const spec = resolveShaderSpec(card, f.params);
    expect(spec.drawable).toBe(false);
    expect(spec.missing).toContain('surface');
  });

  it('refuses a nebula whose diameter is unknown, and one whose layer is absent', () => {
    const f = fixture('nebula');
    const noDiameter: ObjectCard = {
      ...f.card,
      diameter_km: { ...f.card.diameter_km!, value: null },
    };
    expect(resolveShaderSpec(noDiameter, f.params).missing).toContain('point_cloud');
    const noLayer: RenderParams = { ...f.params, layers: [] };
    const spec = resolveShaderSpec(f.card, noLayer);
    expect(spec.drawable).toBe(false);
    expect(spec.missing).toContain('point_cloud');
  });

  it('keys the gas palette by teq_K when present, else uses the artist default', () => {
    const f = fixture('gas_giant');
    const withT = resolveShaderSpec(f.card, f.params);
    expect(withT.gas?.paletteSource).toBe('teq_K');
    expect(withT.gas?.palette).toEqual(keyed(GASK, 100));
    const noT: ObjectCard = { ...f.card, teq_K: { ...f.card.teq_K!, value: null } };
    const spec = resolveShaderSpec(noT, f.params);
    expect(spec.gas?.paletteSource).toBe('artist_default');
    expect(spec.gas?.paletteTemperatureK).toBe(140);
    expect(spec.drawable).toBe(true);
  });

  it('throws for a card / params pair that is not a shader kind', () => {
    const g = fixture('gas_giant');
    const w = fixture('planet_water');
    expect(() => resolveShaderSpec(g.card, w.params)).toThrow(TypeError);
    const a = fixture('asteroid_shape');
    expect(() => resolveShaderSpec(a.card, a.params)).toThrow(TypeError);
  });

  it('applies valid slider overrides only for applicable types; out of range is ignored, not clamped', () => {
    const f = fixture('planet_water');
    const spec = resolveShaderSpec(f.card, f.params, { sea_level: 0.5, relief: 99, bands: 20 });
    expect(spec.field?.seaLevel).toBe(0.5);
    // One invalid-value policy with the store and the physics layer (D-27): the default is drawn.
    expect(spec.planet?.relief).toBe(resolveShaderSpec(f.card, f.params).planet?.relief);
    expect(sliderValue({ relief: SLIDER_REGISTRY.relief.max }, 'relief', 'planet_water')).toBe(
      SLIDER_REGISTRY.relief.max,
    );
    expect(spec.field?.bands).toBe(0); // 'bands' does not apply to planets
    expect(sliderValue({ storms: true }, 'storms', 'gas_giant')).toBeUndefined();
    expect(sliderValue({ storms: NaN }, 'storms', 'gas_giant')).toBeUndefined();
  });

  it('the water planet has an ocean and no lava; the rocky planet has no ocean (defaults)', () => {
    const r = resolveShaderSpec(fixture('planet_rocky').card, fixture('planet_rocky').params);
    expect(r.field?.seaLevel).toBe(0);
    const w = resolveShaderSpec(fixture('planet_water').card, fixture('planet_water').params);
    expect(w.field?.seaLevel).toBeGreaterThan(0);
    expect(w.field?.heat).toBe(0);
  });

  it('lava cracks follow teq_K: none when unknown or cool, glowing from about 700 K (N9, A7.1)', () => {
    const f = fixture('planet_rocky');
    const withT = (value: number | null): ObjectCard => ({
      ...f.card,
      teq_K: { ...f.card.teq_K!, value },
    });
    // The fixture's teq_K is null: refuse rather than invent a glow.
    expect(resolveShaderSpec(f.card, f.params).field?.heat).toBe(0);
    expect(resolveShaderSpec(withT(null), f.params).field?.heat).toBe(0);
    expect(resolveShaderSpec(withT(300), f.params).field?.heat).toBe(0);
    expect(resolveShaderSpec(withT(700), f.params).field?.heat).toBe(0);
    const warm = resolveShaderSpec(withT(900), f.params).field!.heat;
    const hot = resolveShaderSpec(withT(1400), f.params).field!.heat;
    expect(warm).toBeGreaterThan(0);
    expect(hot).toBeGreaterThan(warm);
    expect(resolveShaderSpec(withT(5000), f.params).field?.heat).toBe(1);
    // A slider is the visitor's own artistic choice and still wins.
    expect(resolveShaderSpec(withT(null), f.params, { lava_heat: 0.4 }).field?.heat).toBe(0.4);
  });
});
