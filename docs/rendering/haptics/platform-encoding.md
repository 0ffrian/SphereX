# Haptics: platform reality and encoding

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R8, R8.1–R8.3 · **Implements:** [D-08, D-09, D-10, D-12, Q-133](../../decisions/haptics-design.md), [D-21](../../decisions/contract.md), [Q-132](../../decisions/platform-hosting.md), [Q-71](../../decisions/haptics-built.md) · **Read with:** [engine-api.md](engine-api.md) (R8.8), [audio-pairing.md](audio-pairing.md) (R8.9)

## R8. Haptics

"Haptics" here means every touch and sound cue that encodes a surface or a value. At the event they are heard, not felt (Q-132): the engine plays through the audio driver only.

### R8.1 Platform reality

| Platform | When | Mechanism | Control |
|---|---|---|---|
| Desktop Chrome on Atish's Asus TUF A15 | **the event** (Q-132) | Audio driver only ([§8.9](audio-pairing.md#r89-audio-pairing-d-10)). `navigator.vibrate` exists in desktop Chrome but there is no motor, so it is never used | Continuous gain, pitch, pan; the body tone (R8.9.1) |
| Android Chrome (realme 14 Pro, Samsung; Android 16) | after the event | `navigator.vibrate(ms or pattern)` plus the audio driver | On/off only; no amplitude control **[verify]** (R12 #8). Needs a prior user gesture. Each call cancels the previous pattern |
| iPhone (any browser), iPad, other desktops | after the event | No vibration available | Audio driver only |
| Tauri Android (B-01) | after the event | `VibrationEffect.Composition` (API 30+), `LOW_TICK` (API 31+), envelopes (API 36) | Real intensity and sharpness |

**Decision (D-08, as amended by Q-132):** the event uses the **web only**, in a desktop browser on the A15, with sound only. There is no Android build, no `navigator.vibrate` and no Tauri build at the event. After the event, Android Chrome gets `navigator.vibrate` (D-08's original plan) and Tauri is backlog B-01. The `HapticDriver` interface ([§8.8](engine-api.md#r88-engine-api)) lets the vibrate and Tauri drivers be added without touching the sources.

### R8.2 Two kinds of haptics (both labelled in the UI)

- **Texture haptics:** derived from the height map or mesh, including the body tone (R8.9.1). As honest as the relief: tagged `artistic` for procedural relief and shader surfaces, `measured` for real shape models.
- **Data haptics:** encode a measured quantity (spectrum, Q, light curve, proper motion, Teq). Tagged `measured` or `derived`.

**Honesty rule (this section owns it; D-21).** The honesty toggle applies to every haptic and sound, with the same tag filter as the layers ([§5.3](../display-rules.md#r53-honesty-toggle-3-states)). The engine applies it before any driver (R8.8), so a source never checks it.

| State | What plays |
|---|---|
| Measured only | only `measured` events: the body tone and mesh cues of real shape models, `measured` data pulses (for example `teq_pulse` when `teq_K` is from Exoplanet Archive `pl_eqt`), spectrum haptics of a `measured` spectrum, Track exposure ticks (R8.9.2). Procedural relief, every shader-kind texture and every Estimated data haptic are silent |
| + Estimated | adds `derived`, `model_dependent`, `inferred_from_analog` events: a `derived` `teq_pulse`, the Track path voice |
| + Artistic | adds `artistic` events: the body tone on procedural and shader surfaces, the terrain and flow cues |

A change of state stops at once any sound the new state hides (a train, a tone, a chime). Nebulae and novae have no haptics at all ([§8.5](profiles.md#r85-per-type-haptic-profile)).

### R8.3 Encoding (web driver, D-09)

**After the event (Q-132):** this section applies when the vibrate driver ships. At the event nothing vibrates; the audio driver plays every event with the R8.9 mapping.

`navigator.vibrate` takes durations only. Chrome has no amplitude control as far as we know **[verify]** (R12 #8). Strength is therefore **quantised**, not continuous.

| Haptic meaning | Pattern |
|---|---|
| whisper (optional, only if calibration shows the phone renders it) | pulse-width pattern, e.g. `[4, 4, 4, 4, 4]`. Motor-dependent **[verify]** (R12 #13) |
| soft tick | 8 ms (or `minMs` from calibration) |
| medium tick | 15 ms |
| firm tick | 25 ms |
| double tick (crater rim, lava crack) | `[12, 40, 12]` |
| heartbeat (Mira) | `[20, 120, 12]` |
| pulse train (fields, pulses) | the engine sends one 250 ms window at a time, with explicit pulse times (Q-71, [§8.8](engine-api.md#r88-engine-api)) |

- **Strength → level:** `strength` (0–1, times the user multiplier) maps to **3–4 discrete levels**: soft, medium, firm, plus the whisper if calibration found it distinct ([§8.7](calibration.md#r87-calibration-and-settings)). Split 0–1 into equal bins, one per level the device can render.
- **Fine detail lives in time, not strength:** rhythm, pulse rate and spacing carry it, together with the paired audio ([§8.9](audio-pairing.md#r89-audio-pairing-d-10)), which has continuous gain.
- **Pattern length:** Chrome caps the pattern array, believed at about 99 entries **[verify]** (R12 #9). Keep patterns short; the 250 ms train windows keep each call short.
- **Rate limit:** at most 40 events per second, with ≥25 ms between ticks; drop extra events rather than queue them. This applies to the audio driver at the event too.
- **Roughness:** irregular spacing, with ±30% jitter from a seeded RNG.
- **Continuous tone:** vibration cannot carry the body tone. After the event the vibrate driver plays the R8.4 height ticks instead (**Proposed (Q-NEW-REN-5)**).
