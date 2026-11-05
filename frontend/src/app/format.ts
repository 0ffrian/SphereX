// Display formatting for the flipbook and spectrum. Fixed formats, no locale, so text and tests
// are the same on every machine.

const ISO_PARTS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/** Shown instead of a time when a string has no zone: it is never read as local time. */
export const TIME_WITHOUT_ZONE = 'time not stated in UTC';

/**
 * "2025-05-03 14:22:10 UTC". Only strings with `Z` or an explicit offset are parsed; a zone-less
 * string would be read as local time by `Date`, so it is refused.
 */
export function formatUtc(iso: string): string {
  if (!ISO_PARTS.test(iso)) return TIME_WITHOUT_ZONE;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return TIME_WITHOUT_ZONE;
  return `${new Date(ms).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

/** "1.234 µm" */
export function formatWavelength(um: number): string {
  return `${um.toFixed(3)} µm`;
}

/** Three significant figures; exponent form outside 0.001–99 999. */
export function formatNumber(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e-3 && a < 1e5) return String(Number(v.toPrecision(3)));
  return v.toExponential(2);
}

/** "3.1 ± 0.2 mJy" */
export function formatFlux(flux: number, error: number, unit: string): string {
  return `${formatNumber(flux)} ± ${formatNumber(error)} ${unit}`;
}

/** "RA 269.45208°, Dec +4.69339°" */
export function formatCoords(ra: number, dec: number): string {
  const sign = dec < 0 ? '−' : '+';
  return `RA ${ra.toFixed(5)}°, Dec ${sign}${Math.abs(dec).toFixed(5)}°`;
}
