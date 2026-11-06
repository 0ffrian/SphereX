// Shared constants for the golden-frame tests (10.6 gates 2 and 6).

/**
 * Minimum mean SSIM (8x8 luminance windows, see ssim.ts) for a frame to match its golden.
 * [verify] Tuned on SwiftShader reruns (min 0.9996 over two full reruns on one machine) against the negative controls in
 * ssim.spec.ts (a 6 px shift, a 12% size change, heavy noise or a blank frame all score well below).
 * Re-tune if the CI rasteriser version changes and honest reruns start to fail.
 */
export const GOLDEN_MIN_SSIM = 0.97;
