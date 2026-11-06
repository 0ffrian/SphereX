// R5.3 / D-21 honesty toggle: three states, one per badge (D-02). Pure functions, no three.js.
//   Measured only  -> shows `measured`
//   + Estimated    -> adds derived, model_dependent, inferred_from_analog (starting state)
//   + Artistic     -> adds artistic
import type { Tag } from '@/contract';
import type { HonestyState } from '@/state/store';

export type { HonestyState };

/** Order is from strictest to most permissive. */
export const HONESTY_STATES: readonly HonestyState[] = ['measured', 'derived', 'artistic'];

/** D-21: the toggle starts at + Estimated. */
export const DEFAULT_HONESTY: HonestyState = 'derived';

export const HONESTY_LABEL: Readonly<Record<HonestyState, string>> = {
  measured: 'Measured only',
  derived: '+ Estimated',
  artistic: '+ Artistic',
};

const ESTIMATED_TAGS: readonly Tag[] = ['derived', 'model_dependent', 'inferred_from_analog'];

export function allowedTags(state: HonestyState): readonly Tag[] {
  switch (state) {
    case 'measured':
      return ['measured'];
    case 'derived':
      return ['measured', ...ESTIMATED_TAGS];
    case 'artistic':
      return ['measured', ...ESTIMATED_TAGS, 'artistic'];
  }
}

export function isTagShown(state: HonestyState, tag: Tag): boolean {
  return allowedTags(state).includes(tag);
}

/** `null` (nothing chosen yet) means the D-21 starting state. */
export function effectiveHonesty(state: HonestyState | null | undefined): HonestyState {
  return state ?? DEFAULT_HONESTY;
}

/** The three user-facing badge names (D-02). */
export type BadgeName = 'Measured' | 'Estimated' | 'Default';

export function badgeForTag(tag: Tag): BadgeName {
  switch (tag) {
    case 'measured':
      return 'Measured';
    case 'derived':
    case 'model_dependent':
    case 'inferred_from_analog':
      return 'Estimated';
    case 'artistic':
      return 'Default';
  }
}

/** The weakest honesty state that shows `tag` (what the user must switch to). */
export function stateThatShows(tag: Tag): HonestyState {
  return HONESTY_STATES.find((s) => isTagShown(s, tag)) ?? 'artistic';
}

export function filterByHonesty<T extends { tag: Tag }>(
  items: readonly T[],
  state: HonestyState,
): { shown: T[]; hidden: T[] } {
  const shown: T[] = [];
  const hidden: T[] = [];
  for (const item of items) (isTagShown(state, item.tag) ? shown : hidden).push(item);
  return { shown, hidden };
}
