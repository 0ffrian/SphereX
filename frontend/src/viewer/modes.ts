// R5.2 view modes (visible / SPHEREx infrared) using the D-23 VisibleMode / IRMode fields.
// Pure functions. A mode that is not available is listed in `missing`, never faked.
import type { ObjectType, RenderParams, VisibleMode } from '@/contract';
import { isTagShown, type HonestyState } from './honesty';
import type { MissingItem, ModeInfo, Rgb, Tint, ViewModeId } from './planTypes';

export const MODE_LABEL: Readonly<Record<ViewModeId, string>> = {
  visible: 'Visible colour',
  spherex_ir: 'SPHEREx infrared',
};

export const MODE_IDS: readonly ViewModeId[] = ['visible', 'spherex_ir'];

/**
 * Plain grey used where no colour data may be shown (Measured only without a measured tint, or a
 * mode with no colour). A display stand-in, not data: it is never listed as a layer.
 */
export const NEUTRAL_TINT: Rgb = [0.5, 0.5, 0.5];

function rgbValue(mode: VisibleMode | undefined): Rgb | null {
  const v = mode?.rgb?.value;
  return v ? [v[0], v[1], v[2]] : null;
}

/**
 * A mode is usable when the backend says so AND it carries a colour. `available: true` with no
 * colour (e.g. a class palette the backend did not fill) is treated as unavailable, not guessed.
 */
function isUsable(mode: VisibleMode | undefined): boolean {
  return mode !== undefined && mode.available && rgbValue(mode) !== null;
}

export function resolveModes(params: RenderParams): { modes: ModeInfo[]; missing: MissingItem[] } {
  const modes: ModeInfo[] = [];
  const missing: MissingItem[] = [];
  for (const id of MODE_IDS) {
    const m = params.view_modes[id];
    const available = isUsable(m);
    modes.push({
      id,
      label: MODE_LABEL[id],
      available,
      badge: m?.badge ?? '',
      tag: available ? (m?.rgb?.tag ?? null) : null,
      source: m?.source ?? null,
    });
    if (!available) {
      missing.push({
        id,
        reason: 'data',
        detail:
          m === undefined
            ? 'This object has no infrared colour data.'
            : m.available
              ? 'The mode has no colour value.'
              : 'The backend marked the mode unavailable.',
      });
    }
  }
  return { modes, missing };
}

/** R7.4: brown dwarfs are almost black in visible light, so they open in the infrared view. */
export function defaultMode(type: ObjectType, modes: readonly ModeInfo[]): ViewModeId | null {
  const usable = (id: ViewModeId) => modes.find((m) => m.id === id)?.available === true;
  const order: ViewModeId[] =
    type === 'brown_dwarf' || type === 'brown_dwarf_binary'
      ? ['spherex_ir', 'visible']
      : ['visible', 'spherex_ir'];
  return order.find(usable) ?? null;
}

export function chooseMode(
  requested: ViewModeId | null,
  type: ObjectType,
  modes: readonly ModeInfo[],
): ViewModeId | null {
  if (requested && modes.find((m) => m.id === requested)?.available) return requested;
  return defaultMode(type, modes);
}

/** Colour of the body in a mode. A tint whose tag the honesty state hides becomes plain grey. */
export function resolveTint(
  params: RenderParams,
  mode: ViewModeId | null,
  honesty: HonestyState,
): Tint {
  const m = mode ? params.view_modes[mode] : undefined;
  const rgb = rgbValue(m);
  if (!m || !rgb || !m.rgb || !isTagShown(honesty, m.rgb.tag)) {
    return { rgb: NEUTRAL_TINT, tag: null, source: null };
  }
  return { rgb, tag: m.rgb.tag, source: m.source };
}
