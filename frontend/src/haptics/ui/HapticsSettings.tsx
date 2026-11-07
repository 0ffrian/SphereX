// R8.7 vibration and sound settings, on top of the `useHapticSettings` store (settings.ts), which
// saves them and, through `bindEngine`, applies them to the engine and drivers. Vibration on/off,
// sound on/off, volume, the strength multiplier (0.5–1.5×) and the texture-vs-data labels toggle.
// Native controls with visible labels; every target is at least 24 px (R9). "This device
// vibrates" follows the R8.7 phone rule (platform.ts `deviceVibrates`: vibrate API, Android, touch
// screen), not the bare `navigator.vibrate`, which desktop Chrome also has.
import { useEffect, useId, useState, type Ref } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { buttonClass } from '@/app/ui';
import { calibrationAvailable } from '../calibration';
import { deviceVibrates, platformEnv, type PlatformEnv } from '../platform';
import { ensureLoaded, useHapticSettings } from '../settings';
import { STRENGTH_MULTIPLIER_MAX, STRENGTH_MULTIPLIER_MIN } from '../tuning';

export interface HapticsSettingsProps {
  /** The vibrate driver's `supported`; combined with the phone rule (Android + touch screen). */
  canVibrate: boolean;
  /** Shown as "Calibrate vibration" when given and this is a phone that vibrates (R8.7). */
  onCalibrate?: () => void;
  /** The "Calibrate vibration" button, so the wizard can return focus to it. */
  calibrateButtonRef?: Ref<HTMLButtonElement>;
  /** Android + touch screen. Default: read from the browser. */
  platform?: PlatformEnv;
  className?: string;
}

const rowClass = 'flex min-h-11 items-center gap-3';
const NBSP = '\u00a0';
const checkClass = 'size-6 shrink-0 accent-sky-400';
const rangeClass = 'h-6 w-full max-w-xs accent-sky-400';

export function HapticsSettings({
  canVibrate,
  onCalibrate,
  calibrateButtonRef,
  platform,
  className,
}: HapticsSettingsProps) {
  const [browserEnv] = useState<PlatformEnv>(platformEnv);
  const env = platform ?? browserEnv;
  const vibrates = deviceVibrates(canVibrate, env);
  const canCalibrate = calibrationAvailable(canVibrate, env);
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
  // The reset confirmation: cleared by any later change; a repeat alternates a no-break space so
  // it is announced again.
  const [status, setStatus] = useState({ text: '', seq: 0 });
  const update: typeof s.update = (changes) => {
    setStatus((st) => (st.text ? { text: '', seq: st.seq } : st));
    s.update(changes);
  };

  // Read the saved settings once the panel is shown (never at import).
  useEffect(() => ensureLoaded(), []);

  const normal = Math.abs(s.strengthMultiplier - 1) < 1e-9;

  return (
    <fieldset className={className ?? 'flex flex-col gap-3'}>
      <legend className="mb-1 font-semibold">Vibration and sound</legend>

      <label className={rowClass}>
        <input
          type="checkbox"
          className={checkClass}
          checked={s.hapticsOn}
          onChange={(e) => update({ hapticsOn: e.target.checked })}
          aria-describedby={vibrates ? undefined : `${id}-novib`}
        />
        Vibration
      </label>
      {!vibrates && (
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
          onChange={(e) => update({ soundOn: e.target.checked })}
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
          onChange={(e) => update({ volume: Number(e.target.value) })}
        />
      </label>

      <label className="flex flex-col gap-1" htmlFor={`${id}-strength`}>
        <span>
          Vibration strength: {s.strengthMultiplier.toFixed(2)}×{normal ? ' (normal)' : ''}
        </span>
        <input
          id={`${id}-strength`}
          type="range"
          className={rangeClass}
          min={STRENGTH_MULTIPLIER_MIN}
          max={STRENGTH_MULTIPLIER_MAX}
          step={0.05}
          value={s.strengthMultiplier}
          aria-valuetext={`${s.strengthMultiplier.toFixed(2)} times${normal ? ', normal' : ''}`}
          onChange={(e) => update({ strengthMultiplier: Number(e.target.value) })}
        />
      </label>

      <label className={rowClass}>
        <input
          type="checkbox"
          className={checkClass}
          checked={s.showChannelLabels}
          onChange={(e) => update({ showChannelLabels: e.target.checked })}
        />
        Label what you feel as surface texture or data
      </label>

      <div className="flex flex-wrap gap-2">
        {onCalibrate && canCalibrate && (
          <button
            ref={calibrateButtonRef}
            type="button"
            className={buttonClass}
            onClick={onCalibrate}
          >
            Calibrate vibration
          </button>
        )}
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            s.reset();
            setStatus((st) => ({
              text: "Settings reset to this device's defaults.",
              seq: st.seq + 1,
            }));
          }}
        >
          Reset to defaults
        </button>
      </div>
      <p role="status" className="text-sm text-neutral-300">
        {status.text}
        {status.seq % 2 === 1 && status.text ? NBSP : ''}
      </p>
    </fieldset>
  );
}
