# Haptics: engine API

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R8.8 · **Implements:** [D-08, D-09, D-20, Q-19, Q-85](../../decisions/haptics-design.md), [D-10, Q-72, Q-133](../../decisions/haptics-sound.md), [Q-71, Q-73](../../decisions/haptics-built.md), [Q-132](../../decisions/platform-hosting.md) · **Read with:** [platform-encoding.md](platform-encoding.md) (R8.1–R8.3), [audio-pairing.md](audio-pairing.md) (R8.9), [wiring.md](wiring.md) (R8.8.1), [data-contract.md](../data-contract.md) (R3.4 `HapticProfile`)

### R8.8 Engine API

The types live in `frontend/src/contract/haptics.ts` (hand-written next to the generated contract, Q-19) and `haptics/haptics.ts` re-exports them. The engine is `haptics/haptics.ts`. The code below is the reference shape; at the event only the audio driver is in the engine (Q-132).

```ts
// contract/haptics.ts (types) and haptics/haptics.ts (engine)
export type HapticKind = 'tick' | 'double' | 'heartbeat' | 'pulseTrain' | 'stop';
export interface HapticEvent {
  kind: HapticKind; strength: number; rateHz?: number; tag: Tag;
  pitch?: number;   // 0–1. Audio only. Spectrum, Listen, Track: λ (Q-70, Q-134); body tone: height (Q-133); gas giant bands: latitude
  pan?: number;     // −1 (left) to 1 (right). Audio only. From the pointer's x on screen
  sharpness?: number; // Optional (D-20). The web driver ignores it; a future Tauri driver (B-01) uses it
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

// haptics/drivers/webVibrate.ts (after the event, Q-132)
const MAX_PATTERN = 99; // Chrome pattern-length cap, believed ~99 entries [verify] (R12 #9; after the event)

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

**As built (issue #9, `frontend/src/haptics/`).** The code above is the reference; the built engine differs where the spec could not work as written. Each difference is a `Q-` entry for Atish to confirm:
- **Pulse trains (Q-71).** Re-issuing `emit({kind: 'pulseTrain'})` every 250 ms cannot play below 4 Hz (a 1–2 Hz ocean swell gets one pulse per window) and loses the phase at each re-issue. The engine owns trains instead: sources call `startTrain(id, {rateHz, strength, tag, pitch?, pan?, voice?})`, `updateTrain(id, changes)` and `stopTrain(id)`, and own no timers. The engine keeps the phase and sends each 250 ms window with explicit pulse times (`TrainWindow`). One train plays at a time. `stopTrain` cancels only train output (`TrainCapableDriver.stopTrain()`), so a one-shot that is playing is not cut. A late timer never shifts the phase. `emit(pulseTrain)` still works and plays a single window.
- **Gate and cap.** The engine refuses a strength that is not a finite number and applies the honesty filter (D-21) before any driver, then the R8.3 limits to every kind: ≥ 25 ms between ticks, doubles and heartbeats, and at most 40 events in any 1 s window (a train window counts as one). `stop` is exempt from both. The strength multiplier (R8.7) is applied here, once, for both drivers.
- **`voice` (Q-72).** `HapticEvent` gains an optional audio hint, `voice?: 'tone' | 'click' | 'surf' | 'chime'`, for the D-12 per-kind sounds. The vibrate driver ignores it. The tag still sets the timbre family ([§8.9](audio-pairing.md#r89-audio-pairing-d-10)).
- **`channel` (Q-85).** An optional display hint, `channel?: 'texture' | 'data'` (R8.2), on `HapticEvent` and `TrainParams`. Drivers ignore it; the on-screen pulse indicator shows it with the event's D-02 badge.
- **Audio output.** Every module's sound goes through one master bus per AudioContext, `getMasterBus(ctx)` in `audioGraph.ts` (gain → one limiter → destination), and the bell is the shared `playBell(ctx, dest, {freqHz, when, gain, …})`.
- **Page lifecycle.** `bindEngine` also stops the engine when the page is hidden or unloaded (`bindPageLifecycle`, built on `stopWhenHidden(target)` in `settings.ts`), so a held train does not keep sounding in a background tab. The Listen sweep (`ListenSweep`) does the same: it stops on a hidden page or `pagehide` and `play()` refuses to start on a hidden page (its `page` option, default `document`). Settings saves are debounced and flushed when the page hides.
- **Audio only by default (Q-132, #76).** `createHaptics()` builds the `AudioDriver` only and returns `SoundOutputs` (`engine`, `audio`); no `WebVibrateDriver` is constructed. `createHaptics({ vibrate: true })` adds the vibrate driver and returns `HapticOutputs` (`engine`, `vibrate`, `audio`); it is the opt-in for the dev test page and for after the event. `applySettings` and `bindEngine` accept either and enable the vibrate driver only when there is one.
- **The app's engine (#76).** The app's one engine is `createAppSound()` (`appSound.ts`), mounted once by `SoundProvider` (`SoundProvider.tsx`, wrapped in `App.tsx`). It owns the audio-only engine and the Listen sweep, binds the settings, the page lifecycle and the honesty toggle (`bindHonesty` for the engine and the sweep), and exposes `unlock`, `setMuted`, `setVolume`, `setStrengthMultiplier`, `listen(reply, { lines })`, `stopListen` and `spectrumSource(reply, { xToLambda, seed })`. It draws no UI (#83).
- **Pulse indicator (D-20).** At most 3 flashes a second for every user (WCAG 2.3.1), and a steady glow while a train plays; it ignores a `spherex:haptic` detail that is not a well-formed `HapticEvent`. At the event it shows what is heard, not what a phone feels (Q-132).
- **Unlock and "can vibrate" (Q-73).** `engine.unlock()` from a click; the unlock state is shared (`getUnlockState`, `subscribeUnlockState`, `engine.unlocked`). User-facing "can vibrate" is `deviceVibrates(vibrate.supported)` (`platform.ts`): `navigator.vibrate` also exists in desktop Chrome, which has no motor. On the A15 the button reads "Turn on sound".
- All tuning values live in `haptics/tuning.ts` (D-13).

Event sources (`sources/heightMap.ts`, `meshNormal.ts`, `field.ts`, `dataPulse.ts`, `terrain.ts`, `flow.ts`, `lightcurve.ts`) are built by `buildHaptics` in `profiles.ts` from the `HapticProfile` in RenderParams (R8.5) and driven by `TouchHaptics`; `sources/spectrum.ts` serves every object's spectrum (R8.6). They call `engine.emit` and the train API only. Drivers never know about objects.

**Tone stream (Q-133). Proposed (Q-189).** The body tone (R8.9.1) and the Track path voice (R8.9.2) are sustained sounds whose pitch, gain and pan change while they play. Discrete events and trains cannot carry them, so the engine gets a tone stream next to the Q-71 trains:

```ts
export interface ToneParams {
  pitch: number; strength: number; tag: Tag;   // pitch 0–1, mapped as R8.9; strength 0–1 → gain
  pan?: number; voice?: HapticVoice; channel?: HapticChannel;
}
type ToneId = 'body' | 'path';
// HapticEngine gains:
startTone(id: ToneId, p: ToneParams): void;              // starts, or replaces, the tone `id`
updateTone(id: ToneId, changes: Partial<ToneParams>): void;
stopTone(id: ToneId): void;
// A driver that can play tones implements ToneCapableDriver (the same three methods).
// The vibrate driver does not: a tone is audio only.
```

- **Gate:** the engine checks the strength and applies the honesty filter (R8.2) on `startTone` and on every `updateTone` that changes `tag`. A hidden tag stops the tone; it does not mute it. A honesty change stops any tone the new state hides.
- **Rate:** updates are coalesced to at most one per animation frame. They change a playing sound and are not new events, so they do not count against the 40 events per second cap (R8.3).
- **Shape:** fade in over `TONE_FADE_IN_S`, glide pitch, gain and pan with time constant `TONE_GLIDE_S`, fade out over `TONE_FADE_OUT_S` (placeholders in `tuning.ts`; proposed 0.03, 0.02 and 0.06 s). The strength multiplier (R8.7) applies once, as for events.
- **Lifetime:** at most one tone per id. `stop()`, a hidden page (`bindPageLifecycle`) and the sound switch stop every tone. A tone and a train may play together (a data pulse starts when the pointer holds still).
- **Not built yet:** `HapticKind` and the train API are the only outputs today (`frontend/src/contract/haptics.ts:8-35`).

**From the mock-up (D-20).** The discrete `HapticEvent` is the app API. What was kept from the mock-up and what was dropped is recorded in [D-20](../../decisions/haptics-design.md). Tick lengths follow [§8.3](platform-encoding.md#r83-encoding-web-driver-d-09). Novae and nebulae have no haptics ([§8.5](profiles.md#r85-per-type-haptic-profile)).

**`HapticProfile`** is part of RenderParams and is generated from `shared/schemas/` (D-18). Its definition is in [R3.4](../data-contract.md#r34-renderparams-produced-by-the-backend-get-v1objectsidrender-params). The wiring checklist for the event build is [R8.8.1](wiring.md).
