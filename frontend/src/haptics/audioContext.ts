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
 * Tests: replace the factory (and drop the current context). `null` restores the browser factory.
 * Does not close the old context; tests own their fakes.
 */
export function setAudioContextFactory(f: AudioContextFactory | null): void {
  factory = f ?? defaultFactory;
  factoryOverridden = f !== null;
  shared = null;
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
 * activation. Resolves to whether the context is running.
 */
export async function unlockAudio(): Promise<boolean> {
  if (!shared || shared.state === 'closed') shared = factory();
  const ctx = shared;
  if (!ctx) return false;
  if (ctx.state === 'running') return true;
  try {
    await ctx.resume();
  } catch {
    return false;
  }
  return (ctx.state as string) === 'running';
}
