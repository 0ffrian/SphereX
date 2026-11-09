// R9 alt text and aria-live message builders. Pure functions; wording is plain, no jargon.
// Alt text: "<name>, <type>, <size + tag>, <colour basis, if drawn>, viewed at <phase angle>°.
//            Surface relief: <measured | illustrative>." (relief only where there is relief)
import type { CometEpoch, ObjectType, Tag } from '@/contract';
import { badgeForTag, HONESTY_LABEL, stateThatShows, type HonestyState } from './honesty';
import { MODE_LABEL } from './modes';
import { deriveClimate } from '@/physics/climate';
import { exoplanetSentences, isExoplanetCard, showsBody } from './planCommon';
import { GAS_LAYER_IDS, gasHiddenText } from './renderers/shaderSpec';
import type { RenderPlan, ViewModeId } from './planTypes';
import { AT_AGE_MAX_PHRASE, formatLength, type ShownSize } from './scaleBar';

export const TYPE_NAME: Readonly<Record<ObjectType, string>> = {
  asteroid_shape: 'asteroid with a shape model',
  asteroid_procedural: 'asteroid',
  comet: 'comet',
  brown_dwarf: 'brown dwarf',
  brown_dwarf_binary: 'brown dwarf pair',
  star_mira: 'Mira variable star',
  star_ttauri: 'T Tauri star',
  star: 'star',
  candidate: 'unidentified moving source',
  planet_rocky: 'rocky planet',
  planet_water: 'water planet',
  gas_giant: 'gas giant',
  nebula: 'nebula',
  nova: 'nova',
};

export const EPOCH_NAME: Readonly<Record<CometEpoch, string>> = {
  '2025-08': 'August 2025',
  '2025-12': 'December 2025',
};

/** "measured", "estimated" or "default": the D-02 badge in lower case. */
export function tagWord(tag: Tag): string {
  return badgeForTag(tag).toLowerCase();
}

/**
 * The size that is on screen. `shown` is the scale bar's size (`shownSize`): for a loaded shape
 * model it is the model's own size, not the card's, so a screen reader hears what the bar says.
 * Without it the card's size is used.
 */
function sizeText(plan: RenderPlan, shown?: ShownSize | null): string {
  const radiusM = shown ? shown.radiusM : plan.scaleM;
  if (radiusM === null || radiusM === undefined) return 'size unknown';
  const d = formatLength(2 * radiusM);
  const tagOf = shown ? shown.tag : plan.sizeTag;
  const tag = tagOf ? tagWord(tagOf) : null;
  const qualifier = shown ? shown.qualifier : plan.sizeQualifier;
  // An upper limit is read out as a bound, never as a measurement (R7.3).
  // The remnant's age slider draws the shell smaller than its full size (Q-103).
  const at = shown?.atSliderMax ? AT_AGE_MAX_PHRASE : '';
  if (qualifier === 'upper_limit')
    return `at most ${d} long${at} (upper limit${tag ? `, ${tag}` : ''})`;
  return tag ? `${d} long${at} (${tag})` : `${d} long${at}`;
}

/** "Size shown: 33 km long (estimated)". Said when the honesty level changes which size shows. */
export function sizeAnnouncement(plan: RenderPlan, shown: ShownSize): string {
  return `Size shown: ${sizeText(plan, shown)}.`;
}

function colourBasis(plan: RenderPlan): string {
  const t = plan.tint;
  // The comet's mode colour is applied to the dust only; other types colour the body.
  const subject = plan.type === 'comet' ? 'dust ' : '';
  if (t.tag === null || t.source === null) return `${subject}plain grey, no colour data shown`;
  const basis =
    t.source === 'gaia_rgb'
      ? 'colour from Gaia'
      : t.source === 'class_palette'
        ? 'colour from the spectral class palette'
        : 'SPHEREx infrared false colour';
  return `${subject}${basis} (${tagWord(t.tag)})`;
}

/** Why nothing is drawn, in plain words, and the honesty state that would show it (or null). */
export function nothingDrawnReason(plan: RenderPlan): { text: string; needs: HonestyState | null } {
  // The generated kinds: the layer itself is an artist's impression (R7.7).
  const layer = plan.shader
    ? plan.missing.find((m) => ['surface', 'point_cloud', ...GAS_LAYER_IDS].includes(m.id))
    : undefined;
  if (layer?.reason === 'honesty' && layer.tag) {
    return {
      text:
        layer.tag === 'artistic'
          ? "It is an artist's impression, so it is hidden at this level."
          : 'It is estimated from rules and typical values, so it is hidden at this level.',
      needs: stateThatShows(layer.tag),
    };
  }
  const body = plan.missing.find((m) => m.id === 'body' || m.id === 'size');
  if (body?.reason === 'honesty' && body.tag) {
    return {
      text: 'Its size is only an estimate, so it is hidden at this level.',
      needs: stateThatShows(body.tag),
    };
  }
  if (body?.reason === 'data' || body?.reason === 'load') {
    return { text: 'The data needed to draw it is missing.', needs: null };
  }
  return { text: 'It could not be drawn from the data on the card.', needs: null };
}

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * Issue #68 Part 6 (Q-165): what the alt text of a demo exoplanet says about the star's light and the
 * climate scenario, from the finished plan: the same words as the plan's notes. Empty for a body that
 * is not a planet with host-star fields, so solar-system alt text is unchanged.
 */
function exoplanetAlt(plan: RenderPlan): string {
  if ((plan.type !== 'planet_rocky' && plan.type !== 'planet_water') || !plan.shader) return '';
  const { card } = plan.shader;
  if (!isExoplanetCard(card)) return '';
  const refusal = plan.missing.find((m) => m.id === 'starlight');
  const sentences = exoplanetSentences({
    kind: plan.type,
    scenario: deriveClimate(card, plan.type)?.scenario ?? null,
    teffK: plan.lighting.colourTeffK,
    starlight: plan.drawn.some((d) => d.id === 'starlight')
      ? 'drawn'
      : refusal?.reason === 'data'
        ? 'data'
        : refusal?.reason === 'honesty'
          ? 'honesty'
          : null,
    climateShown: plan.shader.surface || plan.shader.pattern,
  });
  return sentences.length > 0 ? ` ${sentences.join(' ')}` : '';
}

export function buildAltText(plan: RenderPlan, shown?: ShownSize | null): string {
  const type = TYPE_NAME[plan.type];
  if (!plan.threeD) {
    return `${plan.name}, ${type}. ${sentence(plan.message ?? 'No 3D view.')}`;
  }
  if (!showsBody(plan)) {
    return `${plan.name}, ${type}. Nothing is drawn: ${nothingDrawnReason(plan).text}`;
  }
  if (plan.shader) {
    // The generated kinds: the backend's own description, and what the viewer is honest about (R5.3).
    const alt = sentence(plan.shader.params.alt_text.trim());
    const exo = exoplanetAlt(plan);
    if (plan.shader.pattern && !plan.shader.surface) {
      return `${plan.name}, ${type}, ${sizeText(plan, shown)}. A smooth sphere that shows only where the model puts water and ice on a tidally locked planet. It is a model, not a measured image.${exo}`;
    }
    return plan.shader.surface
      ? plan.shader.gas
        ? `${alt} This is a generated model, not a measured image.`
        : `${alt} This is an artist's impression, not a measured image.${exo}`
      : `${plan.name}, ${type}, ${sizeText(plan, shown)}. A plain grey sphere: ${
          plan.type === 'gas_giant'
            ? gasHiddenText(plan.shader.params)
            : "the surface is an artist's impression and is hidden at this level."
        }${exo}`;
  }
  const phase =
    plan.lighting.phaseAngleDeg !== null
      ? `viewed at ${Math.round(plan.lighting.phaseAngleDeg)}°`
      : plan.lighting.mode === 'self'
        ? 'self-luminous, so no phase angle'
        : 'phase angle unknown';
  const parts = [plan.name, type, sizeText(plan, shown)];
  if (plan.tintUsed) parts.push(colourBasis(plan));
  parts.push(phase);
  // Relief is named only where there is relief to describe: a shape model or a normal map.
  const hasRelief = plan.bodies.some((b) => b.meshUrl !== null || b.normalUrl !== null);
  return `${parts.join(', ')}.${hasRelief ? ` Surface relief: ${plan.relief}.` : ''}`;
}

/** The canvas aria-label: the alt text plus how to use it. Updated whenever the plan changes. */
export function canvasLabel(plan: RenderPlan | null, shown?: ShownSize | null): string {
  const help = '3D view: drag or use the arrow keys to rotate, plus and minus to zoom, R to reset.';
  if (!plan) return `Viewer placeholder: no object loaded. ${help}`;
  // No help when there is no 3D view to operate.
  if (!plan.threeD || !showsBody(plan)) return buildAltText(plan, shown);
  return `${buildAltText(plan, shown)} ${help}`;
}

function countPhrase(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

export function modeAnnouncement(mode: ViewModeId, plan: RenderPlan): string {
  const info = plan.modes.find((m) => m.id === mode);
  return `${MODE_LABEL[mode]} view. ${info?.badge ?? ''}`.trim();
}

export function epochAnnouncement(epoch: CometEpoch, plan: RenderPlan): string {
  const shells = plan.shells.map((s) => s.label).join(', ');
  const dust = plan.dust ? 'Dust is shown.' : 'No dust is shown.';
  // Built from what the plan draws: a tail volume exists only when its layer is drawn.
  const tails = plan.volumes
    .filter((v) => v.kind === 'ion_tail' || v.kind === 'dust_tail')
    .map((v) => (v.kind === 'ion_tail' ? 'gas tail' : 'dust tail'));
  const tail = tails.length > 0 ? `Tails drawn: ${tails.join(' and ')}.` : 'No tail is drawn.';
  return `${EPOCH_NAME[epoch]}. ${shells ? `Gas shells: ${shells}.` : 'No gas shells for this epoch.'} ${dust} ${tail}`;
}

/**
 * `shown` is the size the scale bar will show at the new level, and `previous` the one it shows
 * now: when they differ (the shape model's own size swaps with the card's), the change is said.
 */
export function honestyAnnouncement(
  state: HonestyState,
  plan: RenderPlan,
  shown?: ShownSize | null,
  previous?: ShownSize | null,
): string {
  const hidden = plan.missing.filter((m) => m.reason === 'honesty').length;
  const hiddenText =
    hidden === 0 ? 'Nothing is hidden.' : `${countPhrase(hidden, 'layer')} hidden.`;
  const sizeChanged =
    shown && previous && (shown.radiusM !== previous.radiusM || shown.tag !== previous.tag);
  const size = sizeChanged && shown.radiusM !== null ? ` ${sizeAnnouncement(plan, shown)}` : '';
  return `${HONESTY_LABEL[state]}. ${countPhrase(plan.drawn.length, 'layer')} shown. ${hiddenText}${size}`;
}

/** Modified Julian Date as a UTC calendar date, "2025-12-14". MJD 40587 is 1970-01-01. */
export function formatMjdDate(mjd: number): string {
  const d = new Date(Math.round((mjd - 40587) * 86_400_000));
  return Number.isNaN(d.getTime()) ? 'unknown date' : d.toISOString().slice(0, 10);
}

export function scrubAnnouncement(plan: RenderPlan): string {
  const s = plan.scrub;
  if (!s) return '';
  return `Light-curve point ${s.index + 1} of ${s.count}, ${formatMjdDate(s.tMjd)}, brightness ${Math.round(s.brightness * 100)} percent of the maximum.`;
}
