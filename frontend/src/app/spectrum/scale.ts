// Linear scales and "nice" ticks for the hand-rolled SVG spectrum chart.

export type Domain = readonly [number, number];

export interface LinearScale {
  (v: number): number;
  domain: Domain;
  range: Domain;
}

export function linearScale(domain: Domain, range: Domain): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  const f = ((v: number) =>
    span === 0 ? (r0 + r1) / 2 : r0 + ((v - d0) / span) * (r1 - r0)) as LinearScale;
  f.domain = domain;
  f.range = range;
  return f;
}

/** Tick step of 1, 2 or 5 × 10^k giving about `count` ticks across the domain. */
export function niceStep(span: number, count: number): number {
  if (!(span > 0) || count < 1) return 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  // Geometric midpoints between 1, 2, 5 and 10 (√2, √10, √50), so the tick count stays near `count`.
  const nice = norm >= Math.sqrt(50) ? 10 : norm >= Math.sqrt(10) ? 5 : norm >= Math.SQRT2 ? 2 : 1;
  return nice * mag;
}

/** Never return more ticks than this, whatever the domain. */
export const MAX_TICKS = 50;

/**
 * Ticks inside the domain, on multiples of a nice step. Rounded to drop float noise. Each tick is
 * computed as start + k·step (no running sum), the loop is capped at MAX_TICKS, and it stops if a
 * step no longer changes the value (a step below the float resolution of the domain).
 */
export function niceTicks(domain: Domain, count = 5): number[] {
  const [a, b] = domain[0] <= domain[1] ? domain : [domain[1], domain[0]];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [];
  const step = niceStep(b - a, count);
  // Finite endpoints can still overflow (b − a = Infinity); no ticks rather than NaN ticks.
  if (!Number.isFinite(step) || step <= 0) return [];
  const start = Math.ceil(a / step - 1e-9) * step;
  const digits = Math.min(100, Math.max(0, -Math.floor(Math.log10(step)) + 1));
  const ticks: number[] = [];
  let prev = Number.NaN;
  for (let k = 0; k < MAX_TICKS; k++) {
    const v = start + k * step;
    if (v > b + step * 1e-9 || v === prev) break;
    ticks.push(Number(v.toFixed(digits)));
    prev = v;
  }
  return ticks;
}

/** Below this span relative to the values' magnitude, the extent counts as flat. */
const FLAT_RELATIVE = 1e-9;
/** A flat extent is widened by this fraction of the values' magnitude on each side. */
const FLAT_PAD_RELATIVE = 0.05;

/**
 * [min, max] of the values, padded by `pad` × span on each side. A flat (or float-noise) extent,
 * such as a single point, is widened relative to the values' magnitude, so 0.8 µm stays near
 * 0.8 and a flux of 1e-17 stays near 1e-17; only an extent at exactly 0 gets ±1.
 */
export function paddedExtent(values: readonly number[], pad = 0.05): Domain {
  if (values.length === 0) return [0, 1];
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo;
  const magnitude = Math.max(Math.abs(lo), Math.abs(hi));
  if (span <= magnitude * FLAT_RELATIVE) {
    const mid = (lo + hi) / 2;
    const half = magnitude > 0 ? magnitude * FLAT_PAD_RELATIVE : 1;
    return [mid - half, mid + half];
  }
  return [lo - span * pad, hi + span * pad];
}

/** Y extent that includes every error bar, padded. */
export function extentWithErrors(
  points: readonly { value: number; error: number }[],
  pad = 0.08,
): Domain {
  const values: number[] = [];
  for (const p of points) values.push(p.value - p.error, p.value + p.error);
  return paddedExtent(values, pad);
}
