// R8.9, D-10: the button whose click unlocks output. Its click is the user activation that both
// `navigator.vibrate` and the AudioContext need, and the AudioContext is created or resumed inside
// that same click (a `click`, not `pointerdown`: Q-61).
import { useState } from 'react';
import { buttonClass } from '@/app/ui';
import type { HapticEngine } from '../haptics';

export interface UnlockButtonProps {
  engine: HapticEngine;
  /** Whether this device can vibrate (the vibrate driver's `supported`); only changes the label. */
  canVibrate?: boolean;
  /** Called with whether audio is running after the click. */
  onUnlocked?: (audioRunning: boolean) => void;
  className?: string;
}

export function UnlockButton({
  engine,
  canVibrate = false,
  onUnlocked,
  className,
}: UnlockButtonProps) {
  const [state, setState] = useState<'idle' | 'on' | 'no-audio'>('idle');
  const onClick = () => {
    void engine.unlock().then((running) => {
      setState(running ? 'on' : 'no-audio');
      onUnlocked?.(running);
    });
  };
  const on = canVibrate ? 'Haptics and sound on' : 'Sound on (this device cannot vibrate)';
  const label =
    state === 'idle' ? 'Turn on haptics and sound' : state === 'on' ? on : 'Sound unavailable here';
  return (
    <button type="button" className={className ?? buttonClass} onClick={onClick}>
      {label}
    </button>
  );
}
