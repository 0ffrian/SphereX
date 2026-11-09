// Display brightening of asteroids (artistic, PR #63 review and approval follow-up 1). Pure: the
// factor is computed here and applied by build.ts to the material colour.
//
// A dark C-type map (brightness 0.12 + 1.6 albedo, R6.2) read at about 1.8:1 against the sky at the
// common exposure, so it is multiplied up. A fixed factor clipped bright bodies (E- and V-types came
// out flat white), so the factor is capped: it brings the mean linear reflectance of the surface up
// to ASTEROID_LIFT_TARGET and never lifts by more than ASTEROID_ALBEDO_LIFT or less than 1 (a bright
// body is shown as it is, never darkened). The card's albedo and the baked map are not changed.
import { isTagShown } from '../honesty';
import type { PlanBuilder } from '../planCommon';
import type { Rgb } from '../planTypes';

/** Largest lift (artistic). The C-type fixture map (mean 0.070 linear) reaches the target at about this. */
export const ASTEROID_ALBEDO_LIFT = 6;

/**
 * Mean linear reflectance the lift aims for (artistic, a display choice). 0.42 keeps the C-type look
 * the review accepted (6 x 0.070) and leaves headroom: at the scene's light (DIRECTIONAL_INTENSITY 2,
 * a Lambert surface) the lit side stays near 0.27 of full scale at normal incidence, so it does not
 * clip.
 */
export const ASTEROID_LIFT_TARGET = 0.42;

const toLinear = (s: number): number =>
  s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);

/** Rec. 709 luma in linear light of an sRGB colour (0..1 channels). */
export function rgbLinearLuma(rgb: Rgb): number {
  return 0.2126 * toLinear(rgb[0]) + 0.7152 * toLinear(rgb[1]) + 0.0722 * toLinear(rgb[2]);
}

/**
 * The factor for a surface of mean linear luma `meanLinear`:
 * `clamp(ASTEROID_LIFT_TARGET / meanLinear, 1, ASTEROID_ALBEDO_LIFT)`. An unreadable mean (no canvas,
 * a test environment) answers the cap, the factor used before the cap existed.
 */
export function displayLift(meanLinear: number | null): number {
  if (meanLinear === null || !Number.isFinite(meanLinear) || meanLinear <= 0) {
    return ASTEROID_ALBEDO_LIFT;
  }
  return Math.min(ASTEROID_ALBEDO_LIFT, Math.max(1, ASTEROID_LIFT_TARGET / meanLinear));
}

export const DISPLAY_LIFT_TEXT = `Brightened for display so the lit side is readable: at most ${ASTEROID_ALBEDO_LIFT} times, less for a bright surface. This is an artist's display choice; the albedo on the card is unchanged.`;

/**
 * Says so wherever the lift applies. From + Artistic it is a legend line tagged `artistic`; at
 * + Estimated the legend lists only Estimated and stronger tags (renderPlan invariant), so it is a
 * note there instead. Never at Measured only, where nothing is lifted.
 */
export function noteDisplayLift(b: PlanBuilder): void {
  if (isTagShown(b.input.ctx.honesty, 'artistic')) {
    b.drawn.push({ id: 'display_lift', tag: 'artistic', tier: 5, description: DISPLAY_LIFT_TEXT });
  } else {
    b.notes.push(DISPLAY_LIFT_TEXT);
  }
}
