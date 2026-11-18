// §10 / §13 (R13.8, R13.10): the flyover soundscape hook, mounted in WorldFlyStage. It owns the 10 Hz rAF throttle and
// every gate subscription; the pipeline is ambienceLoop.ts. Gate changes (close-up closed, page hidden, honesty,
// settings, unlock, unmount) reach the loop at once, not at the next tick, so the fade never waits for rAF (C1).
// Kill switch for the stage (blue 30): `?sx-noambience` or localStorage `sx.ambience.kill=1` mounts nothing.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CardToWorldOk } from '@/engine/worlds/cardToWorld';
import type { EngineOverrides } from '@/engine/worlds/types';
import { useAppStore } from '@/state/store';
import { getUnlockState, subscribeUnlockState } from '../audioContext';
import { useSoundSettings } from '../settings';
import { reportIdle, sharedMixer, sharedPalette } from './ambienceHolder';
import { createAmbienceLoop, IDLE_UI, type AmbienceLoop } from './ambienceLoop';
import { flyLive, type GateInputs } from './ambienceState';
import { useAmbienceStore } from './ambienceStore';
import type { WorldEngineWithSpinup } from './place';
import { AMBIENCE_UPDATE_HZ } from './tuning';
import { publishStrike, publishWeather } from './weatherBus';

export function ambienceKilled(): boolean {
  try {
    if (
      typeof location !== 'undefined' &&
      new URLSearchParams(location.search).has('sx-noambience')
    )
      return true;
    return typeof localStorage !== 'undefined' && localStorage.getItem('sx.ambience.kill') === '1';
  } catch {
    return false;
  }
}

function useHidden(): boolean {
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  useEffect(() => {
    const vis = () => setHidden(document.hidden);
    const hide = () => setHidden(true);
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('pagehide', hide);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('pagehide', hide);
    };
  }, []);
  return hidden;
}

export interface UseAmbienceArgs {
  engine: WorldEngineWithSpinup | null;
  world: CardToWorldOk;
  /** The fly view was entered (the camera landed). */
  entered: boolean;
  /** The close-up is closed (roadmap 0.7). */
  paused: boolean;
  failed: boolean;
  /** The controls applied since the world loaded (worldStore.applied), read when the AirModel is rebuilt. */
  applied?: () => EngineOverrides;
}

export function useAmbience({
  engine,
  world,
  entered,
  paused,
  failed,
  applied,
}: UseAmbienceArgs): void {
  const honesty = useAppStore((s) => s.honesty);
  const soundOn = useSoundSettings((s) => s.soundOn);
  const ambienceOn = useSoundSettings((s) => s.ambienceOn);
  const unlock = useSyncExternalStore(subscribeUnlockState, getUnlockState, getUnlockState);
  const hidden = useHidden();
  const [killed] = useState(ambienceKilled);
  const loopRef = useRef<AmbienceLoop | null>(null);
  const worldRef = useRef(world);
  const appliedRef = useRef(applied);

  const gate: GateInputs = {
    entered,
    paused,
    hidden,
    artistic: honesty === 'artistic',
    failed,
    soundOn,
    ambienceOn,
    audioRunning: unlock.audio === 'running',
  };
  const gateRef = useRef(gate);
  const live = flyLive(gate);
  // Keep the latest values for the loop's callbacks (set after render, before the effects below run).
  useEffect(() => {
    worldRef.current = world;
    appliedRef.current = applied;
    gateRef.current = gate;
  });

  // One loop per engine instance (a new world remounts the stage; the holder keeps the beds for 2 minutes).
  useEffect(() => {
    if (killed || !engine) return;
    const id = {};
    const loop = createAmbienceLoop(
      {
        engine: () => engine,
        world: () => {
          const w = worldRef.current;
          return { ...w, overrides: { ...w.overrides, ...appliedRef.current?.() } };
        },
        palette: sharedPalette,
        mixer: sharedMixer,
        publish: publishWeather,
        strike: publishStrike,
        onUi: (ui) => useAmbienceStore.getState().setUi(ui),
        clockS: () => performance.now() / 1000,
        timers: {
          set: (fn, ms) => setTimeout(fn, ms),
          clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
        },
        idle: (on) => reportIdle(id, on),
      },
      gateRef.current,
    );
    loopRef.current = loop;
    return () => {
      loop.dispose();
      loopRef.current = null;
      useAmbienceStore.getState().setUi(IDLE_UI);
    };
  }, [engine, killed]);

  // Gate events reach the loop at once (C1).
  useEffect(() => {
    loopRef.current?.setGate(gateRef.current);
  }, [engine, entered, paused, hidden, honesty, failed, soundOn, ambienceOn, unlock.audio]);

  // §10: 10 Hz on requestAnimationFrame while the fly view is live (no rAF when paused or hidden).
  useEffect(() => {
    if (killed || !engine || !live) return;
    const period = 1000 / AMBIENCE_UPDATE_HZ;
    let last = -Infinity;
    let raf = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - last < period - 4) return;
      last = t;
      loopRef.current?.tick();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [engine, live, killed]);
}
