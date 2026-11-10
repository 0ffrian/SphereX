// Issue #71 stream D (Q-241): fluid phase, Clausius-Clapeyron and the starlight colours.
import { describe, expect, it } from 'vitest';
import {
  ATM_PA,
  FLUIDS,
  FLUID_ORDER,
  boilingPointK,
  cloudBaseK,
  fluidState,
  psatFn,
  skyColours,
  visFraction,
} from './fluids';

describe('fluids', () => {
  it('the slider order lists the five fluids of the table', () => {
    expect([...FLUID_ORDER].sort()).toEqual(Object.keys(FLUIDS).sort());
  });

  it('saturation pressure equals the triple-point pressure at the triple point', () => {
    for (const f of Object.values(FLUIDS)) expect(psatFn(f)(f.Tt)).toBeCloseTo(f.Pt, 6);
  });

  it('water boils at one atmosphere at 373.15 K and at about 344 K at a third of an atmosphere (Everest)', () => {
    expect(boilingPointK(FLUIDS.water, ATM_PA)).toBeCloseTo(373.15, 6);
    // Known answer: the boiling point at 0.33 atm is about 344 K (71 C).
    expect(boilingPointK(FLUIDS.water, 0.33 * ATM_PA)!).toBeGreaterThan(342);
    expect(boilingPointK(FLUIDS.water, 0.33 * ATM_PA)!).toBeLessThan(346);
  });

  it('refuses a liquid range below the triple-point pressure and for CO2 at one atmosphere', () => {
    expect(boilingPointK(FLUIDS.water, 300)).toBeNull();
    expect(boilingPointK(FLUIDS.co2, ATM_PA)).toBeNull();
  });

  it('phase: Earth is liquid, Mars-like air is frozen, an airless hot rock is vapour', () => {
    expect(fluidState(FLUIDS.water, 288, ATM_PA, false)).toBe('liquid');
    expect(fluidState(FLUIDS.water, 210, 600, false)).toBe('frozen');
    expect(fluidState(FLUIDS.water, 400, 0, true)).toBe('vapour');
    expect(fluidState(FLUIDS.water, 450, ATM_PA, false)).toBe('vapour');
  });

  it('water on Earth condenses a few km up', () => {
    const Tc = cloudBaseK(FLUIDS.water, 288, ATM_PA)!;
    expect(Tc).toBeLessThan(286);
    expect(Tc).toBeGreaterThan(240);
  });

  it('a cool star lights the sky red-orange and a hot one blue-white', () => {
    const cool = skyColours(2566, 0).sky;
    const hot = skyColours(9000, 0).sky;
    expect(cool[0]).toBeGreaterThan(cool[2]);
    expect(hot[2]).toBeGreaterThan(hot[0]);
    expect(Math.max(...cool)).toBeCloseTo(1, 9);
  });

  it('methane takes the red out of the sky', () => {
    expect(skyColours(5772, 2.1).sky[0]).toBeLessThan(skyColours(5772, 0).sky[0]);
  });

  it('a cool star gives less visible light to ice than the Sun (so its ice is darker)', () => {
    expect(visFraction(2566)).toBeLessThan(visFraction(5772));
    expect(visFraction(5772)).toBeGreaterThan(0.3);
  });
});
