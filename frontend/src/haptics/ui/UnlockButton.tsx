// R8.9, D-10: the button whose click unlocks output. Its click is the user activation that both
// `navigator.vibrate` and the AudioContext need, and the AudioContext is created or resumed inside
// that same click (a `click`, not `pointerdown`: Q-73). The unlock state is shared
// (audioContext.ts), so every UnlockButton on the page agrees. The button's name is the action;
// once output is on, the button goes away and a polite live region beside it says what is on.
import { useEffect, useRef, useSyncExternalStore } from 'react';
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

/** The action, as the button's accessible name. */
export function unlockActionLabel(canVibrate: boolean, settings: Switches): string {
  const vibration = canVibrate && settings.hapticsOn;
  if (vibration && settings.soundOn) return 'Turn on vibration and sound';
  if (vibration) return 'Turn on vibration';
  return 'Turn on sound';
}

/** What is on after the click; never claims an output that is off or missing. */
export function unlockedLabel(
  canVibrate: boolean,
  audioRunning: boolean,
  settings: Switches,
): string {
  const vibration = canVibrate && settings.hapticsOn;
  const sound = audioRunning && settings.soundOn;
  if (vibration && sound) return 'Vibration and sound on';
  if (vibration) {
    return settings.soundOn ? 'Vibration on, sound unavailable here' : 'Vibration on, sound off';
  }
  if (sound)
    return canVibrate ? 'Sound on, vibration off' : 'Sound on (this device cannot vibrate)';
  if (settings.soundOn && !audioRunning) return 'Sound unavailable here';
  return 'Vibration and sound are off in settings';
}

/** The button is needed until a click has unlocked output, and again if the OS suspends audio. */
export function needsUnlock(state: UnlockState): boolean {
  return !state.unlocked || state.audio === 'suspended';
}

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
  const status = useRef<HTMLSpanElement>(null);
  const clicked = useRef(false);
  const showButton = needsUnlock(state);

  // When this button's own click hides it, keep keyboard focus on the status beside it.
  useEffect(() => {
    if (!showButton && clicked.current) {
      clicked.current = false;
      status.current?.focus();
    }
  }, [showButton]);

  const onClick = () => {
    clicked.current = true;
    void engine.unlock().then((running) => onUnlocked?.(running));
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {showButton && (
        <button type="button" className={className ?? buttonClass} onClick={onClick}>
          {unlockActionLabel(canVibrate, settings)}
        </button>
      )}
      <span ref={status} tabIndex={-1} aria-live="polite" className="outline-none">
        {state.unlocked ? unlockedLabel(canVibrate, state.audio === 'running', settings) : ''}
      </span>
    </span>
  );
}
