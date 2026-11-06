# Renderers: shader-generated kinds

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R7.7 · **Implements:** D-01, D-04, D-12, D-21 ([decisions](../../decisions.md))

### R7.7 Shader-generated kinds: `planet_rocky`, `planet_water`, `gas_giant`, `nebula`, `nova`

- **Look:** browser shader generators with triplanar mapping, as in [architecture spec §6](../../architecture/README.md) (D-01). This doc does not restate them.
- **Shared CPU field (D-01, D-12):** planets and gas giants need a field the finger can sample.
  - When a body loads, a Web Worker generates one equirectangular field at **512×256**. It runs once, not per frame.
  - It uses the **same seed and the same functions** as the shader, so the field and the picture agree.
  - Six channels, packed into two RGBA `Float32` `DataTexture`s (D-12). The haptics read the same `Float32Array`s.
    - Texture A: R = height, G = band index, B = storm id, A = unused.
    - Texture B: R = ocean mask, G = ice mask, B = lava-crack mask, A = unused.
  - Pixel-to-direction mapping as in [§6.1](../surface-generation.md#r61-strategy-height-first-colour-second).
  - The field is uploaded to the shader as a `DataTexture`. The haptic sources ([§8.4](../haptics/sources.md#r84-event-sources)) sample the **same array**. Principle 6 ("one height map drives everything") holds for these kinds too.
  - The shader may add finer visual noise below the field's resolution. That detail is seen but not felt.
- **Nebulae and novae** are point clouds. Their haptics use local point density (field source, [§8.4](../haptics/sources.md#r84-event-sources)).
- **Honesty:** nothing about these surfaces is measured. Every texture layer and texture haptic is `artistic`. In Measured only, texture haptics are silent. The data pulse (`teq_pulse`) remains only when `teq_K` is `measured` (Exoplanet Archive `pl_eqt`, D-21).
- **Haptics:** terrain and flow sources ([§8.4](../haptics/sources.md#r84-event-sources)), profile rows in [§8.5](../haptics/profiles.md#r85-per-type-haptic-profile).
- **Implementation (issue #8):**
  - `viewer/fields/fieldGenerator.ts` (pure, seeded, integer-hash noise) is the source of truth for the field; `fieldWorker.ts` wraps it and `fieldClient.ts` falls back to the main thread. `FieldSampler` is the typed sampler for haptic sources.
  - The shader reads the two textures with `textureLoad` and filters by hand, so float32 filtering support does not matter. It recomputes only sub-resolution noise and the analytic storm shapes (centres from `stormsFor`, the same function the field uses).
  - Gas giants: R holds the band profile (0.5 is a band edge), G the band index, B the storm id; a gas giant has no relief (Q-43). Terrain: R is the raw terrain height, ocean flattened by consumers using the ocean mask.
  - Layer `surface` (planets, gas giants) or `point_cloud` (nebula, nova) is refused, and listed in `missing`, when `scale_m` or the size field is null.
- **Status:** D-12 is **Accepted** (signed off by Atish, 5 Nov 2026). The jet pulse rate stays **[verify on phones]** ([§8.4](../haptics/sources.md#r84-event-sources)).
