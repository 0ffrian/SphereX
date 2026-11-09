# Haptics: event sources

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R8.4 · **Implements:** [D-12, Q-17, Q-78, Q-79, Q-80, Q-81, Q-82, Q-133](../../decisions/haptics-design.md), [Q-71, Q-83, Q-84, Q-105](../../decisions/haptics-built.md), [Q-132](../../decisions/platform-hosting.md) · **Read with:** [engine-api.md](engine-api.md) (R8.8), [audio-pairing.md](audio-pairing.md) (R8.9.1 body tone), [profiles.md](profiles.md) (R8.5)

### R8.4 Event sources

A source turns a pointer sample (or a scrub step) into engine calls. It owns no timers and never checks the honesty state (R8.2). The pointer comes from desktop Feel mode at the event, or Touch mode after the event (R5.6).

**Body tone first (Q-133).** On every body with a height, the interaction sound is one continuous tone whose pitch follows the height under the pointer: low in grooves, higher on the surface and peaks. The tone's rules are [R8.9.1](audio-pairing.md#r891-body-tone-from-the-height-map-q-133). The sources below supply its height sample and add the cues that are not height. The discrete height ticks below are the post-event vibration encoding only; the audio driver does not sound them (**Proposed (Q-NEW-REN-5)**).

**Height-map source** (`asteroid_procedural`):

1. On a pointer sample, intersect the ray with the analytic sphere or ellipsoid (no mesh raycast is needed). Get the UV, then sample `height.bin` bilinearly. This sample drives the body tone.
2. *After the event (vibration):* track `dh` between consecutive samples. When `dh` turns from positive to negative after a rise > threshold `τ` (0.15 of local relief std), emit a tick with strength = clamp(rise / (3τ), 0, 1).
3. *After the event (vibration):* inside a crater rim band (from a crater mask channel), emit a **double tick**; inside crater floors, stay silent. Refused today (`crater_rims`, Q-78). The body tone needs no crater mask.
4. Hydrated objects (`band_depth_3um > 0.05`) are softer: tick strength and tone gain ×0.6.

**Mesh source** (`asteroid_shape`, real shape models such as 433 Eros):

1. Raycast the mesh with `three-mesh-bvh`.
2. **Mesh height for the body tone. Proposed (Q-NEW-REN-1):** height = the distance from the model's centre to the hit point minus the radius of the model's reference ellipsoid in that direction. The reference ellipsoid has the half-extents of the model's bounding box in the model frame. Pitch 0 and 1 are the lowest and highest heights over all vertices, computed once per model. The tone carries the mesh's tag (`measured`, as the mesh-normal ticks do in R8.2), so it plays in every honesty state. The reference surface only sets where the pitch scale starts; it adds no value that is not in the mesh.
3. *After the event (vibration):* when the angle between consecutive face normals exceeds 12°, emit a tick with strength = clamp(angle/40°, 0, 1).
4. When the pointer slides off the limb, emit one firm "edge" tick and stop the tone.

**Field source** (comet coma):

1. Compute the distance r from the nucleus in the projected view.
2. Pulse rate = clamp(k · Q_selected / r, 2, 30) Hz, played as an engine train (Q-71). Touching the nucleus gives one firm tick. The nucleus is a plain sphere with no height, so there is no body tone.
3. Selecting CO₂, H₂O or CO on the spectrum switches Q. December sounds denser than August. Tag `measured` + `model_dependent`; which single event tag, and whether it plays in Measured only, is Q-17 (R12 #20).

**Terrain source** (`planet_rocky`, `planet_water`; D-12). Tag `artistic`.

1. Intersect the ray with the analytic sphere, as for the height-map source. Sample the shared field ([§7.7](../renderers/shader-kinds.md#r77-shader-generated-kinds-planet_rocky-planet_water-gas_giant-nebula-nova)) bilinearly.
2. **Land:** the body tone follows the field height (Q-133). After the event, height ticks add vibration (same rule as the height-map source).
3. **Open ocean:** the height is flat at sea level, so the tone holds its sea-level pitch; the surf sound and the near-silent slow swell (a 1–2 Hz train at the lowest level) mark the water. **Proposed (Q-NEW-REN-4).**
4. **Coastline:** one firm tick when the ocean mask changes between consecutive samples.
5. **Polar ice:** dense, fine, soft ticks.
6. **Lava cracks** (`planet_rocky`): double tick, from the field's lava-crack mask (texture B, channel B; D-12).
7. **Clouds:** not heard or felt. An optional "feel clouds" toggle may add them.
8. Items 4 to 6 are one-shots on top of the tone: they mark mask edges, not height (**Proposed (Q-NEW-REN-4)**).

**Flow source** (`gas_giant`; D-12). There is no surface (Q-48), so there is no body tone; the pointer hears the flow (**Proposed (Q-NEW-REN-4)**). Tag `artistic`.

1. Sample band index and storm id from the shared field ([§7.7](../renderers/shader-kinds.md#r77-shader-generated-kinds-planet_rocky-planet_water-gas_giant-nebula-nova)).
2. **Band boundary:** a soft tick each time the band index changes, voice `tone`, pitch from latitude. Strength: the soft tick (Q-79).
3. **Jet:** inside a jet, a pulse train whose rate ∝ the zonal wind speed at that latitude. The wind comes from the same functions as the shader. Rate = clamp(k · |zonal wind| / max |zonal wind|, 2, 20) Hz (D-12) **[verify by ear on the A15; by touch after the event]** (R12 #14).
4. **Storm swirl:** a firm tick at the storm's edge, then a pulse rate that rises towards its centre. Storms move; their centre and size come from the shared model at the scene's t (Q-105).
5. **Rings:** dragging across the rings gives a tick at each gap.

**Band source** (`brown_dwarf`). A soft tick at each band boundary, strength = the R7.4 band contrast. **Refused** (`band_ticks`, Q-82): the band field exists only inside the baked albedo, and `height.bin` is flat. The brown dwarf has no body tone (flat height).

**Data pulse source** (`dataPulse.ts`; D-12, R8.5). Holding still on the body (`HOLD_STILL_MS` 400 ms within `HOLD_STILL_TOLERANCE_PX` 4 px) starts a steady train; moving off the body stops it.
- `teq_pulse` (gas giants, planets): rate ∝ Teq normalised over 200–2000 K, 2–12 Hz. Tag = `teq_K`'s tag. Refused when `teq_K` is null.
- `flux_pulse` (`brown_dwarf`): rate ∝ `flux_45um` ÷ the verified reference, 2–12 Hz, tag = `flux_45um`'s. Refused while the reference is null (R12 #15).
- Binary pulse (`brown_dwarf_binary`): touching each body plays a pulse by temperature class, warmer faster (8 Hz and 4 Hz); tag = `spectral_class`'s. Refused (`binary_pulse`) when the classes cannot be ordered (Q-81).

**Light-curve source** (`lightcurve.ts`). Driven by the light-curve scrubber, not the pointer on the body. Tag `profile.data_tag` (`measured`).
- `star_mira`: one heartbeat per scrub step; strength = the scrubbed flux ÷ the brightest point.
- `star_ttauri`: a steady pulse with depth = the dust-screen opacity clamp(1 − flux/median, 0, 0.9); rate = 4 Hz × (1 − depth), strength × (1 − depth). The beats thin out rather than stutter (Q-80).
- Refused (`heartbeat`, `dimming`) without a usable light curve.

**As built (issue #11, `frontend/src/haptics/sources/`).** One-shots go to `engine.emit`, trains to `startTrain` / `updateTrain` / `stopTrain` (Q-71). `probe.ts` turns a pointer into a ray, meets the analytic sphere or ellipsoid, and gives the body direction, UV, normal, the projected distance from the centre and the ring-plane radius, plus `pan` from the pointer's x. Differences from the text above, each a `Q-` entry for Atish:
- **Body tone: not built yet.** The height-map and terrain sources emit `tick` with voice `click` and no pitch (`heightMap.ts:135`, `terrain.ts`); the engine has no tone stream (R8.8). Only the flow source sets a pitch (latitude).
- **Height map.** `height.bin` (float16 little-endian, W×H = 2H×H) is decoded by hand and sampled bilinearly; "local relief std" is taken per 16-texel tile (of a 512-wide map). Hydrated = `band_depth_3um > 0.05`, the baker's rule. Crater rims are refused (Q-78).
- **Mesh.** The angle rule and the limb tick are built and tested on synthetic normals; the `three-mesh-bvh` raycast is not. A bounding sphere's normal is not the shape's, so mesh haptics are refused (`mesh_normals`) until real normals exist (Q-78). Mesh height is not built.
- **Field.** r is in coma radii; Q is the selected gas's Q for the selected epoch (`gasQForEpoch`) ÷ the largest Q of the card, as the drawn shells, and k = 8 (Q-84); outside the coma there is no pulse. Defaults with no gas or epoch selected: Q-83. `PointDensitySource` is kept but unused until a CPU twin of the noise cube exists.
- **Terrain.** Reads `BodyRenderer.field` (the D-27 overrides included). Masks count at ≥ 0.5. Ice wins over land and sea: open ocean is ocean · (1 − ice), and the coastline tick has hysteresis (enter at 0.6, leave at 0.4). Ice over the sea is flat; ice adds a soft tick every `ICE_TICK_SPACING_PX` unless a relief tick plays in that sample. The audio floor keeps the surf audible (Q-84).
- **Flow.** Band ticks come from the field's band index (the R11 shared-field test checks they sit on the drawn 0.5 edges). Jet rate uses `zonalWind`; storm centres and sizes come from `FieldSampler.currentStorms` at the scene's t (Q-105) and the felt edge is `STORM_EDGE_FACTOR`; ring gaps use `ringT` / `ringGapAt` only when the rings are drawn and the ray meets them before the planet.
