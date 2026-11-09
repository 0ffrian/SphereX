// Issue #68 Track C Part 5, R7.7, D-27: per-planet style presets. They ship EMPTY: no tuning and
// no credit, URL or licence until an entry is added with a verified reference. No image is
// committed. A preset changes artistic settings only.
import { LOOK_KEYS, type LookKey, type Scenario, type ScenarioLook } from './types';

export interface PresetReference {
  title: string;
  credit: string;
  url: string;
  licence: string;
}

/**
 * `look` is typed `Partial<ScenarioLook>`, so only artistic keys type-check. `scenario` is a
 * MATCH GUARD only: the preset applies when the computed scenario equals it, and never sets it.
 */
export interface LookPreset {
  /** Normalised `pl_name` (see `normalisePlanetName`). */
  key: string;
  scenario?: Scenario;
  look: Partial<ScenarioLook>;
  reference: PresetReference;
  reviewedBy: string;
}

/** Lowercase, all whitespace removed: "TRAPPIST-1 f" and "trappist-1f" give the same key. */
export function normalisePlanetName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '');
}

/** Ships empty (Q-159). Entries need a verified credit and a reviewer. */
export const PRESETS: Readonly<Record<string, LookPreset>> = {};

/** True when the look is an object whose own keys are all artistic (allow-list). Runtime guard. */
export function isArtisticOnly(look: unknown): boolean {
  if (typeof look !== 'object' || look === null || Array.isArray(look)) return false;
  return Object.keys(look).every((k) => (LOOK_KEYS as readonly string[]).includes(k));
}

/**
 * Preset for a planet, or null. Null too when the `scenario` guard does not match, and when the
 * preset carries a non-artistic key (refused, never applied).
 */
export function lookupPreset(
  plName: string,
  scenario: Scenario | null,
  table: Readonly<Record<string, LookPreset>> = PRESETS,
): Partial<ScenarioLook> | null {
  const name = normalisePlanetName(plName);
  // Own keys only: "constructor" or "__proto__" must not reach Object.prototype members.
  if (!Object.prototype.hasOwnProperty.call(table, name)) return null;
  const p = table[name];
  if (!p) return null;
  if (p.scenario !== undefined && p.scenario !== scenario) return null;
  if (!isArtisticOnly(p.look)) return null;
  const out: Partial<ScenarioLook> = {};
  for (const k of LOOK_KEYS as readonly LookKey[]) {
    if (Object.prototype.hasOwnProperty.call(p.look, k) && p.look[k] !== undefined)
      (out as Record<string, unknown>)[k] = p.look[k];
  }
  return out;
}

/** Legend: "Look styled after <credit> artist's concept" (`artistic`). */
export function presetLegend(p: LookPreset): string {
  return `Look styled after ${p.reference.credit} artist's concept`;
}
