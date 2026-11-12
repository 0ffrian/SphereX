// R13.9 / R13.10 (Q-441, Q-442): the app shell's Sound control. A "Sound" button in the top bar
// opens a small popover with sound on/off, volume, ambience on/off and volume, and Flashes. The
// button's click unlocks audio (Q-73: a user gesture, never on load); no sound plays from it. The
// settings are the `useSoundSettings` store (saved under the pre-D-39 key). Every sound follows
// Sound and Volume (the engine, the Listen sweep and the build pane's Hear it, hearAudio.ts); the
// ambience itself plays only in the fly view at "+ Artistic" (#116). In the build view the top bar
// is click-through, so index.css moves this control to the bottom right and gives it clicks.
// Popover pattern as ConfidencePopover: Escape (consumed, so the shell's own Escape handlers skip it,
// A21.10) and an outside click close it, and focus goes back to the button. Native controls with
// visible labels, targets at least 24 px (R9).
import { useEffect, useId, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSound, useSoundStatus } from '../SoundProvider';
import { ensureLoaded, useSoundSettings } from '../settings';

export const SOUND_STATUS_OFF = 'Sound is off.';
export const SOUND_STATUS_NONE = 'This browser cannot play sound.';
export const SOUND_STATUS_SUSPENDED = 'The browser paused the sound. Click Sound again to resume it.';
export const SOUND_STATUS_READY =
  'Every sound follows Sound and Volume, Hear it included. The imagined ambience plays in the fly view at + Artistic.';
export const FLASHES_HINT = 'Lightning flashes in the fly view. Reduced motion always turns them off.';

const rowClass = 'flex min-h-11 items-center gap-3';
const checkClass = 'size-6 shrink-0 accent-sky-400';
const rangeClass = 'h-6 w-full accent-sky-400 disabled:opacity-40';

export function SoundSettings({ className }: { className?: string }) {
  const sound = useSound();
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
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const titleId = useId();
  const statusId = useId();
  const flashesHintId = useId();
  const ids = { sound: useId(), volume: useId(), amb: useId(), ambVol: useId(), flashes: useId() };

  useEffect(() => ensureLoaded(), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (panel.current?.contains(t) || button.current?.contains(t))) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  const onButton = () => {
    // Synchronously inside the click (Q-73): browsers only start audio from a user activation.
    void sound.unlock();
    setOpen((o) => !o);
  };

  const line = !s.soundOn
    ? SOUND_STATUS_OFF
    : status.audio === 'none'
      ? SOUND_STATUS_NONE
      : status.unlocked && status.audio === 'suspended'
        ? SOUND_STATUS_SUSPENDED
        : SOUND_STATUS_READY;

  return (
    <div className={`sx-sound relative shrink-0 ${className ?? ''}`} data-testid="sound-settings">
      <button
        ref={button}
        type="button"
        className="sx-coords inline-flex min-h-11 items-center gap-2 text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onButton}
        data-testid="sound-button"
      >
        Sound
        <span className="text-muted">{s.soundOn ? 'on' : 'off'}</span>
      </button>
      <div
        ref={panel}
        id={panelId}
        role="group"
        aria-labelledby={titleId}
        aria-describedby={statusId}
        hidden={!open}
        className="sx-sound-pop absolute top-full right-0 z-50 mt-2 w-72 rounded-lg border border-line bg-s1 p-3 text-sm text-fg shadow-lg"
        data-testid="sound-popover"
      >
        <h2 id={titleId} className="mb-1 text-sm font-semibold">
          Sound settings
        </h2>
        <p id={statusId} className="mb-2 text-muted" data-testid="sound-status">
          {line}
        </p>
        <div className={rowClass}>
          <input
            id={ids.sound}
            type="checkbox"
            className={checkClass}
            checked={s.soundOn}
            onChange={(e) => s.update({ soundOn: e.target.checked })}
          />
          <label htmlFor={ids.sound}>Sound</label>
        </div>
        <div className={rowClass}>
          <label htmlFor={ids.volume} className="w-28 shrink-0">
            Volume
          </label>
          <input
            id={ids.volume}
            type="range"
            min={0}
            max={100}
            step={1}
            className={rangeClass}
            value={Math.round(s.volume * 100)}
            disabled={!s.soundOn}
            onChange={(e) => s.update({ volume: Number(e.target.value) / 100 })}
          />
        </div>
        <div className={rowClass}>
          <input
            id={ids.amb}
            type="checkbox"
            className={checkClass}
            checked={s.ambienceOn}
            onChange={(e) => s.update({ ambienceOn: e.target.checked })}
          />
          <label htmlFor={ids.amb}>Ambience (fly view)</label>
        </div>
        <div className={rowClass}>
          <label htmlFor={ids.ambVol} className="w-28 shrink-0">
            Ambience volume
          </label>
          <input
            id={ids.ambVol}
            type="range"
            min={0}
            max={100}
            step={1}
            className={rangeClass}
            value={Math.round(s.ambienceVolume * 100)}
            disabled={!s.soundOn || !s.ambienceOn}
            onChange={(e) => s.update({ ambienceVolume: Number(e.target.value) / 100 })}
          />
        </div>
        <div className={rowClass}>
          <input
            id={ids.flashes}
            type="checkbox"
            className={checkClass}
            checked={s.flashesOn}
            aria-describedby={flashesHintId}
            onChange={(e) => s.update({ flashesOn: e.target.checked })}
          />
          <label htmlFor={ids.flashes}>Flashes</label>
        </div>
        <p id={flashesHintId} className="text-muted">
          {FLASHES_HINT}
        </p>
      </div>
    </div>
  );
}
