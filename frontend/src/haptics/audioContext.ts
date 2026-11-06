// R8.9, D-10: the one shared AudioContext of the app. Created lazily, and only from a user gesture:
// call `unlockAudio()` from a `click` handler (R8.9, the Touch-mode tap). The audio driver and the
// sound modules (Listen sweep, imagined drive) all use it. Nothing here runs at import time.

/** Makes a context; returns null when Web Audio is missing. Tests inject a fake one. */
export type AudioContextFactory = () => AudioContext | null;

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Safari: an AudioContext is muted by the ringer switch unless the audio session is "playback".
 * `navigator.audioSession` is Safari-only and not in lib.dom, hence the guarded cast.
 */
function preferPlaybackSession(): void {
  try {
    const nav = (typeof navigator === 'undefined' ? undefined : navigator) as
      (Navigator & { audioSession?: { type: string } }) | undefined;
    if (nav?.audioSession) nav.audioSession.type = 'playback';
  } catch {
    // Not settable here: the sound may follow the ringer switch.
  }
}

const defaultFactory: AudioContextFactory = () => {
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  preferPlaybackSession();
  try {
    return new Ctor({ latencyHint: 'interactive' });
  } catch {
    return null;
  }
};

let factory: AudioContextFactory = defaultFactory;
let factoryOverridden = false;
let shared: AudioContext | null = null;

/**
 * Whether output has been unlocked, shared by every UnlockButton and the engine. `audio`: `none`
 * when no AudioContext can be made here, `suspended` when one exists but is not running (not yet
 * resumed, or interrupted by the OS: a click must resume it), `running`.
 */
export interface UnlockState {
  /** A click has called `unlockAudio()` (the user activation vibration needs too). */
  readonly unlocked: boolean;
  readonly audio: 'none' | 'suspended' | 'running';
}

const INITIAL_UNLOCK: UnlockState = { unlocked: false, audio: 'suspended' };
let unlockState: UnlockState = INITIAL_UNLOCK;
const listeners = new Set<() => void>();

function setUnlockState(next: UnlockState): void {
  if (next.unlocked === unlockState.unlocked && next.audio === unlockState.audio) return;
  unlockState = next; // a new object only on change, for useSyncExternalStore
  for (const l of [...listeners]) l();
}

function audioStateOf(ctx: AudioContext | null): UnlockState['audio'] {
  if (!ctx || ctx.state === 'closed') return 'none';
  return ctx.state === 'running' ? 'running' : 'suspended';
}

/** The shared unlock state. The same object until it changes. */
export function getUnlockState(): UnlockState {
  return unlockState;
}

/** Called after every change of the unlock state. Returns the unsubscribe function. */
export function subscribeUnlockState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Tests: replace the factory (and drop the current context and the unlock state). `null`
 * restores the browser factory. Does not close the old context; tests own their fakes.
 */
export function setAudioContextFactory(f: AudioContextFactory | null): void {
  factory = f ?? defaultFactory;
  factoryOverridden = f !== null;
  shared = null;
  setUnlockState(INITIAL_UNLOCK);
}

/** True when a context can be made here (an injected factory counts). */
export function audioContextSupported(): boolean {
  return factoryOverridden || audioContextCtor() !== null;
}

/**
 * The shared context if it exists and is not closed. Never creates one, so it is safe outside a
 * gesture.
 */
export function getAudioContext(): AudioContext | null {
  return shared && shared.state !== 'closed' ? shared : null;
}

/**
 * Create the shared context if needed (or if the old one was closed) and resume it. Call it
 * synchronously inside a `click` handler; browsers only let a context start from a user
 * activation. Resolves to whether the context is running, and updates the shared unlock state.
 */
export async function unlockAudio(): Promise<boolean> {
  if (!shared || shared.state === 'closed') {
    shared = factory();
    // The OS can suspend or interrupt the context later; keep the shared state in step.
    const ctx = shared as (AudioContext & Partial<EventTarget>) | null;
    if (ctx && typeof ctx.addEventListener === 'function') {
      ctx.addEventListener('statechange', () => {
        if (shared === ctx) setUnlockState({ unlocked: true, audio: audioStateOf(ctx) });
      });
    }
  }
  const ctx = shared;
  if (ctx && ctx.state !== 'running') {
    try {
      await ctx.resume();
    } catch {
      // Stays suspended; the state below says so.
    }
  }
  const audio = audioStateOf(ctx);
  setUnlockState({ unlocked: true, audio });
  return audio === 'running';
}
