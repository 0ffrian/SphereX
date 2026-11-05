# Haptics

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A9–A9.5 · **Implements:** D-08, D-09, D-10, D-12, D-20, D-21 · **Read with:** [../rendering/README.md](../rendering/README.md), [sound-voice.md](sound-voice.md)

## A9 Haptics

The rendering doc is the authority: see **rendering doc §8** for encoding, event sources, per-type profiles, calibration and the engine API. This section summarises the decisions. Status: **To build**.

### A9.1 Platform (D-08)

| Platform | What the user gets |
|---|---|
| Android Chrome (realme 14 Pro, Samsung; Android 16) | `navigator.vibrate` plus paired audio |
| iPhone, iPad, desktop | Audio only |
| Tauri Android app | Post-event backlog (B-01). The `HapticDriver` interface lets `drivers/tauri.ts` be added later without touching the event sources. |

The challenge requires a web tool, and judges will not sideload an APK. Haptics can only be shown on the phones.

The app API is rendering doc §8.8's `HapticEvent` (D-20). The mock-up's native and iOS bridges are dropped for the event. `HapticEvent` gains an optional `sharpness`, which the web driver ignores and a future Tauri driver uses. The mock-up's `spherex:haptic` event stays as a debug hook and drives an on-screen pulse indicator, so an audience watching the laptop can see what the phone feels.

### A9.2 Strength and detail (D-09)

- `navigator.vibrate` takes durations only. There is no amplitude control in Chrome as far as we know **[verify]**.
- The web driver maps strength to **3–4 discrete levels** (soft, medium, firm, plus an optional "whisper" if the phone can render it). It does not use a continuous scale.
- Fine detail is carried by rhythm, rate and spacing, and by the paired audio.
- Calibration measures the faintest pulse each phone can render (`minMs`) and how many levels can be told apart, stored per device.
- Rate limit: at most 40 events per second; extra events are dropped, not queued (rendering doc §8.3).

### A9.3 Audio pairing (D-10)

Every `HapticEvent` goes to both drivers: vibrate and audio. Audio is not only a fallback. Detail: rendering doc §8.9 and [section 8](sound-voice.md#a8-sound-and-voice) above.

### A9.4 What is felt

- **Two kinds**, both labelled in the UI: texture haptics (from the height map or mesh) and data haptics (encode a measured quantity) (rendering doc §8.2).
- **Spectrum haptics** work on every object and are P1 (rendering doc §8.6).
- **Rendering-doc types:** per-type profile in rendering doc §8.5.
- **Gas giants, water worlds and other shader-drawn bodies** (D-12, Accepted 5 Nov 2026): a Web Worker builds one shared field per body (512×256) from the same seed as the shader. The shader and the haptics sample the same field.

  | Type | Texture haptics (`artistic`) | Data haptics |
  |---|---|---|
  | `gas_giant` | The finger feels the flow: ticks at band boundaries, pulse trains in jets, a "swirl" on storms, ticks at ring gaps | Steady pulse (`teq_pulse`), rate ∝ normalised `Teq`. Tag follows `teq_K`: `measured` from Exoplanet Archive `pl_eqt`, otherwise `derived` |
  | `planet_water` | Slow swell on ocean, a firm tick at the coast, height ticks on land, fine soft ticks on ice | As for `gas_giant` |
  | `planet_rocky` | Height-map ticks; lava cracks give a double tick | As for `gas_giant` |
  | `nebula`, `nova` | Pulse rate ∝ local point density, as for the comet field | — |

  Full rules, including the paired sounds, are in D-12.

### A9.5 Honesty rule

The honesty toggle (rendering doc §5.3) applies to haptics too, with the same tag filter (D-21). In **Measured only**, only `measured` haptics play: every `artistic` texture haptic and every Estimated data haptic is silent. Texture haptics then come only from real shape meshes. On shader-drawn bodies nothing about the surface is measured, so only the `teq_pulse` can remain, and only when Teq comes from Exoplanet Archive `pl_eqt` (`measured`).

Haptics never carry information that is not also available as text or sound (rendering doc §9).
