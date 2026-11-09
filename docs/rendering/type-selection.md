# Type selection (backend)

> **Part of:** Rendering & haptics spec ([index](README.md)) · **Sections:** R3.3 · **Implements:** [D-04](../decisions/contract.md), [D-12](../decisions/haptics-design.md), [Q-55, Q-61, Q-63](../decisions/pipeline-jobs.md) · **Read with:** [data-contract.md](data-contract.md) (R3.2 ObjectCard), [pipeline-card.md](../architecture/pipeline-card.md) (A4.3, stage 3)

### R3.3 Type selection (backend)

Pipeline stage 3 (`backend/app/core/classify/rules.py`, owner Atish, D-17) picks one `ObjectType` (R3.2) per object, in this order:

1. JPL SBDB says comet → `comet`.
2. JPL SBDB says asteroid → `asteroid_shape` if a DAMIT or NASA model exists, otherwise `asteroid_procedural`. The shape-model registry holds Gaskell 433 Eros (Q-61), so Eros is `asteroid_shape`.
3. SIMBAD object type (`otype`, as built in Q-55 item 2):
   - brown dwarf (`BD*`) → `brown_dwarf`, or `brown_dwarf_binary` if the system has known components. "Known components" = a composite SIMBAD spectral type containing `+`, such as `T1V+T6V` (Q-55 item 3)
   - Mira variable (`Mi*`) → `star_mira`
   - T Tauri (`TT*`) → `star_ttauri`
   - any other star (any otype ending in `*`, plus `s*r`, `s*y`, `s*b`, `Y*O`) → `star`
   - candidates such as `BD?` and `Mi?` are not stars and become `candidate`
4. NASA Exoplanet Archive match → `planet_rocky`, `planet_water` or `gas_giant`.
   - Classification thresholds: **proposed** values in `PROPOSED_EXOPLANET_THRESHOLDS` in `rules.py` (Q-63: radius cuts, true mass, Zeng 2019 mass-radius curves), chosen by Moon on 7 Nov 2026. The live thresholds stay `None` (refuse: `candidate` with `type:exoplanet_thresholds`) until Atish (classify owner, D-17) confirms Q-63; all values stay **[verify]** ([R12 #12](open-items.md#r12-open-items-verify)). Archive values marked `CALCULATED_VALUE` are never used to classify (Q-63).
   - The Exoplanet Archive service is tested ([A3.8](../architecture/object-sources.md)).
5. `nebula` and `nova` come from user sliders only. They have no catalogue rule; they are slider-only showcase bodies, and every value is tagged `artistic` (D-12).
6. Anything else → `candidate`.

The class label on the card comes from the catalogue only (SIMBAD `sp_type`; SBDB `spec_B`, then `spec_T`), tagged `measured` (Q-55 item 1). Matching against reference spectra (A4.3 step 2) is not built.
