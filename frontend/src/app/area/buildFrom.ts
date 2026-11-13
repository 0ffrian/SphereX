// Build it from the area results (issue #145, Q-469): a catalogued object (every Known row, and a
// Discovery track matched to a known object) is built from its catalogue data, through the same
// path as the selected object's card: the object is searched by name (a marker's left click does
// the same, Q-120), and the build view opens once the name resolves. A name that does not resolve
// opens the object panel instead, which says why (never a build of something else).
//
// A Discovery track no known object explains has no catalogue data: Build it shows a placeholder
// (Q-469, Moon 13 Nov 2026), a plain sphere tagged Assumed with its size listed as not measured.
import { useShellStore } from '@/app/shell/shellStore';
import { useAppStore } from '@/state/store';
import type { AreaTrack, ObjectCard, RenderParams } from '@/contract';
import { PLACEHOLDER_LAYER } from '@/viewer/renderers/AsteroidProcedural';
import type { KnownObject } from './areaService';

/** How long the name may take to resolve before the object panel is shown instead. */
export const BUILD_RESOLVE_MS = 20_000;

/** The query a known row is searched by: SkyBoT's designation ("433 Eros"), else number and name. */
export const searchName = (o: Pick<KnownObject, 'designation' | 'id' | 'name'>): string =>
  o.designation ?? `${o.id} ${o.name}`.trim();

/** Build it on a known object: search it, then open the build view (animated, as the card's button). */
export function buildKnown(o: Pick<KnownObject, 'designation' | 'id' | 'name'>): void {
  const shell = useShellStore.getState();
  shell.cancelCard();
  const app = useAppStore.getState();
  const q = searchName(o);
  void app.skySearch({ q, kind: 'name', origin: 'sky' });
  const requestId = useAppStore.getState().sky.requestId;
  let off: (() => void) | null = null;
  const stop = () => {
    off?.();
    off = null;
    clearTimeout(t);
  };
  const settle = () => {
    const sky = useAppStore.getState().sky;
    // A newer search took over: this Build it is dropped.
    if (sky.requestId !== requestId) return stop();
    if (sky.resolved) {
      stop();
      useShellStore.getState().openBuild(true);
    } else if (sky.status === 'error') {
      stop();
      useShellStore.getState().setTool('flipbook');
    }
  };
  const t = setTimeout(() => {
    stop();
    if (useAppStore.getState().sky.requestId === requestId)
      useShellStore.getState().setTool('flipbook');
  }, BUILD_RESOLVE_MS);
  off = useAppStore.subscribe(settle);
  settle();
}

/** FNV-1a of a string, as the placeholder's seed: the same track always gives the same build. */
function seedOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 2147483647;
}

export const PLACEHOLDER_ALT =
  'Placeholder for a moving source no known object explains: a plain sphere. Its size, shape, colour and spin are not measured.';

/**
 * Q-469: the card and render params of a placeholder body for a Discovery track no known object
 * explains. Nothing physical is given: no size (no scale bar), no colour, no spin; the one layer is
 * the placeholder sphere, tagged `artistic` (Assumed). What was measured (its motion) stays in the
 * area card. Pure and deterministic (the seed comes from the id).
 */
export function placeholderBody(
  areaId: string,
  track: Pick<AreaTrack, 'track_id'>,
  label: string,
): { card: ObjectCard; params: RenderParams } {
  const id = `area:${areaId}:${track.track_id}`;
  const card: ObjectCard = { id, name: label, type: 'asteroid_procedural' };
  const params: RenderParams = {
    id,
    type: 'asteroid_procedural',
    generator_version: 'area-placeholder-1',
    seed: seedOf(id),
    scale_m: null,
    layers: [
      {
        id: PLACEHOLDER_LAYER,
        tag: 'artistic',
        tier: 5,
        description:
          'Placeholder: a plain sphere stands in, as the size and shape of this object are not measured (Q-469).',
        requires: [],
      },
    ],
    lighting: { mode: 'sun', sun_dir: [1, 0, 0] },
    view_modes: {
      visible: {
        available: false,
        badge: 'Estimated visible colour',
        rgb: null,
        source: 'class_palette',
      },
    },
    haptics: {
      texture: 'none',
      texture_tag: 'artistic',
      data: 'detections',
      data_tag: 'measured',
      params: {},
    },
    dynamics: { speedup: {} },
    alt_text: PLACEHOLDER_ALT,
    missing: ['diameter_km', 'mesh', 'visible', 'dynamics:spin_period_h'],
  };
  return { card, params };
}

/** Build it on a Discovery track no known object explains: the placeholder in the build view. */
export function buildPlaceholder(
  areaId: string,
  track: Pick<AreaTrack, 'track_id'>,
  label: string,
): void {
  const { card, params } = placeholderBody(areaId, track, label);
  const app = useAppStore.getState();
  // No selected object: the build view takes the placeholder's own name, not a searched one.
  app.skyReset();
  useShellStore.getState().cancelCard();
  useAppStore.getState().setObject(card, params);
  useShellStore.getState().setBody({ status: 'idle' });
  useShellStore.getState().openBuild(true);
}
