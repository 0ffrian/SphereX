// Which overlay layers the flipbook draws for the current frame (issue #12). A layer is drawn only
// when it is switched on, its data is there and the reply tags it (D-02); otherwise it is refused
// and its code is listed with the reply's own `missing`, never filled in.
//
// Honesty (D-21, Q-28): marker placement and contamination are `derived`. There is no honesty
// toggle in the flipbook yet, and Q-28 (what "Measured only" does to the flipbook's derived ring
// and stretch) is open, so they follow the ring's treatment today: always shown, with the
// Estimated badge. No new rule is made here.
import type { OverlayFrame, OverlaysResponse, ProvenanceEntry } from '@/app/api/types';
import type { OverlayLayer, OverlaysState } from '@/state/store';

/** Provenance keys each part needs (the backend contract of issue #12). */
export const LAYER_PROVENANCE: Readonly<Record<OverlayLayer | 'contamination', readonly string[]>> =
  {
    gaia: ['catalog_positions', 'catalog_mags', 'markers'],
    wise: ['catalog_positions', 'catalog_mags', 'markers'],
    flags: ['flags_mask'],
    fov: ['footprint', 'cutout_box'],
    contamination: ['contamination', 'catalog_mags'],
  };

export interface OverlayView {
  data: OverlaysResponse;
  /** This frame's overlay entry; undefined when the reply has none for it. */
  frame: OverlayFrame | undefined;
  show: Readonly<Record<OverlayLayer | 'contamination', boolean>>;
  /** The reply's `missing`, plus `provenance:<key>` for a part refused for lack of a tag. */
  missing: readonly string[];
}

export function provenanceOf(data: OverlaysResponse, key: string): ProvenanceEntry | undefined {
  return Object.hasOwn(data.provenance, key) ? data.provenance[key] : undefined;
}

/**
 * Null until the overlays have loaded. While a reload runs, or after it fails, the previous reply
 * is still drawn.
 */
export function overlayView(state: OverlaysState, frameId: string): OverlayView | null {
  const data = state.data;
  if (!data) return null;
  const frame = data.frames.find((f) => f.frame_id === frameId);
  const extra = new Set<string>();
  const tagged = (part: OverlayLayer | 'contamination', wanted: boolean) => {
    if (!wanted) return false;
    const absent = LAYER_PROVENANCE[part].filter((k) => !provenanceOf(data, k));
    for (const k of absent) extra.add(`provenance:${k}`);
    return absent.length === 0;
  };
  const available = (name: 'gaia' | 'wise') =>
    data.catalogs.some((c) => c.catalog === name && c.available);
  const t = state.toggles;
  const show = {
    gaia: tagged('gaia', t.gaia && available('gaia')),
    wise: tagged('wise', t.wise && available('wise')),
    flags: tagged('flags', t.flags) && !data.missing.includes(`flags_mask:${frameId}`),
    fov: tagged('fov', t.fov),
    contamination: tagged('contamination', (frame?.contamination.length ?? 0) > 0),
  };
  return {
    data,
    frame,
    show,
    // The reply's own array when nothing is added, so it stays referentially stable.
    missing: extra.size === 0 ? data.missing : [...data.missing, ...[...extra].sort()],
  };
}
