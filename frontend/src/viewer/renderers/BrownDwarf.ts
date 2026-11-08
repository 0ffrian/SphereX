// R7.4 `brown_dwarf` and `brown_dwarf_binary`. Pure plan; renderers/build.ts draws it.
//   Sphere of about 1 Jupiter radius (model_dependent), default view mode SPHEREx IR, band texture
//   baked by the backend (artistic), emissive intensity from normalised flux_45um (measured).
//   Binary (Eps Indi Ba T1 + Bb T6): two bodies on an illustrative orbit (artistic). No orbit
//   numbers are shown: period and separation are [verify].
import { litBody, numberField, PlanBuilder, type PlanInput } from '../planCommon';
import type { BodyPlan, JetSurfacePlan, RenderPlan, Rgb } from '../planTypes';
import { processOf, resolveMotion } from '../motion/motion';
import { listMotion, offerLayer, spinPlanOf, viewerLayer } from '../motion/planMotion';
import { rhinesBands } from './shaderSpec';
import { lightcurveScrub } from './Star';

export interface BrownDwarfConfig {
  /**
   * Reference flux at 4.5 µm used to normalise flux_45um to 0..1 (R7.4 "normalised flux_45um").
   * [verify]: the spec does not say what it is normalised by. While null, the emissive layer is
   * refused as "unverified" and the body glows at the default display level instead.
   */
  flux45Reference: number | null;
}

export const BROWN_DWARF_CONFIG: BrownDwarfConfig = { flux45Reference: null };

/** Glow used when no verified normalisation exists. A display level, not data (artistic). */
export const DEFAULT_EMISSIVE = 1;
/** Lowest glow drawn when flux is normalised, so a faint object is still visible (display floor, artistic). */
export const EMISSIVE_FLOOR = 0.2;

/** Offset of each body from the centre of a binary, in scene units. Illustrative (artistic). */
export const BINARY_OFFSET = 0.8;
/** Radius of each body of a binary, in scene units. Both are about 1 Jupiter radius (R7.4). */
export const BINARY_BODY_RADIUS = 0.5;

/** Band count when no rule gives one (artistic default; a brown dwarf has no mock-up default). */
export const DEFAULT_JET_BANDS = 10;
/** Turbulence and storms of a brown dwarf's jets (artistic display values). */
export const JET_TURBULENCE = 0.55;
export const JET_STORMS = 3;

export function emissiveIntensity(flux: number, reference: number): number {
  return Math.min(1, Math.max(EMISSIVE_FLOOR, flux / reference));
}

/** "T1+T6" -> ["T1", "T6"]. */
export function binaryClasses(spectralClass: string | null | undefined): string[] {
  return (spectralClass ?? '')
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function planBrownDwarf(
  input: PlanInput,
  config: BrownDwarfConfig = BROWN_DWARF_CONFIG,
): RenderPlan {
  const { card, params } = input;
  const b = new PlanBuilder(input);
  const binary = params.type === 'brown_dwarf_binary';
  const tex = params.textures;

  const sizeOk = b.body('radius_rjup');
  const bodyLayerOk = b.has('body') ? b.draw('body') : true;
  const bodyOk = sizeOk && bodyLayerOk;
  if (!b.has('body') && bodyOk) b.legendBody('Sphere of about one Jupiter radius.');

  // Emissive intensity: measured flux, normalised by a reference that is still [verify].
  let emissive = DEFAULT_EMISSIVE;
  if (b.has('emissive') && b.ready('emissive')) {
    const flux = numberField(card, 'flux_45um');
    if (config.flux45Reference !== null && flux !== null) {
      emissive = emissiveIntensity(flux, config.flux45Reference);
      b.draw('emissive');
    } else {
      b.reject({
        id: 'emissive',
        reason: 'unverified',
        detail: 'What the 4.5 µm flux is normalised by is not confirmed yet.',
        defaultShown: 'The body glows at a fixed level, not the measured 4.5 µm flux.',
      });
    }
  } else {
    b.draw('emissive');
  }

  // Motion (R5.7, D-34). With a stated winds speed-up the bands are drawn by the browser as moving
  // jets (counter-flowing, turbulent edges, drifting storms): a baked texture cannot move that way.
  // Without it the baked bands are drawn as before. Both are `artistic` (R7.4), so both are hidden
  // at the same honesty levels.
  const motion = resolveMotion(card, params);
  listMotion(b, motion);
  const winds = processOf(motion, 'winds');
  const bandsLayer = params.layers.find((l) => l.id === 'bands');
  const jetsMode =
    winds !== undefined && bandsLayer !== undefined && !params.missing.includes('bands');
  let bands: boolean;
  let jets: JetSurfacePlan | null = null;
  let scrub: RenderPlan['scrub'] = null;
  if (jetsMode) {
    offerLayer(
      b,
      viewerLayer(
        'jets',
        'artistic',
        'Counter-flowing jets with turbulent band edges and storms that drift and turn, drawn by the browser. The band contrast comes from the methane depth at 3.3 microns. The band count follows the Rhines rule when the spin and the wind speed are known, else an artist default.',
        {
          requires: bandsLayer.requires,
          formula: 'band contrast = clamp(2 * ch4_depth_33, 0.1, 0.8)',
        },
      ),
    );
    const depth = numberField(card, 'ch4_depth_33');
    // Band contrast comes from the CH4 depth; without it the jets are refused, not drawn with an
    // invented contrast (and not listed as drawn).
    if (depth === null) {
      b.refuse({
        id: 'jets',
        reason: 'data',
        detail: 'The band contrast needs the methane depth at 3.3 microns, which is missing.',
      });
      bands = false;
    } else {
      bands = b.drawBaked('jets', 'procedural');
    }
    if (bands && depth !== null) {
      const rule = rhinesBands(motion, params.scale_m);
      const wind = motion.rates.jet_speed_ms;
      // Flattening needs a mass (f = 0.7 Omega^2 R^3 / (G M)). `flatteningRule` assumes Jupiter's
      // mean density, which is wrong for a brown dwarf (13 to 80 Jupiter masses at about one Jupiter
      // radius: f is 10 to 50 times smaller), and the card has no mass. So it is refused, not drawn
      // from the display cap (Q-103/PR #52 review item 7, D-32).
      const flattening = 0;
      b.refuse({
        id: 'flattening',
        reason: 'data',
        detail:
          "The flattening needs the mass of the brown dwarf, which the card does not give; Jupiter's density does not apply here.",
      });
      jets = {
        seed: params.seed,
        bands: rule?.value ?? DEFAULT_JET_BANDS,
        turbulence: JET_TURBULENCE,
        storms: JET_STORMS,
        contrast: Math.min(0.8, Math.max(0.1, 2 * depth)),
        clouds: false,
        cover: 0,
        windMs: wind ? wind.value : null,
        radiusM: params.scale_m,
        flattening,
      };
      // R7.4: "brown-dwarf cloud cover follows the measured light curve". The timing is measured,
      // the cover it implies is a model (a dimmer dwarf has thicker cloud), tier 3.
      offerLayer(
        b,
        viewerLayer(
          'cloud_cover',
          'model_dependent',
          'Cloud patches whose cover follows the measured light curve: the dimmer the dwarf at the chosen time, the thicker the cover.',
          {
            requires: ['lightcurve'],
            formula: 'cover = 1 - flux / flux_max, from the usable light-curve points',
            assumed: { cloud_cover_vs_flux: 'dimming means thicker cloud cover' },
          },
        ),
      );
      const s = lightcurveScrub(card, input.ctx.scrubIndex);
      if (b.draw('cloud_cover') && s) {
        jets.clouds = true;
        jets.cover = 1 - s.brightness;
        scrub = s;
      } else if (b.ready('cloud_cover')) {
        b.notes.push('Every light-curve point is flagged, so the cloud cover is not scaled.');
      }
    } else if (bands) {
      bands = false;
    }
  } else {
    bands = b.drawBaked('bands', tex?.albedo);
  }

  // Binary: two bodies on an illustrative orbit; without the orbit layer only the first is drawn.
  const orbit = binary ? b.draw('orbit') : false;
  const classes = binary ? binaryClasses(card.spectral_class?.value) : [];
  const twoBodies = binary && orbit && classes.length >= 2;
  if (binary && !orbit)
    b.notes.push(
      'Only the first body is shown: where the second sits is part of the illustrative orbit.',
    );
  if (binary && orbit && classes.length < 2)
    b.notes.push('The spectral class does not name two components, so one body is shown.');
  if (twoBodies)
    b.notes.push(
      'Both bodies share the system colour and brightness: per-class values are not specified.',
    );

  if (!bodyOk) b.dropDrawn();

  const make = (id: string, x: number, radius: number): BodyPlan =>
    litBody(id, [radius, radius, radius], texturedBands ? ([1, 1, 1] as Rgb) : b.tint.rgb, {
      position: [x, 0, 0],
      emissive,
      segments: [64, 32],
      albedoUrl: texturedBands ? (tex?.albedo ?? null) : null,
    });
  const texturedBands = bands && !jetsMode;
  const bodies: BodyPlan[] = !bodyOk
    ? []
    : twoBodies
      ? [
          make('body_a', -BINARY_OFFSET, BINARY_BODY_RADIUS),
          make('body_b', BINARY_OFFSET, BINARY_BODY_RADIUS),
        ]
      : [make('body', 0, 1)];

  return b.build({
    bodies,
    motion,
    jets: bodyOk ? jets : null,
    scrub: bodyOk ? scrub : null,
    spin: bodyOk && jets ? spinPlanOf(motion) : null,
  });
}
