// What the flipbook says about grid areas without data (frameGrid.ts noDataKind). R9: nothing may
// flash during playback, so the per-frame caption is shown only while the flipbook is paused or
// stopped; for the whole object one steady line says how many frames are hatched and why.
// Logic and wording only; Flipbook.tsx draws it.
import type { Frame } from '@/app/api/types';
import {
  gridSize,
  largestSide,
  noDataKind,
  placeFrame,
  type NoData,
  type PixelSize,
  type Registration,
} from './frameGrid';

export type NoDataKind = Exclude<NoData, 'none'>;

/** The per-frame caption, shown when paused on such a frame (and in the picture's alt text). */
export const NO_DATA_CAPTION: Record<NoDataKind, string> = {
  edge: 'Edge of the detector: part of this cutout lies outside it.',
  outside: 'Part of the frame grid lies outside this cutout.',
};

export const NO_DATA_KINDS = Object.keys(NO_DATA_CAPTION) as NoDataKind[];

export interface NoDataCounts {
  edge: number;
  outside: number;
  /** Frames whose size is known (stated by the reply or decoded): only they can be counted. */
  known: number;
}

/** How many of the object's frames leave part of the grid without data, by kind. */
export function countNoData(
  frames: readonly Pick<Frame, 'x' | 'y'>[],
  sizes: readonly (PixelSize | null)[],
  registration: Registration,
): NoDataCounts {
  const grid = gridSize(sizes);
  const fullSide = largestSide(sizes);
  const counts: NoDataCounts = { edge: 0, outside: 0, known: 0 };
  sizes.forEach((s, i) => {
    const f = frames[i];
    if (s === null || f === undefined) return;
    counts.known += 1;
    const kind = noDataKind(grid, placeFrame(grid, f, s, registration), s, fullSide);
    if (kind !== 'none') counts[kind] += 1;
  });
  return counts;
}

/**
 * The steady line for the whole object, or null when no frame is hatched, e.g. "2 of 240 frames
 * are at a detector edge; their missing part is hatched."
 */
export function noDataSummary(c: NoDataCounts): string | null {
  const parts: string[] = [];
  if (c.edge > 0) {
    const one = c.edge === 1;
    parts.push(
      `${c.edge} of ${c.known} frames ${one ? 'is' : 'are'} at a detector edge; ${one ? 'its' : 'their'} missing part is hatched.`,
    );
  }
  if (c.outside > 0) {
    const one = c.outside === 1;
    parts.push(
      `${c.outside} of ${c.known} frames ${one ? 'covers' : 'cover'} only part of the picture; the rest is hatched.`,
    );
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

/** The per-frame caption shows only while paused or stopped, never during playback (R9). */
export function noDataCaptionVisible(playing: boolean, noData: NoData): boolean {
  return !playing && noData !== 'none';
}
