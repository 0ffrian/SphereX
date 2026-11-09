# Haptics: calibration and settings

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R8.7 · **Implements:** D-09, D-10 ([decisions](../../decisions/README.md)) · **Read with:** [engine-api.md](engine-api.md)

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
- The probe, level and beat patterns go straight to `navigator.vibrate` (not through the engine, so they fire no `spherex:haptic` debug event). With vibration off in the settings the wizard plays none and says so.
- **Step 1:** the 5, 10 and 20 ms probes play as one pattern, 700 ms apart; the answers are enabled once they have played. "I felt none" is not a measurement: it keeps the stored value (or 8 ms) and suggests checking vibration settings and battery saver (R12 #11).
- **Step 2:** whisper, soft (= `minMs`), medium and firm play in turn. The question is whether the first buzz was **weaker** than the second: the whisper has more on-time than a short soft tick, so only the user can say. It is kept only when felt and weaker; skipping this step after step 1 shortened soft drops a stored whisper. Tick lengths stay strictly increasing and never exceed R8.3's 25 ms: firm is 25 ms, soft is `minMs` (at most 23 ms) and medium is 15 ms raised to soft + 5 ms, or halfway to firm when that would reach it (Q-74).
- **Step 3:** 10 beats at 800 ms, first as vibration only (firm ticks), then as sound only (the `measured` tone through the audio driver, with its lookahead and the offset set to 0; it needs sound on and a volume above 0). Taps come from touch, Space or Enter, or a screen reader's double-tap (a click with no pointer down). Each tap is matched to the nearest beat within half a period; the first 2 beats are warm-up. The lag is the median of at least 4 matched taps, and a run scattered by more than 60 ms (median absolute deviation) is refused. `avOffsetMs` = vibration lag − sound lag, rounded; beyond ±400 ms the run is refused (Q-75).
- **Feedback:** focus moves to each step's heading (on open too, scrolled into view), status and failures show in a visible `role="status"` line, the tap area names the beat's channel with a "Beat n of 10" counter, and closing returns focus to the opener; Cancel without a host handler goes back to the intro and forgets the cancelled run, and a failed save is said in the status line (Q-74).
- **Storage:** `sx.haptics.calibration` holds `{version: 1, minMs, levels, avOffsetMs}`. A stored value is validated on load (version, `minMs` 1–50 ms, a level set of exactly `soft, medium, firm` or `whisper, soft, medium, firm`, `|avOffsetMs|` ≤ 400). Anything else, unparsable JSON or blocked storage loads as "not calibrated", and the defaults apply.
