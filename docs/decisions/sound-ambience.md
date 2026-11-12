# Decisions: Sound and ambience

> **Part of:** the decision log ([index](README.md)) · **Holds:** the haptics cut and the move of the audio code to `frontend/src/sound/` (D-39), pitch polarity (Q-430) and the flyover soundscape, weather, stage audibility and spectrum chord (Q-431 to Q-444; spec [R13](../rendering/sound/overview.md)) · **Authority:** highest; an entry here wins over [rendering/](../rendering/README.md) and [architecture/](../architecture/README.md) (see the index for precedence)

## D-39 Haptics cut; the audio moves to frontend/src/sound

- **Decision (Atish, 12 Nov 2026):** haptics are cut from the product. The haptics code is deleted and the audio code moves to `frontend/src/sound/` with `git mv` (issue #111).
  - **Deleted:** the vibrate and Tauri drivers, calibration and its wizard, the platform defaults, the touch profiles and probe, every haptic source, `PulseIndicator`, `SpectrumHapticsPad`, `UnlockButton`, `HapticsSettings`, the Feel panel, and the dev page `haptics-test.html`.
  - **Moved:** the engine (`sound/engine.ts`, `SoundEngine`, `createSoundEngine`), the audio driver (`sound/voices.ts`), `audioContext`, `audioGraph`, `pitch`, `spectrumMapping`, `listenSweep`, `appSound`, `SoundProvider`, settings (without `hapticsOn`) and tuning (audio constants only).
- **Supersedes:**
  - D-08, D-09 and D-20 (vibration on the web, quantised strength, the haptics API surface for vibration): superseded.
  - The haptic parts of D-12 (touch profiles on shader bodies) and D-13 (creative ownership of vibration).
  - D-10 is **amended**: there is no vibration to pair with. Its timbre-by-tag rules and the audio driver stay.
  - The engine rules the audio still follows stay live, re-read as sound rules: the R8.3 rate cap and timing, the R8.8 engine API and tone stream, R8.8.1's sound items and R8.9.
- **Kept on purpose:**
  - The contract types `HapticEvent`, `HapticDriver`, `HapticVoice` and `HapticProfile` keep their names. They mirror `shared/schemas` (Moon's, D-17), and renaming them reaches the backend. They are renamed after the event (backlog).
  - The settings key `sx.haptics.settings` is kept, so saved volumes survive. The old fields are ignored.
- **Deferred:** the body tone (Q-133, Q-188 to Q-192). Its probe and height-map source were haptic code and are deleted. It comes back from R13 work if wanted.
- **Spec conflict noted (CLAUDE.md "never pick silently"):** the approved spec's §15 deletes the folder now, but its §18 lists "the haptics folder rename" as post-event. §15 is the later decision (12 Nov) and wins; the R13 transcription drops the §18 line. Its §2 rule 7 cited "plan D-38" for the cut; D-38 is the design language, so the reference is D-39.
- **Event build:** unchanged. Desktop Chrome on the A15, sound only (Q-132). The Q-132 M3 rename is done by #111.
- **Spec:** [R13](../rendering/sound/overview.md), [R13.9](../rendering/sound/buses-stage.md#r139-buses-ducking-master-settings-and-stage-audibility), [A8](../architecture/sound-voice.md), [A9](../architecture/haptics.md) (cut), [R10](../rendering/layout.md).

## Questions

Status, owner and full text as recorded. The [index](README.md) lists every ID with its file. All were decided by Atish on 12 Nov 2026 when he approved the soundscape spec. The spec text is in R13.

| ID | Question | Owner | Status |
|---|---|---|---|
| Q-430 | **Pitch polarity: long wavelength = low pitch** for the sweep, the chord and Track (Trayford et al. 2023). **Amends Q-70 and Q-134.** `PITCH_RISES_WITH_WAVELENGTH = false` in `sound/tuning.ts`. Copy: "Short wavelengths sound high, long wavelengths low. Brighter is louder." Built in #111 ([R13.12](../rendering/sound/chord-pitch.md#r1312-spectrum-chord-and-pitch-polarity)). | Atish | Decided (built #111) |
| Q-431 | **Listener model:** a quasi-static time-lapse at the fly camera. No Doppler and no flight noise ([R13.4](../rendering/sound/place-wind.md#r134-listener-place-sampling-and-wind)). | Atish | Decided |
| Q-432 | **Air physics** ([R13.3](../rendering/sound/inputs-air.md#r133-air-physics)): classes, γ, absorption models and anchors, the silence ceiling. Appendix D R5 sets the Mars impedance test: self-consistent, Z in [3.3, 4.8]. Appendix D R6: sound needs `P0 >= P_FLOOR` (1 Pa) on rocky worlds (always on gas giants); the engine's climate `airless` flag (Ps < 0.02 bar) no longer gates sound. | Atish | Decided |
| Q-433 | **Inputs and accessors:** `weatherFields`, `gasField`, `groundKm` and `flyCameraBasis` on the `WorldEngine` wrapper; no core edits ([R13.2](../rendering/sound/inputs-air.md#r132-inputs-every-value-its-source-its-tag)). Appendix B contract amendment 1 (the fly noise seed, the ocean share, the preset id, `jetU` for gas giants) and Appendix D contract amendments 2 (units and conventions in `types.ts` comments) and 3 (the engine's local frame) apply. | Atish | Decided |
| Q-434 | **`hKm` CPU port** with a GLSL parity test (R13.4). | Atish | Decided |
| Q-435 | **Planetary wind model** (R13.4, spec §6.5). | Atish | Decided |
| Q-436 | **Source catalogue and gates** ([R13.5](../rendering/sound/sources-weather.md#r135-sound-sources-gates-physics-and-character)), with Appendix D R2 (bubble pitch factor), R3 (raindrop size) and R4 (whistle gate per obstacle size) and R6 (the "No air here" captions only below `P_FLOOR`). | Atish | Decided |
| Q-437 | **Weather:** the lightning rule table, rate and thunder physics ([R13.6](../rendering/sound/sources-weather.md#r136-weather)). | Atish | Decided |
| Q-438 | **Weather visuals overlay:** rain, snow, bolts, glow and flash safety (R13.6, spec §8.5). Flashes can be turned off in the Sound settings (`flashesOn`); reduced motion always turns them off. | Atish | Decided |
| Q-439 | **Bake method:** Moon's DSP ported with corrections; loop lengths and rates, budgets, re-bake triggers ([R13.7](../rendering/sound/bake-mix.md#r137-baking-worker)). | Atish (Moon authored the prototype) | Decided |
| Q-440 | **Level model:** world scaling, the presentation offset and caption ([R13.8](../rendering/sound/bake-mix.md#r138-live-mixing-and-levels)), with the Appendix D R1 area integral (an exact sector with cos² directivity). | Atish | Decided |
| Q-441 | **Stage audibility and buses** ([R13.9](../rendering/sound/buses-stage.md#r139-buses-ducking-master-settings-and-stage-audibility)).<br>**Spec values:** the presentation window, the loudness targets, the harmonic branch and the sound-check page; buses `events`, `spectrum` and `ambience`; the limiter at −3 dB; the ambience ducked −9 dB (0.05 s / 0.6 s) while data sounds play; a 35 Hz high-pass on the ambience.<br>**Coordinator rulings (12 Nov), built in #111:**<br>(1) The duck is reference-counted. Every end path releases it, and a safety timeout releases it after the longest voice + 1 s.<br>(2) The harmonic branch gets +18 dB drive before tanh(3x) and −18 dB make-up after it, so −24 LUFS beds make audible harmonics. tanh is odd, so these are the 3rd and 5th harmonics; there is no 2nd.<br>**Assumptions:** τ = time / 3 for the duck ramps; the band edges are high-pass + low-pass pairs at Q 0.707; the ambience level = ambienceVolume × volume, while events and spectrum keep their own volume gains. | Atish | Decided (buses built #111; window, sound-check in #116) |
| Q-442 | **UI, captions and "What you hear"** ([R13.10](../rendering/sound/ui-lifecycle.md#r1310-ui-captions-lifecycle-and-budgets)).<br>**Built in #111:** the shell's Sound popover in the top bar (Sound, Volume, Ambience, Ambience volume, Flashes). Its click unlocks audio.<br>**Known gap:** the build pane's Hear it sound (`app/build/hearAudio.ts`, own AudioContext, Q-416) is not under these settings or the limiter. PR #107 removes Hear it (Q-420); a follow-up wires whatever replaces it to the buses. | Atish | Decided (popover built #111; chip and panel in #116) |
| Q-443 | **Spectrum chord** ([R13.12](../rendering/sound/chord-pitch.md#r1312-spectrum-chord-and-pitch-polarity)): 12 bins, a button, no Colour mode, ISO 226, beating for noise, an A/B toggle. | Atish | Decided (#115) |
| Q-444 | **Determinism for sound:** byte-identical loops within one JavaScript engine (V8 in Chrome and Node). It is not promised across browsers (PR #101 note). | Atish | Decided |
