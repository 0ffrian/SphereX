# Haptics: calibration and settings

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R8.7 · **Implements:** D-09, D-10 ([decisions](../../decisions.md)) · **Read with:** [engine-api.md](engine-api.md)

### R8.7 Calibration and settings

First use, on phones that vibrate. Three short steps:

1. **Faintest pulse:** play 5 / 10 / 20 ms pulses and ask "tap the faintest one you felt". Store the answer as `minMs`.
2. **Distinct levels (D-09):** play whisper, soft, medium and firm in turn and ask which ones feel different. Store the set of levels the phone renders distinctly (3 or 4). If the whisper is not felt, or feels the same as soft, drop it.
3. **Audio–vibration offset (D-10):** a tap-along step. The user taps along to a short beat played as vibration only, then as sound only. The difference in mean tap lag is the offset, `avOffsetMs`. Method details **[verify]** in testing.

- Store `minMs`, the level set and `avOffsetMs` **per device** in `localStorage`, under one key.
- **Settings:** haptics on/off, sound on/off, volume, strength multiplier (0.5–1.5×), texture-vs-data labels shown in the legend.
- **Defaults:** on Android, haptics and sound both on. On iPhone, iPad and desktop, "sound only".
- The audio driver is **not** an iPhone-only fallback any more. It runs alongside vibration on every platform ([§8.9](audio-pairing.md#r89-audio-pairing-d-10)).
