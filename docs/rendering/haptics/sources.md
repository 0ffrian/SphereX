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
4. `nebula` and `nova` reuse this source: pulse rate ∝ local point density instead of Q/r. Tag `artistic`.

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
