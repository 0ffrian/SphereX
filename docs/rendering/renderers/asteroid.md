# Renderers: asteroids

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R7 (intro), R7.1, R7.2 · **Implements:** D-01 ([decisions](../../decisions.md)) · **Read with:** [surface-generation.md](../surface-generation.md)

## R7. Per-type rendering specs

Each spec lists the required card fields. If one is missing, the dependent layer is refused and added to `missing`.

### R7.1 `asteroid_shape` (Bennu, Eros, Vesta, DAMIT objects)

- **Requires:** `shape_source`, `diameter_km`.
- **Mesh:** load the GLB/OBJ (decimated to ≤50k triangles, [§5.5](../display-rules.md#r55-performance-budget-d-05)) and scale it to the measured diameter. Tag `measured`.
- **Mesh address (viewer):** `shape_source` is loaded only if it is a same-origin path (`/…` or `./…`) ending in `.glb`, `.gltf` or `.obj` (Q-44: the backend cache serves it, D-25). Any other value (an http(s) URL, a DOI) is refused and the body falls back to a sphere. The model is scaled so its bounding sphere equals the diameter on the card (assumption **[verify]**, Q-43: catalogue diameters are often volume-equivalent, which would make an elongated body too long).
- **Spin:** `rot_period_h` sped up, with the factor shown on screen ("×1000"). Tag `measured`.
- **Material:** `MeshStandardMaterial`, colour = base_rgb · brightness, roughness 0.95. No procedural detail by default: these meshes often have no UVs, and the real shape is the point.
- **Haptics:** mesh-normal source ([§8.4](../haptics/sources.md#r84-event-sources)).

### R7.2 `asteroid_procedural`

- **Requires:** `diameter_km`. Optional: `lightcurve_amp_mag`, `gaia_rgb`, `albedo`, band depths.
- **Mesh:** `SphereGeometry(1, 256, 128)`, scaled by `ellipsoid_axes`.
- **Material:** albedo, normal and roughness maps from [§6](../surface-generation.md#r6-surface-generation-backend-cpu). The baked albedo already holds the colour: it is shown in the visible view only, with a white tint, and left out of the SPHEREx infrared view (R5.2). Displacement only on desktop (`displacementScale` = relief_amp); off on mobile.
- **Measured-only state:** a plain sphere with a flat tint (the `ellipsoid` layer is `model_dependent`, so it is hidden there; the body stays only if the size is `measured`).
- **Haptics:** height-map source ([§8.4](../haptics/sources.md#r84-event-sources)).
