// #78: the "Hear the Shift" toggle on the Eros card (the event's Track-lite), Track's path sound
// (R8.9.2, Q-134, Q-194; controls A20.9). Off until pressed; the press unlocks audio (Q-73). While on,
// each new exposure sounds one tick (a note per frame, pitched by its wavelength) and, while the
// player runs, a soft path voice plays. Renders nothing outside a SoundProvider or with no frame.
import { useId, useMemo, useState } from 'react';
import { currentHop, erosList, useAreaStore } from '@/app/shell/areaStore';
import { useAppStore } from '@/state/store';
import { effectiveHonesty } from '@/viewer/honesty';
import { useOptionalSound, useOptionalSoundStatus } from '@/sound/SoundProvider';
import { usePathSound } from '@/sound/track/usePathSound';

export const HEAR_SHIFT_LABEL = 'Hear the Shift';
export const HEAR_SHIFT_HINT =
  'A tick for each exposure, pitched by wavelength: long is low. A soft hum follows the predicted path while the player runs.';
export const HEAR_SHIFT_NO_AUDIO = 'This browser could not start the sound.';
export const HEAR_SHIFT_MUTED = 'Sound is off. Turn it on in Sound.';

export function HearTheShift() {
  const sound = useOptionalSound();
  const status = useOptionalSoundStatus();
  const eros = useAreaStore((s) => s.eros);
  const det = useAreaStore((s) => s.det);
  const hop = useAreaStore((s) => currentHop(s));
  const playing = useAreaStore((s) => s.playing);
  const honesty = useAppStore((s) => effectiveHonesty(s.honesty));
  const frames = useMemo(() => erosList(eros, det), [eros, det]);
  const path = usePathSound(sound, hop, frames, playing, honesty);
  const [noAudio, setNoAudio] = useState(false);
  const lineId = useId();

  if (!sound || !hop) return null;

  const toggle = () => {
    if (path.on) {
      path.stop();
      return;
    }
    setNoAudio(false);
    // Inside the click: start() unlocks audio before any await (Q-73).
    // A start cancelled by a later press resolves null: not "no audio".
    void path.start().then((running) => {
      if (typeof running === 'boolean') setNoAudio(!running);
    });
  };

  const line = path.on ? (noAudio ? HEAR_SHIFT_NO_AUDIO : status?.muted ? HEAR_SHIFT_MUTED : HEAR_SHIFT_HINT) : null;

  return (
    <div className="flex flex-col" data-testid="hear-shift">
      <button
        type="button"
        className="sx-amb-btn self-start"
        aria-pressed={path.on}
        aria-describedby={line ? lineId : undefined}
        title={path.on ? 'Stop the notes' : "Hear this object's frames as notes while the player runs"}
        onClick={toggle}
        data-testid="hear-shift-toggle"
      >
        {HEAR_SHIFT_LABEL}
      </button>
      {/* Always rendered, so the live region exists before its text changes. */}
      <p className={line ? 'sx-hr-hint mt-2' : 'sx-hr-hint'} id={lineId} role="status" data-testid="hear-shift-line">
        {line ?? ''}
      </p>
    </div>
  );
}
