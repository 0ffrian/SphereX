// R9 alt text and aria-live message builders. Pure functions; wording is plain, no jargon.
// Alt text: "<name>, <type>, <size + tag>, <colour basis>, viewed at <phase angle>°.
//            Surface relief: <measured | illustrative>."
import type { CometEpoch, ObjectType, Tag } from '@/contract';
import { badgeForTag, HONESTY_LABEL, type HonestyState } from './honesty';
import { MODE_LABEL } from './modes';
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
  return plan.sizeTag ? `${d} across (${tagWord(plan.sizeTag)})` : `${d} across`;
}

function colourBasis(plan: RenderPlan): string {
  const t = plan.tint;
  if (t.tag === null || t.source === null) return 'plain grey, no colour data shown';
  const basis =
    t.source === 'gaia_rgb'
      ? 'colour from Gaia'
      : t.source === 'class_palette'
        ? 'colour from the spectral class palette'
        : 'SPHEREx infrared false colour';
  return `${basis} (${tagWord(t.tag)})`;
}

export function buildAltText(plan: RenderPlan): string {
  const type = TYPE_NAME[plan.type];
  if (!plan.threeD) {
    return `${plan.name}, ${type}. ${plan.message ?? 'No 3D view.'}`;
  }
  const phase =
    plan.lighting.phaseAngleDeg !== null
      ? `viewed at ${Math.round(plan.lighting.phaseAngleDeg)}°`
      : plan.lighting.mode === 'self'
        ? 'self-luminous, so no phase angle'
        : 'phase angle unknown';
  const parts = [plan.name, type, sizeText(plan), colourBasis(plan), phase];
  return `${parts.join(', ')}. Surface relief: ${plan.relief}.`;
}

/** The canvas aria-label: the alt text plus how to use it. Updated whenever the plan changes. */
export function canvasLabel(plan: RenderPlan | null): string {
  const help = '3D view: drag or use the arrow keys to rotate, plus and minus to zoom, R to reset.';
  if (!plan) return `Viewer placeholder: no object loaded. ${help}`;
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

export function scrubAnnouncement(plan: RenderPlan): string {
  const s = plan.scrub;
  if (!s) return '';
  return `Light-curve point ${s.index + 1} of ${s.count}, MJD ${s.tMjd.toFixed(1)}, brightness ${Math.round(s.brightness * 100)} percent of the maximum.`;
}
