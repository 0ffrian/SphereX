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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function utcDate(iso: string): Date | null {
  if (!ISO_PARTS.test(iso)) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/** "15 Jan 03:00 UTC" (Area search visits, A18.3). Zone-less strings are refused as in formatUtc. */
export function formatVisitTime(iso: string): string {
  const d = utcDate(iso);
  if (!d) return TIME_WITHOUT_ZONE;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${hh}:${mm} UTC`;
}

/** "15 to 16 Jan 2026", "30 Jan 2026 to 2 Feb 2026" or "15 Jan 2026" (UTC days). */
export function formatUtcDayRange(firstIso: string, lastIso: string): string {
  const a = utcDate(firstIso);
  const b = utcDate(lastIso);
  if (!a || !b) return TIME_WITHOUT_ZONE;
  const day = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const sameMonth =
    a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
  if (sameMonth && a.getUTCDate() === b.getUTCDate()) return day(a);
  if (sameMonth) return `${a.getUTCDate()} to ${day(b)}`;
  return `${day(a)} to ${day(b)}`;
}
