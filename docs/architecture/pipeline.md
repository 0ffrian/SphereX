# Pipeline

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A4–A4.8 · **Implements:** D-04 · **Read with:** [data-contract.md](data-contract.md)

## A4 Pipeline

Each stage has one job, takes defined inputs and returns defined outputs. Stages 1 to 5 produce the **ObjectCard**. Stages 6 and 7 turn it into **RenderParams**. Stages 8 to 10 turn those into the body, its sound and its touch.

### A4.1 Stage 1: Find the object

- **Input:** a name or RA/Dec.
- **Process:**
  1. Resolve names (SIMBAD or SBDB, order to be decided, Q-05) to RA/Dec.
  2. For moving objects, get position at each frame time from Horizons, and neighbours from SkyBoT.
  3. Convert sky position to pixel position in each frame using the frame's WCS.
- **Output:** list of `(frame_id, x, y, time)`.
- **Status:** To build.

### A4.2 Stage 2: Measure brightness and spectrum

- **Input:** pixel positions and frame cutouts.
- **Process:**
  1. Sum flux in a small aperture, subtract local background.
  2. Drop pixels with bad flags.
  3. Use the variance layer for error bars.
  4. Look up each frame's wavelength at the object's pixel from the wavelength map.
- **Output:** a spectrum `[(wavelength_um, flux, error)]` and a light curve `[(time, flux)]`.
- **Status:** To build.

### A4.3 Stage 3: Classify and pick a type

- **Input:** spectrum, Gaia colours (if known), catalogue match (SBDB, SIMBAD).
- **Process:**
  1. Pick the `ObjectType` with the type-selection rules in rendering doc §3.3: SBDB comet → `comet`; SBDB asteroid → `asteroid_shape` if a DAMIT or NASA model exists, otherwise `asteroid_procedural`; SIMBAD type → `brown_dwarf`, `brown_dwarf_binary`, `star_mira`, `star_ttauri` or `star`; anything else → `candidate`.
  2. Match the spectrum against reference types for the class label: asteroid classes, brown dwarf types, comet gas features (water 2.7 micron, CO2 4.25, CO 4.67).
  3. `planet_rocky`, `planet_water`, `gas_giant`, `nebula` and `nova` do not come from SPHEREx detections. They come from the Exoplanet Archive or user sliders (D-04).
- **Output:** `type` (one of the D-04 union below), plus a class label (`spectral_class`) with a confidence.

  | Source of the type | `ObjectType` values |
  |---|---|
  | Rendering doc | `asteroid_shape`, `asteroid_procedural`, `comet`, `brown_dwarf`, `brown_dwarf_binary`, `star_mira`, `star_ttauri`, `star`, `candidate` |
  | This doc | `planet_rocky`, `planet_water`, `gas_giant`, `nebula`, `nova` |

  The old `dwarf` kind maps to `brown_dwarf`. The old `asteroid` kind maps to `asteroid_shape` or `asteroid_procedural`.
- **Status:** To build.

### A4.4 Stage 4: Check for a saved asset

```text
asset = store.get(object_id)
if asset exists            -> status = "saved"      -> load its ObjectCard
else if type is known      -> status = "generated"  -> build the ObjectCard from catalogues + spectrum
else                       -> status = "sketch"     -> build the ObjectCard from SPHEREx only
save the new card to the store
```

A sketch from SPHEREx only is often a `candidate`, which gets no 3D body (rendering doc §7.6).

This is the lookup flow shown in the Surface Lab "Lookup" card of the mock-up.

### A4.5 Stage 5: ObjectCard

The backend builds the **ObjectCard**: every known value for the object, each as a tagged value with its source (rendering doc §3.1, §3.2). Missing values are `null`, never a guess.

- **Endpoint:** `GET /v1/objects/{id}/card`.
- **Schema:** [section 5](data-contract.md#a5-data-contract).

### A4.6 Stage 6: Physics layer

Pure functions that turn measured values into `derived` values, each with its stated formula ([section 7](physics.md#a7-physics-layer)). The backend fills them into the card. In the browser the same functions rerun on every slider change against the `overrides` ([section 5.3](data-contract.md#a53-overrides)). The result is never written back to the card as truth.

### A4.7 Stage 7: RenderParams

The backend turns the ObjectCard into **RenderParams** with deterministic rules (rendering doc §3.4, §6.2). The frontend renders RenderParams only. RenderParams lists the layers (each with a tag), texture URLs, lighting, view modes, the haptic profile, the alt text and the layers refused for `missing` data.

- **Endpoint:** `GET /v1/objects/{id}/render-params`.
- **Status:** To build.

### A4.8 Stages 8 to 10: Generators

| Stage | Output | Detail |
|---|---|---|
| 8 Build the look | colour, relief, clouds, storms | Rendering-doc types: maps baked on the backend. Other types: browser shaders. See [section 6](generators.md#a6-generators). Optional Gemini layer on top. |
| 9 Build the shape | geometry | DAMIT or NASA mesh for `asteroid_shape`. Otherwise a sphere or ellipsoid, or a point cloud. |
| 10 Make the sound and touch | audio, haptics | Data sweep (spectrum to pitch), imagined drive, and haptics with paired audio (sections [8](sound-voice.md#a8-sound-and-voice) and [9](haptics.md#a9-haptics)). |
