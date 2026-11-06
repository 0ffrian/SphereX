// R8.7 haptics and sound settings, on top of the `useHapticSettings` store (settings.ts), which
// saves them and, through `bindEngine`, applies them to the engine and drivers. Haptics on/off,
// sound on/off, volume, the strength multiplier (0.5–1.5×) and the texture-vs-data labels toggle.
// Native controls with visible labels; every target is at least 24 px (R9).
import { useEffect, useId, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { buttonClass } from '@/app/ui';
import { calibrationAvailable } from '../calibration';
import { platformEnv, type PlatformEnv } from '../platform';
import { ensureLoaded, useHapticSettings } from '../settings';
import { STRENGTH_MULTIPLIER_MAX, STRENGTH_MULTIPLIER_MIN } from '../tuning';

export interface HapticsSettingsProps {
  /** The vibrate driver's `supported`. Without it the haptics switch says it has no effect here. */
  canVibrate: boolean;
  /** Shown as "Calibrate vibration" when given and this is a phone that vibrates (R8.7). */
  onCalibrate?: () => void;
  /** Android + touch screen. Default: read from the browser. */
  platform?: PlatformEnv;
  className?: string;
}

const rowClass = 'flex min-h-11 items-center gap-3';
const checkClass = 'size-6 accent-sky-400';
const rangeClass = 'h-6 w-full max-w-xs accent-sky-400';

export function HapticsSettings({
  canVibrate,
  onCalibrate,
  platform,
  className,
}: HapticsSettingsProps) {
  const [browserEnv] = useState<PlatformEnv>(platformEnv);
  const canCalibrate = calibrationAvailable(canVibrate, platform ?? browserEnv);
  const s = useHapticSettings(
    useShallow((st) => ({
      hapticsOn: st.hapticsOn,
      soundOn: st.soundOn,
      volume: st.volume,
      strengthMultiplier: st.strengthMultiplier,
      showChannelLabels: st.showChannelLabels,
      update: st.update,
      reset: st.reset,
    })),
  );
  const id = useId();

  // Read the saved settings once the panel is shown (never at import).
  useEffect(() => ensureLoaded(), []);

  return (
    <fieldset className={className ?? 'flex flex-col gap-3'}>
      <legend className="mb-1 font-semibold">Haptics and sound</legend>

      <label className={rowClass}>
        <input
          type="checkbox"
          className={checkClass}
          checked={s.hapticsOn}
          onChange={(e) => s.update({ hapticsOn: e.target.checked })}
          aria-describedby={canVibrate ? undefined : `${id}-novib`}
        />
        Vibration
      </label>
      {!canVibrate && (
        <p id={`${id}-novib`} className="-mt-2 text-sm text-neutral-400">
          {s.soundOn
            ? 'This device cannot vibrate. What you would feel plays as sound instead.'
            : 'This device cannot vibrate, and sound is off: turn sound on to hear what you would feel.'}
        </p>
      )}

      <label className={rowClass}>
        <input
          type="checkbox"
          className={checkClass}
          checked={s.soundOn}
          onChange={(e) => s.update({ soundOn: e.target.checked })}
        />
        Sound
      </label>

      <label className="flex flex-col gap-1" htmlFor={`${id}-volume`}>
        <span>Volume: {Math.round(s.volume * 100)}%</span>
        <input
          id={`${id}-volume`}
          type="range"
          className={rangeClass}
          min={0}
          max={1}
          step={0.05}
          value={s.volume}
          aria-valuetext={`${Math.round(s.volume * 100)}%`}
          disabled={!s.soundOn}
          onChange={(e) => s.update({ volume: Number(e.target.value) })}
        />
      </label>

      <label className="flex flex-col gap-1" htmlFor={`${id}-strength`}>
        <span>Strength: {s.strengthMultiplier.toFixed(2)}×</span>
        <input
          id={`${id}-strength`}
          type="range"
          className={rangeClass}
          min={STRENGTH_MULTIPLIER_MIN}
          max={STRENGTH_MULTIPLIER_MAX}
          step={0.05}
          value={s.strengthMultiplier}
          aria-valuetext={`${s.strengthMultiplier.toFixed(2)} times`}
          onChange={(e) => s.update({ strengthMultiplier: Number(e.target.value) })}
        />
      </label>

      <label className={rowClass}>
        <input
          type="checkbox"
          className={checkClass}
          checked={s.showChannelLabels}
          onChange={(e) => s.update({ showChannelLabels: e.target.checked })}
        />
        Show texture and data labels in the legend
      </label>

      <div className="flex flex-wrap gap-2">
        {onCalibrate && canCalibrate && (
          <button type="button" className={buttonClass} onClick={onCalibrate}>
            Calibrate vibration
          </button>
        )}
        <button type="button" className={buttonClass} onClick={() => s.reset()}>
          Reset to defaults
        </button>
      </div>
    </fieldset>
  );
}
