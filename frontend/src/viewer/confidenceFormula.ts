// D-36, Q-266: the data-confidence formula as LaTeX strings and plain text. Pure functions of the
// backend's `RenderParams.confidence`. The backend computes the score; this file only lays out its
// terms and checks the sum against it (Q-266), it never replaces the backend's number.
import type { Confidence } from './confidenceGate';

export type ConfidenceInput = Confidence['inputs'][number];

/** General formula, as in D-36. */
export const GENERAL_LATEX = String.raw`C = \frac{\sum_i w_i c_i}{\sum_i w_i}`;

/** The c-value table (Q-221), plain words. `model_dependent` and the assumed-input `derived` use
 *  the backend's placeholder 0.5 (both [verify] in confidence.py). */
export const C_TABLE: readonly { source: string; c: string; why: string }[] = [
  { source: 'Measured', c: '1', why: 'the value comes straight from an instrument or catalogue' },
  { source: 'Derived from measured values', c: '1', why: 'a formula of measured values' },
  { source: 'Derived with an assumed input', c: '0.5', why: 'a placeholder share' },
  { source: 'Model dependent', c: '0.5', why: 'a model fit narrows the range part way' },
  { source: 'Inferred from an analog, artistic or missing', c: '0', why: 'no data behind it' },
];

/** Largest allowed gap between the backend score and the sum of the rounded rows. The backend
 *  rounds each `c` to 4 decimals before sending, so the sum can differ by about 1e-4 per row. */
export const SCORE_TOLERANCE = 0.001;

/** A number as short LaTeX: at most 4 decimals, no trailing zeros. */
export function num(x: number): string {
  if (!Number.isFinite(x)) return '0';
  return String(Math.round(x * 1e4) / 1e4);
}

export interface FormulaTerms {
  /** `sum(w c) / sum(w)` from the rows, or null when there are no rows or no weight. */
  fromRows: number | null;
  /** The backend's score: the value shown. */
  shown: number;
  /** True when rows and backend agree within the tolerance (or there are no rows to compare). */
  agrees: boolean;
  /** Σ w c and Σ w. */
  numerator: number;
  denominator: number;
}

export function formulaTerms(c: Confidence): FormulaTerms {
  const denominator = c.inputs.reduce((s, i) => s + i.weight, 0);
  const numerator = c.inputs.reduce((s, i) => s + i.weight * i.c, 0);
  const fromRows = denominator > 0 ? numerator / denominator : null;
  const agrees = fromRows === null || Math.abs(fromRows - c.score) <= SCORE_TOLERANCE;
  return { fromRows, shown: c.score, agrees, numerator, denominator };
}

/** This object's terms substituted into the general formula. The result is the backend's score. */
export function substitutionLatex(c: Confidence): string {
  const t = formulaTerms(c);
  if (c.inputs.length === 0 || t.denominator <= 0) return `C = ${num(c.score)}`;
  const top = c.inputs.map((i) => `${num(i.weight)} \\cdot ${num(i.c)}`).join(' + ');
  const bottom = c.inputs.map((i) => num(i.weight)).join(' + ');
  return `C = \\frac{${top}}{${bottom}} = \\frac{${num(t.numerator)}}{${num(t.denominator)}} \\approx ${num(c.score)}`;
}

/** The gate rule with the real threshold. */
export function gateLatex(threshold: number): string {
  return `C \\ge ${num(threshold)}`;
}

/** Plain-text twins, used when KaTeX throws (never blank). */
export function generalPlain(): string {
  return 'C = (sum of w_i x c_i) / (sum of w_i)';
}

export function substitutionPlain(c: Confidence): string {
  const t = formulaTerms(c);
  if (c.inputs.length === 0 || t.denominator <= 0) return `C = ${num(c.score)}`;
  const top = c.inputs.map((i) => `${num(i.weight)} x ${num(i.c)}`).join(' + ');
  const bottom = c.inputs.map((i) => num(i.weight)).join(' + ');
  return `C = (${top}) / (${bottom}) = ${num(t.numerator)} / ${num(t.denominator)}, about ${num(c.score)}`;
}

export function gatePlain(threshold: number): string {
  return `C is at least ${num(threshold)}`;
}
