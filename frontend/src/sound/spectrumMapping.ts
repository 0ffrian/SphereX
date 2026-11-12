// R8.6, R8.9: the one spectrum → sample mapping. The spectrum haptics source (#10) and the Listen
// sweep (#11) both use it, so touch and sound match (R8.6 item 3). Pure: no browser globals.
//   - flagged and non-finite points are dropped, the rest sorted by λ; points at the same λ are
//     averaged (mean flux, mean σ)
//   - strength = flux ÷ the largest flux of those points, linearly interpolated in λ, clamped 0–1
//   - quiet when strength < 0.2 (absorption dips go silent in both channels)
//   - noisy when σ/flux > 0.3 at the nearest point (its source jitters the tick spacing)
//   - pitch from λ (pitch.ts)
import type { SpectrumPoint } from '@/app/api/types';
import { wavelengthToPitch } from './pitch';
import { SPECTRUM_NOISY_SIGMA_RATIO, SPECTRUM_QUIET_THRESHOLD } from './tuning';

export type SpectrumMappingPoint = Pick<
  SpectrumPoint,
  'wavelength_um' | 'flux' | 'error' | 'flagged'
>;

export interface SpectrumSample {
  wavelengthUm: number;
  /** Normalised flux, 0–1. */
  strength: number;
  quiet: boolean;
  noisy: boolean;
  /** 0–1, from λ. */
  pitch: number;
}

/** One usable point after the merge (R13.12 chord bins use points, never interpolated samples, Q-446). */
export interface MappedPoint {
  wavelengthUm: number;
  /** Flux ÷ the largest usable flux (may be negative or 0 for a non-positive flux; not clamped). */
  strength: number;
  /** σ/flux: NaN when there is no finite positive σ; +Infinity when flux ≤ 0 with a σ. */
  sigmaRatio: number;
}

export interface SpectrumMapping {
  /** No usable point (none left, or no positive flux): nothing can be felt or heard. */
  readonly empty: boolean;
  /** λ range of the usable points (µm); NaN when empty. */
  readonly lambdaMinUm: number;
  readonly lambdaMaxUm: number;
  /** Usable points kept (one per distinct λ), sorted by λ. */
  readonly count: number;
  /**
   * The sample at λ, or null outside the usable range (or when empty). Pass `out` to reuse one
   * object in a pointermove handler.
   */
  sampleAt(lambdaUm: number, out?: SpectrumSample): SpectrumSample | null;
  /** The usable points (flagged and non-finite dropped, equal λ merged), sorted by λ; [] when empty. */
  points(): readonly MappedPoint[];
}

/** σ/flux of one point: NaN without a finite positive σ, +Infinity when flux ≤ 0 with a σ. */
export function sigmaRatio(flux: number, error: number): number {
  if (!Number.isFinite(error) || error <= 0) return NaN;
  if (!(flux > 0)) return Infinity;
  return error / flux;
}

export function isNoisy(flux: number, error: number): boolean {
  if (!Number.isFinite(error) || error <= 0) return false;
  if (!(flux > 0)) return true;
  return error / flux > SPECTRUM_NOISY_SIGMA_RATIO;
}

interface Merged {
  wavelength_um: number;
  flux: number;
  error: number;
}

/**
 * Points that share a λ (two frames at the same wavelength) become one: the mean flux and the mean
 * σ. The mean σ, not the σ of the mean, so averaging does not make a noisy point feel smooth.
 */
function mergeSameWavelength(sorted: readonly SpectrumMappingPoint[]): Merged[] {
  const out: Merged[] = [];
  let i = 0;
  while (i < sorted.length) {
    const l = sorted[i]!.wavelength_um;
    // Running means (m += (x − m) / n), so two huge values cannot overflow to Infinity.
    let flux = 0;
    let error = 0;
    let errors = 0;
    let n = 0;
    for (; i < sorted.length && sorted[i]!.wavelength_um === l; i++) {
      n++;
      flux += (sorted[i]!.flux - flux) / n;
      if (Number.isFinite(sorted[i]!.error)) {
        errors++;
        error += (sorted[i]!.error - error) / errors;
      }
    }
    // A mean that still is not finite (opposite extremes) is refused, like any non-finite flux.
    if (Number.isFinite(flux)) {
      out.push({ wavelength_um: l, flux, error: errors > 0 ? error : NaN });
    }
  }
  return out;
}

export function buildSpectrumMapping(points: readonly SpectrumMappingPoint[]): SpectrumMapping {
  const usable = mergeSameWavelength(
    points
      .filter((p) => !p.flagged && Number.isFinite(p.wavelength_um) && Number.isFinite(p.flux))
      .sort((a, b) => a.wavelength_um - b.wavelength_um),
  );
  const maxFlux = usable.reduce((m, p) => Math.max(m, p.flux), -Infinity);
  const empty = usable.length === 0 || !(maxFlux > 0) || !Number.isFinite(maxFlux);

  const n = empty ? 0 : usable.length;
  const lambda = new Float64Array(n);
  const norm = new Float64Array(n);
  const noisy = new Uint8Array(n);
  const mapped: MappedPoint[] = [];
  for (let i = 0; i < n; i++) {
    const p = usable[i]!;
    lambda[i] = p.wavelength_um;
    norm[i] = Math.max(0, p.flux / maxFlux);
    noisy[i] = isNoisy(p.flux, p.error) ? 1 : 0;
    mapped.push({
      wavelengthUm: p.wavelength_um,
      strength: p.flux / maxFlux,
      sigmaRatio: sigmaRatio(p.flux, p.error),
    });
  }
  Object.freeze(mapped);
  const lambdaMinUm = n > 0 ? lambda[0]! : NaN;
  const lambdaMaxUm = n > 0 ? lambda[n - 1]! : NaN;

  function sampleAt(lambdaUm: number, out?: SpectrumSample): SpectrumSample | null {
    if (n === 0 || !(lambdaUm >= lambdaMinUm && lambdaUm <= lambdaMaxUm)) return null;
    // First index with λ ≥ lambdaUm (binary search).
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lambda[mid]! < lambdaUm) lo = mid + 1;
      else hi = mid;
    }
    const i1 = lo;
    const i0 = i1 > 0 ? i1 - 1 : 0;
    const l0 = lambda[i0]!;
    const l1 = lambda[i1]!;
    const t = l1 > l0 ? (lambdaUm - l0) / (l1 - l0) : 1;
    const strength = Math.min(1, Math.max(0, norm[i0]! + t * (norm[i1]! - norm[i0]!)));
    const nearest = t < 0.5 ? i0 : i1;
    const s = out ?? ({} as SpectrumSample);
    s.wavelengthUm = lambdaUm;
    s.strength = strength;
    s.quiet = strength < SPECTRUM_QUIET_THRESHOLD;
    s.noisy = noisy[nearest] === 1;
    s.pitch = wavelengthToPitch(lambdaUm);
    return s;
  }

  return { empty, lambdaMinUm, lambdaMaxUm, count: n, sampleAt, points: () => mapped };
}
