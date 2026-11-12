// R13.12 item 5 (Q-443, Q-446): ISO 226 equal-loudness weights for the spectrum chord. A playback
// (perception) correction, not data: it never changes a tag, and the UI labels it "Loudness-corrected".
//
// Source: ISO 226:2003, Table 1 (α_f, L_U, T_f) and formula (1), as reproduced in J. Tackett's
// `iso226.m` (MathWorks File Exchange, BSD licence). [verify] against the standard (R12): the numbers
// were copied, not checked against a copy of ISO 226. The 2023 revision moves the contours by less
// than 0.5 dB over 20–90 phon (research notes §2.4), so the 2003 table is kept and named.
// Only the 1/3-octave rows 200–1250 Hz are kept (the chord spans about 236–1083 Hz); outside that
// range the edge row is used (clamped, never extrapolated).
import { CHORD_ISO_CAP_DB, CHORD_ISO_PHON } from './tuning';

/** ISO 226:2003 Table 1 rows: frequency (Hz), α_f, L_U (dB), T_f (dB). [verify] */
const ROWS: readonly (readonly [number, number, number, number])[] = [
  [200, 0.315, -3.1, 14.4],
  [250, 0.301, -2.0, 11.4],
  [315, 0.288, -1.1, 8.6],
  [400, 0.276, -0.4, 6.2],
  [500, 0.267, 0.0, 4.4],
  [630, 0.259, 0.3, 3.0],
  [800, 0.253, 0.5, 2.2],
  [1000, 0.25, 0.0, 2.4],
  [1250, 0.246, -2.7, 3.5],
];

/** ISO 226:2003 formula (1): the sound pressure level (dB) of a pure tone at a table row, for `phon`. */
function lpAtRow(row: readonly [number, number, number, number], phon: number): number {
  const [, af, lu, tf] = row;
  const a = 4.47e-3 * (10 ** (0.025 * phon) - 1.15) + (0.4 * 10 ** ((tf + lu) / 10 - 9)) ** af;
  return (10 / af) * Math.log10(a) - lu + 94;
}

/**
 * The equal-loudness level L_p (dB SPL) at `hz` for `phon`: the formula at the table rows, linear in
 * log f between them, clamped to the edge rows outside 200–1250 Hz.
 */
export function equalLoudnessDb(hz: number, phon: number = CHORD_ISO_PHON): number {
  const first = ROWS[0]!;
  const last = ROWS[ROWS.length - 1]!;
  if (!(hz > first[0])) return lpAtRow(first, phon);
  if (hz >= last[0]) return lpAtRow(last, phon);
  let i = 0;
  while (ROWS[i + 1]![0] < hz) i++;
  const r0 = ROWS[i]!;
  const r1 = ROWS[i + 1]!;
  const t = Math.log(hz / r0[0]) / Math.log(r1[0] / r0[0]);
  return lpAtRow(r0, phon) + t * (lpAtRow(r1, phon) - lpAtRow(r0, phon));
}

/**
 * The boost (dB) that makes a tone at `hz` as loud as 1 kHz at CHORD_ISO_PHON, capped at
 * +CHORD_ISO_CAP_DB. Negative when the tone needs less level than 1 kHz.
 */
export function loudnessWeightDb(hz: number): number {
  const w = equalLoudnessDb(hz) - equalLoudnessDb(1000);
  return Math.min(CHORD_ISO_CAP_DB, w);
}
