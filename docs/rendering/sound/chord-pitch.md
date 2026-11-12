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
7. **Listening aids:**
   - an **A/B toggle** between "Smooth (continuum)" and "Data", so absorption dips become audible;
   - a 3-example tutorial before first use;
   - the caption "Data mapping, not a recording".
8. **Honesty:**
   - Never claim a weak band is audible: at SNR below 5, listeners were at chance (Tucker Brown et al. 2022).
   - The tag follows the spectrum: `measured` for SPHEREx.

**As built in #111:** item 2 only. `PITCH_RISES_WITH_WAVELENGTH = false` in `frontend/src/sound/tuning.ts`; `wavelengthToPitch(0.75 µm) = 1`, `wavelengthToPitch(5 µm) = 0`; the Listen sweep falls in pitch from short to long wavelengths; the Senses copy reads "Short wavelengths sound high, long wavelengths low. Brighter is louder." The chord is #115.
