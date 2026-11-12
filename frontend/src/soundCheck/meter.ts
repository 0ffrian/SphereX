// R13.9 sound check: level-meter maths (pure). RMS and peak in dBFS over one analyser block, a 1 s peak hold and a
// clip counter. dBFS here is sample-based; the LUFS targets are compared approximately (no K-weighting on the page).
import './marker';

export const METER_FLOOR_DB = -100;
/** A sample at or above this magnitude counts as a clip (0 dBFS less a hair). */
export const CLIP_LEVEL = 0.999;

const toDb = (x: number) => (x > 0 ? Math.max(METER_FLOOR_DB, 20 * Math.log10(x)) : METER_FLOOR_DB);

export function rmsDb(block: ArrayLike<number>): number {
  if (!block.length) return METER_FLOOR_DB;
  let s = 0;
  for (let i = 0; i < block.length; i++) s += (block[i] as number) ** 2;
  return toDb(Math.sqrt(s / block.length));
}

export function peakDb(block: ArrayLike<number>): number {
  let p = 0;
  for (let i = 0; i < block.length; i++) p = Math.max(p, Math.abs(block[i] as number));
  return toDb(p);
}

export function clips(block: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < block.length; i++) if (Math.abs(block[i] as number) >= CLIP_LEVEL) n++;
  return n;
}

/** Holds the highest peak for `holdS` seconds, then follows the current peak. */
export class PeakHold {
  private db = METER_FLOOR_DB;
  private at = -Infinity;
  constructor(private readonly holdS = 1) {}
  update(peak: number, nowS: number): number {
    if (peak >= this.db || nowS - this.at > this.holdS) {
      this.db = peak;
      this.at = nowS;
    }
    return this.db;
  }
}
