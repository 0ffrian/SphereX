// #78: the React side of Track's path sound (R8.9.2). One PathSoundController per sound engine; the
// card's hop, frame list, player state and the honesty state are fed to `scrub` on every change, and
// the path tone is released on unmount (it holds the ambience duck with no timeout, Q-458).
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { PathSoundController, type PathFrame, type PathSoundOutput } from './pathSound';

export interface PathSoundApi {
  /** The path sound is on (pressed). */
  on: boolean;
  /** Call from the click: unlocks audio (Q-73) and starts the sound. */
  start(): Promise<boolean>;
  stop(): void;
}

const noSubscribe = () => () => {};
const off = () => false;

export function usePathSound(
  sound: PathSoundOutput | null,
  hop: PathFrame | null,
  frames: readonly PathFrame[],
  playing: boolean,
  /** Any value that changes with the honesty state: a change restarts a tone the engine dropped. */
  honesty: unknown,
): PathSoundApi {
  const ctl = useMemo(() => (sound ? new PathSoundController(sound) : null), [sound]);
  const on = useSyncExternalStore(ctl ? ctl.subscribe : noSubscribe, ctl ? ctl.getActive : off);

  useEffect(() => {
    ctl?.scrub({ hop, frames, playing });
  }, [ctl, hop, frames, playing, honesty]);

  // Unmount (card closed or replaced) or another engine: release the path tone.
  useEffect(() => () => ctl?.stop(), [ctl]);

  return useMemo(
    () => ({
      on,
      start: () => (ctl ? ctl.start() : Promise.resolve(false)),
      stop: () => ctl?.stop(),
    }),
    [ctl, on],
  );
}
