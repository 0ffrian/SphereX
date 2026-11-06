// A7 physics layer (A4.6): pure, deterministic functions from card + overrides to tagged values.
// The browser reruns them on every slider change; the result is never written back to the card
// (D-02), so Reset (clearing `overrides`) restores the data values.
import type { ObjectCard, ObjectType } from '@/contract';
import { deriveAsteroid } from './asteroids';
import { deriveBrownDwarf } from './brownDwarfs';
import { deriveGasGiant } from './gasGiants';
import { derivePlanet } from './planets';
import type { Overrides } from './sliders';
import { deriveSnr } from './snr';
import type { PhysicsResult } from './tagging';

export type { PhysicsResult, PhysicsInput } from './tagging';
export * from './sliders';

const FAMILY: Partial<Record<ObjectType, (card: ObjectCard, o: Overrides) => PhysicsResult>> = {
  planet_rocky: derivePlanet,
  planet_water: derivePlanet,
  gas_giant: deriveGasGiant,
  brown_dwarf: deriveBrownDwarf,
  brown_dwarf_binary: deriveBrownDwarf,
  asteroid_shape: deriveAsteroid,
  asteroid_procedural: deriveAsteroid,
  nova: deriveSnr,
};

/**
 * Physics values for one body. Types with no A7 rule (comet, stars, candidate, nebula) get an
 * empty result. Never mutates `card` or `overrides`.
 */
export function derivePhysics(card: ObjectCard, overrides: Overrides = {}): PhysicsResult {
  const fn = FAMILY[card.type];
  return fn ? fn(card, overrides) : { values: {}, missing: [], needs: {}, ignored: [] };
}

/**
 * Selector over the store's `card` and `overrides`. Returns a new object, with new nested
 * objects, on each call. Do not pass it to `useAppStore` directly or through `useShallow`: the
 * snapshot never compares equal and React loops. Select `card` and `overrides` from the store,
 * then call this inside `useMemo` keyed on both.
 */
export function selectPhysics(s: {
  card: ObjectCard | null;
  overrides: Overrides;
}): PhysicsResult | null {
  return s.card ? derivePhysics(s.card, s.overrides) : null;
}
