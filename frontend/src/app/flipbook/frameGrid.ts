// One fixed display grid for every frame of an object, so playback never changes the scale or the
// box size. SPHEREx cutouts differ in size (58×58, 58×59, 59×58, 59×59 px for one target, and
// smaller where a detector edge clips them), and fitting each to the box made the picture and
// everything below it jump between frames.
//
// - The grid is N×N source pixels for the whole object, N odd, so it has a centre pixel.
// - Native orientation (`north_up: false`): each frame is shifted by whole source pixels so the
//   object's pixel (x, y) lands on the grid centre (registered on the object; whole pixels keep
//   the picture sharp and free of shimmer).
// - Shared north-up grid (`north_up: true`): the frames already share one pixel grid, so they are
//   drawn at offset 0; a moving object then moves across the grid, which Rainbow Trails needs.
// - Where no pixel of the current frame lands (a cutout clipped at a detector edge, e.g. 34×59 px
//   with the object at x = 4.3), the grid has no data: Flipbook.tsx hatches it, so it does not
//   look like dark sky. A strip of at most NO_DATA_SLIVER_PX is the normal 58/59 px variation and
//   stays black.
// Logic only; Flipbook.tsx draws it.
import type { Frame } from '@/app/api/types';

/**
 * Grid side when no frame states its size. ASSUMPTION (display value, not data): the backend's
 * default cutout, SX_CUTOUT_SIZE_ARCSEC = 360″, at the SPHEREx pixel scale of 6.15″ (A3.1), is
 * 58.5 px, rounded up to the next odd number.
 */
export const FALLBACK_GRID_PX = 59;

export interface PixelSize {
  w: number;
  h: number;
}

export type Registration = 'object' | 'grid';

/** Where one frame sits on the grid, in source pixels (left, top may be negative). */
export interface Placement {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The smallest odd integer ≥ n. */
export function oddCeil(n: number): number {
  const c = Math.ceil(n);
  return c % 2 === 1 ? c : c + 1;
}

/** The frame's size as the API states it, else the decoded image's size, else unknown. */
export function frameSize(
  frame: Pick<Frame, 'width' | 'height'>,
  decoded?: PixelSize | null,
): PixelSize | null {
  if (frame.width !== undefined && frame.height !== undefined) {
    return { w: frame.width, h: frame.height };
  }
  return decoded ?? null;
}

/** The largest side of any known frame, source pixels; 0 when no size is known. */
export function largestSide(sizes: readonly (PixelSize | null)[]): number {
  let max = 0;
  for (const s of sizes) if (s) max = Math.max(max, s.w, s.h);
  return max;
}

/** Grid side N: the largest frame side, rounded up to odd; FALLBACK_GRID_PX when none is known. */
export function gridSize(sizes: readonly (PixelSize | null)[]): number {
  const max = largestSide(sizes);
  return max > 0 ? oddCeil(max) : FALLBACK_GRID_PX;
}

/** Registered on the object for native-orientation frames; on the shared grid for north-up ones. */
export function registrationFor(northUp: boolean): Registration {
  return northUp ? 'grid' : 'object';
}

/**
 * Place a frame. `x`, `y`: the object's pixel in the cutout as served, 0-based, an integer is a
 * pixel centre (A4.1). Object registration rounds the shift to whole pixels, so the object lands
 * within half a source pixel of the grid centre ((N − 1) / 2) whatever the cutout's size.
 */
export function placeFrame(
  grid: number,
  frame: Pick<Frame, 'x' | 'y'>,
  size: PixelSize,
  registration: Registration,
): Placement {
  if (registration === 'grid') return { left: 0, top: 0, width: size.w, height: size.h };
  const c = (grid - 1) / 2;
  // `+ 0` turns −0 into 0.
  return {
    left: Math.round(c - frame.x) + 0,
    top: Math.round(c - frame.y) + 0,
    width: size.w,
    height: size.h,
  };
}

/** The object's position on the grid, in source pixels from the grid's top-left corner. */
export function objectOnGrid(
  p: Placement,
  frame: Pick<Frame, 'x' | 'y'>,
): { x: number; y: number } {
  return { x: p.left + frame.x + 0.5, y: p.top + frame.y + 0.5 };
}

/**
 * Where the object ring goes, in source pixels: the grid centre for object registration (the
 * object is within half a pixel of it, so the ring does not wobble between frames), the object's
 * own pixel on a shared grid.
 */
export function ringOnGrid(
  grid: number,
  p: Placement,
  frame: Pick<Frame, 'x' | 'y'>,
  registration: Registration,
): { x: number; y: number } {
  return registration === 'object' ? { x: grid / 2, y: grid / 2 } : objectOnGrid(p, frame);
}

/** CSS box of a placement, as percentages of the grid (one constant scale for the object). */
export function placementStyle(
  grid: number,
  p: Placement,
): { left: string; top: string; width: string; height: string } {
  const pct = (v: number) => `${(v / grid) * 100}%`;
  return { left: pct(p.left), top: pct(p.top), width: pct(p.width), height: pct(p.height) };
}

/**
 * Widest strip of the grid without data that is still drawn plain black, source pixels. Cutouts of
 * one object differ by a pixel (58 or 59 px) and the whole-pixel shift can leave a 1 px column or
 * row; hatching it would mark every normal frame. Display threshold, not data.
 */
export const NO_DATA_SLIVER_PX = 1;

/** How far the frame falls short of each grid edge, source pixels (0 where it reaches or overhangs). */
export interface Gaps {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function uncoveredGaps(grid: number, p: Placement): Gaps {
  return {
    left: Math.max(0, p.left),
    right: Math.max(0, grid - (p.left + p.width)),
    top: Math.max(0, p.top),
    bottom: Math.max(0, grid - (p.top + p.height)),
  };
}

/**
 * Why part of the grid has no data from this frame:
 * - `none`: every uncovered strip is a sliver of at most NO_DATA_SLIVER_PX (normal frames);
 * - `edge`: a wider strip, and the cutout is more than 1 px narrower or shorter than the object's
 *   largest frame side, so IRSA clipped it at a detector edge;
 * - `outside`: a wider strip from a full-size cutout (the object sits off its centre).
 * `fullSide`: largestSide() over the object's frames. It is compared instead of the grid N because
 * N is rounded up to odd (64 px frames give N = 65), so a normal 63 px frame is 2 px short of N.
 */
export type NoData = 'none' | 'edge' | 'outside';

export function noDataKind(grid: number, p: Placement, size: PixelSize, fullSide: number): NoData {
  const g = uncoveredGaps(grid, p);
  if (Math.max(g.left, g.right, g.top, g.bottom) <= NO_DATA_SLIVER_PX) return 'none';
  return size.w < fullSide - 1 || size.h < fullSide - 1 ? 'edge' : 'outside';
}
