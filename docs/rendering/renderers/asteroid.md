# Renderers: asteroids

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R7 (intro), R7.1, R7.2 · **Implements:** D-01 ([decisions](../../decisions.md)) · **Read with:** [surface-generation.md](../surface-generation.md)

## R7. Per-type rendering specs

Each spec lists the required card fields. If one is missing, the dependent layer is refused and added to `missing`.

### R7.1 `asteroid_shape` (Bennu, Eros, Vesta, DAMIT objects)

- **Requires:** `shape_source`, `diameter_km`.
- **Mesh:** load the GLB/OBJ (decimated to ≤50k triangles, [§5.5](../display-rules.md#r55-performance-budget-d-05)) and scale it to the measured diameter. Tag `measured`.
- **Mesh address (viewer):** `shape_source` is loaded only if it is a same-origin path (`/…` or `./…`) ending in `.glb`, `.gltf` or `.obj` (Q-44: the backend cache serves it, D-25). Any other value (an http(s) URL, a DOI) is refused and the body falls back to a sphere. The model is scaled so its bounding sphere equals the diameter on the card (assumption **[verify]**, Q-43: catalogue diameters are often volume-equivalent, which would make an elongated body too long).
- **Spin:** `rot_period_h` sped up, with the factor shown on screen ("×1000"). Tag `measured`.
- **Material:** colour = base_rgb · brightness. No procedural detail by default: these meshes often have no UVs, and the real shape is the point.
- **Issue #43 additions** (each its own layer with its own tag, so the honesty toggle can hide it; see `planShapeLayers`): `reflectance` (`model_dependent`) is Lommel-Seeliger, `2/π · μ0/(μ0+μ)` through a custom lighting model, so the shadow map still multiplies the light (A7.4); `self_shadow` is a shadow map of the shape from the Sun direction so crater rims shadow the surface at low Sun (`derived` when the direction comes from the phase angle on the card, `artistic` when it is a default or a hint); `baked_ao` (`derived`) is per-vertex ambient occlusion baked with a BVH (cosine-weighted visibility, deterministic, 16 rays at every quality level so the cached result does not depend on which level loaded first, in slices after the model shows; drawn only while the plan asks for it, so Measured only never shows an AO baked earlier); `regolith` (`artistic`, tier 5) adds normal detail only at wavelengths shorter than two mean edges of the model, so it never changes the silhouette (D-33). With these hidden (Measured only) the model is drawn with the standard material as before.
- **Levels of detail:** the backend serves `<slug>.glb` and `<slug>.lod1.glb` (README "Shape models"). The low quality level loads `lod1`; the others load full detail. The 160 px rule is wired: every frame `ViewerApp` computes the body's on-screen diameter in CSS pixels (`bodyScreenPx`: scene radius, camera distance, the 40 degree field of view, canvas height) and hands it to `BuiltScene.setScreenPx`, which re-chooses the level with `chooseLod`. Below 160 px the coarse level is drawn; it is kept until the body is 1.25 times larger (`LOD_HYSTERESIS`), so zooming around the limit does not reload the model. The first model is chosen before a size is known, so a small body loads full detail first and then switches. A tier change while the first model still loads is honoured. A missing `lod1` falls back to full detail.
- **Real size:** a loaded GLB is in metres (Q-61), so half of its longest box extent is the measured size and the scale bar shows it (`ViewerApp.setMeshMeasuredHandler`); the catalogue `diameter_km` still sizes the plain-sphere fallback.
- **Haptics:** mesh-normal source ([§8.4](../haptics/sources.md#r84-event-sources)).

### R7.2 `asteroid_procedural`

- **Requires:** `diameter_km`. Optional: `lightcurve_amp_mag`, `gaia_rgb`, `albedo`, band depths.
- **Mesh:** `SphereGeometry(1, 256, 128)`, scaled by `ellipsoid_axes`.
- **Material:** albedo, normal and roughness maps from [§6](../surface-generation.md#r6-surface-generation-backend-cpu). Displacement by the baked height map (issue #43) needs `relief_amp`, an optional field of `RenderTextures` (`textures.relief_amp`, a fraction of the radius, R6.2; Q-103). Since issue #62 (Q-117) the backend sends it for this kind (the R6.2 style rule's value: rubble 0.04, cratered 0.03, large 0.02) together with an **`artistic`** layer `displacement`, so the surface is displaced on the high and medium quality levels from "+ Artistic" (the phone's low level keeps the normal map only). Without `relief_amp` the layer `displacement` is refused with reason `backend` and the plain words say that the server does not send the relief height yet, a gap in the service and not missing data about the object. The baked albedo already holds the colour: it is shown in the visible view only, with a white tint, and left out of the SPHEREx infrared view (R5.2). Displacement only on desktop (`displacementScale` = relief_amp); off on mobile.
- **Measured-only state:** a plain sphere with a flat tint (the `ellipsoid` layer is `model_dependent`, so it is hidden there; the body stays only if the size is `measured`).
- **Haptics:** height-map source ([§8.4](../haptics/sources.md#r84-event-sources)).
