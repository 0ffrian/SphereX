// Shared constants for the golden-frame tests (10.6 gates 2 and 6).

/**
 * Minimum mean SSIM (8x8 luminance windows, see ssim.ts) for a frame to match its golden.
 * [verify] Tuned on SwiftShader reruns (min 0.9996 over two full reruns on one machine) against the negative controls in
 * ssim.spec.ts (a 6 px shift, a 12% size change, heavy noise or a blank frame all score well below).
 * Re-tune if the CI rasteriser version changes and honest reruns start to fail.
 */
export const GOLDEN_MIN_SSIM = 0.97;

/** Minimum SSIM of the worst colour channel (R, G or B). [verify] tuned like GOLDEN_MIN_SSIM. */
export const GOLDEN_MIN_CHANNEL_SSIM = 0.97;

/**
 * Maximum mean absolute colour difference (0..255 per channel) over lit pixels. A 15% desaturation
 * or a hue rotation moves this by to about 9 and about 110 (ssim.spec.ts; luminance SSIM stays 0.9999 for the desaturation); rerun noise was at most 0.11.
 * [verify] tuned on SwiftShader reruns.
 */
export const GOLDEN_MAX_COLOUR_DELTA = 4;

/**
 * The viewer's deep-space background (ViewerApp SPACE_BACKGROUND, 0x05060a) in 8-bit sRGB, checked
 * at a canvas corner. The SSIM and colour terms both ignore dark flat regions, so a background lost in
 * the HDR pass (it once came out black) needs its own check. Tolerance in levels per channel.
 */
export const SPACE_BACKGROUND_RGB = [5, 6, 10] as const;
export const BACKGROUND_TOLERANCE = 2;
