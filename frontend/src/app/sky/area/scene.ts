// The Area layers' scene (A18.2): prepared once per data change, never per frame. Dots per visit in
// a fixed draw order (frame order, then the numeric n of `<frame_id>:<n>`, Q-208 (14)), with their
// wavelength colour computed once; tracks with their tracklets joined to /dots by dot id (Q-208
// (2)), their label text and a screen cache the draw fills for the hit test.
import type { AreaDot, AreaDotLabel, AreaDots, AreaSummary, AreaTracks } from '@/contract';
import { wavelengthColor } from '@/app/flipbook/wavelengthColor';
import { areaTrackLabel } from '@/app/area/realArea';

export interface SceneDot {
  ra: number;
  dec: number;
  label: AreaDotLabel;
  /** wavelengthColor of the dot's measured wavelength (Estimated, Q-27 open). */
  color: string;
}

export interface SceneVisit {
  visit: number;
  /** In draw order (frame order, then n). */
  dots: SceneDot[];
  /** Indices into `dots` grouped by colour, so one stroke draws each colour. */
  byColour: Uint32Array;
}

export interface SceneTracklet {
  visit: number;
  ra: Float64Array;
  dec: Float64Array;
}

export interface SceneTrack {
  id: string;
  status: 'track' | 'possible';
  verdict: 'found_blind' | 'unexplained' | 'unchecked' | 'possible';
  label: string;
  tracklets: SceneTracklet[];
  /** Screen x, y of every point (tracklets in order), written by the last draw; NaN off screen. */
  sx: Float32Array;
  sy: Float32Array;
  /** Visit of each point, to find the current visit's points for the bracket. */
  pointVisit: Uint16Array;
}

export interface AreaScene {
  visits: SceneVisit[];
  tracks: SceneTrack[];
  /** Dot ids a track names that /dots does not hold (drawn without them, never invented). */
  unmatchedDotIds: string[];
}

/** The numeric n of a dot id `<frame_id>:<n>`, or NaN. */
function dotN(id: string): number {
  const i = id.lastIndexOf(':');
  return i < 0 ? Number.NaN : Number(id.slice(i + 1));
}

function frameOrder(summary: AreaSummary | null): Map<string, number> {
  const out = new Map<string, number>();
  summary?.frames.forEach((f, i) => out.set(f.frame_id, i));
  return out;
}

/** Sorts dots by frame order (unknown frames last, by id), then by numeric n. */
export function orderDots<T extends Pick<AreaDot, 'dot_id' | 'frame_id'>>(
  dots: readonly T[],
  order: ReadonlyMap<string, number>,
): T[] {
  return [...dots].sort((a, b) => {
    const fa = order.get(a.frame_id) ?? Number.MAX_SAFE_INTEGER;
    const fb = order.get(b.frame_id) ?? Number.MAX_SAFE_INTEGER;
    if (fa !== fb) return fa - fb;
    if (a.frame_id !== b.frame_id) return a.frame_id < b.frame_id ? -1 : 1;
    return dotN(a.dot_id) - dotN(b.dot_id);
  });
}

export function prepareScene(
  summary: AreaSummary | null,
  dots: AreaDots | null,
  tracks: AreaTracks | null,
): AreaScene {
  const order = frameOrder(summary);
  const colourCache = new Map<number, string>();
  const colourOf = (um: number) => {
    let c = colourCache.get(um);
    if (c === undefined) {
      c = wavelengthColor(um);
      colourCache.set(um, c);
    }
    return c;
  };
  const byId = new Map<string, AreaDot>();
  const visits: SceneVisit[] = [];
  for (const v of dots?.visits ?? []) {
    const ordered = orderDots(v.dots, order);
    const sceneDots = ordered.map((d) => {
      byId.set(d.dot_id, d);
      return { ra: d.ra, dec: d.dec, label: d.label, color: colourOf(d.wavelength_um) };
    });
    const idx = sceneDots.map((_, i) => i);
    idx.sort((a, b) => {
      const ca = sceneDots[a]!.color;
      const cb = sceneDots[b]!.color;
      return ca === cb ? a - b : ca < cb ? -1 : 1;
    });
    visits.push({ visit: v.visit, dots: sceneDots, byColour: Uint32Array.from(idx) });
  }
  visits.sort((a, b) => a.visit - b.visit);

  const unmatched: string[] = [];
  const sceneTracks: SceneTrack[] = [];
  for (const t of tracks?.tracks ?? []) {
    const tracklets = [...t.tracklets]
      .sort((a, b) => a.visit - b.visit)
      .map((tl) => {
        const found: AreaDot[] = [];
        for (const id of tl.dot_ids) {
          const d = byId.get(id);
          if (d) found.push(d);
          else unmatched.push(id);
        }
        const ordered = orderDots(found, order);
        return {
          visit: tl.visit,
          ra: Float64Array.from(ordered, (d) => d.ra),
          dec: Float64Array.from(ordered, (d) => d.dec),
        };
      });
    const n = tracklets.reduce((k, tl) => k + tl.ra.length, 0);
    const pointVisit = new Uint16Array(n);
    let k = 0;
    for (const tl of tracklets) for (let i = 0; i < tl.ra.length; i++) pointVisit[k++] = tl.visit;
    sceneTracks.push({
      id: t.track_id,
      status: t.status,
      verdict: t.verdict,
      label: areaTrackLabel(t),
      tracklets,
      sx: new Float32Array(n).fill(Number.NaN),
      sy: new Float32Array(n).fill(Number.NaN),
      pointVisit,
    });
  }
  return { visits, tracks: sceneTracks, unmatchedDotIds: unmatched };
}

// ---- Styles (Q-406 (3), Q-407) -------------------------------------------------------------------

export type DotStyle = 'none' | 'ring-white' | 'ring-colour' | 'cross' | 'ring-mono';

/**
 * A dot's look by its label and the Discovery step (A18.2; Q-406 (3)): star and fixed are white
 * rings before step 3, a faint cross from it; a glitch is a ring in its colour until step 2, then
 * hidden; a mover is a ring in its colour. "Measured only" (Q-407): every dot the same ring, since
 * the labels themselves are Estimated. A flagged dot (`OUTLIER`) is drawn like the others (A16.5).
 */
export function dotStyle(label: AreaDotLabel, step: number, measured: boolean): DotStyle {
  if (step <= 0) return 'none';
  if (measured) return 'ring-mono';
  switch (label) {
    case 'star':
    case 'fixed':
      return step >= 3 ? 'cross' : 'ring-white';
    case 'glitch':
      return step >= 2 ? 'none' : 'ring-colour';
    case 'mover':
      return 'ring-colour';
  }
}

/** Track lines show from step 4, with the Tracks layer on, and never in "Measured only". */
export function tracksShown(step: number, tracksLayer: boolean, measured: boolean): boolean {
  return tracksLayer && step >= 4 && !measured;
}

export const ACCENT = '#4ade80';
export const AMBER = '#fbbf24';
export const GREY = '#9ca3af';
export const NEUTRAL = '#f4f4f5';
export const MONO = '#e5e7eb';

export interface JoinStyle {
  color: string;
  /** Canvas line dash; empty = solid. */
  dash: readonly number[];
}

const SOLID: readonly number[] = [];
const SHORT_DASH: readonly number[] = [4, 4];
const LONG_DASH: readonly number[] = [10, 6];
const DOTTED: readonly number[] = [1.5, 4];

/**
 * The join line between visits by verdict (A18.2), so colour is never the only cue (R9): step 4
 * draws every join neutral and solid; from step 5 `found_blind` is a short dash in the accent,
 * `unexplained` a long amber dash, `unchecked` a grey dotted line, and `possible` has none.
 */
export function joinStyle(verdict: SceneTrack['verdict'], step: number): JoinStyle | null {
  if (verdict === 'possible') return null;
  if (step < 5) return { color: NEUTRAL, dash: SOLID };
  switch (verdict) {
    case 'found_blind':
      return { color: ACCENT, dash: SHORT_DASH };
    case 'unexplained':
      return { color: AMBER, dash: LONG_DASH };
    case 'unchecked':
      return { color: GREY, dash: DOTTED };
  }
}

/** Label colour by verdict (the text says the verdict too). */
export function labelColor(verdict: SceneTrack['verdict']): string {
  switch (verdict) {
    case 'found_blind':
      return ACCENT;
    case 'unexplained':
      return AMBER;
    case 'unchecked':
      return GREY;
    case 'possible':
      return NEUTRAL;
  }
}
