// Eros demo helpers shared by the card, the sky layer and the player: times, detectors and the
// path position at a time. Pure; ported from the mock-up's `kn*` block (mockup/spherex-ui.html).
import type { ErosDemo, ErosHop } from './areaService';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number) => String(n).padStart(2, '0');

/** ISO time (UTC) to modified Julian date. */
export const isoToMjd = (s: string): number => Date.parse(s) / 86400000 + 40587;
const mjdDate = (m: number): Date => new Date((m - 40587) * 86400000);
/** "08:38" (UTC). */
export const mjdHM = (m: number): string => {
  const d = mjdDate(m);
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
};
/** "20 Mar" (UTC). */
export const mjdDay = (m: number): string => {
  const d = mjdDate(m);
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
};
export const mjdYear = (m: number): number => mjdDate(m).getUTCFullYear();
export const mjdHour = (m: number): number => mjdDate(m).getUTCHours();

/**
 * The six SPHEREx detectors and their bands in micrometres, as the mock-up lists them.
 * [verify] the band edges against the SPHEREx instrument paper before they leave the demo.
 */
export const DETECTORS: { name: string; lo: number; hi: number }[] = [
  { name: 'Detector 1', lo: 0.75, hi: 1.12 },
  { name: 'Detector 2', lo: 1.1, hi: 1.65 },
  { name: 'Detector 3', lo: 1.63, hi: 2.43 },
  { name: 'Detector 4', lo: 2.4, hi: 3.85 },
  { name: 'Detector 5', lo: 3.81, hi: 4.43 },
  { name: 'Detector 6', lo: 4.41, hi: 5.01 },
];

/** 0..5 from a frame's "D1".."D6". */
export const detectorIndex = (h: ErosHop): number => Number(h.detector.slice(1)) - 1;

/** The detectors that have an Eros exposure (the others are disabled). */
export function detectorsWithFrames(eros: ErosDemo): Set<number> {
  return new Set(eros.hops.map(detectorIndex));
}

/** Where Eros is on the demo sky image at a time (linear between the track points). */
export function trackAt(eros: ErosDemo, mjd: number): [number, number] {
  const T = eros.track;
  const first = T[0];
  const last = T[T.length - 1];
  if (!first || !last) return [0, 0];
  if (mjd <= isoToMjd(first.t)) return first.px;
  for (let i = 1; i < T.length; i++) {
    const b = T[i]!;
    const mb = isoToMjd(b.t);
    if (mjd <= mb) {
      const a = T[i - 1]!;
      const ma = isoToMjd(a.t);
      const f = (mjd - ma) / (mb - ma);
      return [a.px[0] + f * (b.px[0] - a.px[0]), a.px[1] + f * (b.px[1] - a.px[1])];
    }
  }
  return last.px;
}

/** A colour token's value (canvas cannot use `var()`); falls back to `fb` outside a browser. */
export function tok(name: string, fb: string): string {
  if (typeof document === 'undefined') return fb;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fb;
}
