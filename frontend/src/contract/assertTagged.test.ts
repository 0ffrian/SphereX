import { describe, expect, it } from 'vitest';
import { assertTagged, isValidlyTagged, ProvenanceError } from './assertTagged';
import { TAGS, type TV } from './tags';

const base = { value: 1, source: 'test fixture' };

describe('assertTagged (R3.1 provenance rules)', () => {
  it('accepts measured, inferred_from_analog and artistic values without formula or assumption', () => {
    for (const tag of ['measured', 'inferred_from_analog', 'artistic'] as const) {
      const v: TV = { ...base, tag };
      expect(() => assertTagged(v)).not.toThrow();
    }
  });

  it('accepts a derived value with a formula', () => {
    const v: TV = { ...base, tag: 'derived', formula: 'D = 1329 / sqrt(p) * 10^(-H/5)' };
    expect(() => assertTagged(v)).not.toThrow();
  });

  it('rejects a derived value without a formula', () => {
    const v: TV = { ...base, tag: 'derived' };
    expect(() => assertTagged(v, 'diameter_km')).toThrow(ProvenanceError);
    expect(() => assertTagged(v, 'diameter_km')).toThrow(/diameter_km.*formula/);
  });

  it('rejects a derived value with a blank formula', () => {
    expect(() => assertTagged({ ...base, tag: 'derived', formula: '   ' })).toThrow(
      ProvenanceError,
    );
  });

  it('accepts a model_dependent value with an assumption', () => {
    const v: TV = { ...base, tag: 'model_dependent', assumption: 'albedo assumed from class' };
    expect(() => assertTagged(v)).not.toThrow();
  });

  it('rejects a model_dependent value without an assumption', () => {
    const v: TV = { ...base, tag: 'model_dependent' };
    expect(() => assertTagged(v, 'albedo')).toThrow(/albedo.*assumption/);
  });

  it('rejects a model_dependent value that only has a formula', () => {
    const v: TV = { ...base, tag: 'model_dependent', formula: 'x = y' };
    expect(() => assertTagged(v)).toThrow(ProvenanceError);
  });

  it('rejects an unknown tag coming from untyped JSON', () => {
    const fromJson = JSON.parse('{"value":1,"source":"x","tag":"estimated"}') as TV;
    expect(() => assertTagged(fromJson)).toThrow(/unknown provenance tag/);
  });

  it('allows a null value (unknown, never a guess) as long as the tag rules hold', () => {
    const v: TV = { value: null, source: 'JPL SBDB', tag: 'measured' };
    expect(() => assertTagged(v)).not.toThrow();
  });

  it('isValidlyTagged mirrors assertTagged', () => {
    expect(isValidlyTagged({ tag: 'derived', formula: 'a*b' })).toBe(true);
    expect(isValidlyTagged({ tag: 'derived' })).toBe(false);
  });

  it('knows exactly the five R3.1 tags', () => {
    expect([...TAGS].sort()).toEqual(
      ['artistic', 'derived', 'inferred_from_analog', 'measured', 'model_dependent'].sort(),
    );
  });
});
