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
  /**
   * Linear limb-darkening coefficient of the self-lit disc (issue #62). null refuses the layer as
   * "unverified" (nothing is invented).
   */
  limbU: number | null;
}

/**
 * ASSUMPTION [verify]: u = 0.6, the linear coefficient the spec gives for stars (R7.5, the
 * `limb_darkening` layer of the star). That is a visible-band solar value, used here as a
 * placeholder for an infrared view. No T-dwarf coefficient is confirmed here: published values
 * depend on the band and the model atmosphere (for example Claret et al. 2012 tabulate them for
 * cool dwarfs: about 0.25-0.29 at 3.6 and 4.5 um), so 0.6 is an analogue and the layer is
 * `inferred_from_analog` (Q-119), with this assumption in its `assumed` text, never `measured` or
 * `derived`. It makes a self-lit disc fade toward the limb instead of a flat
 * disc; a different `u` changes the depth of the fade, not the layer.
 */
export const BROWN_DWARF_LIMB_U: number | null = 0.6;

export const BROWN_DWARF_CONFIG: BrownDwarfConfig = {
  flux45Reference: null,
  limbU: BROWN_DWARF_LIMB_U,
};

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

/**
 * Seeded longitude offset of body B's copy of the shared baked map, in turns, in [0.25, 0.75) so it
 * is never close to A's. Deterministic from the seed (determinism rule); a look, `artistic`.
 */
export function binaryMapOffset(seed: number): number {
  const h = Math.imul((seed ^ 0x9e3779b9) >>> 0, 2654435761) >>> 0;
  return 0.25 + (h / 2 ** 32) * 0.5;
}

/** The infrared view's stripes come from the baked map, not from SPHEREx: said in the legend (PR #63). */
export const IR_STRIPES_NOTE =
  "The stripes are the artist's band map, drawn as brightness on the SPHEREx average colour. They are not from SPHEREx, which sees this dwarf as a single point.";

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

  // Limb darkening of the self-lit disc (issue #62): a disc that glows evenly to its edge looks
  // flat. Linear law, coefficient taken from an analogue (see BROWN_DWARF_LIMB_U), so `inferred_from_analog` (Q-119).
  let limbU: number | null = null;
  if (config.limbU === null) {
    if (bodyOk && b.has('limb_darkening')) {
      b.reject({
        id: 'limb_darkening',
        reason: 'unverified',
        detail: 'The limb-darkening coefficient for this kind of brown dwarf is not confirmed yet.',
        defaultShown: 'The disc is drawn evenly bright to its edge.',
      });
    }
  } else {
    offerLayer(
      b,
      viewerLayer(
        'limb_darkening',
        'inferred_from_analog',
        'The disc is fainter toward its edge, as a hot gas ball is: a standard linear law. The coefficient is the visible-band solar value, used as a placeholder for an infrared view; none is confirmed for this dwarf [verify].',
        {
          formula: 'I(mu) = 1 - u * (1 - mu)',
          assumed: {
            limb_darkening_u: config.limbU,
            basis:
              'the R7.5 visible-band solar value, used as a placeholder for an infrared view; no brown-dwarf value is confirmed [verify]',
          },
        },
      ),
    );
    if (bodyOk && b.draw('limb_darkening')) limbU = config.limbU;
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
  let irPattern = false;
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
      // In the infrared view the jets are refused (`mode`: Q-107 item 4), which used to leave a flat
      // disc. The baked band map stands in as brightness only (issue #62, Q-116).
      if (!bands && b.mode === 'spherex_ir')
        irPattern = b.draw('bands', { asset: tex?.albedo ?? null });
    }
    if (bands && depth !== null) {
      const rule = rhinesBands(motion, params.scale_m);
      const wind = motion.rates.jet_speed_ms;
      // Flattening needs a mass (f = 0.7 Omega^2 R^3 / (G M)). `flatteningRule` assumes Jupiter's
      // mean density, which is wrong for a brown dwarf (13 to 80 Jupiter masses at about one Jupiter
      // radius: f is 10 to 50 times smaller), and the card has no mass. So it is refused, not drawn
      // from the display cap (Q-109, D-32).
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
        limbU,
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
    if (b.mode === 'spherex_ir') {
      // The baked map is in the visible palette, so the infrared view takes its brightness only.
      bands = false;
      irPattern = b.draw('bands', { asset: tex?.albedo ?? null });
    } else {
      bands = b.drawBaked('bands', tex?.albedo);
    }
  }

  // Binary: two bodies on an illustrative orbit; without the orbit layer only the first is drawn.
  const orbit = binary ? b.draw('orbit') : false;
  const classes = binary ? binaryClasses(card.spectral_class?.value) : [];
  const twoBodies = binary && orbit && classes.length >= 2;
  // Said only when a body is drawn: at Measured only the size may be hidden and nothing is shown.
  if (binary && !orbit && bodyOk)
    b.notes.push(
      'Only the first body is shown: where the second sits is part of the illustrative orbit.',
    );
  if (binary && orbit && classes.length < 2 && bodyOk)
    b.notes.push('The spectral class does not name two components, so one body is shown.');
  if (!bodyOk) b.dropDrawn();

  if (irPattern) {
    const entry = b.drawn.find((d) => d.id === 'bands');
    // Said once: in the legend entry when `bands` is listed, else as a note (PR #63 review nit: a
    // screen reader read it twice).
    if (entry) entry.description = `${entry.description} ${IR_STRIPES_NOTE}`;
    else b.notes.push(IR_STRIPES_NOTE);
  }

  // The baked map in colour (visible view), or as brightness on the SPHEREx colour (infrared view).
  const texturedBands = (bands && !jetsMode) || irPattern;
  if (twoBodies && texturedBands)
    b.notes.push(
      "The two bodies share one band map; the second is turned by a seeded amount so they differ. That is the artist's look, not data.",
    );
  // Q-154: each body's own colour (from its class) and brightness (from its published Teff), when
  // the backend sent `components` and the layers pass the honesty state. The infrared view keeps the
  // whole-body SPHEREx colour, and a drawn band map is the colour itself, so neither takes the
  // per-class tint.
  const comps = twoBodies ? (params.components ?? null) : null;
  const flatTint = !(texturedBands && !irPattern);
  const colourPerBody =
    comps !== null && b.mode !== 'spherex_ir' && flatTint && b.draw('components');
  const brightnessPerBody =
    comps !== null &&
    comps.every((c) => c.emissive_scale !== null) &&
    b.draw('component_brightness');
  if (twoBodies) {
    const shared = [
      colourPerBody ? null : 'colour',
      brightnessPerBody ? null : 'brightness',
    ].filter((s): s is string => s !== null);
    if (shared.length === 2)
      b.notes.push(
        comps === null
          ? 'Both bodies share the system colour and brightness: per-class values are not specified.'
          : 'Both bodies share the system colour and brightness: the per-component values are not drawn in this view.',
      );
    else if (shared.length === 1) b.notes.push(`Both bodies share the system ${shared[0]}.`);
  }
  const make = (
    id: string,
    x: number,
    radius: number,
    offsetU = 0,
    part: number | null = null,
  ): BodyPlan =>
    litBody(
      id,
      [radius, radius, radius],
      !flatTint
        ? ([1, 1, 1] as Rgb)
        : colourPerBody && comps !== null && part !== null
          ? (comps[part]!.tint as Rgb)
          : b.tint.rgb,
      {
        position: [x, 0, 0],
        emissive:
          brightnessPerBody && comps !== null && part !== null
            ? emissive * (comps[part]!.emissive_scale ?? 1)
            : emissive,
        segments: [64, 32],
        albedoUrl: texturedBands ? (tex?.albedo ?? null) : null,
        albedoLuma: irPattern,
        ...(texturedBands && offsetU > 0 ? { albedoOffsetU: offsetU } : {}),
        limbDarkening: limbU !== null,
        limbU,
      },
    );
  const bodies: BodyPlan[] = !bodyOk
    ? []
    : twoBodies
      ? [
          make('body_a', -BINARY_OFFSET, BINARY_BODY_RADIUS, 0, 0),
          make('body_b', BINARY_OFFSET, BINARY_BODY_RADIUS, binaryMapOffset(params.seed), 1),
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
