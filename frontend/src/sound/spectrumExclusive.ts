// R13.12, Q-446: one spectrum sound at a time. The spectrum chord, the Listen sweep (ListenSweep) and
// the Hear it sweep (app/build/hearAudio) each claim this slot when they start; a new claim stops the
// previous holder, so they are mutually exclusive whoever starts them and from whichever panel.
// Framework-free; nothing runs at import time.

export interface SpectrumClaim {
  /** Give the slot back (idempotent); only the current holder clears it. */
  release(): void;
  readonly held: boolean;
}

interface Holder {
  stop: () => void;
}

let current: Holder | null = null;

/**
 * Take the slot for a sound that `stop` ends. The previous holder's `stop` runs first (synchronously),
 * so call this before scheduling anything.
 */
export function claimSpectrumSound(stop: () => void): SpectrumClaim {
  const prev = current;
  const me: Holder = { stop };
  current = me;
  if (prev) {
    try {
      prev.stop();
    } catch {
      // A failing stop must not block the new sound; the old one is no longer the holder.
    }
  }
  return {
    release() {
      if (current === me) current = null;
    },
    get held() {
      return current === me;
    },
  };
}

/** Stop whatever spectrum sound plays now (tests, unbind). */
export function stopSpectrumSound(): void {
  const prev = current;
  current = null;
  prev?.stop();
}

/** Whether a spectrum sound holds the slot (tests). */
export function spectrumSoundHeld(): boolean {
  return current !== null;
}
