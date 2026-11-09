// Markers for positions whose frame list is complete in the backend cache (`GET /v1/sky/cached`):
// clicking one loads at once. Logic only; SkyPane draws them and useCachedMarkers loads them.
import type { SkyCachedObject } from '@/app/api/types';
import { formatCoords } from '@/app/format';
import { separationDeg } from '@/viewer/sky/skyMath';
import type { SkyQuery } from '@/state/store';
import type { TargetMarker } from './useTargetMarkers';

/**
 * A cached position this close to a target marker is the same object (it is drawn once, as the
 * target). Display choice, not a physical value: 2″ is well under one SPHEREx pixel (6.15″).
 */
export const CACHED_DEDUPE_DEG = 2 / 3600;

/** The cached positions to draw: every one that is not already a target marker. */
export function cachedMarkersToShow(
  cached: readonly SkyCachedObject[],
  targets: readonly TargetMarker[],
): SkyCachedObject[] {
  const targetIds = new Set(targets.map((t) => t.id));
  const seen = new Set<string>();
  return cached.filter((c) => {
    if (seen.has(c.id) || targetIds.has(c.id)) return false;
    seen.add(c.id);
    return !targets.some((t) => separationDeg(t.ra, t.dec, c.ra, c.dec) <= CACHED_DEDUPE_DEG);
  });
}

/**
 * The search a cached marker runs. A name searches the text the backend resolved before (a cache
 * hit, also offline); a position searches its coordinates with the 5 decimals of its id
 * (backend `coord_id`), so the same id and the same cached frames come back.
 */
export function cachedMarkerQuery(c: SkyCachedObject): SkyQuery {
  if (c.resolver !== 'coords') {
    return { q: c.query ?? c.name ?? c.id, kind: 'name', origin: 'sky' };
  }
  return { q: `${c.ra.toFixed(5)},${c.dec.toFixed(5)}`, kind: 'coords', origin: 'sky' };
}

/** Short visible label: the name, or the position. */
export function cachedMarkerLabel(c: SkyCachedObject): string {
  return c.name ?? formatCoords(c.ra, c.dec);
}

/** Accessible name and tooltip of the marker button. */
export function cachedMarkerDescription(c: SkyCachedObject): string {
  const frames = c.frames === 1 ? '1 frame' : `${c.frames} frames`;
  return `${cachedMarkerLabel(c)}: cached, ${frames}, loads instantly. Open it`;
}
