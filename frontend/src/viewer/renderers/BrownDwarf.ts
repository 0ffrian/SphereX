// R7.4 `brown_dwarf` and `brown_dwarf_binary`. Pure plan; renderers/build.ts draws it.
//   Sphere of about 1 Jupiter radius (model_dependent), default view mode SPHEREx IR, band texture
//   baked by the backend (artistic), emissive intensity from normalised flux_45um (measured).
//   Binary (Eps Indi Ba T1 + Bb T6): two bodies on an illustrative orbit (artistic). No orbit
//   numbers are shown: period and separation are [verify].
import { litBody, numberField, PlanBuilder, type PlanInput } from '../planCommon';
import type { BodyPlan, RenderPlan, Rgb } from '../planTypes';

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

  const bands = b.drawBaked('bands', tex?.albedo);

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
    litBody(id, [radius, radius, radius], bands ? ([1, 1, 1] as Rgb) : b.tint.rgb, {
      position: [x, 0, 0],
      emissive,
      segments: [64, 32],
      albedoUrl: bands ? (tex?.albedo ?? null) : null,
    });
  const bodies: BodyPlan[] = !bodyOk
    ? []
    : twoBodies
      ? [
          make('body_a', -BINARY_OFFSET, BINARY_BODY_RADIUS),
          make('body_b', BINARY_OFFSET, BINARY_BODY_RADIUS),
        ]
      : [make('body', 0, 1)];

  return b.build({ bodies });
}
