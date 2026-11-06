// R8.1, R8.7, D-08, D-10: which outputs are on by default. Android Chrome phones get haptics and
// sound; iPhone, iPad and desktop get sound only. "Android" also needs a coarse (touch) pointer, so
// an Android desktop-mode browser or a Chromebook with vibrate but no motor starts on sound only
// (Q-73). Every browser global is guarded; nothing runs at import time.

export interface OutputDefaults {
  hapticsOn: boolean;
  soundOn: boolean;
}

/** What the defaults depend on; read from the browser when not given (tests pass it). */
export interface PlatformEnv {
  android: boolean;
  coarsePointer: boolean;
}

export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  if (uaData?.platform) return /android/i.test(uaData.platform);
  return /android/i.test(navigator.userAgent ?? '');
}

export function hasCoarsePointer(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  );
}

export function platformEnv(): PlatformEnv {
  return { android: isAndroid(), coarsePointer: hasCoarsePointer() };
}

/** R8.7 defaults: Android with a touch screen → haptics and sound; anything else → sound only. */
export function defaultOutputs(env: PlatformEnv = platformEnv()): OutputDefaults {
  return { hapticsOn: env.android && env.coarsePointer, soundOn: true };
}
