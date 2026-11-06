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

**As built (issue #10):** logic in `frontend/src/haptics/calibration.ts`, wizard in `haptics/ui/CalibrationWizard.tsx`, settings in `haptics/ui/HapticsSettings.tsx` (on the `useHapticSettings` store). Choices where R8.7 is silent are in Q-74 and Q-75; every tuning value is in `haptics/tuning.ts`.

- The wizard runs only on phones that vibrate: `navigator.vibrate` and Android with a touch screen (`calibrationAvailable`, as in Q-73). Elsewhere it says there is nothing to calibrate, and the settings do not offer it.
- Every step can be skipped: a skipped step keeps what the device already has saved (or the R8.3 default: soft 8 ms, 3 levels, offset 0), and with nothing re-measured nothing is written. **Cancel** on every step leaves without saving and stops anything the wizard is still playing.
- **Step 1:** the 5, 10 and 20 ms probes play as one pattern, 700 ms apart. "I felt none" keeps 8 ms and suggests checking vibration settings and battery saver (R12 #11).
- **Step 2:** whisper, soft (= `minMs`), medium and firm play in turn. The question is whether the first buzz was **weaker** than the second: the whisper has more on-time than a short soft tick, so only the user can say. It is kept only when felt and weaker. Tick lengths stay strictly increasing: medium and firm are raised to at least the level below plus 5 ms (Q-74).
- **Step 3:** 10 beats at 800 ms, first as vibration only (firm ticks), then as sound only (the `measured` tone through the audio driver, with its lookahead and the offset set to 0; it needs sound on and a volume above 0). Taps come from touch, Space or Enter. Each tap is matched to the nearest beat within half a period; the first 2 beats are warm-up. The lag is the median of at least 4 matched taps, and a run scattered by more than 60 ms (median absolute deviation) is refused. `avOffsetMs` = vibration lag − sound lag, rounded; beyond ±400 ms the run is refused (Q-75).
- **Storage:** `sx.haptics.calibration` holds `{version: 1, minMs, levels, avOffsetMs}`. A stored value is validated on load (version, `minMs` 1–50 ms, a level set of exactly `soft, medium, firm` or `whisper, soft, medium, firm`, `|avOffsetMs|` ≤ 400). Anything else, unparsable JSON or blocked storage loads as "not calibrated", and the defaults apply.
