// R3.1 Tagged value (rendering doc), D-02 provenance tags.

/** The five provenance tags (R1 principle 2). The UI shows them as three badges (D-02). */
export type Tag = 'measured' | 'derived' | 'model_dependent' | 'inferred_from_analog' | 'artistic';

export const TAGS: readonly Tag[] = [
  'measured',
  'derived',
  'model_dependent',
  'inferred_from_analog',
  'artistic',
];

export interface TV<T = number> {
  value: T | null; // null = unknown, never a guess
  err?: number | [number, number];
  tag: Tag;
  source: string; // e.g. "JPL SBDB", "SPHEREx QR2 (this tool)", "Lisse et al. 2026 ApJL 1000 L52"
  formula?: string; // required when tag === 'derived'
  assumption?: string; // required when tag === 'model_dependent'
}
