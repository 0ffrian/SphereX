// Issue #68 Track C: looks and presets. Completeness, precedence, normalisation, artistic-only,
// determinism.
import { describe, expect, it } from 'vitest';
import { generateField, fieldHash, type FieldParams } from '../fields/fieldGenerator';
import {
  SCENARIO_LOOKS,
  lookForScenario,
  lookLegend,
  lookProvenance,
  mergeLook,
} from './scenarioLooks';
import { PRESETS, lookupPreset, normalisePlanetName, type LookPreset } from './presets';
import { LOOK_KEYS, SCENARIOS, type Scenario, type ScenarioLook } from './types';

const ref = { title: 't', credit: 'c', url: 'u', licence: 'l' };
const table = (
  key: string,
  p: { scenario?: Scenario; look: object },
): Record<string, LookPreset> => ({
  [key]: { key, reference: ref, reviewedBy: 'x', ...p } as LookPreset,
});

describe('scenario looks', () => {
  it('has a complete, in-range look for every scenario', () => {
    expect(Object.keys(SCENARIO_LOOKS).sort()).toEqual([...SCENARIOS].sort());
    for (const s of SCENARIOS) {
      const l = SCENARIO_LOOKS[s];
      expect(Object.keys(l).sort()).toEqual([...LOOK_KEYS].sort());
      for (const k of ['cloudCover', 'atmosphereStrength', 'iceContrast'] as const) {
        expect(l[k]).toBeGreaterThanOrEqual(0);
        expect(l[k]).toBeLessThanOrEqual(1);
      }
      expect(l.relief).toBeGreaterThan(0);
      expect(l.freq).toBeGreaterThan(0);
      expect(l.atmosphereColour.every((c) => c >= 0 && c <= 1)).toBe(true);
    }
  });
  it('returns null for an unknown scenario', () => {
    expect(lookForScenario('nope')).toBeNull();
    expect(lookForScenario(null)).toBeNull();
  });
  it('tags and words the legend', () => {
    expect(lookProvenance).toEqual({ tag: 'artistic', tier: 5, plusArtisticOnly: true });
    expect(lookLegend('hot_dry')).toBe("Look: typical artist's depiction of a hot dry world");
  });
});

describe('merge precedence', () => {
  const base = SCENARIO_LOOKS.temperate;
  it('sliders beat preset beat look', () => {
    const m = mergeLook(base, { cloudCover: 0.3, relief: 0.1 }, { cloudCover: 0.9 });
    expect(m.cloudCover).toBe(0.9);
    expect(m.relief).toBe(0.1);
    expect(m.freq).toBe(base.freq);
  });
  it('does not mutate and skips undefined', () => {
    const before = structuredClone(base);
    const m = mergeLook(base, { freq: undefined }, { relief: undefined });
    expect(base).toEqual(before);
    expect(m).toEqual(base);
  });
});

describe('presets', () => {
  it('ships empty', () => {
    expect(Object.keys(PRESETS)).toHaveLength(0);
  });
  it('normalises names', () => {
    expect(normalisePlanetName('TRAPPIST-1 f')).toBe('trappist-1f');
    const t = table('trappist-1f', { look: { cloudCover: 0.4 } });
    expect(lookupPreset('TRAPPIST-1 f', 'eyeball', t)).toEqual({ cloudCover: 0.4 });
    expect(lookupPreset('trappist-1f', 'eyeball', t)).toEqual({ cloudCover: 0.4 });
    expect(lookupPreset('other', 'eyeball', t)).toBeNull();
  });
  it('uses scenario only as a match guard', () => {
    const t = table('trappist-1f', { scenario: 'eyeball', look: { relief: 0.07 } });
    const hit = lookupPreset('TRAPPIST-1 f', 'eyeball', t);
    expect(hit).toEqual({ relief: 0.07 });
    expect(hit && 'scenario' in hit).toBe(false);
    expect(lookupPreset('TRAPPIST-1 f', 'temperate', t)).toBeNull();
    expect(lookupPreset('TRAPPIST-1 f', null, t)).toBeNull();
  });
  it('is artistic only: types and runtime', () => {
    const typed: LookPreset = {
      key: 'x',
      // @ts-expect-error thetaIce is not an artistic setting
      look: { thetaIce: 1 },
      reference: ref,
      reviewedBy: 'x',
    };
    expect(typed.key).toBe('x');
    // @ts-expect-error scenario is not a look key
    const bad2: Partial<ScenarioLook> = { scenario: 'lava' };
    expect(bad2).toBeDefined();
    for (const k of ['thetaIce', 'scenario', 'starlight', 'teq']) {
      const t = table('trappist-1f', { look: { [k]: 1, cloudCover: 0.2 } });
      expect(lookupPreset('TRAPPIST-1 f', 'eyeball', t)).toBeNull();
    }
  });
});

describe('determinism', () => {
  it('applies a preset twice to a deep-equal result', () => {
    const t = table('trappist1f', { look: { cloudCover: 0.4, atmosphereColour: [0.1, 0.2, 0.3] } });
    const run = () =>
      mergeLook(SCENARIO_LOOKS.eyeball, lookupPreset('trappist1f', 'eyeball', t), { freq: 2.2 });
    expect(run()).toEqual(run());
  });
  it('gives byte-identical fields from look params', () => {
    for (const s of SCENARIOS) {
      const l = SCENARIO_LOOKS[s];
      const p: FieldParams = {
        kind: 'terrain',
        seed: 7,
        freq: l.freq,
        seaLevel: 0.4,
        iceExtent: l.iceContrast * 0.3,
        heat: s === 'lava' ? 1 : 0,
        bands: 0,
        turbulence: 0,
        storms: 0,
      };
      const a = generateField(p, 64, 32);
      const b = generateField(p, 64, 32);
      expect(Buffer.from(a.a.buffer).equals(Buffer.from(b.a.buffer))).toBe(true);
      expect(Buffer.from(a.b.buffer).equals(Buffer.from(b.b.buffer))).toBe(true);
      expect(fieldHash(a)).toBe(fieldHash(b));
    }
  });
});
