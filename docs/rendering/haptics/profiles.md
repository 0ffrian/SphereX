# Haptics: per-type profiles and spectrum haptics

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R8.5, R8.6 · **Implements:** D-12, D-21 ([decisions](../../decisions.md)) · **Read with:** [engine-api.md](engine-api.md), [sources.md](sources.md)

### R8.5 Per-type haptic profile

| Type | Texture haptics | Data haptics |
|---|---|---|
| `asteroid_shape` | Mesh-normal ticks (measured shape) | — |
| `asteroid_procedural` | Height-map ticks: dense, irregular for rubble; rim double-ticks and silent floors for cratered | — |
| `comet` | Nucleus tick | Field pulse rate ∝ Q/r per selected gas and epoch |
| `brown_dwarf` | Soft tick at each band boundary, strength = band contrast | Holding still gives a steady pulse; rate ∝ normalised `flux_45um` (2–12 Hz) |
| `brown_dwarf_binary` | As above | Tapping each body gives a pulse rate by temperature class (the warmer T1 is faster) |
| `star_mira` | — | Heartbeat. One beat per scrub step; strength follows the measured flux |
| `star_ttauri` | — | Steady pulse that weakens and stutters (dropped beats ∝ dimming depth) as you scrub the 2025 dimming |
| `star` | — | Ticks while tracing the motion trail; spacing ∝ distance moved per year |
| `candidate` | — | In the flipbook: one tick per frame where it's detected |
| `gas_giant` | No surface, so the finger feels the **flow**: a soft tick crossing each band boundary (strength = band contrast); inside a jet, a pulse train whose rate ∝ the zonal wind speed at that latitude; on a storm, a firm tick at its edge and a pulse rate that rises towards its centre (a "swirl"); dragging across rings gives a tick at each gap | Holding still gives a steady pulse (`teq_pulse`), rate ∝ normalised `Teq` (2–12 Hz), as for brown dwarfs. Tag follows `teq_K`: `measured` from `pl_eqt`, otherwise `derived` |
| `planet_water` | Open ocean: near-silent slow swell (1–2 Hz, lowest level); coastline: one firm tick; land: height-map ticks as for `asteroid_procedural`; polar ice: dense, fine, soft ticks; clouds: not felt (optional "feel clouds" toggle) | As for `gas_giant` (`Teq` pulse) |
| `planet_rocky` | Height-map ticks; lava cracks give a double tick | As for `gas_giant` |
| `nebula`, `nova` | Field source as for the comet ([§8.4](sources.md#r84-event-sources)): pulse rate ∝ local point density | — |

- The last 4 rows come from D-12 (Accepted). All their texture haptics are `artistic`, so they play only in + Artistic and are silent in Measured only and + Estimated (D-21). The `teq_pulse` follows the tag of `teq_K`: when it is `measured` (Exoplanet Archive `pl_eqt`) it plays in every state; when it is `derived` it is silent in Measured only and plays from + Estimated.

### R8.6 Spectrum haptics (every object; the most useful for blind and low-vision users)

1. Dragging along the spectrum plot maps x to λ and emits a tick every 8 px of travel.
2. Strength = normalised flux. Absorption dips fall below the 20% threshold and go **quiet**. Points with large σ (σ/flux > 0.3) jitter.
3. The same events drive the Listen sweep and the audio driver ([§8.9](audio-pairing.md#r89-audio-pairing-d-10)), with `pitch` from λ, so sound and touch match.
4. Tag `measured`.

**As built (issue #10):** `frontend/src/haptics/sources/spectrum.ts` (`SpectrumHapticSource`) with the pad `haptics/ui/SpectrumHapticsPad.tsx`. Choices where R8.6 is silent are in Q-76.

- x → λ goes through `app/spectrum/scale.ts` (`linearScale`), read from the pad's box once per gesture.
- Strength, quiet, noisy and pitch come from the shared `spectrumMapping.ts` (the one the Listen sweep uses); pitch from λ (Q-70); pan from the finger's x across the plot; the tag from `SpectrumResponse.tag`.
- Quiet steps emit nothing. A step outside the spectrum's λ range emits nothing.
- After a noisy point the spacing to the next step is 8 px ± 30%, from a hash of (seed, step index), so the same seed and gesture give the same ticks (R8.3).
- When one pointer move crosses several steps, only the last plays (the engine's 25 ms rule would drop the others anyway).
- Keyboard: the pad is a `role="slider"` over λ. Arrow keys move one step, Page Up and Page Down 10, Home and End jump to the ends, and a step past an edge lands on it; each emits the same event as a drag step. The value text gives λ and the flux as a share of the peak, and says "quiet" (R9).
- One pointer drives a drag (the first finger, or the main mouse button). A spectrum with usable flux at only one wavelength is refused with a sentence.
- R11 test: a synthetic spectrum with a 90%-deep dip at 4.25 µm gives at least 3 consecutive quiet steps on an 800 px pad (`sources/spectrum.test.ts`). At phone width (about 296 px) the same dip gives only 1–2 over the full band, so it needs the pad zoomed (`lambdaDomain`); a broad band such as a brown dwarf's CH₄ trough passes unzoomed. The arithmetic and the options are in Q-77.
