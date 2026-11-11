// Provenance of an object's position as the panel shows it (D-02 badges). Mirrors the resolver's
// tags in backend/app/core/find/resolver.py: SIMBAD positions are `measured`, SBDB positions come
// from the JPL Horizons orbit (`model_dependent`), typed coordinates are user input (`derived`,
// Q-25) and so are positions picked on the sky (Q-91).
import type { Tag } from '@/contract';
import { formatCoords } from '@/app/format';

type Resolver = 'simbad' | 'sbdb' | 'coords' | 'reference';

/** Shown instead of coordinates for a reference object (Jupiter, Saturn, Titan, the Sun). */
export const NO_SKY_POSITION = 'no fixed sky position';

/**
 * Whether the object has a place on the sky. A reference object (resolver "reference", Q-258) is
 * a solar-system body that is not a SPHEREx target: the backend sends ra = dec = 0 as a placeholder
 * (tagged artistic), so the sky does not fly there, mark it or print 00h 00m 00s +00°.
 */
export function hasSkyPosition(o: { resolver: Resolver }): boolean {
  return o.resolver !== 'reference';
}

/** The position as text, or NO_SKY_POSITION for a reference object. */
export function positionText(o: { resolver: Resolver; ra: number; dec: number }): string {
  return hasSkyPosition(o) ? formatCoords(o.ra, o.dec) : NO_SKY_POSITION;
}

/** Where the frame search looks: the position, or the name of a reference object. */
export function searchPlaceText(o: {
  resolver: Resolver;
  ra: number;
  dec: number;
  name: string | null;
}): string {
  return hasSkyPosition(o) ? formatCoords(o.ra, o.dec) : (o.name ?? NO_SKY_POSITION);
}

/** Q-91: a position picked on the sky view. */
export const PICK_FORMULA =
  'the position under the pointer, computed from the view direction (user input, not an observation)';

/** Q-25: coordinates typed in the search (the backend's formula, word for word). */
export const TYPED_FORMULA =
  'ra, dec = the coordinates typed in the query (user input, not an observation)';

export function positionProvenance(
  resolver: Resolver,
  pickedOnSky: boolean,
): { tag: Tag; tooltip: string } {
  if (resolver === 'simbad')
    return { tag: 'measured', tooltip: 'Position from SIMBAD, ICRS, J2000' };
  if (resolver === 'sbdb') {
    return { tag: 'model_dependent', tooltip: 'Position computed from the JPL Horizons orbit' };
  }
  if (resolver === 'reference')
    return {
      tag: 'artistic',
      tooltip: 'A planet of the solar system, not a SPHEREx target: no place on the sky is claimed',
    };
  return { tag: 'derived', tooltip: pickedOnSky ? PICK_FORMULA : TYPED_FORMULA };
}
