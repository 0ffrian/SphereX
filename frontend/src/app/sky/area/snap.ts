// Snap a drawn square to a prepared area (A16.4, A18.1; Q-406 (1)). An area holds the square when
// the square's centre lies inside the area's box (on the box's tangent plane, so RA wrap and cos Dec
// are handled). Several: the largest overlap wins, ties go to the first in the index. None: null,
// which the card shows as `area:not_prepared`.
import type { AreaIndexEntry } from '@/contract';
import { boxContains, overlapDeg2, type SkySquare } from './geometry';

export function snapToArea(sq: SkySquare, areas: readonly AreaIndexEntry[]): AreaIndexEntry | null {
  let best: AreaIndexEntry | null = null;
  let bestOverlap = -1;
  for (const a of areas) {
    if (!boxContains(a, sq.ra, sq.dec)) continue;
    const o = overlapDeg2(a, sq);
    // Strictly larger: an equal overlap keeps the earlier entry (index order).
    if (o > bestOverlap) {
      best = a;
      bestOverlap = o;
    }
  }
  return best;
}
