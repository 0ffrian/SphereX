// R9 alt text and aria-live message builders. Pure functions; wording is plain, no jargon.
// Alt text: "<name>, <type>, <size + tag>, <colour basis, if drawn>, viewed at <phase angle>°.
//            Surface relief: <measured | illustrative>." (relief only where there is relief)
import type { CometEpoch, ObjectType, Tag } from '@/contract';
import { badgeForTag, HONESTY_LABEL, stateThatShows, type HonestyState } from './honesty';
import { MODE_LABEL } from './modes';
import { showsBody } from './planCommon';
import type { RenderPlan, ViewModeId } from './planTypes';
import { formatLength } from './scaleBar';

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

function sizeText(plan: RenderPlan): string {
  if (plan.scaleM === null) return 'size unknown';
  const d = formatLength(2 * plan.scaleM);
  const tag = plan.sizeTag ? tagWord(plan.sizeTag) : null;
  // An upper limit is read out as a bound, never as a measurement (R7.3).
  if (plan.sizeQualifier === 'upper_limit')
    return `at most ${d} across (upper limit${tag ? `, ${tag}` : ''})`;
  return tag ? `${d} across (${tag})` : `${d} across`;
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
    ? plan.missing.find((m) => m.id === 'surface' || m.id === 'point_cloud')
    : undefined;
  if (layer?.reason === 'honesty' && layer.tag) {
    return {
      text: "It is an artist's impression, so it is hidden at this level.",
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

export function buildAltText(plan: RenderPlan): string {
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
    return plan.shader.surface
      ? `${alt} This is an artist's impression, not a measured image.`
      : `${plan.name}, ${type}, ${sizeText(plan)}. A plain grey sphere: the surface is an artist's impression and is hidden at this level.`;
  }
  const phase =
    plan.lighting.phaseAngleDeg !== null
      ? `viewed at ${Math.round(plan.lighting.phaseAngleDeg)}°`
      : plan.lighting.mode === 'self'
        ? 'self-luminous, so no phase angle'
        : 'phase angle unknown';
  const parts = [plan.name, type, sizeText(plan)];
  if (plan.tintUsed) parts.push(colourBasis(plan));
  parts.push(phase);
  // Relief is named only where there is relief to describe: a shape model or a normal map.
  const hasRelief = plan.bodies.some((b) => b.meshUrl !== null || b.normalUrl !== null);
  return `${parts.join(', ')}.${hasRelief ? ` Surface relief: ${plan.relief}.` : ''}`;
}

/** The canvas aria-label: the alt text plus how to use it. Updated whenever the plan changes. */
export function canvasLabel(plan: RenderPlan | null): string {
  const help = '3D view: drag or use the arrow keys to rotate, plus and minus to zoom, R to reset.';
  if (!plan) return `Viewer placeholder: no object loaded. ${help}`;
  // No help when there is no 3D view to operate.
  if (!plan.threeD || !showsBody(plan)) return buildAltText(plan);
  return `${buildAltText(plan)} ${help}`;
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
  return `${EPOCH_NAME[epoch]}. ${shells ? `Gas shells: ${shells}.` : 'No gas shells for this epoch.'} ${dust} No tail is drawn.`;
}

export function honestyAnnouncement(state: HonestyState, plan: RenderPlan): string {
  const hidden = plan.missing.filter((m) => m.reason === 'honesty').length;
  const hiddenText =
    hidden === 0 ? 'Nothing is hidden.' : `${countPhrase(hidden, 'layer')} hidden.`;
  return `${HONESTY_LABEL[state]}. ${countPhrase(plan.drawn.length, 'layer')} shown. ${hiddenText}`;
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
