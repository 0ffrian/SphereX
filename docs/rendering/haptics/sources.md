# Haptics: event sources

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R8.4 · **Implements:** D-12 ([decisions](../../decisions.md)) · **Read with:** [engine-api.md](engine-api.md)

### R8.4 Event sources

**Height-map source** (procedural asteroids):

1. On `pointermove` in touch mode, intersect the ray with the analytic sphere/ellipsoid (no mesh raycast is needed). Get the UV, then sample `height.bin` bilinearly.
2. Track `dh` between consecutive samples. When `dh` turns from positive to negative after a rise > threshold `τ` (0.15 of local relief std), emit a tick with strength = clamp(rise / (3τ), 0, 1).
3. If the sample is inside a crater rim band (from a crater mask channel), emit a **double tick**. Inside crater floors, stay silent.
4. Hydrated objects scale strength ×0.6 (softer).

**Mesh-normal source** (real shape models):

1. Raycast with `three-mesh-bvh`.
2. When the angle between consecutive face normals exceeds 12°, emit a tick with strength = clamp(angle/40°, 0, 1).
3. When the finger slides off the limb, emit one firm "edge" tick.

**Field source** (comet coma):

1. Compute the distance r from the nucleus in the projected view.
2. Pulse rate = clamp(k · Q_selected / r, 2, 30) Hz, re-issued as a pattern every 250 ms. Touching the nucleus gives one firm tick.
3. Selecting CO₂, H₂O or CO on the spectrum switches Q. December feels denser than August. Tag `measured` + `model_dependent` (which single event tag, and whether it plays in Measured only: Q-17).
4. `nebula` and `nova` have no data haptics (issue #43, Q-103): they are drawn as volumes, and what is felt must match what is drawn (D-34). The point-density source (`PointDensitySource`) stays in the code for a later version that samples a CPU twin of the baked noise cube; no profile uses it now.

**Terrain source** (`planet_rocky`, `planet_water`; D-12). Tag `artistic`.

1. Intersect the ray with the analytic sphere, as for the height-map source. Sample the shared field ([§7.7](../renderers/shader-kinds.md#r77-shader-generated-kinds-planet_rocky-planet_water-gas_giant-nebula-nova)) bilinearly.
2. **Land:** height ticks, same rule as the height-map source (rise > τ → tick).
3. **Coastline:** one firm tick when the ocean mask changes between consecutive samples.
4. **Open ocean:** near-silent slow swell, a pulse train at 1–2 Hz at the lowest level.
5. **Polar ice:** dense, fine, soft ticks.
6. **Lava cracks** (`planet_rocky`): double tick, from the field's lava-crack mask (texture B, channel B; D-12).
7. **Clouds:** not felt. An optional "feel clouds" toggle may add them.

**Flow source** (`gas_giant`; D-12). There is no surface, so the finger feels the flow. Tag `artistic`.

1. Sample band index and storm id from the shared field ([§7.7](../renderers/shader-kinds.md#r77-shader-generated-kinds-planet_rocky-planet_water-gas_giant-nebula-nova)).
2. **Band boundary:** a soft tick each time the band index changes. Strength = band contrast.
3. **Jet:** inside a jet, a pulse train whose rate ∝ the zonal wind speed at that latitude. The wind comes from the same functions as the shader. Rate = clamp(k · |zonal wind| / max |zonal wind|, 2, 20) Hz (D-12) **[verify on phones]**.
4. **Storm swirl:** a firm tick at the storm's edge, then a pulse rate that rises towards its centre.
5. **Rings:** dragging across the rings gives a tick at each gap.

**As built (issue #11, `frontend/src/haptics/sources/`).** Every source owns no timers: one-shots go to `engine.emit`, trains to `startTrain` / `updateTrain` / `stopTrain` (Q-71), and the engine applies the honesty filter, so a source never checks it. `probe.ts` turns a pointer into a ray, meets the analytic sphere or ellipsoid (item 1), and gives the body direction, UV, normal, the projected distance from the centre and the ring-plane radius, plus `pan` from the finger's x. Differences from the text above, each a `Q-` entry for Atish:
- **Height map.** `height.bin` (float16 little-endian, W×H = 2H×H) is decoded by hand and sampled bilinearly; "local relief std" is taken per 16-texel tile (of a 512-wide map). Hydrated = `band_depth_3um > 0.05`, the baker's rule (`backend/app/core/render/params.py`). The crater-rim double tick and silent floor are refused as `crater_rims`: the bake ships no crater mask (Q-78).
- **Mesh normal.** The angle rule and the limb tick are built and tested on synthetic normals; the `three-mesh-bvh` raycast is not (no fixture or renderer has a mesh yet). A bounding sphere's normal is not the shape's, so the mesh texture is refused (`mesh_normals`) until M5 provides real normals (Q-78).
- **Field.** Comet: r is in coma radii, Q is the selected gas's Q for the selected epoch (`gasQForEpoch`) ÷ the largest Q of the card, as the drawn shells (`planShells`), and k = 8 so December stays denser than August across the coma (Q-84); outside the coma there is no pulse. The nucleus is the drawn `nucleus` body; on it there is one firm tick and no pulse. The tag is `profile.data_tag` (Q-17 stays open). Defaults with no gas or epoch selected: Q-83. Nebula and nova: none (Q-103). `PointDensitySource` (points of `BodyRenderer.pointSets` within `DENSITY_RADIUS` of the finger's ray, recounted only after the finger moves 1 px) is kept but unused until a CPU twin of the noise cube exists.
- **Terrain.** Reads `BodyRenderer.field` (the D-27 overrides included). Masks count at ≥ 0.5. The ice cap is drawn over land and sea, so ice wins: open ocean is ocean · (1 − ice), and the coastline tick has hysteresis (enter at 0.6, leave at 0.4). Land ticks with the height rule, ice on land too; ice over the sea is flat; ice adds a soft tick every `ICE_TICK_SPACING_PX` unless a relief tick plays in that sample. The ocean swell is at the lowest level; the audio floor keeps its surf audible (Q-84).
- **Flow.** Band ticks come from the field's band index (the R11 shared-field test checks they sit on the drawn 0.5 edges); their strength is the soft tick, as the gas field has no per-boundary contrast (Q-79). Jet rate uses `zonalWind`; storm centres and sizes come from `stormsFor` and the felt edge is `STORM_EDGE_FACTOR`; ring gaps use `ringT` / `ringGapAt` and only when the rings are drawn and the ray meets them before the planet.
