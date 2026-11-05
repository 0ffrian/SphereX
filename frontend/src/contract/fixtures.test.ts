// Shared fixtures against the real JSON Schemas (A12, D-18). The generated types drop the R3.1
// if/then rules, so this uses a real validator, not the type checker.
import Ajv, { type ValidateFunction } from 'ajv';
import { describe, expect, it } from 'vitest';
import cardSchema from '../../../shared/schemas/object-card.schema.json';
import paramsSchema from '../../../shared/schemas/render-params.schema.json';
import invalidCases from '../../../shared/fixtures/invalid/cases.json';
import { assertTagged, OBJECT_TYPES, TAGS, type Tagged } from '@/contract';

const load = (files: Record<string, unknown>) =>
  new Map(
    Object.entries(files).map(([path, data]) => [
      path.replace(/^.*\//, '').replace(/\.json$/, ''),
      data as Record<string, unknown>,
    ]),
  );

const cards = load(
  import.meta.glob('../../../shared/fixtures/cards/*.json', { eager: true, import: 'default' }),
);
const params = load(
  import.meta.glob('../../../shared/fixtures/params/*.json', { eager: true, import: 'default' }),
);

const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addSchema(cardSchema);
ajv.addSchema(paramsSchema);
const validators: Record<string, ValidateFunction> = {
  'object-card': ajv.getSchema('object-card.schema.json')!,
  'render-params': ajv.getSchema('render-params.schema.json')!,
};

function taggedValues(node: unknown): Tagged[] {
  if (Array.isArray(node)) return node.flatMap(taggedValues);
  if (typeof node !== 'object' || node === null) return [];
  const own = 'value' in node && 'tag' in node ? [node as Tagged] : [];
  return [...own, ...Object.values(node).flatMap(taggedValues)];
}

describe('shared fixtures (D-04, D-18)', () => {
  const types = [...OBJECT_TYPES].sort();

  it('have exactly one card and one params file per ObjectType', () => {
    expect([...cards.keys()].sort()).toEqual(types);
    expect([...params.keys()].sort()).toEqual(types);
  });

  it('match the generated lists, which match the schema enums', () => {
    expect([...OBJECT_TYPES]).toEqual(cardSchema.definitions.ObjectType.enum);
    expect([...TAGS]).toEqual(cardSchema.definitions.Tag.enum);
  });

  it.each(types)('%s: the card and params pair validates and agrees', (type) => {
    const card = cards.get(type)!;
    const param = params.get(type)!;
    for (const [schema, data] of [
      ['object-card', card],
      ['render-params', param],
    ] as const) {
      const validate = validators[schema]!;
      expect(validate(data), ajv.errorsText(validate.errors)).toBe(true);
    }
    expect(card.type).toBe(type);
    expect(param.type).toBe(type);
    expect(param.id).toBe(card.id);
  });

  it.each(types)('%s: every tagged value passes assertTagged', (type) => {
    for (const v of taggedValues([cards.get(type), params.get(type)])) assertTagged(v, type);
  });

  it.each(invalidCases.map((c) => [c.name, c] as const))('rejects: %s', (_name, c) => {
    const validate = validators[c.schema]!;
    expect(validate(c.instance)).toBe(false);
    const { path, keyword, detail = '' } = c.expect;
    const errors = validate.errors ?? [];
    const stated = errors.some(
      (e) =>
        e.instancePath === path &&
        e.keyword === keyword &&
        JSON.stringify(e.params).includes(detail),
    );
    expect(stated, ajv.errorsText(errors)).toBe(true);
    // ajv adds an `if` wrapper error on the parent of the failing `then` rule.
    const real = errors.filter((e) => e.keyword !== 'if');
    expect(real.every((e) => e.instancePath.startsWith(path))).toBe(true);
  });
});

describe('the schema and assertTagged enforce the same rule', () => {
  const card = { id: 'fixture:t', name: 'Synthetic fixture', type: 'candidate' };
  const accepted = (albedo: Record<string, unknown>) =>
    validators['object-card']!({ ...card, albedo: { value: 1, source: 'x', ...albedo } });

  it.each([
    [{ tag: 'derived', formula: 'a*b' }, true],
    [{ tag: 'derived' }, false],
    [{ tag: 'derived', formula: ' \t' }, false],
    [{ tag: 'model_dependent', assumption: 'x' }, true],
    [{ tag: 'model_dependent', assumption: '  ' }, false],
    [{ tag: 'measured', formula: '  ' }, true],
    [{ tag: 'artistic', assumption: '' }, true],
  ])('%j', (tagged, ok) => {
    expect(accepted(tagged)).toBe(ok);
    const check = () => assertTagged(tagged as Tagged);
    if (ok) expect(check).not.toThrow();
    else expect(check).toThrow();
  });
});
