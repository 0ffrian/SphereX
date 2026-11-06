// Shared plumbing for the physics families: read an input from the card or the overrides, and
// wrap a computed number in a tagged value (R3.1, D-02). Nothing here writes to the card.
import type { ObjectCard, Tag, TV, TVNumber } from '@/contract';
import { isValidOverride, sliderApplies, type Overrides, type SliderKey } from './sliders';

/** One resolved input: its value, where it came from, and the provenance it carries. */
export interface PhysicsInput {
  name: string;
  value: number;
  from: 'card' | 'slider' | 'physics';
  tag: Tag;
  assumption?: string;
}

/** Output of one family: tagged values, plus the ids of the quantities that were refused. */
export interface PhysicsResult {
  values: Readonly<Record<string, TV<number | boolean | string>>>;
  /** Quantities not computed because an input is missing (refuse rather than invent). */
  missing: string[];
  /** For each refused quantity, the inputs it lacked (to word the refusal). */
  needs: Readonly<Record<string, string[]>>;
  /**
   * Override keys that apply to this type but were not used: invalid (wrong type, out of range,
   * not finite) or shadowed by another slider. Keys that do not apply to the type are left out.
   */
  ignored: SliderKey[];
}

/** Card fields a slider may override, by the same name and unit (D-27). */
type CardNumberKey = {
  [K in keyof ObjectCard]-?: NonNullable<ObjectCard[K]> extends TVNumber ? K : never;
}[keyof ObjectCard];

export class InputReader {
  readonly ignored: SliderKey[] = [];

  constructor(
    private readonly card: ObjectCard,
    private readonly overrides: Overrides,
  ) {
    // Every applicable but invalid override is reported, whether or not a family reads it.
    for (const [key, value] of Object.entries(overrides) as [SliderKey, number | boolean][]) {
      if (value === undefined || !sliderApplies(card.type, key)) continue;
      if (!isValidOverride(card.type, key, value)) this.ignore(key);
    }
  }

  /**
   * The slider value when one is set and valid, else the card value when it is not null.
   * An invalid override is ignored (recorded by the constructor), never clamped into range.
   */
  read(key: SliderKey, cardKey?: CardNumberKey): PhysicsInput | null {
    const o = this.overrides[key];
    if (o !== undefined && isValidOverride(this.card.type, key, o)) {
      return { name: key, value: o as number, from: 'slider', tag: 'derived' };
    }
    return cardKey ? this.readCard(cardKey) : null;
  }

  /** True when an override is set for `key` (valid or not). */
  has(key: SliderKey): boolean {
    return this.overrides[key] !== undefined;
  }

  /** Records an override that was set but not used. */
  ignore(key: SliderKey): void {
    if (!this.ignored.includes(key)) this.ignored.push(key);
  }

  /** A card-only input (no slider exists for it). */
  readCard(cardKey: CardNumberKey): PhysicsInput | null {
    const tv = this.card[cardKey] as TVNumber | undefined;
    if (!tv || tv.value === null || !Number.isFinite(tv.value)) return null;
    const input: PhysicsInput = { name: cardKey, value: tv.value, from: 'card', tag: tv.tag };
    if (tv.assumption) input.assumption = tv.assumption;
    return input;
  }
}

// Provenance strength, weakest last. An output can claim no more than its weakest input.
const RANK: Record<Tag, number> = {
  measured: 0,
  derived: 1,
  model_dependent: 2,
  inferred_from_analog: 3,
  artistic: 4,
};

export interface DeriveOptions {
  /** Formula shown next to the slider (required: every output is at least `derived`). */
  formula: string;
  section: string;
  /** Assumption of the rule itself; makes the output `model_dependent`. */
  assumption?: string;
  /** D-12: every value on the slider-only kinds (nebula, nova) is `artistic`. */
  artistic?: boolean;
}

/**
 * Tag rule: `derived` with the formula, weakened to the weakest input tag (a `model_dependent`
 * input or rule makes the output `model_dependent`, with every assumption listed). Slider inputs
 * count as `derived` here (Q-43). The formula is kept on every tag.
 */
export function derive<T extends number | boolean | string>(
  value: T,
  inputs: readonly PhysicsInput[],
  opts: DeriveOptions,
): TV<T> {
  let tag: Tag = 'derived';
  for (const i of inputs) if (RANK[i.tag] > RANK[tag]) tag = i.tag;
  if (opts.assumption && RANK['model_dependent'] > RANK[tag]) tag = 'model_dependent';
  if (opts.artistic) tag = 'artistic';

  const assumptions = [
    ...(opts.assumption ? [opts.assumption] : []),
    ...inputs.filter((i) => i.assumption).map((i) => `${i.name}: ${i.assumption}`),
  ];
  const source =
    `physics layer ${opts.section}; inputs: ` +
    (inputs.length ? inputs.map((i) => `${i.name} (${i.from}, ${i.tag})`).join(', ') : 'none');

  const tv: TV<T> = { value, tag, source, formula: opts.formula };
  if (assumptions.length) tv.assumption = assumptions.join('; ');
  return tv;
}

/** Narrows a set of possibly-missing inputs; names the missing ones. */
export function need<K extends string>(
  inputs: Record<K, PhysicsInput | null>,
): { ok: true; v: Record<K, PhysicsInput> } | { ok: false; absent: K[] } {
  const absent = (Object.keys(inputs) as K[]).filter((k) => inputs[k] === null);
  if (absent.length) return { ok: false, absent };
  return { ok: true, v: inputs as Record<K, PhysicsInput> };
}

/** Collects one family's outputs and refusals. */
export class ResultBuilder {
  readonly values: Record<string, TV<number | boolean | string>> = {};
  readonly missing: string[] = [];
  readonly needs: Record<string, string[]> = {};

  set(id: string, tv: TV<number | boolean | string>): void {
    this.values[id] = tv;
  }

  refuse(id: string, absent: readonly string[]): void {
    if (!this.missing.includes(id)) this.missing.push(id);
    this.needs[id] = [...absent];
  }

  /**
   * Sets `id` from a formula result, or refuses it when the formula returned null (an input was
   * present but not usable, e.g. a radius of 0): the inputs are then named in `needs`.
   */
  put<T extends number | boolean | string>(
    id: string,
    value: T | null,
    inputs: readonly PhysicsInput[],
    opts: DeriveOptions,
  ): TV<T> | null {
    if (value === null) {
      this.refuse(
        id,
        inputs.map((i) => i.name),
      );
      return null;
    }
    const tv = derive(value, inputs, opts);
    this.set(id, tv);
    return tv;
  }

  build(reader: InputReader): PhysicsResult {
    return {
      values: this.values,
      missing: this.missing,
      needs: this.needs,
      ignored: reader.ignored,
    };
  }
}

/** An output computed by this layer, reused as the input of another rule. */
export function asInput(name: string, tv: TV<number>): PhysicsInput {
  const input: PhysicsInput = { name, value: tv.value as number, from: 'physics', tag: tv.tag };
  if (tv.assumption) input.assumption = tv.assumption;
  return input;
}

/** Pure number check used by the formula functions: true for finite numbers above zero. */
export function positive(...xs: number[]): boolean {
  return xs.every((x) => Number.isFinite(x) && x > 0);
}
