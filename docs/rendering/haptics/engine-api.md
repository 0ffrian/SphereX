# Haptics: engine API

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R8.8 · **Implements:** D-08, D-09, D-10 ([decisions](../../decisions.md)) · **Read with:** [data-contract.md](../data-contract.md)

### R8.8 Engine API

```ts
// haptics/haptics.ts
export type HapticKind = 'tick' | 'double' | 'heartbeat' | 'pulseTrain' | 'stop';
export interface HapticEvent {
  kind: HapticKind; strength: number; rateHz?: number; tag: Tag;
  pitch?: number;   // 0–1. Audio only. Spectrum: λ→pitch as in the Listen sweep; surfaces: height or latitude
  pan?: number;     // −1 (left) to 1 (right). Audio only. From the finger's x on screen
}

export interface HapticDriver { readonly supported: boolean; emit(e: HapticEvent): void; stop(): void }

// Fans every event out to all drivers (vibrate + audio, D-10). The on/off settings add or remove drivers.
export class HapticEngine {
  constructor(private drivers: HapticDriver[], private minIntervalMs = 25) {}
  private last = 0;
  emit(e: HapticEvent) {
    const now = performance.now();
    if (e.kind === 'tick' && now - this.last < this.minIntervalMs) return; // drop, don't queue
    this.last = now;
    for (const d of this.drivers) if (d.supported) d.emit(e);
  }
  stop() { for (const d of this.drivers) d.stop(); }
}

// haptics/drivers/webVibrate.ts
const MAX_PATTERN = 99; // Chrome pattern-length cap, believed ~99 entries [verify]

export class WebVibrateDriver implements HapticDriver {
  supported = typeof navigator !== 'undefined' && 'vibrate' in navigator;
  // levelsMs: soft, medium, firm (soft = minMs from calibration). whisper: only if calibration found it distinct (§8.7)
  constructor(private levelsMs = [8, 15, 25], private whisper: number[] | null = null, private gain = 1) {}
  private level(s: number) {                       // quantise to 3–4 levels (D-09); whisper is level 0
    const n = this.levelsMs.length + (this.whisper ? 1 : 0);
    return Math.min(n - 1, Math.floor(Math.min(1, s * this.gain) * n));
  }
  private ms(s: number) { return this.levelsMs[Math.max(0, this.level(s) - (this.whisper ? 1 : 0))]; }
  emit(e: HapticEvent) {
    if (!this.supported) return;
    switch (e.kind) {
      case 'tick':
        navigator.vibrate(this.whisper && this.level(e.strength) === 0 ? this.whisper : this.ms(e.strength)); break;
      case 'double':    navigator.vibrate([12, 40, 12]); break;
      case 'heartbeat': navigator.vibrate([20, 120, 12]); break;
      case 'pulseTrain': {
        const period = 1000 / Math.max(1, e.rateHz ?? 4), on = this.ms(e.strength);
        const n = Math.max(1, Math.floor(250 / period));
        const p = Array.from({ length: n * 2 }, (_, i) => (i % 2 ? Math.max(0, period - on) : on));
        navigator.vibrate(p.slice(0, MAX_PATTERN));
        break;
      }
      case 'stop': navigator.vibrate(0); break;
    }
  }
  stop() { if (this.supported) navigator.vibrate(0); }
}
```

Event sources (`sources/heightMap.ts`, `meshNormal.ts`, `field.ts`, `terrain.ts`, `flow.ts`, `spectrum.ts`, `lightcurve.ts`) read the `HapticProfile` from RenderParams and call `engine.emit`. Drivers never know about objects.

```ts
interface HapticProfile {
  texture: 'height' | 'mesh' | 'bands' | 'terrain' | 'flow' | 'none'; texture_tag: Tag;
  // 'terrain' = height + ocean and ice masks; 'flow' = bands, jets, storms (D-12)
  data: 'field' | 'flux_pulse' | 'teq_pulse' | 'heartbeat' | 'dimming' | 'motion' | 'detections' | 'none'; data_tag: Tag;
  params: Record<string, number>;   // e.g. tau, k, softness, maxRateHz
}
```
