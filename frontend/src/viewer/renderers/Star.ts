// R7.5 stars: `star`, `star_mira`, `star_ttauri`. Pure plan; renderers/build.ts draws it.
//   Requires teff_K. Colour: Teff to sRGB through a blackbody table (derived) - the backend
//   supplies it in view_modes.visible, the viewer does not carry the table. Linear limb darkening
//   I(mu) = 1 - 0.6 (1 - mu) (model_dependent). `star`: proper-motion trail (measured).
//   `star_mira`: brightness follows the measured light curve; the +-10% radius pulsation is
//   artistic. `star_ttauri`: tilted disc and a dust screen whose opacity follows the light curve;
//   timing measured, geometry artistic.
import type { ObjectCard } from '@/contract';
import { litBody, median, PlanBuilder, type PlanInput } from '../planCommon';
import { NEUTRAL_TINT } from '../modes';
import type { RenderPlan, ScrubPlan } from '../planTypes';

export interface StarConfig {
  /**
   * Years of proper motion covered by the SPHEREx epochs, for the `star` motion trail (R7.5:
   * "drawn from pm_mas_yr over the SPHEREx epochs"). [verify]: the span is not in the card or the
   * specs. While null, the trail is refused as "unverified".
   */
  spherexBaselineYears: number | null;
}

export const STAR_CONFIG: StarConfig = { spherexBaselineYears: null };

/** Linear limb-darkening coefficient of R7.5, I(mu) = 1 - 0.6 (1 - mu). Tag model_dependent. */
export const LIMB_DARKENING_U = 0.6;

/** R7.5: radius pulsation of +-10% (artistic). */
export const PULSATION_AMPLITUDE = 0.1;

/** T Tauri disc geometry (R7.5: tilted RingGeometry, inclination 45-60°). All values artistic. */
export const TTAURI_DISC = { innerRadius: 1.4, outerRadius: 2.6, inclinationDeg: 50 } as const;
/** T Tauri dust screen: radius and distance in front of the star, scene units (artistic). */
export const TTAURI_SCREEN = { radius: 1.3, z: 1.6 } as const;
/** R7.5: screen opacity = clamp(1 - flux/median_flux, 0, 0.9). */
export const MAX_SCREEN_OPACITY = 0.9;

/** Lowest brightness drawn for a Mira at minimum light (display floor, artistic). */
export const MIRA_MIN_BRIGHTNESS = 0.05;

/**
 * ASSUMPTION: R7.5 excludes points "with SPHEREx saturation FLAGS"; which bit means saturation is
 * not specified here, so any non-zero `flags` excludes the point (the conservative choice).
 */
export function usableLightcurve(card: ObjectCard) {
  return (card.lightcurve ?? [])
    .filter((p) => p.flags === 0 && Number.isFinite(p.flux))
    .sort((a, b) => a.t_mjd - b.t_mjd);
}

/** Scrubbed point of the light curve, with flux relative to the brightest usable point. */
export function lightcurveScrub(card: ObjectCard, index: number): ScrubPlan | null {
  const pts = usableLightcurve(card);
  if (pts.length === 0) return null;
  const i = Math.min(Math.max(Math.round(index), 0), pts.length - 1);
  const max = Math.max(...pts.map((p) => p.flux));
  const p = pts[i]!;
  return {
    count: pts.length,
    index: i,
    tMjd: p.t_mjd,
    brightness: max > 0 ? Math.max(0, p.flux / max) : 0,
    flagged: (card.lightcurve ?? []).length - pts.length,
  };
}

/** R7.5: opacity = clamp(1 - flux/median_flux, 0, 0.9) at the scrubbed time. */
export function screenOpacity(card: ObjectCard, index: number): number | null {
  const pts = usableLightcurve(card);
  const med = median(pts.map((p) => p.flux));
  if (pts.length === 0 || med === null || med <= 0) return null;
  const p = pts[Math.min(Math.max(Math.round(index), 0), pts.length - 1)]!;
  return Math.min(MAX_SCREEN_OPACITY, Math.max(0, 1 - p.flux / med));
}

export function planStar(input: PlanInput, config: StarConfig = STAR_CONFIG): RenderPlan {
  const { card, params, ctx } = input;
  const b = new PlanBuilder(input);
  b.tintLegend = false; // the `colour` layer is the colour's legend line
  const type = params.type;

  const bodyOk = b.body('radius_rsun');
  const colour = b.draw('colour');
  const limb = b.draw('limb_darkening');

  const scrubbed = type === 'star_mira' || type === 'star_ttauri';
  const scrub = scrubbed ? lightcurveScrub(card, ctx.scrubIndex) : null;

  let brightness = 1;
  let radiusScale = 1;
  if (type === 'star_mira') {
    const curve = b.draw('brightness_curve');
    if (curve && scrub) brightness = Math.max(MIRA_MIN_BRIGHTNESS, scrub.brightness);
    else if (curve)
      b.notes.push('Every light-curve point is flagged, so brightness is not scaled.');
    if (b.draw('radius_pulsation') && scrub) {
      radiusScale = 1 - PULSATION_AMPLITUDE + 2 * PULSATION_AMPLITUDE * scrub.brightness;
    }
  }

  const discs: RenderPlan['discs'] = [];
  const screens: RenderPlan['screens'] = [];
  if (type === 'star_ttauri') {
    if (b.draw('disc')) discs.push({ id: 'disc', ...TTAURI_DISC });
    if (b.has('dust_screen')) {
      const opacity = screenOpacity(card, ctx.scrubIndex);
      if (b.ready('dust_screen') && opacity === null) {
        b.reject({ id: 'dust_screen', reason: 'data', detail: 'No usable light-curve point.' });
      } else if (b.draw('dust_screen') && opacity !== null) {
        screens.push({ id: 'dust_screen', ...TTAURI_SCREEN, opacity });
      }
    }
  }

  const trails: RenderPlan['trails'] = [];
  if (type === 'star' && b.has('motion_trail')) {
    const pm = card.pm_mas_yr?.value;
    if (b.ready('motion_trail') && config.spherexBaselineYears === null) {
      b.reject({
        id: 'motion_trail',
        reason: 'unverified',
        detail: 'The span of the SPHEREx epochs is not confirmed yet.',
      });
    } else if (b.draw('motion_trail') && pm && config.spherexBaselineYears !== null) {
      trails.push({ id: 'motion_trail', pm: [pm[0], pm[1]], years: config.spherexBaselineYears });
    }
  }

  if (!bodyOk) b.dropDrawn();
  if (bodyOk && !colour)
    b.notes.push('The star is plain grey: its colour is not shown at this level.');

  const tint = colour ? b.tint.rgb : NEUTRAL_TINT;
  const axes = [radiusScale, radiusScale, radiusScale] as [number, number, number];
  return b.build({
    bodies: bodyOk
      ? [
          litBody('body', axes, tint, {
            emissive: brightness,
            limbDarkening: limb,
            segments: [64, 32],
          }),
        ]
      : [],
    discs: bodyOk ? discs : [],
    screens: bodyOk ? screens : [],
    trails: bodyOk ? trails : [],
    scrub: bodyOk ? scrub : null,
    relief: 'illustrative',
  });
}
