// Provenance of an object's position as the panel shows it (D-02 badges). Mirrors the resolver's
// tags in backend/app/core/find/resolver.py: SIMBAD positions are `measured`, SBDB positions come
// from the JPL Horizons orbit (`model_dependent`), typed coordinates are user input (`derived`,
// Q-25) and so are positions picked on the sky (Q-91).
import type { Tag } from '@/contract';

/** Q-91: a position picked on the sky view. */
export const PICK_FORMULA =
  'the position under the pointer, computed from the view direction (user input, not an observation)';

/** Q-25: coordinates typed in the search (the backend's formula, word for word). */
export const TYPED_FORMULA =
  'ra, dec = the coordinates typed in the query (user input, not an observation)';

export function positionProvenance(
  resolver: 'simbad' | 'sbdb' | 'coords',
  pickedOnSky: boolean,
): { tag: Tag; tooltip: string } {
  if (resolver === 'simbad')
    return { tag: 'measured', tooltip: 'Position from SIMBAD, ICRS, J2000' };
  if (resolver === 'sbdb') {
    return { tag: 'model_dependent', tooltip: 'Position computed from the JPL Horizons orbit' };
  }
  return { tag: 'derived', tooltip: pickedOnSky ? PICK_FORMULA : TYPED_FORMULA };
}
