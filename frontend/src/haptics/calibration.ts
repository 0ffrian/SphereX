// R8.7 per-device calibration (D-09, D-10): the faintest pulse (`minMs`), the levels the phone
// renders distinctly, and the audio–vibration offset (`avOffsetMs`). #9 pins the types and how a
// calibration is applied; the wizard, its maths and persistence come with #10.
import type { HapticOutputs } from './haptics';
import type { VibrateLevel } from './drivers/webVibrate';
import { VIBRATE_LEVELS_MS, WHISPER_PATTERN } from './tuning';

export type CalibrationLevel = 'whisper' | 'soft' | 'medium' | 'firm';

export const CALIBRATION_VERSION = 1;

/** One `localStorage` key per device for the whole calibration (R8.7). */
export const CALIBRATION_STORAGE_KEY = 'sx.haptics.calibration';

export interface Calibration {
  version: typeof CALIBRATION_VERSION;
  /** R8.7 step 1: the faintest pulse felt, in ms; becomes the soft tick. */
  minMs: number;
  /** R8.7 step 2: the levels the phone renders distinctly, weakest first (3 or 4). */
  levels: CalibrationLevel[];
  /**
   * R8.7 step 3: mean tap lag to vibration minus mean tap lag to sound, in ms. Positive: vibration
   * is felt later than sound is heard, so the audio is delayed (R8.9); negative: the vibration is.
   */
  avOffsetMs: number;
}

/**
 * Vibrate levels for a calibration: whisper → WHISPER_PATTERN, soft → `minMs`, medium and firm →
 * the R8.3 lengths. #10 refines this (soft = minMs, strictly increasing).
 */
export function levelsToVibrate(cal: Calibration): VibrateLevel[] {
  const fixed: Record<Exclude<CalibrationLevel, 'whisper' | 'soft'>, number> = {
    medium: VIBRATE_LEVELS_MS[1]!,
    firm: VIBRATE_LEVELS_MS[2]!,
  };
  return cal.levels.map((l) =>
    l === 'whisper' ? [...WHISPER_PATTERN] : l === 'soft' ? cal.minMs : fixed[l],
  );
}

/**
 * Apply a calibration to the web drivers: the vibrate levels, and the R8.9 offset rule. A positive
 * `avOffsetMs` (vibration felt later) delays the audio by it; otherwise the vibration is delayed.
 */
export function applyCalibration(outputs: HapticOutputs, cal: Calibration): void {
  outputs.vibrate.setLevels(levelsToVibrate(cal));
  const off = Number.isFinite(cal.avOffsetMs) ? cal.avOffsetMs : 0;
  outputs.audio.setOffsetMs(off > 0 ? off : 0);
  outputs.vibrate.setDelayMs(off < 0 ? -off : 0);
}
