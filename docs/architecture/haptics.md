# Haptics (sound at the event; vibration after)

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A9–A9.5 · **Implements:** [D-08, D-09, D-12, D-20](../decisions/haptics-design.md), [D-10, Q-133](../decisions/haptics-sound.md), [Q-132](../decisions/platform-hosting.md), [D-21](../decisions/contract-tags.md) · **Read with:** [rendering/README.md](../rendering/README.md) (R8), [sound-voice.md](sound-voice.md) (A8)

> **D-39 (12 Nov 2026), haptics cut:** A9 is kept for history and its IDs stay. Vibration, touch and calibration are cut; what A9.3 says about audio pairing lives on in the sound engine ([A8](sound-voice.md), [R8.9](../rendering/haptics/audio-pairing.md), [R13](../rendering/sound/overview.md)). See [D-39](../decisions/sound-ambience.md).

## A9 Haptics

**Event scope (Q-132):** the event build runs in desktop Chrome on Atish's Asus TUF A15. Haptics are **heard, not felt**: the engine plays through the audio driver only. Phones, `navigator.vibrate` and calibration come after the event.

The rendering doc is the authority: rendering doc §8 holds the encoding, sources, per-type profiles, calibration, the engine API and the audio pairing. This section is a summary with links. Status: **built against fixtures** (6 Nov 2026): the engine, drivers, settings and test page (issue #9), spectrum haptics and calibration (#10), and the per-type sources, `buildHaptics`, the touch probe and the Listen sweep (#11). **Not wired into the app** (rendering doc R8.8.1). Nothing has been heard on the A15 yet. The body tone (Q-133) and the Track path sound (Q-134) are not built.

### A9.1 Platform (D-08)

| When | Platform | What the user gets |
|---|---|---|
| The event | Desktop Chrome on the A15 | Sound only, through the audio driver (Q-132) |
| After the event | Android Chrome (realme 14 Pro, Samsung) | `navigator.vibrate` plus paired sound |
| After the event | iPhone, iPad, other desktops | Sound only |
| After the event | Tauri Android app (B-01) | Real intensity and sharpness; `drivers/tauri.ts` plugs into the `HapticDriver` interface |

D-08 as amended by Q-132; table and detail in rendering doc §8.1. The app API is rendering doc §8.8's `HapticEvent` ([D-20](../decisions/haptics-design.md)).

### A9.2 Strength and detail (D-09)

After the event. The vibrate driver quantises strength to 3–4 levels and carries detail in rhythm and in the paired sound ([D-09](../decisions/haptics-design.md); rendering doc §8.3, §8.7). At the event the sound carries continuous gain.

### A9.3 Audio pairing (D-10)

Every `HapticEvent` goes to every driver in the engine; at the event that is the audio driver alone. Rules: rendering doc §8.9. Sound parts and their status: [A8](sound-voice.md#a8-sound-and-voice).

### A9.4 What is felt

At the event, "felt" means heard (Q-132).

- **Two kinds**, both labelled in the UI: texture haptics (the height map or mesh) and data haptics (a measured quantity) (rendering doc §8.2).
- **Body interaction** is one continuous tone that follows the height under the pointer (Q-133; rendering doc R8.9.1). It replaces the height ticks for sound; after the event the ticks may return as vibration.
- **Spectrum haptics** work on every object and are P1 (rendering doc §8.6).
- **Per-type profiles**, including the shader-drawn bodies of D-12 (gas giants, water and rocky worlds) and the nebula and nova, which have none: rendering doc §8.5. The shared field the shader and the sound both sample: rendering doc §7.7.

### A9.5 Honesty rule

The honesty toggle applies to every haptic and sound with the same tag filter as the layers (D-21). The rule and its table are owned by rendering doc §8.2. Haptics never carry information that is not also available as text or as a picture (rendering doc §9).
