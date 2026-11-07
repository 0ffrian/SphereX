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
  // DynamicsValue is not a card TV: its model_dependent rule is `assumed`, not `assumption` (D-32).
  const rest = Object.entries(node).filter(([k]) => k !== 'dynamics');
  return [...own, ...rest.flatMap(([, v]) => taggedValues(v))];
}

const SPEEDUP_NEEDS: Record<string, string[]> = {
  spin: ['spin_period_h'],
  spots: ['spot_lifetime_d'],
  flares: ['flare_rate_per_d'],
  winds: ['jet_speed_ms'],
  clouds: ['jet_speed_ms', 'diff_rotation', 'spin_period_h'],
  pulsation: ['pulsation_period_d'],
};
/** Card fields that measure a dynamics rate directly, in the same unit (R3.4). */
const CARD_FIELD_OF_RATE: Record<string, string> = {
  spin_period_h: 'rot_period_h',
  pulsation_period_d: 'period_var_d',
};
type Dyn = Record<string, { value: number; tag: string; tier: number; source: string }> & {
  speedup: Record<string, number>;
};

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

  it.each(types)('%s: dynamics is present, synthetic and speeds up only what moves', (type) => {
    const p = params.get(type)!;
    const dyn = p.dynamics as unknown as Dyn;
    expect(dyn.speedup).toBeDefined();
    const present = Object.keys(dyn).filter((k) => k !== 'speedup');
    for (const process of Object.keys(dyn.speedup)) {
      expect(
        SPEEDUP_NEEDS[process]!.some((k) => present.includes(k)),
        process,
      ).toBe(true);
    }
    for (const k of present) {
      const v = dyn[k]!;
      expect(v.source.startsWith('synthetic fixture: ')).toBe(true);
      expect(v.tier).toBe(TAGS.indexOf(v.tag as (typeof TAGS)[number]) + 1);
    }
    for (const m of p.missing as string[]) {
      if (m.startsWith('dynamics:')) expect(present).not.toContain(m.slice('dynamics:'.length));
    }
  });

  it.each(types)('%s: a measured card rate wins at tier 1, and tier 1 needs one (D-32)', (type) => {
    const card = cards.get(type)! as Record<string, { value?: unknown; tag?: string } | undefined>;
    const dyn = params.get(type)!.dynamics as unknown as Dyn;
    for (const [key, field] of Object.entries(CARD_FIELD_OF_RATE)) {
      const tv = card[field];
      if (tv?.tag === 'measured' && tv.value != null) {
        expect(dyn[key], key).toBeDefined();
        expect([dyn[key]!.value, dyn[key]!.tier], key).toEqual([tv.value, 1]);
      }
    }
    for (const key of Object.keys(dyn).filter((k) => k !== 'speedup')) {
      if (dyn[key]!.tier !== 1) continue;
      const field = CARD_FIELD_OF_RATE[key];
      expect(field, `${key}: no card field can measure it`).toBeDefined();
      expect(card[field!]?.tag, key).toBe('measured');
    }
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
