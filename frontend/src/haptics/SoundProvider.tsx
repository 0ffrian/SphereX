// #76: mounts the event app's one sound engine (appSound.ts) at the app root and keeps it in step
// with the app's honesty toggle (D-21). It renders no UI: #83 builds the controls and calls
// `useSound()`. The engine is audio only (Q-132). One `createAppSound` call per provider; React
// StrictMode runs `bind`, its unbind and `bind` again, and the instance survives that.
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useAppStore } from '@/state/store';
import { effectiveHonesty } from '@/viewer/honesty';
import { createAppSound, type AppSound, type SoundStatus } from './appSound';

const SoundContext = createContext<AppSound | null>(null);

export function SoundProvider({ children, sound }: { children: ReactNode; sound?: AppSound }) {
  const [s] = useState(() => sound ?? createAppSound());
  useEffect(
    () =>
      s.bind({
        get: () => effectiveHonesty(useAppStore.getState().honesty),
        subscribe: (fn) =>
          useAppStore.subscribe((state, prev) => {
            if (state.honesty !== prev.honesty) fn();
          }),
      }),
    [s],
  );
  return <SoundContext.Provider value={s}>{children}</SoundContext.Provider>;
}

/** The app's sound engine. Throws outside `SoundProvider`. */
export function useSound(): AppSound {
  const s = useContext(SoundContext);
  if (!s) throw new Error('useSound needs a SoundProvider above it');
  return s;
}

/** The sound status (unlocked, muted, volume, listening), live. */
export function useSoundStatus(): SoundStatus {
  const s = useSound();
  return useSyncExternalStore(s.subscribe, s.getStatus);
}
