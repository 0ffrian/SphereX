# Haptics: per-type profiles and spectrum haptics

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R8.5, R8.6 · **Implements:** [D-12, D-20, Q-37, Q-78 to Q-82, Q-86](../../decisions/haptics-design.md), [Q-133](../../decisions/haptics-sound.md), [Q-76, Q-77, Q-83](../../decisions/haptics-built.md), [Q-103](../../decisions/rendering-kinds.md), [D-21](../../decisions/contract-tags.md) · **Read with:** [sources.md](sources.md) (R8.4), [audio-pairing.md](audio-pairing.md) (R8.9), [engine-api.md](engine-api.md) (R8.8)

### R8.5 Per-type haptic profile

"Texture" is the body interaction: at the event, the body tone (R8.9.1, Q-133) plus the cues named; after the event, the ticks named also vibrate (**Proposed (Q-172)**).

| Type | Texture haptics | Data haptics |
|---|---|---|
| `asteroid_shape` | Body tone from mesh height (`measured`, Q-168); limb edge tick. After the event: mesh-normal ticks | — |
| `asteroid_procedural` | Body tone from `height.bin` (`artistic`, heard from + Artistic). After the event: height ticks, dense and irregular for rubble; rim double-ticks and silent floors for cratered | — |
| `comet` | Nucleus tick (no body tone: the nucleus has no height) | Field pulse rate ∝ Q/r per selected gas and epoch |
| `brown_dwarf` | Soft tick at each band boundary, strength = band contrast (no body tone: flat height) | Holding still gives a steady pulse; rate ∝ normalised `flux_45um` (2–12 Hz) |
| `brown_dwarf_binary` | As above | Tapping each body gives a pulse rate by temperature class (the warmer T1 is faster) |
| `star_mira` | — | Heartbeat. One beat per scrub step; strength follows the measured flux |
| `star_ttauri` | — | Steady pulse that weakens and stutters (dropped beats ∝ dimming depth) as you scrub the 2025 dimming |
| `star` | — | Ticks while tracing the motion trail; spacing ∝ distance moved per year |
| `candidate` | — | In the flipbook: one tick per frame where it's detected |
| `gas_giant` | No surface and no body tone (Q-171), so the pointer hears the **flow**: a soft tick crossing each band boundary (strength = band contrast); inside a jet, a pulse train whose rate ∝ the zonal wind speed at that latitude; on a storm, a firm tick at its edge and a pulse rate that rises towards its centre (a "swirl"); dragging across rings gives a tick at each gap | Holding still gives a steady pulse (`teq_pulse`), rate ∝ normalised `Teq` (2–12 Hz), as for brown dwarfs. Tag follows `teq_K`: `measured` from `pl_eqt`, otherwise `derived` |
| `planet_water` | Land: the body tone from the field height. Open ocean: the tone holds at sea level, with the surf sound and a near-silent slow swell (1–2 Hz, lowest level) (Q-171); coastline: one firm tick; polar ice: dense, fine, soft ticks; clouds: not heard or felt (optional "feel clouds" toggle) | As for `gas_giant` (`Teq` pulse) |
| `planet_rocky` | The body tone from the field height; lava cracks give a double tick on top | As for `gas_giant` |
| `nebula` | None. The nebula has no haptics (user decision, Q-103) | — |
| `nova` | None. The nova is drawn as a volume and has no haptics for now (Q-103; Atish's acceptance pending) | — |

- The last 5 object types come from D-12 (Accepted). Their texture haptics are all `artistic`; the honesty filter is owned by [§8.2](platform-encoding.md#r82-two-kinds-of-haptics-both-labelled-in-the-ui).
- **Nebulae and novae have no haptics or sound (this section owns the rule; issue #43, Q-103).** They are drawn as volumes, and what is heard or felt must match what is drawn (D-34): a point-density pulse would be felt where nothing is drawn. The 3D view says so in plain words ("Nebulae have no touch feedback"), so Feel on one is not silent without a reason (R9). The nebula decision is Moon's; the nova follows the review of PR #51; Atish's acceptance is pending (D-12, D-20 amendments).

**As built (issue #11, `frontend/src/haptics/profiles.ts`).** `buildHaptics(engine, params, card, body, options)` reads `params.haptics` and returns at most one texture and one data source, plus a `missing` list of refused haptics. `options.overrides` (D-27) is required; the comet also needs the plan's bodies for its nucleus, and `asteroid_shape` needs `meshNormals: true` from a real mesh raycast. For the shared fixtures:

| Type | Texture source | Data source | Refused (`missing`) |
|---|---|---|---|
| `asteroid_shape` | mesh normal (`texture_tag`), only with real mesh normals | — | `mesh_normals` until the mesh raycast exists (Q-78); the body tone is not built |
| `asteroid_procedural` | height map (ticks voiced as clicks, no tone yet), once `height.bin` is loaded | — | `crater_rims` (Q-78); `height` until the map loads |
| `comet` | — | comet field, Q per epoch and gas (`data_tag`), nucleus tick on the drawn nucleus | `field` when the epoch, or the selected gas in it, has no Q; `nucleus_tick` without the plan's nucleus body |
| `brown_dwarf` | — | `flux_pulse` once `flux45Reference` is verified | `band_ticks` (Q-82), `flux_pulse` (R12 #15) |
| `brown_dwarf_binary` | — | pulse per body by temperature class (`spectral_class` tag, Q-81) | `band_ticks` (Q-82) |
| `star_mira` | — | heartbeat per scrub step | `heartbeat` without a usable light curve |
| `star_ttauri` | — | dimming pulse per scrub step (Q-80) | `dimming` without a usable light curve |
| `star` | — | — | `motion` (R12 #16) |
| `candidate` | — | — | `detections` (frames carry no detection field, Q-86) |
| `gas_giant` | flow | `teq_pulse` (`teq_K` tag) | `flow` without a field; `teq_pulse` when `teq_K` is null |
| `planet_water` | terrain (land ticks voiced as clicks, no tone yet) | `teq_pulse` (`teq_K` tag) | as above, `terrain` |
| `planet_rocky` | terrain with lava cracks | `teq_pulse` when offered | as above |
| `nebula` | — | — (no haptics, Q-103) | — |
| `nova` | — | — (no haptics, Q-103) | — |

- `TouchHaptics` drives the two sources (pointer sample from Feel mode at the event, Touch mode after; neither is wired yet, R5.6): moving gives texture events; holding still for `HOLD_STILL_MS` starts the `teq_pulse` or `flux_pulse` (the viewer's frame loop calls `poll`, Q-83); the scrubber drives the light-curve pulses.
- The R11 honesty test runs these through the real engine with the R8.2 filter; `asteroid_shape` is silent while its mesh haptics are refused.

### R8.6 Spectrum haptics (every object; the most useful for blind and low-vision users)

1. Dragging along the spectrum plot maps x to λ and emits a tick every 8 px of travel.
2. Strength = normalised flux. Absorption dips fall below the 20% threshold and go **quiet**. Points with large σ (σ/flux > 0.3) jitter.
3. The same events drive the Listen sweep and the audio driver ([§8.9](audio-pairing.md#r89-audio-pairing-d-10)), with `pitch` from λ (Q-70), so sound and touch match. At the event this is sound only (Q-132).
4. Tag `measured`.

**As built (issue #10):** `frontend/src/haptics/sources/spectrum.ts` (`SpectrumHapticSource`) with the pad `haptics/ui/SpectrumHapticsPad.tsx`. Choices where R8.6 is silent are in Q-76.

- x → λ goes through `app/spectrum/scale.ts` (`linearScale`), read from the pad's box once per gesture.
- Strength, quiet, noisy and pitch come from the shared `spectrumMapping.ts` (the one the Listen sweep uses); pitch from λ (Q-70); pan from the finger's x across the plot; the tag from `SpectrumResponse.tag`.
- Quiet steps emit nothing. A step outside the spectrum's λ range emits nothing.
- After a noisy point the spacing to the next step is 8 px ± 30%, from a hash of (seed, step index), so the same seed and gesture give the same ticks (R8.3).
- When one pointer move crosses several steps, only the last plays (the engine's 25 ms rule would drop the others anyway).
- Keyboard: the pad is a `role="slider"` over λ. Arrow keys move one step, Page Up and Page Down 10, Home and End jump to the ends, and a step past an edge lands on it; each emits the same event as a drag step. The value text gives λ and the flux as a share of the peak, and says "quiet" (R9).
- One pointer drives a drag (the first finger, or the main mouse button). A spectrum with usable flux at only one wavelength is refused with a sentence.
- The pad shows its D-02 badge as a data haptic ("Data ·" and app/Badge's `ProvenanceBadge`; "Fixture (synthetic)" for synthetic data), and every tick carries `channel: 'data'` (Q-85). Its visible readout follows the finger, says "uncertain" for large σ and says when the honesty state hides the ticks; the slider's ARIA value changes only at the end of a drag and on keys. The page's single unlock button lives with the host, not the pad (Q-76).
- R11 test: a synthetic spectrum with a 90%-deep dip at 4.25 µm gives at least 3 consecutive quiet steps on an 800 px pad (`sources/spectrum.test.ts`). At phone width (about 296 px) the same dip gives only 1–2 over the full band, so it needs the pad zoomed (`lambdaDomain`); a broad band such as a brown dwarf's CH₄ trough passes unzoomed. The arithmetic and the options are in Q-77.
