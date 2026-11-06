# Haptics: engine API

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R8.8 · **Implements:** D-08, D-09, D-10, D-20 ([decisions](../../decisions.md)) · **Read with:** [data-contract.md](../data-contract.md)

### R8.8 Engine API

```ts
// haptics/haptics.ts
export type HapticKind = 'tick' | 'double' | 'heartbeat' | 'pulseTrain' | 'stop';
export interface HapticEvent {
  kind: HapticKind; strength: number; rateHz?: number; tag: Tag;
  pitch?: number;   // 0–1. Audio only. Spectrum: λ→pitch as in the Listen sweep; surfaces: height or latitude
  pan?: number;     // −1 (left) to 1 (right). Audio only. From the finger's x on screen
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

**As built (issue #9, `frontend/src/haptics/`).** The code above is the reference; the built engine differs where the spec could not work as written. Each difference is a `Q-` entry for Atish to confirm:
- **Pulse trains (Q-71).** Re-issuing `emit({kind: 'pulseTrain'})` every 250 ms cannot play below 4 Hz (a 1–2 Hz ocean swell gets one pulse per window) and loses the phase at each re-issue. The engine owns trains instead: sources call `startTrain(id, {rateHz, strength, tag, pitch?, pan?, voice?})`, `updateTrain(id, changes)` and `stopTrain(id)`, and own no timers. The engine keeps the phase and sends each 250 ms window with explicit pulse times (`TrainWindow`). One train plays at a time. `stopTrain` cancels only train output (`TrainCapableDriver.stopTrain()`), so a one-shot that is playing is not cut. A late timer never shifts the phase. `emit(pulseTrain)` still works and plays a single window.
- **Gate and cap.** The engine refuses a strength that is not a finite number and applies the honesty filter (D-21) before any driver, then the R8.3 limits to every kind: ≥ 25 ms between ticks, doubles and heartbeats, and at most 40 events in any 1 s window (a train window counts as one). `stop` is exempt from both. The strength multiplier (R8.7) is applied here, once, for both drivers.
- **`voice` (Q-72).** `HapticEvent` gains an optional audio hint, `voice?: 'tone' | 'click' | 'surf' | 'chime'`, for the D-12 per-kind sounds. The vibrate driver ignores it. The tag still sets the timbre family ([§8.9](audio-pairing.md#r89-audio-pairing-d-10)).
- **`channel` (Q-85).** An optional display hint, `channel?: 'texture' | 'data'` (R8.2), on `HapticEvent` and `TrainParams`. Drivers ignore it; the on-screen pulse indicator shows it with the event's D-02 badge.
- **Audio output.** Every module's sound goes through one master bus per AudioContext, `getMasterBus(ctx)` in `audioGraph.ts` (gain → one limiter → destination), and the bell is the shared `playBell(ctx, dest, {freqHz, when, gain, …})`.
- **Unlock and "can vibrate" (Q-73).** `engine.unlock()` from a click; the unlock state is shared (`getUnlockState`, `subscribeUnlockState`, `engine.unlocked`). User-facing "can vibrate" is `deviceVibrates(vibrate.supported)` (`platform.ts`): `navigator.vibrate` also exists in desktop Chrome.
- All tuning values live in `haptics/tuning.ts` (D-13).

Event sources (`sources/heightMap.ts`, `meshNormal.ts`, `field.ts`, `dataPulse.ts`, `terrain.ts`, `flow.ts`, `lightcurve.ts`) are built by `buildHaptics` in `profiles.ts` from the `HapticProfile` in RenderParams (R8.5) and driven by `TouchHaptics`; `sources/spectrum.ts` serves every object's spectrum (R8.6). They call `engine.emit` and the train API only. Drivers never know about objects.

**M5 integration checklist** (issues #9–#11 are built against fixtures; nothing below is wired into the app yet):
1. **One engine:** `createHaptics()` once; `bindEngine(outputs)` for the settings (R8.7); `applyStoredCalibration` at start-up (R8.7).
2. **Honesty:** `bindHonesty(engine, get, subscribe)` (`haptics.ts`) from the store's honesty toggle (D-21), so the haptics follow the same filter as the layers.
3. **Unlock and indicator:** a single `UnlockButton` with `canVibrate = deviceVibrates(vibrate.supported)`, whose click is the Touch-mode tap (Q-73); mount `PulseIndicator` (D-20).
4. **Calibration:** decide when `CalibrationWizard` first runs (start-up or first entry to Touch mode); it runs only where `deviceVibrates` is true.
5. **Touch mode (R5.6):** one pointer down turns orbit controls off; each `pointermove` goes through `TouchProbe` (`shaderProbeOptions(body, build)` for shader kinds, `planProbeBodies(plan.bodies)` for planned kinds) into `TouchHaptics.move`; the viewer's frame loop calls `TouchHaptics.poll(now)` while the pointer is down (Q-83); pointerup, pointercancel and pointerleave call `release`.
6. **`buildHaptics` options:** `overrides` (required, the D-27 overrides the body was built with), `planBodies` (the comet nucleus), `heightGrid` (`loadHeightGrid(params.textures.height_bin)`), `epoch` and `gas` (the comet toggle and the gas selected on the spectrum), and `meshNormals: true` only once a `three-mesh-bvh` raycast fills `TouchSample.normal` (Q-78). Rebuild when the body, overrides, epoch or gas change; show `missing` with the other refusals.
7. **Light curve:** the scrubber calls `TouchHaptics.scrub(index)` and `endScrub()`.
8. **Spectrum:** mount `SpectrumHapticsPad` over `SpectrumChart` with the chart's `lambdaDomain`.
9. **Listen tab:** from the Listen button's click, `const plan = planSweep(mapping, gasLinesForEpoch(card, epoch))`; when `plan` is null (no usable spectrum, or one wavelength) say there is nothing to play, otherwise `engine.unlock()` and then `sweep.play(plan, engine.honesty)` (as the test page's Texture panel does). Bind the sweep to the honesty toggle as well, `bindHonesty(sweep, get, subscribe)`, so `ListenSweep.setHonesty` stops a tone or chime the new state hides.
10. **PR #33** changes `viewer/sliders.ts` (`Overrides` readonly; invalid overrides no longer clamped). `profiles.ts` passes `overrides` to `resolveShaderSpec`: re-run the `profiles` tests after #33 merges.

**From the mock-up (D-20).** This discrete `HapticEvent` is the app API; it carries the `tag` that the honesty rule and the audio timbre need.
- The mock-up's native and iOS bridges are dropped for the event (D-08). The `HapticDriver` interface keeps the door open.
- The mock-up's `spherex:haptic` DOM event (a `CustomEvent` on `window` in `mockup/spherex-ui.html`) stays as a **debug hook**. It also drives an **on-screen pulse indicator**, so an audience watching the laptop can see what the phone feels.
- Tick lengths follow [§8.3](platform-encoding.md#r83-encoding-web-driver-d-09): 8–25 ms with the calibrated `minMs`, not the mock-up's 6–22 ms.
- Nebulae and novae get the field pulse ([§8.5](profiles.md#r85-per-type-haptic-profile)), not the mock-up's refusal.

```ts
interface HapticProfile {
  texture: 'height' | 'mesh' | 'bands' | 'terrain' | 'flow' | 'none'; texture_tag: Tag;
  // 'terrain' = height + ocean and ice masks; 'flow' = bands, jets, storms (D-12)
  data: 'field' | 'flux_pulse' | 'teq_pulse' | 'heartbeat' | 'dimming' | 'motion' | 'detections' | 'none'; data_tag: Tag;
  params: Record<string, number>;   // e.g. tau, k, softness, maxRateHz
}
```
