// R8.6, R8.9, D-10, D-12: the `pitch` (0–1) of a HapticEvent and its frequency. One mapping for the
// audio driver, the spectrum source and the Listen sweep, so sound and touch match (R8.6 item 3).
// Pitch follows λ (R8.6/R8.9), not brightness as in the mock-up's sweep (Q-58).
import {
  DEFAULT_PITCH,
  PITCH_LAMBDA_MAX_UM,
  PITCH_LAMBDA_MIN_UM,
  PITCH_MIN_HZ,
  PITCH_OCTAVES,
  PITCH_RISES_TO_NORTH,
  PITCH_RISES_WITH_WAVELENGTH,
} from './tuning';

export function clamp01(x: number): number {
  return x <= 0 ? 0 : x >= 1 ? 1 : Number.isFinite(x) ? x : 0;
}

/** pitch 0–1 → Hz, exponential (equal steps sound equal). `undefined` or NaN → DEFAULT_PITCH. */
export function pitchToHz(pitch: number | undefined): number {
  const p = pitch === undefined || Number.isNaN(pitch) ? DEFAULT_PITCH : clamp01(pitch);
  return PITCH_MIN_HZ * 2 ** (p * PITCH_OCTAVES);
}

/**
 * λ (µm) → pitch 0–1 over [λmin, λmax], clamped. The default range is the SPHEREx band, so the same
 * λ sounds the same on every object (Q-58). A degenerate range gives the middle pitch.
 */
export function wavelengthToPitch(
  lambdaUm: number,
  lambdaMinUm: number = PITCH_LAMBDA_MIN_UM,
  lambdaMaxUm: number = PITCH_LAMBDA_MAX_UM,
): number {
  const span = lambdaMaxUm - lambdaMinUm;
  if (!(span > 0) || !Number.isFinite(lambdaUm)) return 0.5;
  const t = clamp01((lambdaUm - lambdaMinUm) / span);
  return PITCH_RISES_WITH_WAVELENGTH ? t : 1 - t;
}

/** D-12 gas giant bands: latitude (degrees, −90 south to 90 north) → pitch 0–1. */
export function latitudeToPitch(latitudeDeg: number): number {
  const t = clamp01((latitudeDeg + 90) / 180);
  return PITCH_RISES_TO_NORTH ? t : 1 - t;
}
