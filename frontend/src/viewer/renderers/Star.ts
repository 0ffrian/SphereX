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
import type { PulsationPlan, RenderPlan, ScrubPlan, StarSurfacePlan } from '../planTypes';
import { processOf, resolveMotion, weakestTag } from '../motion/motion';
import { listMotion, offerLayer, spinPlanOf, viewerLayer } from '../motion/planMotion';
import { configFromModel, starRatesFrom, STAR_SURFACE } from '../bodies/starModel';
import {
  MAX_GROUPS_DRAWN,
  cellsForScale,
  closeUpTarget,
  granuleVisibility,
  stellarModel,
  type StellarModel,
} from '@/physics/stellar';
import type { TVNumber } from '@/contract';

export interface StarConfig {
  /**
   * Years of proper motion covered by the SPHEREx epochs, for the `star` motion trail (R7.5:
   * "drawn from pm_mas_yr over the SPHEREx epochs"). [verify]: the span is not in the card or the
   * specs. While null, the trail is refused as "unverified".
   */
  spherexBaselineYears: number | null;
  /**
   * Stellar mass for the surface physics (issue #71 stream C). ASSUMPTION: the card has no mass
   * field for a star (only `host_mass_msun` on planets), so the default returns null and the
   * physics is refused: the star keeps the placeholder look. Wire a real source (for example a
   * Gaia FLAME mass from stream B) here; a value must carry its own tag.
   */
  massMsun?: (card: ObjectCard) => TVNumber | null;
}

export const STAR_CONFIG: StarConfig = {
  spherexBaselineYears: null,
  massMsun: () => null,
};

/** Groups drawn on the `low` quality tier (the phone tier), against MAX_GROUPS_DRAWN. */
export const LOW_TIER_MAX_GROUPS = 4;

/** Linear limb-darkening coefficient of R7.5, I(mu) = 1 - 0.6 (1 - mu). Tag model_dependent. */
export const LIMB_DARKENING_U = 0.6;

/** R7.5: radius pulsation of +-10% (artistic). */
export const PULSATION_AMPLITUDE = 0.1;

/**
 * T Tauri disc geometry (R7.5, amended in issue #62: a flared, lit disc, tilted 45-60°). All
 * values are artistic: the radii, the tilt, and the flaring (half-thickness 0.14 at the inner edge,
 * growing as `r^1.25`, so the disc opens up with distance and its surface is lit at a graze). At 58°
 * the near edge of the disc projects well inside the star's outline, so the near half passes in
 * front of the star's upper part and the far half goes behind its lower part.
 */
export const TTAURI_DISC = {
  innerRadius: 1.3,
  outerRadius: 2.7,
  inclinationDeg: 58,
  heightAtInner: 0.14,
  flareExponent: 1.25,
} as const;
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

/**
 * R7.5.1: the surface layers the viewer states for a star, each with the tier its own rule earns
 * (D-32). The backend does not build them yet (stage 6, Q-60); a layer it offers under the same id
 * wins. Tiers, and why:
 *   granulation  5 artistic. The cell SIZE rule H ~ T/g needs the mass, and the constants (cell
 *                scale, lifetime) and a typical mass by class are all [verify] (R7.5.2), so none is
 *                used; the cells are drawn far larger than real ones so they can be seen anyway.
 *   spots        4 inferred_from_analog. How many groups are alive at once is a typical value for
 *                this kind of body, with the Sun as the analogue ([verify], R7.5.3); where they are
 *                comes from a seeded rule. Tier 1 only from measured region data (none exists).
 *   faculae      4, the same regions (R7.5.4); the contrast law is [verify].
 *   flares       the weaker of the flare rate's own tier and 4 (the places are the analogue's).
 *   prominences  4 for the placement along dipole field lines, 5 for the strand look (R7.5.5).
 *   glow         5 artistic.
 */
export function starSurfaceLayers(
  flareRateTag: import('@/contract').Tag | null,
  physics: { cellsEnlarged: boolean } | null = null,
) {
  const flareTag = weakestTag(flareRateTag ? [flareRateTag, 'inferred_from_analog'] : ['artistic']);
  return [
    physics && !physics.cellsEnlarged
      ? viewerLayer(
          'granulation',
          'model_dependent',
          'Convective cells and dark lanes at their modelled size: about eight pressure scale heights across, from the star\u2019s temperature, radius and mass. The pattern itself is not measured.',
        )
      : viewerLayer(
          'granulation',
          'artistic',
          physics
            ? 'Convective cells and dark lanes, drawn larger than real ones so they can be seen. The true size comes from the star\u2019s temperature, radius and mass; the enlarged pattern is an artist look.'
            : 'Convective cells and dark lanes, drawn far larger than real granules so they can be seen. How big real cells are depends on the star\u2019s mass and surface gravity, which are not on the card, so the pattern is an artist look.',
        ),
    viewerLayer(
      'spots',
      'inferred_from_analog',
      'A few sunspot groups alive at once, like the Sun: a leader, a broken-up follower and small pores, each with a dark centre and a streaky rim. How many, and where, is a typical value and a seeded rule, not a measurement.',
    ),
    viewerLayer(
      'faculae',
      'inferred_from_analog',
      'Bright patches around the spot groups that brighten towards the edge of the disc.',
    ),
    viewerLayer(
      'flares',
      flareTag,
      'Flares light two ribbons at a spot group on a seeded schedule at the flare rate. Each is drawn for a few seconds, and they start no more than about once every two seconds, so nothing flashes; the speed-up applies to the schedule.',
    ),
    viewerLayer(
      'prominences',
      'inferred_from_analog',
      'Loops of plasma along magnetic field lines between the leader and the follower of each group, seen best at the edge of the disc; a flare lifts them.',
    ),
    viewerLayer(
      'prominence_strands',
      'artistic',
      'The loops drawn as uneven, tapering strands (an artist look).',
    ),
    viewerLayer(
      'plasma',
      'model_dependent',
      'Glowing arches along the magnetic field lines of each spot group, with plasma that evaporates up from white-hot footpoints, cools and rains back down. Flare energy is capped by the group\u2019s magnetic energy; whether a flare opens or stays closed comes from the decay index (open above 1.5). The arch shape follows a standard model; the wisps are an artist look. Loops are drawn three times larger in the enlarged view.',
    ),
    viewerLayer('glow', 'artistic', 'A soft glow around the edge of the star (an artist look).'),
  ];
}

export function planStar(input: PlanInput, config: StarConfig = STAR_CONFIG): RenderPlan {
  const { card, params, ctx } = input;
  const b = new PlanBuilder(input);
  b.tintLegend = false; // the `colour` layer is the colour's legend line
  const type = params.type;

  // R7.5: the radius is optional. Without it the star is a unit sphere with no scale bar.
  const size = b.bodyOptionalSize('radius_rsun');
  let bodyOk = size.ok;
  if (bodyOk && size.sizeKnown) b.legendBody('Sphere at the radius on the card.');
  const colour = b.draw('colour');
  const limb = b.draw('limb_darkening');

  // Motion (R5.7, D-34): rates from `dynamics` by the tier chain, speed-ups as stated.
  const motion = resolveMotion(card, params);
  listMotion(b, motion);

  const scrubbed = type === 'star_mira' || type === 'star_ttauri';
  const scrub = scrubbed ? lightcurveScrub(card, ctx.scrubIndex) : null;

  let brightness = 1;
  let radiusScale = 1;
  let pulsation: PulsationPlan | null = null;
  if (type === 'star_mira') {
    const curve = b.draw('brightness_curve');
    if (curve && scrub) brightness = Math.max(MIRA_MIN_BRIGHTNESS, scrub.brightness);
    else if (curve)
      b.notes.push('Every light-curve point is flagged, so brightness is not scaled.');
    if (b.draw('radius_pulsation')) {
      // Q-65: the period is data (tier 1 or 2), the amplitude is art. With a stated pulsation
      // speed-up the radius follows the clock; otherwise it follows the scrubbed light-curve point.
      const proc = processOf(motion, 'pulsation');
      const period = motion.rates.pulsation_period_d;
      if (proc && period) {
        // Start where the scrubbed brightness puts the radius, so the two agree at clock time 0.
        const phase = scrub ? Math.asin(2 * Math.min(1, Math.max(0, scrub.brightness)) - 1) : 0;
        pulsation = { periodD: period.value, amplitude: PULSATION_AMPLITUDE, phase };
      } else if (scrub) {
        radiusScale = 1 - PULSATION_AMPLITUDE + 2 * PULSATION_AMPLITUDE * scrub.brightness;
      }
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

  // R7.5.1 surface layers, for stars that have a surface to draw them on (not a Mira: a giant).
  let star: StarSurfacePlan | null = null;
  if (bodyOk && type !== 'star_mira') {
    const flareRate = motion.rates.flare_rate_per_d;
    // Issue #71 stream C: the physics of the surface, when the card gives teff, radius and mass.
    const colourView = ctx.starColour ?? 'observatory';
    const scale = ctx.starScale ?? 'enlarged';
    const teff = card.teff_K?.value;
    const radius = card.radius_rsun?.value;
    const mass = config.massMsun?.(card) ?? null;
    const spinH = motion.rates.spin_period_h;
    let physics: StellarModel | null = null;
    if (typeof teff === 'number') {
      const r = stellarModel({
        teffK: teff,
        radiusRsun: typeof radius === 'number' ? radius : null,
        massMsun: mass ? mass.value : null,
        rotationPeriodD: spinH ? spinH.value / 24 : null,
        seed: params.seed,
        maxGroups: ctx.qualityTier === 'low' ? LOW_TIER_MAX_GROUPS : MAX_GROUPS_DRAWN,
      });
      physics = r.model;
      if (!r.model && r.notes) b.notes.push(...r.notes);
      if (physics) {
        const a = Object.values(physics.assumed);
        if (a.length)
          b.notes.push(
            `The surface physics assumes: ${a.join('; ')}. These are typical values, not measurements; the card is unchanged.`,
          );
      }
    } else {
      b.notes.push(
        'Cell size, magnetic field and spots are not computed: the card has no effective temperature. The surface is a typical look.',
      );
    }
    const cells = physics ? cellsForScale(physics, scale) : { cells: 30, artistic: true };
    const half = scale === 'close' && physics ? closeUpTarget(physics).halfWidth : 1.28;
    if (colourView === 'observatory')
      b.notes.push(
        'Observatory view is false-colour ultraviolet in the style of solar observatories: the colours are an artist look, not the star\u2019s real colour.',
      );
    else if (colourView === 'enhanced')
      b.notes.push(
        'Enhanced colour deepens the star\u2019s real hue so differences are easy to see.',
      );
    for (const l of starSurfaceLayers(flareRate ? flareRate.tag : null, {
      cellsEnlarged: cells.artistic,
    }))
      offerLayer(b, l);
    const flaresMoving = processOf(motion, 'flares') !== undefined;
    if (b.has('flares') && !flaresMoving && motion.rates.flare_rate_per_d) {
      b.notes.push('Flares are not drawn: no speed-up is stated for them.');
    }
    const granulation = b.draw('granulation');
    const spots = b.draw('spots');
    const faculae = b.draw('faculae');
    const flares = flaresMoving && b.draw('flares');
    const prominences = b.draw('prominences');
    const strands = prominences && b.draw('prominence_strands');
    const glow = b.draw('glow');
    const plasma = !!physics && physics.groups.length > 0 && flares && b.draw('plasma');
    if (granulation || spots || faculae || flares || prominences || glow || plasma) {
      star = {
        seed: params.seed,
        granulation,
        spots,
        faculae,
        flares,
        prominences,
        strands,
        glow,
        rates: starRatesFrom(motion),
        physics,
        config: physics ? configFromModel(physics, STAR_SURFACE) : null,
        colourView,
        scale,
        cellsAcross: cells.cells,
        granuleVisibility: physics ? granuleVisibility(cells.cells, half) : 1,
        cellsEnlarged: cells.artistic,
        plasma,
      };
    }
  }

  if (!bodyOk) b.dropDrawn();
  if (bodyOk && !size.sizeKnown) {
    if (b.drawn.length === 0) {
      // Nothing to show on a sphere of no known size: draw no body (never a bare grey ball).
      b.refuse({
        id: 'body',
        reason: 'data',
        fields: ['radius_rsun'],
        detail: 'The radius is unknown and no other layer can be shown on the sphere.',
      });
      bodyOk = false;
    } else {
      b.notes.push(
        'The radius is not on the card, so the sphere has no set size and there is no scale bar.',
      );
    }
  }
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
    tintUsed: colour,
    relief: 'illustrative',
    motion,
    spin: bodyOk && star ? spinPlanOf(motion) : null,
    star: bodyOk ? star : null,
    pulsation: bodyOk ? pulsation : null,
  });
}
