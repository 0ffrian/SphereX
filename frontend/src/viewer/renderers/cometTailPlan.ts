// Issue #71 stream F (Q-261, Q-263): the modelled tail of a comet at one time, as plan data.
//   Pure. Sun direction and path come from the card's `orbit_track`; the dust is Finson-Probstein
//   (physics/cometTail.ts). Scene frame: the display frame of that module, with the Sun on the
//   right at the August epoch and the orbit normal toward the viewer; the coma radius is 1.
import { EMISSION_START_JD, EPOCH_JD } from '@/physics/cometGas';
import {
  displayFrame,
  stateAt,
  summariseTail,
  toScene,
  unit,
  validTrack,
  type Row,
  type V3,
} from '@/physics/cometTail';
import type { Vec3, VolumePlan } from '../planTypes';
import {
  ionTailVolume,
  modelledDustTailVolume,
  TAIL_LENGTH_COMA_RADII,
} from '../volume/volumeSpecs';

/** A modelled dust tail shorter than this many coma radii is not drawn: it would be a smudge inside the coma. */
export const MIN_DUST_TAIL_COMA_RADII = 0.15;
/** Display cap on the dust tail, in coma radii (the real one can be longer than the view). */
export const MAX_DUST_TAIL_COMA_RADII = 4;

export interface ModelledTails {
  /** Unit vector toward the Sun in the scene (derived from Horizons). */
  sunScene: Vec3;
  ion: VolumePlan | null;
  dust: VolumePlan | null;
  /** Why the dust tail is not drawn, in plain words, or null when it is. */
  dustWhy: string | null;
  /** Modelled dust length in km, for the readout; null with no grains yet. */
  dustLengthKm: number | null;
  /** The dust length was cut to the display cap. */
  dustCapped: boolean;
}

/** The track rows of a card's `orbit_track`, or null when absent or unusable. */
export function trackRows(value: unknown): readonly Row[] | null {
  return validTrack(value as readonly Row[] | null | undefined) ? (value as readonly Row[]) : null;
}

export function modelledTails(
  rows: readonly Row[],
  jd: number,
  comaKm: number | null,
  seed: number,
  perBeta: number,
): ModelledTails | null {
  const frame = displayFrame(rows, EPOCH_JD['2025-08']);
  const s = stateAt(rows, jd);
  if (!frame || !s) return null;
  const sun = unit([-s.r[0], -s.r[1], -s.r[2]] as V3);
  if (!sun) return null;
  const sunScene = toScene(frame, sun) as Vec3;
  const ion = ionTailVolume(sunScene, (seed * 8 + 5) >>> 0);
  let dust: VolumePlan | null = null;
  let dustWhy: string | null = null;
  let dustLengthKm: number | null = null;
  let dustCapped = false;
  const sum = summariseTail(rows, jd, frame, { startJd: EMISSION_START_JD, perBeta, seed });
  if (!sum) {
    dustWhy = 'No dust has been released yet at this time.';
  } else if (comaKm === null || !(comaKm > 0)) {
    dustLengthKm = sum.dustLengthKm;
    dustWhy = 'The size of the coma is not known, so the tail cannot be scaled to it.';
  } else {
    dustLengthKm = sum.dustLengthKm;
    const len = sum.dustLengthKm / comaKm;
    if (len < MIN_DUST_TAIL_COMA_RADII) {
      dustWhy = 'The modelled tail is much shorter than the coma at this time, so it is not drawn.';
    } else {
      const capped = Math.min(len, MAX_DUST_TAIL_COMA_RADII);
      dustCapped = capped < len;
      const scale = capped / len;
      dust = modelledDustTailVolume(
        sum.dustAxis as Vec3,
        sum.dustBend as Vec3 | null,
        capped,
        (sum.dustLateralKm / comaKm) * scale,
        (seed * 8 + 6) >>> 0,
      );
    }
  }
  return { sunScene, ion, dust, dustWhy, dustLengthKm, dustCapped };
}

export { TAIL_LENGTH_COMA_RADII };
