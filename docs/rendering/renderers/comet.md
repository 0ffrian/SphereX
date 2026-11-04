# Renderer: comet

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R7.3

### R7.3 `comet` (3I/ATLAS)

- **Requires:** `gas_Q` per epoch and `coma_radius_km`, filled from the published papers (Lisse et al.) with citations. Never guess them.
- **Nucleus:** a dark sphere at `nucleus_radius_km_max`, labelled "upper size limit". If the value is missing, draw a point.
- **Gas shells:** one additive-blended point cloud per gas, with density ∝ 1/r² out to the coma radius. Point count and brightness are proportional to Q for the selected epoch. Fixed false colours with a legend: CO₂ = cyan, H₂O = blue, CO = magenta. Tag `measured` (Q) + `model_dependent` (1/r² profile).
- **Dust:** a pear-shaped, Sun-pointing dust cloud, **December only**.
- **Tail:** none in August. Draw a tail only if a published December result shows one.
- **Epoch toggle:** Aug 2025 / Dec 2025. Clicking a shell highlights its spectral line, and clicking a line highlights its shell.
- **Haptics:** field source ([§8.4](../haptics/sources.md#r84-event-sources)).
