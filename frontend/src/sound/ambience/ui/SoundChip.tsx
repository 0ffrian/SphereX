// R13.10 §12.1-12.2: the fly view's Sound chip. It shows when the fly view is live at "+ Artistic": the label
// "Imagined sound" with the Artistic badge, a Mute toggle (the ambience setting, one truth with the Sound popover),
// "What you hear" (opens the panel) and the live caption. The visible caption is not a live region; with "Read changes
// aloud" on, a polite sr-only region that is always present mirrors it (red L23). Locked or paused audio offers a
// click to start it (Q-73); Sound off offers to turn it on (red M14).
import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { ProvenanceBadge } from '@/app/Badge';
import { getUnlockState, subscribeUnlockState, unlockAudio } from '../../audioContext';
import { useSoundSettings } from '../../settings';
import { useAmbienceStore } from '../ambienceStore';
import { WhatYouHear } from './WhatYouHear';

export const CHIP_TEXT = {
  title: 'Imagined sound',
  start: 'Click to hear',
  resume: 'Resume sound',
  turnOn: 'Turn sound on',
  mute: 'Mute',
  what: 'What you hear',
  soundOff: 'Sound is off.',
  locked: 'Sound starts with a click (browsers need one).',
  suspended: 'The browser paused the sound.',
  muted: 'The ambience is muted.',
} as const;

export function SoundChip() {
  const ui = useAmbienceStore((s) => s.ui);
  const soundOn = useSoundSettings((s) => s.soundOn);
  const ambienceOn = useSoundSettings((s) => s.ambienceOn);
  const readCaptions = useSoundSettings((s) => s.readCaptions);
  const update = useSoundSettings((s) => s.update);
  const unlock = useSyncExternalStore(subscribeUnlockState, getUnlockState, getUnlockState);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const whatRef = useRef<HTMLButtonElement>(null);
  if (!ui.live) return null;

  const locked = !unlock.unlocked;
  const suspended = unlock.unlocked && unlock.audio === 'suspended';
  const noAudio = unlock.audio === 'none' && unlock.unlocked;
  const caption = !soundOn
    ? CHIP_TEXT.soundOff
    : noAudio
      ? 'This browser cannot play sound.'
      : locked
        ? CHIP_TEXT.locked
        : suspended
          ? CHIP_TEXT.suspended
          : !ambienceOn
            ? CHIP_TEXT.muted
            : [ui.caption, ui.levelNote].filter(Boolean).join(' · ');

  let action: React.ReactNode;
  if (!soundOn) {
    action = (
      <button type="button" className="sx-amb-btn" onClick={() => update({ soundOn: true })}>
        {CHIP_TEXT.turnOn}
      </button>
    );
  } else if ((locked || suspended) && !noAudio) {
    action = (
      <button type="button" className="sx-amb-btn" onClick={() => void unlockAudio()}>
        {locked ? CHIP_TEXT.start : CHIP_TEXT.resume}
      </button>
    );
  } else {
    action = (
      <button
        type="button"
        className="sx-amb-btn"
        aria-pressed={!ambienceOn}
        onClick={() => update({ ambienceOn: !ambienceOn })}
      >
        {CHIP_TEXT.mute}
      </button>
    );
  }

  return (
    <div
      className="sx-amb"
      role="group"
      aria-label="Sound of this place"
      data-testid="world-fly-sound"
    >
      <div className="sx-amb-row">
        <span className="sx-amb-title">{CHIP_TEXT.title}</span>
        <ProvenanceBadge tag="artistic" />
        {action}
        <button
          ref={whatRef}
          type="button"
          className="sx-amb-btn"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
        >
          {CHIP_TEXT.what}
        </button>
      </div>
      {caption && (
        <p className="sx-amb-caption" data-testid="world-fly-caption">
          {caption}
        </p>
      )}
      <div
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-testid="world-fly-caption-live"
      >
        {readCaptions ? caption : ''}
      </div>
      {open && (
        <WhatYouHear
          id={panelId}
          onClose={() => {
            setOpen(false);
            whatRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
