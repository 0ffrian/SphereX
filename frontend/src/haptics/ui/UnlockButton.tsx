// R8.9, D-10: the button whose click unlocks output. Its click is the user activation that both
// `navigator.vibrate` and the AudioContext need, and the AudioContext is created or resumed inside
// that same click (a `click`, not `pointerdown`: Q-73). The unlock state is shared
// (audioContext.ts), so every UnlockButton on the page agrees. The button's name is the action and
// never names an output that is off; once output is on, the button goes away and a status beside
// it says what is on. Only the instance that was clicked announces the result (one polite live
// region per page in practice); the others show the same status as plain text.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { buttonClass } from '@/app/ui';
import { getUnlockState, subscribeUnlockState, type UnlockState } from '../audioContext';
import type { HapticEngine } from '../haptics';
import { useHapticSettings } from '../settings';

export interface UnlockButtonProps {
  engine: HapticEngine;
  /**
   * Whether this device really vibrates: pass `deviceVibrates(vibrate.supported)` (platform.ts),
   * not the bare `supported`, which is also true in desktop Chrome.
   */
  canVibrate?: boolean;
  /** Called with whether audio is running after the click. */
  onUnlocked?: (audioRunning: boolean) => void;
  className?: string;
}

interface Switches {
  hapticsOn: boolean;
  soundOn: boolean;
}

/** Shown instead of a button when both outputs are off: there is nothing to turn on. */
export const BOTH_OFF_TEXT = 'Vibration and sound are off in settings';

/**
 * The action, as the button's accessible name; null when vibration (on this device) and sound
 * are both off, so no button would turn anything on.
 */
export function unlockActionLabel(canVibrate: boolean, settings: Switches): string | null {
  const vibration = canVibrate && settings.hapticsOn;
  if (vibration && settings.soundOn) return 'Turn on vibration and sound';
  if (vibration) return 'Turn on vibration';
  if (settings.soundOn) return 'Turn on sound';
  return null;
}

/**
 * What is on after the click; never claims an output that is off or missing. `audio` tells a
 * suspended context (the OS paused it: the button comes back to resume it) from no Web Audio.
 */
export function unlockedLabel(
  canVibrate: boolean,
  audioRunning: boolean,
  settings: Switches,
  audio?: UnlockState['audio'],
): string {
  const vibration = canVibrate && settings.hapticsOn;
  const sound = audioRunning && settings.soundOn;
  if (vibration && sound) return 'Vibration and sound on';
  const paused = settings.soundOn && !audioRunning && audio === 'suspended';
  if (vibration) {
    if (paused) return 'Vibration on, sound paused; press the button to resume';
    return settings.soundOn ? 'Vibration on, sound unavailable here' : 'Vibration on, sound off';
  }
  if (sound) {
    return canVibrate ? 'Sound on, vibration off' : 'Sound on (this device cannot vibrate)';
  }
  if (paused) return 'Sound paused; press the button to resume';
  if (settings.soundOn && !audioRunning) return 'Sound unavailable here';
  return BOTH_OFF_TEXT;
}

/** The button is needed until a click has unlocked output, and again if the OS suspends audio. */
export function needsUnlock(state: UnlockState): boolean {
  return !state.unlocked || state.audio === 'suspended';
}

const statusFocusClass =
  'rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400';

export function UnlockButton({
  engine,
  canVibrate = false,
  onUnlocked,
  className,
}: UnlockButtonProps) {
  const state = useSyncExternalStore(subscribeUnlockState, getUnlockState, getUnlockState);
  const settings = useHapticSettings(
    useShallow((s) => ({ hapticsOn: s.hapticsOn, soundOn: s.soundOn })),
  );
  // This instance was the one clicked: it announces the result, the others stay silent.
  const [owner, setOwner] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);
  const moveFocus = useRef(false);
  const action = unlockActionLabel(canVibrate, settings);
  const showButton = needsUnlock(state) && action !== null;

  // When this button's own click removes it, keep keyboard focus beside it, unless the user has
  // already moved focus elsewhere.
  useEffect(() => {
    if (showButton || !moveFocus.current) return;
    moveFocus.current = false;
    const active = typeof document === 'undefined' ? null : document.activeElement;
    if (active === null || active === document.body) wrapper.current?.focus();
  }, [showButton]);

  const onClick = () => {
    setOwner(true);
    moveFocus.current = true;
    void engine.unlock().then((running) => {
      // The click did not remove the button (audio still suspended): nothing to move focus from.
      if (needsUnlock(getUnlockState())) moveFocus.current = false;
      onUnlocked?.(running);
    });
  };

  const status = state.unlocked
    ? unlockedLabel(canVibrate, state.audio === 'running', settings, state.audio)
    : action === null
      ? BOTH_OFF_TEXT
      : '';

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {showButton && (
        <button type="button" className={className ?? buttonClass} onClick={onClick}>
          {action}
        </button>
      )}
      {/* The focus target is not the live region, so the status is not read twice. */}
      <span ref={wrapper} tabIndex={-1} className={statusFocusClass}>
        <span aria-live="polite">{owner ? status : ''}</span>
        {!owner && status}
      </span>
    </span>
  );
}
