// R8.9, D-10: the button whose click unlocks output. Its click is the user activation that both
// `navigator.vibrate` and the AudioContext need, and the AudioContext is created or resumed inside
// that same click (a `click`, not `pointerdown`: Q-73). After the click its label says what is
// actually on, from the device and the haptics and sound switches (R8.7).
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { buttonClass } from '@/app/ui';
import type { HapticEngine } from '../haptics';
import { useHapticSettings } from '../settings';

export interface UnlockButtonProps {
  engine: HapticEngine;
  /** Whether this device can vibrate (the vibrate driver's `supported`). */
  canVibrate?: boolean;
  /** Called with whether audio is running after the click. */
  onUnlocked?: (audioRunning: boolean) => void;
  className?: string;
}

/** The label after the click. */
export function unlockedLabel(
  canVibrate: boolean,
  audioRunning: boolean,
  settings: { hapticsOn: boolean; soundOn: boolean },
): string {
  const haptics = canVibrate && settings.hapticsOn;
  const sound = audioRunning && settings.soundOn;
  if (haptics && sound) return 'Haptics and sound on';
  if (haptics) {
    return settings.soundOn ? 'Haptics on, sound unavailable here' : 'Haptics on, sound off';
  }
  if (sound) return canVibrate ? 'Sound on, haptics off' : 'Sound on (this device cannot vibrate)';
  if (settings.soundOn && !audioRunning) return 'Sound unavailable here';
  return 'Haptics and sound are off in settings';
}

export function UnlockButton({
  engine,
  canVibrate = false,
  onUnlocked,
  className,
}: UnlockButtonProps) {
  const [audioRunning, setAudioRunning] = useState<boolean | null>(null);
  const settings = useHapticSettings(
    useShallow((s) => ({ hapticsOn: s.hapticsOn, soundOn: s.soundOn })),
  );
  const onClick = () => {
    void engine.unlock().then((running) => {
      setAudioRunning(running);
      onUnlocked?.(running);
    });
  };
  const label =
    audioRunning === null
      ? 'Turn on haptics and sound'
      : unlockedLabel(canVibrate, audioRunning, settings);
  return (
    <button type="button" className={className ?? buttonClass} onClick={onClick}>
      {label}
    </button>
  );
}
