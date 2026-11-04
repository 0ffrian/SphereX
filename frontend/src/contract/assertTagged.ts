// R3.1 rule: a `derived` value must carry a `formula`; a `model_dependent` value must carry an
// `assumption` (R1 principle 2, "provenance on everything").
import { TAGS, type Tag } from './tags';

/** The fields `assertTagged` inspects. Any TV<T> satisfies it. */
export interface Tagged {
  tag: Tag;
  formula?: string;
  assumption?: string;
}

export class ProvenanceError extends Error {
  override readonly name = 'ProvenanceError';
}

function isNonEmpty(s: unknown): s is string {
  return typeof s === 'string' && s.trim().length > 0;
}

/**
 * Throws a ProvenanceError when a tagged value breaks the R3.1 provenance rules:
 * - the tag is not one of the five tags;
 * - tag `derived` without a non-empty `formula`;
 * - tag `model_dependent` without a non-empty `assumption`.
 * `label` names the field in the error message, e.g. "diameter_km".
 */
export function assertTagged(v: Tagged, label = 'value'): void {
  if (!(TAGS as readonly string[]).includes(v.tag)) {
    throw new ProvenanceError(`${label}: unknown provenance tag "${String(v.tag)}"`);
  }
  if (v.tag === 'derived' && !isNonEmpty(v.formula)) {
    throw new ProvenanceError(`${label}: tag "derived" requires a formula`);
  }
  if (v.tag === 'model_dependent' && !isNonEmpty(v.assumption)) {
    throw new ProvenanceError(`${label}: tag "model_dependent" requires an assumption`);
  }
}

/** Non-throwing variant: true when `assertTagged` would pass. */
export function isValidlyTagged(v: Tagged): boolean {
  try {
    assertTagged(v);
    return true;
  } catch {
    return false;
  }
}
