// D-36, Q-266: the data-confidence formula as LaTeX strings and plain text. Pure functions of the
// backend's `RenderParams.confidence`. The backend computes the score; this file only lays out its
// terms and checks the sum against it (Q-266), it never replaces the backend's number.
import type { Confidence } from './confidenceGate';

export type ConfidenceInput = Confidence['inputs'][number];

/** General formula, as in D-36. */
export const GENERAL_LATEX = String.raw`C=\dfrac{\sum_i w_i\,c_i}{\sum_i w_i}`;

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

/** Mock-up wording (mockup/spherex-ui.html, #popAcc). */
export const C_TABLE_LINES: readonly string[] = [
  'c = 1: satellite data, or physics from measured values',
  'c = 0.5: model-dependent, or physics with an assumed input',
  'c = 0: estimated from a similar object, drawn, or missing',
];
export const C_TABLE_LATEX = String.raw`\begin{array}{ll}c=1 & \text{measured, or physics from measured values}\\ c=\tfrac{1}{2} & \text{model-dependent, or physics with an assumed input}\\ c=0 & \text{estimated from a similar object, drawn, or missing}\end{array}`;

export type Part = 'd' | 'p' | 'a';
/** Q-267: the mock-up's three parts, mapped from the real tags. d = measured (Satellite data),
 *  p = derived or model_dependent (Physics), a = inferred_from_analog, artistic, missing: these add
 *  0 to the score (the chip colour; the chip text of an analog still reads "Estimated", D-02). */
export function partOf(tag: string): Part {
  if (tag === 'measured') return 'd';
  if (tag === 'derived' || tag === 'model_dependent') return 'p';
  return 'a';
}

export const PART_INFO: Record<Part, { label: string; note: string }> = {
  d: { label: 'Satellite data', note: 'measured by SPHEREx, Gaia and other archives' },
  p: { label: 'Physics', note: 'worked out from the data with a formula' },
  a: { label: 'Assumed', note: 'not narrowed by data: similar objects, drawn detail, or missing' },
};

/** Each part's contribution to the score, 0..1 (issue #71 review): the backend's measured,
 *  estimated and assumed shares, the same numbers as the chip and the Details bar, so the three
 *  agree. d + p is the score; a is the rest (1 - score), including the part of a model value that
 *  the data does not narrow. */
export function partShares(c: Confidence): Record<Part, number> {
  return { d: c.measured_share, p: c.estimated_share, a: c.assumed_share };
}

/** The row chip: text and part (colour). A derived row with c below 1 has an assumed input. */
export function tagChip(i: ConfidenceInput): { text: string; part: Part } {
  switch (i.tag) {
    case 'measured':
      return { text: 'Satellite data', part: 'd' };
    case 'derived':
      return i.c < 1
        ? { text: 'Physics, one input assumed', part: 'p' }
        : { text: 'Physics', part: 'p' };
    case 'model_dependent':
      return { text: 'Physics, from a model', part: 'p' };
    case 'inferred_from_analog':
      return { text: 'Estimated, from a similar object', part: 'a' };
    case 'artistic':
      return { text: 'Assumed, drawn', part: 'a' };
    default:
      return { text: 'Missing', part: 'a' };
  }
}

/** Points one row adds, out of its weight (the mock-up's "Points" column). */
export function rowPoints(i: ConfidenceInput): string {
  return `${Math.round(i.c * i.weight * 10) / 10} / ${num(i.weight)}`;
}

function cTex(x: number): string {
  return x === 1 ? '1' : x === 0.5 ? String.raw`\tfrac{1}{2}` : num(x);
}
function cTxt(x: number): string {
  return num(x);
}

/** This object's numbers substituted, as in the mock-up. Terms with c = 0 fold into "+ 0". The
 *  final value is the backend's score, never the sum of the rows (Q-266). */
export function substitutionLatex(c: Confidence): string {
  const t = formulaTerms(c);
  if (c.inputs.length === 0 || t.denominator <= 0) return `C = ${two(c.score)}`;
  const terms = c.inputs.filter((i) => i.c > 0);
  const fold = terms.length < c.inputs.length ? '+0' : '';
  const top = terms.map((i) => `${num(i.weight)}\\cdot ${cTex(i.c)}`).join('+') + fold;
  return `C=\\dfrac{${top}}{${num(t.denominator)}}=\\dfrac{${num(round1(t.numerator))}}{${num(t.denominator)}}=${two(c.score)}`;
}

export function substitutionPlain(c: Confidence): string {
  const t = formulaTerms(c);
  if (c.inputs.length === 0 || t.denominator <= 0) return `C = ${two(c.score)}`;
  const terms = c.inputs.filter((i) => i.c > 0);
  const fold = terms.length < c.inputs.length ? ' + 0' : '';
  const top = terms.map((i) => `${num(i.weight)}·${cTxt(i.c)}`).join(' + ') + fold;
  return `C = (${top}) / ${num(t.denominator)} = ${num(round1(t.numerator))} / ${num(t.denominator)} = ${two(c.score)}`;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
function two(x: number): string {
  return (Math.round(x * 100) / 100).toFixed(2);
}

export function gateLatex(threshold: number): string {
  return `\\text{3D body shown}\\iff \\text{class known}\\ \\wedge\\ \\text{key measurement}\\ \\wedge\\ C\\ge ${num(threshold)}`;
}
export function gatePlain(threshold: number): string {
  return `3D body shown only if: class known AND key measurement AND C ≥ ${num(threshold)}`;
}
export function generalPlain(): string {
  return 'C = Σ wᵢ·cᵢ / Σ wᵢ';
}
