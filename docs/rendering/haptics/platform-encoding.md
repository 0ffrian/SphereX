# Haptics: platform reality and encoding

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R8, R8.1–R8.3 · **Implements:** D-08, D-09 ([decisions](../../decisions.md)) · **Read with:** [engine-api.md](engine-api.md)

## R8. Haptics

### R8.1 Platform reality

| Platform | Mechanism | Control |
|---|---|---|
| Android Chrome (realme 14 Pro, Samsung; Android 16) | `navigator.vibrate(ms or pattern)` | On/off only; no amplitude control **[verify]**. Needs a prior user gesture. Each call cancels the previous pattern. Plus the audio driver ([§8.9](audio-pairing.md#r89-audio-pairing-d-10)) |
| iPhone (any browser), desktop | No vibration available | Audio driver only ([§8.9](audio-pairing.md#r89-audio-pairing-d-10)) |
| iPad | No Core Haptics hardware | Audio driver only ([§8.9](audio-pairing.md#r89-audio-pairing-d-10)) |
| Tauri Android (post-event, B-01) | `VibrationEffect.Composition` (API 30+), `LOW_TICK` (API 31+), envelopes (API 36) | Real intensity and sharpness |

**Decision (D-08):** the event uses the **web only**. Haptics use `navigator.vibrate` in Android Chrome; iPhone, iPad and desktop get audio only. There is no Tauri build for the event; Tauri is backlog B-01. The `HapticDriver` interface ([§8.8](engine-api.md#r88-engine-api)) lets `drivers/tauri.ts` be added later without touching the event sources.

### R8.2 Two kinds of haptics (both labelled in the UI)

- **Texture haptics:** derived from the height map or mesh. As honest as the relief: tagged `artistic` for procedural relief, `measured` for real shape models.
- **Data haptics:** encode a measured quantity (spectrum, Q, light curve, proper motion). Tagged `measured` or `derived`.

The honesty toggle applies here too. In **Measured only**, texture haptics come only from real meshes, and procedural relief is silent. On the shader-generated kinds ([§7.7](../renderers/shader-kinds.md#r77-shader-generated-kinds-planet_rocky-planet_water-gas_giant-nebula-nova)) all texture haptics are silent; only the data pulse remains.

### R8.3 Encoding (web driver, D-09)

`navigator.vibrate` takes durations only. Chrome has no amplitude control as far as we know **[verify]**. Strength is therefore **quantised**, not continuous.

| Haptic meaning | Pattern |
|---|---|
| whisper (optional, only if calibration shows the phone renders it) | pulse-width pattern, e.g. `[4, 4, 4, 4, 4]`. Motor-dependent **[verify]** |
| soft tick | 8 ms (or `minMs` from calibration) |
| medium tick | 15 ms |
| firm tick | 25 ms |
| double tick (crater rim) | `[12, 40, 12]` |
| heartbeat (Mira) | `[20, 120, 12]` |
| pulse train (fields) | re-issued every 250 ms |

- **Strength → level:** `strength` (0–1, times the user multiplier) maps to **3–4 discrete levels**: soft, medium, firm, plus the whisper if calibration found it distinct ([§8.7](calibration.md#r87-calibration-and-settings)). Split 0–1 into equal bins, one per level the device can render.
- **Fine detail lives in time, not strength:** rhythm, pulse rate and spacing carry it, together with the paired audio ([§8.9](audio-pairing.md#r89-audio-pairing-d-10)), which has continuous gain.
- **Pattern length:** Chrome caps the pattern array, believed at about 99 entries **[verify]**. Keep patterns short; pulse trains are re-issued every 250 ms rather than sent as one long array.
- **Rate limit:** at most 40 events per second, with ≥25 ms between ticks; drop extra events rather than queue them.
- **Roughness:** irregular spacing, with ±30% jitter from a seeded RNG.
