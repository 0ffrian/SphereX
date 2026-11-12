# Sound: spectrum chord and pitch polarity

> **Part of:** Rendering & sound spec ([index](../README.md)) · **Sections:** R13.12 · **Implements:** [Q-430, Q-443](../../decisions/sound-ambience.md), [Q-70](../../decisions/haptics-sound.md) · **Read with:** [audio-pairing.md](../haptics/audio-pairing.md) (R8.9), [sound-voice.md](../../architecture/sound-voice.md) (A8)

## R13.12 Spectrum chord and pitch polarity

1. **Bins:**
   - **12 equal-pitch bins** over the Q-70 pitch range (≈ 10.5 ERB from 220 to 1158 Hz). That gives about 1 ERB per bin: separate notes, and a dip of 1–2 empty bins is audible.
   - The earlier 48 would sit at roughly ¼-band spacing: maximum roughness.
   - No "Colour" mode for the event (decided 12 Nov); post-event backlog.
2. **Pitch polarity: decided (Q-430).** Long λ = low pitch everywhere: `PITCH_RISES_WITH_WAVELENGTH = false` in sound tuning. Sweep, chord and Track all follow `pitch.ts`. The sweep's tests and copy are updated ("Short wavelengths sound high, long wavelengths low. Brighter is louder.").
   - **Interaction:** a button toggles the chord on and off (steady drone). No "Colour" mode for the event.
3. **Render:** pre-render to an AudioBuffer (3 s and loop, or a 6 s seamless loop by inverse FFT). Each partial gets a seeded random phase, which avoids the in-phase spike at onset. 30 ms attack. No live oscillator bank.
4. **Gains:**
   - Flux maps to level over a 30 dB range: `L_i = 20·log10(flux_i/max)`, clamped to [−30, 0] dB.
   - A bin below `SPECTRUM_QUIET_THRESHOLD` (0.2 of the peak) is silent.
   - Normalise by `g_i = a_i/√Σa_j²` (power sum).
   - Master about −18 dBFS RMS, then the limiter.
5. **Equal loudness:** ISO 226 weights at 60 phon, capped at +6 dB at 220 Hz, labelled "loudness-corrected", checked on the A15 speakers.
6. **Noise (σ/flux > 0.3):** amplitude beating at `2 + 4·clamp(σ/flux, 0, 1)` Hz, capped at 6 Hz. **Not a cents detune:** a fixed detune inside a chord is inaudible [SP §2].
7. **Listening aids** (as built, Q-446: "Smooth" is smoothed data, not a continuum; the tutorial is cut):
   - an **A/B toggle** between "Smooth (continuum)" and "Data", so absorption dips become audible;
   - a 3-example tutorial before first use;
   - the caption "Data mapping, not a recording".
8. **Honesty:**
   - Never claim a weak band is audible: at SNR below 5, listeners were at chance (Tucker Brown et al. 2022).
   - The tag follows the spectrum: `measured` for SPHEREx.

**As built in #115 (Q-446):** `frontend/src/sound/spectrumChord.ts` (`planChord`, `renderChord`, `SpectrumChord`), `sound/iso226.ts`, `sound/spectrumExclusive.ts`, and the panels' controls in `app/sound/ChordPlayer.tsx` and `app/sound/SpectrumSound.tsx`.
- Bins come from the usable points inside each bin (mean normalised flux), never from interpolation: a bin with no usable point, or only flagged ones, is silent in both modes and listed as `chord.bin.<i>.no-data`. Notes sit at the bin centres, 235.8–1083 Hz, 240 cents apart (0.70 ERB at the bottom, 1.14 at the top), on the 1/6 Hz loop grid.
- Quiet and the 30 dB range are measured against the **Data bin peak**, in both modes. One power normalisation (from Data) and one −18 dBFS RMS scale (from the Data render) apply to both buffers, so A/B changes only the bins that differ.
- **Smooth** = the running median of log flux over a 0.5 µm window (shrunk symmetrically at the spectrum ends), binned like the data, labelled "smoothed data", tagged `derived` (the weaker of the spectrum's tag and `derived`). It is unavailable at Measured only, with the reason shown. It removes features narrower than about 0.25 µm, except within 0.25 µm of either end of the spectrum, where the window is narrower (never reflected or extrapolated), and it never adds a dip.
- Noise: σ/flux per point, each capped at 1, averaged over the bin's points (per point, not σ/√n). Beating depth 0.5 (CREATIVE placeholder) with a seeded phase per note; a beating note's gain is raised by 1/√(mean e²) (+2.26 dB) so it is not quieter.
- A/B: a linear 150 ms crossfade between two phase-locked looping buffers (the same phase per note). The loop is exact (integer phase). Seed 11 (12 equal notes peak at 0.47). Determinism within one JavaScript engine (Q-444); the tests pin a golden FNV-1a hash.
- The duck goes through `holdDuck` with a safety timeout (6 s + 1 s), kept alive by a heartbeat while the context runs.
- The 12-note strip draws silent notes as short empty boxes, marks notes that change by 1 dB or more between Data and Smooth with a tick at the other mode's level, and marks noisy notes with "~". A visible summary says how many notes sound and whether the A/B changes any note by 1 dB or more. Sweep and Chord are labelled "one wavelength at a time" and "all at once".
- If the AudioContext is suspended longer than the duck's safety, the hold lets go; the chord takes a new hold when the context runs again.
- One spectrum sound at a time: the chord, the Listen sweep and the Hear it sweep stop each other, whoever starts them. The Hear it sweep now uses `pitch.ts` (220–1158 Hz, Q-446; its octave-up sine is timbre only). The sky tool's Spectrum panel gets Sweep | Chord (its sweep is the Listen sweep, with no gas chimes).
- Not built: the 3-example tutorial (item 7; cut, post-event backlog). The ISO table (with the 3 dB cap fallback) and the A15 checks are R12 #66 and #67.

**As built in #111:** item 2 only. `PITCH_RISES_WITH_WAVELENGTH = false` in `frontend/src/sound/tuning.ts`; `wavelengthToPitch(0.75 µm) = 1`, `wavelengthToPitch(5 µm) = 0`; the Listen sweep falls in pitch from short to long wavelengths; the Senses copy reads "Short wavelengths sound high, long wavelengths low. Brighter is louder." The chord is #115.
