// R13.9 / R13.10 (Q-441, Q-442; moved by Q-455): the sound settings. Since Q-455 (Moon, 12 Nov 2026)
// they are not a "Sound" button in the sky's top bar any more: the sound belongs to the generated
// bodies, so these controls sit in the build view's Ambience dropdown (`build/AmbiencePanel.tsx`),
// whose header button unlocks audio (Q-73: a user gesture, never on load). Sound on/off and volume,
// the fly view's ambience on/off and volume, and lightning Flashes. The settings are the
// `useSoundSettings` store (saved under the pre-D-39 key). Every sound follows Sound and Volume (the
// engine, the Listen sweep and Hear it, hearAudio.ts); the ambience plays only in the fly view at
// "+ Artistic" (#116). Switches and sliders have visible labels; rows are 40 px (D-38), 44 px on touch.
import { useEffect, useId } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { SwitchRow } from '@/app/PanelControls';
import { useSoundStatus } from '../SoundProvider';
import { ensureLoaded, useSoundSettings } from '../settings';

export const SOUND_STATUS_OFF = 'Sound is off.';
export const SOUND_STATUS_NONE = 'This browser cannot play sound.';
export const SOUND_STATUS_SUSPENDED = 'The browser paused the sound. Click Ambience again to resume it.';
export const SOUND_STATUS_READY = 'Ambience plays in the fly view at + Artistic.';
export const FLASHES_HINT = 'Lightning in the fly view. Off with reduced motion.';

function Volume({
  label,
  value,
  disabled,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange(v: number): void;
  testId: string;
}) {
  const id = useId();
  return (
    <div className="sx-snd-vol">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(value * 100)}
        disabled={disabled}
        aria-valuetext={`${Math.round(value * 100)}%`}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        data-testid={testId}
      />
    </div>
  );
}

/** The sound settings as a panel body (no button of its own): the Ambience dropdown holds it. */
export function SoundControls() {
  const status = useSoundStatus();
  const s = useSoundSettings(
    useShallow((st) => ({
      soundOn: st.soundOn,
      volume: st.volume,
      ambienceOn: st.ambienceOn,
      ambienceVolume: st.ambienceVolume,
      flashesOn: st.flashesOn,
      update: st.update,
    })),
  );
  const hintId = useId();

  useEffect(() => ensureLoaded(), []);

  const line = !s.soundOn
    ? SOUND_STATUS_OFF
    : status.audio === 'none'
      ? SOUND_STATUS_NONE
      : status.unlocked && status.audio === 'suspended'
        ? SOUND_STATUS_SUSPENDED
        : SOUND_STATUS_READY;

  return (
    <div className="sx-snd" data-testid="sound-settings">
      <p className="sx-snd-status" role="status" data-testid="sound-status">
        {line}
      </p>
      <div className="sx-snd-group">
        <SwitchRow label="Sound" checked={s.soundOn} onChange={(v) => s.update({ soundOn: v })} testId="sound-on" />
        <Volume
          label="Volume"
          value={s.volume}
          disabled={!s.soundOn}
          onChange={(v) => s.update({ volume: v })}
          testId="sound-volume"
        />
      </div>
      <div className="sx-snd-group">
        <SwitchRow
          label="Ambience in the fly view"
          checked={s.ambienceOn}
          onChange={(v) => s.update({ ambienceOn: v })}
          testId="sound-ambience"
        />
        <Volume
          label="Volume"
          value={s.ambienceVolume}
          disabled={!s.soundOn || !s.ambienceOn}
          onChange={(v) => s.update({ ambienceVolume: v })}
          testId="sound-ambience-volume"
        />
      </div>
      <div className="sx-snd-group" aria-describedby={hintId}>
        <SwitchRow label="Flashes" checked={s.flashesOn} onChange={(v) => s.update({ flashesOn: v })} testId="sound-flashes" />
        <p id={hintId} className="sx-snd-hint">
          {FLASHES_HINT}
        </p>
      </div>
    </div>
  );
}
