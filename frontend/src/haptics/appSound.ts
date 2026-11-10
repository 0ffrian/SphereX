// #76: the event app's one sound engine, audio only (Q-132, R8.8.1 items 1, 2, 9, 10). Framework-free:
// `SoundProvider` mounts one for the app and #83's UI calls it. It owns the engine (audio driver
// only, never a vibrate driver), the Listen sweep, and the wiring that keeps both in step with the
// settings (R8.7), the honesty toggle (D-21) and the page lifecycle (R8.8). Creating one has no side
// effects: no AudioContext and no listeners until `bind()`.
import type { SpectrumResponse } from '@/app/api/types';
import type { LinearScale } from '@/app/spectrum/scale';
import type { Tag } from '@/contract';
import { isTagShown, type HonestyState } from '@/viewer/honesty';
import {
  getAudioContext,
  getUnlockState,
  subscribeUnlockState,
  type UnlockState,
} from './audioContext';
import { bindHonesty, createHaptics, type HapticEngineOptions, type SoundOutputs } from './haptics';
import { bindEngine, getHapticSettings, useHapticSettings, type HapticSettings } from './settings';
import {
  DOCUMENT_PAGE,
  ListenSweep,
  planSweep,
  type GasLine,
  type ListenSweepOptions,
} from './sound/listenSweep';
import { buildSpectrumMapping } from './spectrumMapping';
import { SpectrumHapticSource, type SpectrumStep } from './sources/spectrum';

/** A `/spectrum` reply: its points and its provenance tag (`measured` today; any tag is gated). */
export type SpectrumReply = Pick<SpectrumResponse, 'spectrum'> & {
  tag: SpectrumResponse['tag'] | Tag;
};

export type ListenOutcome =
  /** The sweep started. */
  | 'playing'
  /** `planSweep` gave null (no usable point, or one λ). Sound is not unlocked for it. */
  | 'nothing-to-play'
  /** The sound switch is off (before the unlock, or after it). */
  | 'sound-off'
  /** The unlock did not give a running context, or it was not running at play time. */
  | 'no-audio'
  /** The honesty state hides the spectrum's tag and every chime (D-21). */
  | 'hidden'
  /** `stopListen`, unbind, a hidden page, or a honesty change cancelled it during the unlock. */
  | 'stopped';

/** An immutable snapshot: the same object until a field changes (for `useSyncExternalStore`). */
export interface SoundStatus {
  unlocked: boolean;
  audio: UnlockState['audio'];
  muted: boolean;
  volume: number;
  strengthMultiplier: number;
  listening: boolean;
}

export interface AppSound {
  /** For `UnlockButton` and `SpectrumHapticsPad` (the engine and the audio driver only). */
  readonly outputs: SoundOutputs;
  /** Q-132: the event build has no vibration. */
  readonly canVibrate: false;
  /** Call synchronously from a click (Q-73). Resolves to whether audio is running. */
  unlock(): Promise<boolean>;
  /** R8.7 "sound on/off": `settings.update({ soundOn: !muted })`. */
  setMuted(muted: boolean): void;
  setVolume(volume: number): void;
  /** R8.7: 0.5–1.5. */
  setStrengthMultiplier(multiplier: number): void;
  /**
   * Listen to a `/spectrum` reply (A8, R8.6 item 3, R8.8.1 item 10). Call from a click: the unlock
   * starts before any await. `lines` are the comet gas chimes (`gasLinesForEpoch`); each carries
   * its Q's tag. The plan comes only from the reply's points, so no number is made up.
   */
  listen(reply: SpectrumReply, options?: { lines?: readonly GasLine[] }): Promise<ListenOutcome>;
  stopListen(): void;
  /** 0–1 through the sweep, or null when not playing. Polled per frame; not part of the status. */
  listenProgress(): number | null;
  /** The spectrum-pad source (R8.6, R8.8.1 item 9). `seed` is required (R8.3 jitter). */
  spectrumSource(
    reply: SpectrumReply,
    options: {
      xToLambda: LinearScale;
      seed: number;
      onStep?: (step: Readonly<SpectrumStep>) => void;
    },
  ): SpectrumHapticSource;
  getStatus(): SoundStatus;
  subscribe(listener: () => void): () => void;
  /**
   * Wire the engine and the sweep to the settings, the page lifecycle and the honesty toggle.
   * Returns the unbind, which also stops everything. Binding again after an unbind works
   * (React StrictMode runs bind, unbind, bind).
   */
  bind(honesty: { get(): HonestyState; subscribe(fn: () => void): () => void }): () => void;
}

export interface AppSoundOptions {
  engine?: HapticEngineOptions;
  sweep?: ListenSweepOptions;
}

function sameStatus(a: SoundStatus, b: SoundStatus): boolean {
  return (
    a.unlocked === b.unlocked &&
    a.audio === b.audio &&
    a.muted === b.muted &&
    a.volume === b.volume &&
    a.strengthMultiplier === b.strengthMultiplier &&
    a.listening === b.listening
  );
}

export function createAppSound(options: AppSoundOptions = {}): AppSound {
  // Audio only (Q-132): no `vibrate` option, so no WebVibrateDriver exists in the app.
  const outputs = createHaptics(options.engine);
  const { engine } = outputs;
  const sweep = new ListenSweep(options.sweep);
  const page = options.sweep?.page ?? DOCUMENT_PAGE;
  const listeners = new Set<() => void>();
  let listenRun = 0;
  let cached: SoundStatus | null = null;

  const compute = (): SoundStatus => {
    const u = getUnlockState();
    const s = getHapticSettings();
    return {
      unlocked: u.unlocked,
      audio: u.audio,
      muted: !s.soundOn,
      volume: s.volume,
      strengthMultiplier: s.strengthMultiplier,
      listening: sweep.playing,
    };
  };
  const getStatus = (): SoundStatus => {
    const next = compute();
    if (cached === null || !sameStatus(cached, next)) cached = next;
    return cached;
  };
  const notify = (): void => {
    const before = cached;
    if (before === getStatus()) return;
    for (const fn of [...listeners]) fn();
  };
  getStatus();
  sweep.onEnd = notify;

  const unlock = (): Promise<boolean> => {
    const p = engine.unlock();
    void p.then(notify, notify);
    return p;
  };

  const update = (changes: Partial<HapticSettings>) => {
    useHapticSettings.getState().update(changes);
    notify();
  };

  async function listen(
    reply: SpectrumReply,
    opts: { lines?: readonly GasLine[] } = {},
  ): Promise<ListenOutcome> {
    const plan = planSweep(buildSpectrumMapping(reply.spectrum), opts.lines ?? [], {
      tag: reply.tag,
    });
    if (plan === null) return 'nothing-to-play';
    if (!getHapticSettings().soundOn) return 'sound-off';
    const honesty = engine.honesty;
    if (!isTagShown(honesty, plan.tag) && plan.chimes.every((c) => !isTagShown(honesty, c.tag))) {
      return 'hidden';
    }
    const token = ++listenRun;
    // Synchronously, before any await: the unlock must run inside the click's user activation (Q-73).
    const running = await unlock();
    if (token !== listenRun || page.isHidden()) return 'stopped';
    if (!getHapticSettings().soundOn) return 'sound-off';
    if (!running || getAudioContext()?.state !== 'running') return 'no-audio';
    if (sweep.play(plan, engine.honesty)) {
      notify();
      return 'playing';
    }
    return engine.honesty !== honesty ? 'stopped' : 'no-audio';
  }

  return {
    outputs,
    canVibrate: false,
    unlock,
    setMuted: (muted) => update({ soundOn: !muted }),
    setVolume: (volume) => update({ volume }),
    setStrengthMultiplier: (strengthMultiplier) => update({ strengthMultiplier }),
    listen,
    stopListen() {
      listenRun++;
      sweep.stop();
    },
    listenProgress: () => sweep.progress(),
    spectrumSource: (reply, o) =>
      new SpectrumHapticSource(engine, {
        points: reply.spectrum,
        tag: reply.tag,
        xToLambda: o.xToLambda,
        seed: o.seed,
        onStep: o.onStep,
      }),
    getStatus,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    bind(honesty) {
      const undo = [
        bindEngine(outputs),
        bindHonesty(engine, honesty.get, honesty.subscribe),
        bindHonesty(sweep, honesty.get, honesty.subscribe),
        subscribeUnlockState(notify),
        useHapticSettings.subscribe(notify),
      ];
      notify();
      return () => {
        for (const u of undo) u();
        listenRun++;
        sweep.stop();
        engine.stop();
        notify();
      };
    },
  };
}
