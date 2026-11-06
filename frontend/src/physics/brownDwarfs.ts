// A7.3 Brown dwarfs: spectral type letter from temperature, and the ~1 Jupiter radius rule.
// Brown dwarfs are baked (D-01), so by D-26 no slider feeds these; the inputs come from the card.
// Absorption features and colour are handled by the spectrum view and the baker (R7.4).
import type { ObjectCard } from '@/contract';
import type { Overrides } from '@/viewer/sliders';
import { derive, InputReader, ResultBuilder, type PhysicsResult } from './tagging';

/** A7.3 boundaries, "approximate": L above about 1,400 K, T from 1,400 K to 500 K, Y below 500 K. */
export const L_T_BOUNDARY_K = 1400;
export const T_Y_BOUNDARY_K = 500;
/** A7.3: radius about 1 Jupiter radius, almost independent of mass (degeneracy pressure). */
export const BROWN_DWARF_RADIUS_RJUP = 1;

export type SpectralLetter = 'L' | 'T' | 'Y';

export function spectralLetterFromTeff(teffK: number): SpectralLetter | null {
  if (!Number.isFinite(teffK) || teffK <= 0) return null;
  if (teffK > L_T_BOUNDARY_K) return 'L';
  if (teffK >= T_Y_BOUNDARY_K) return 'T';
  return 'Y';
}

const S = 'A7.3';

export function deriveBrownDwarf(card: ObjectCard, overrides: Overrides): PhysicsResult {
  const r = new InputReader(card, overrides);
  const out = new ResultBuilder();

  const teff = r.readCard('teff_K');
  const letter = teff ? spectralLetterFromTeff(teff.value) : null;
  if (teff && letter) {
    out.set(
      'spectral_letter',
      derive(letter, [teff], {
        section: S,
        formula: `L if Teff > ${L_T_BOUNDARY_K} K, T if ${T_Y_BOUNDARY_K}-${L_T_BOUNDARY_K} K, Y below ${T_Y_BOUNDARY_K} K (approximate)`,
      }),
    );
  } else {
    out.refuse('spectral_letter', ['teff_K']);
  }

  // Only when the card has no radius: the card value always wins over the rule.
  if (!r.readCard('radius_rjup')) {
    out.set(
      'radius_rjup',
      derive(BROWN_DWARF_RADIUS_RJUP, [], {
        section: S,
        formula: 'R ~ 1 R_J',
        assumption: 'brown dwarf radii are about 1 Jupiter radius, almost independent of mass',
      }),
    );
  }

  return out.build(r);
}
