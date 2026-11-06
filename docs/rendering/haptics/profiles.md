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

**As built (issue #11, `frontend/src/haptics/profiles.ts`).** `buildHaptics(engine, params, card, body, options)` reads `params.haptics` and returns at most one texture and one data source, plus a `missing` list of refused haptics. For the shared fixtures:

| Type | Texture source | Data source | Refused (`missing`) |
|---|---|---|---|
| `asteroid_shape` | mesh normal (`texture_tag`) | — | — |
| `asteroid_procedural` | height map, once `height.bin` is loaded | — | `crater_rims` (Q-66); `height` until the map loads |
| `comet` | — | comet field, Q per epoch and gas (`data_tag`) | `field` when the epoch has no Q |
| `brown_dwarf` | — | `flux_pulse` once `flux45Reference` is verified | `band_ticks` (Q-70), `flux_pulse` (R12 #15) |
| `brown_dwarf_binary` | — | pulse per body by temperature class (`spectral_class` tag, Q-69) | `band_ticks` (Q-70) |
| `star_mira` | — | heartbeat per scrub step | `heartbeat` without a usable light curve |
| `star_ttauri` | — | dimming pulse per scrub step (Q-68) | `dimming` without a usable light curve |
| `star` | — | — | `motion` (R12 #16) |
| `candidate` | — | — | `detections` (frames carry no detection field) |
| `gas_giant` | flow | `teq_pulse` (`teq_K` tag) | `flow` without a field; `teq_pulse` when `teq_K` is null |
| `planet_water` | terrain | `teq_pulse` (`teq_K` tag) | as above, `terrain` |
| `planet_rocky` | terrain with lava cracks | `teq_pulse` when offered | as above |
| `nebula`, `nova` | — | point density (`data_tag`, `artistic`) | `field` without point sets |

- `TouchHaptics` drives the two sources: moving gives texture events; holding still for `HOLD_STILL_MS` starts the `teq_pulse` or `flux_pulse` (the viewer's frame loop calls `poll`, Q-71); the scrubber drives the light-curve pulses.
- The R11 honesty test runs these through the real engine: in Measured only the gas giant and planet textures and procedural relief are silent, and the `teq_pulse` plays only when `teq_K` is `measured`.

### R8.6 Spectrum haptics (every object; the most useful for blind and low-vision users)

1. Dragging along the spectrum plot maps x to λ and emits a tick every 8 px of travel.
2. Strength = normalised flux. Absorption dips fall below the 20% threshold and go **quiet**. Points with large σ (σ/flux > 0.3) jitter.
3. The same events drive the Listen sweep and the audio driver ([§8.9](audio-pairing.md#r89-audio-pairing-d-10)), with `pitch` from λ, so sound and touch match.
4. Tag `measured`.
