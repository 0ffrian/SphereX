# Pipeline

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A4–A4.8 · **Implements:** D-04, D-16, D-19, D-31 · **Read with:** [data-contract.md](data-contract.md)

## A4 Pipeline

Each stage has one job, takes defined inputs and returns defined outputs. Stages 1 to 5 produce the **ObjectCard**. Stages 6 and 7 turn it into **RenderParams**. Stages 8 to 10 turn those into the body, its sound and its touch.

- **Endpoints:** every endpoint is keyed by one object id, returned by `resolve` (D-16). Responses served from the cache carry `cached_at` (D-25).
- **External calls:** every call to an external service goes through the backend's read-through disk cache (D-25).
- **Owners** of each stage: D-17.

### A4.1 Stage 1: Find the object

- **Input:** a name or RA/Dec.
- **Process:**
  1. Resolve names to RA/Dec (D-19). Names that look like small bodies (numbered asteroids such as `433 Eros`, provisional designations such as `2024 AB`, comets such as `C/…`, interstellar objects such as `3I/ATLAS`) go to SBDB first. Everything else goes to SIMBAD first. On a miss, try the other one. RA/Dec input skips name resolution.
  2. For moving objects, get position at each frame time from Horizons, and neighbours from SkyBoT.
  3. Convert sky position to pixel position in each frame using the frame's WCS.
  - Stars with a catalogue proper motion are propagated linearly from J2000 to each frame time (`derived`; Barnard's Star moves about 269″, 44 px, by 2026). `moving` means a solar-system body only (Q-22). Frames of moving objects are refused in M1 (Q-21).
  - One time per frame (the SIA exposure midpoint, UTC) drives the position, the cutout centre, `x`/`y` and `time`.
- **Output:** list of `(frame_id, x, y, time)`.
- **Endpoints (D-16):**
  - `GET /v1/resolve?q=<name or ra,dec>` returns `{ id, ra, dec, moving }`.
  - `GET /v1/objects/{id}/frames` returns `[{ frame_id, time, wavelength_um, x, y, cutout_url }]`. The flipbook plays this list in order; there is no separate flipbook endpoint.
  - `GET /v1/objects/{id}/cutouts/{frame_id}.png` returns the cutout, stretched to PNG by the server. The frames response states the stretch used.
  - Contract details for M1 (issue #1; full list in [backend/README.md](../../backend/README.md#endpoints-d-16)):
    - Times are ISO-8601 UTC with a trailing `Z`.
    - `x`, `y` are 0-based pixels of the PNG as served (top-left origin, y down, integer = pixel centre). The PNG is the FITS array flipped vertically.
    - `north_up` is `false` (native orientation). Optional `north_angle_deg` and `mirrored` let the UI rotate. Optional per-frame `ra`, `dec`.
    - A `provenance` map tags every field: cutout pixels, time, wavelength and flags are `measured`; `x`, `y`, the propagated `ra`/`dec` and the stretch are `derived`, each with its formula.
    - Frames that cannot be computed are left out and named in `missing` (`cutout:<id>`, `wavelength:<id>`, `outside_cutout:<id>`, `cutout_stretch:<id>`, `frames:truncated`, and `cutouts:deferred:<n>` when one request would download more than `SX_LIVE_CUTOUTS_PER_REQUEST` cutouts live).
- **Status:** Built for stars and coordinates (issue #1, `backend/app/core/find/`). Moving-object frame search: Q-21.

### A4.2 Stage 2: Measure brightness and spectrum

- **Input:** pixel positions and frame cutouts (Stage 1: `x_fits0`, `y_fits0`, `wavelength_um` per frame; cached cutouts with `IMAGE`, `FLAGS`, `VARIANCE`, `WCS-WAVE`).
- **Process** (forced photometry at the Stage 1 pixel, no re-centring; code in `backend/app/core/measure/`):
  1. Sum flux in a small aperture, subtract local background. Aperture radius 3 px with 10×10 sub-pixel weights; background = sigma-clipped mean (3σ, 5 iterations) of an annulus 6–9 px (clipped with the ordinary sample std when the annulus MAD is zero). These are method settings, reported verbatim in the response's `method` block.
  2. Drop pixels with bad flags. Bit numbers are read from the `MP_*` keywords of the `FLAGS` header; a header that does not define `OVERFLOW` and `SUR_ERROR` refuses the frame (`flags_header`), because saturation could not be detected, and other undefined reject names are listed in `method.reject_flags_absent`. Rejected: the IRSA tutorial list `TRANSIENT, OVERFLOW, SUR_ERROR, PHANTOM, REFERENCE, NONFUNC, DICHROIC, MISSING_DATA, HOT, COLD, FULLSAMPLE, PHANMISS, NONLINEAR, PERSIST, OUTLIER`. Checked 5 Nov 2026 against the Explanatory Supplement (SSDC-DP-017 v2.0, Table 16) and the cached QR2 headers; Table 16's newer flags `CROSSTALK`, `STREAK` and `SATELLITE_HALO` are not in the list (Q-31). `SOURCE` is kept everywhere (its mask covers whole regions around bright stars). A bad pixel within 1.5 px of the object refuses the point; a bad pixel further out is dropped and the point is `flagged`. The sum is never rescaled.
  3. Use the variance layer for error bars: `σ = 1e12·Ω·sqrt(Σ w²V + (Σw)²·var_B)`, `var_B = max(ΣV/N², s²/N)`.
  4. Look up each frame's wavelength at the object's pixel from the wavelength map. Stage 1's `wcs.wavelength_at` already does this (SIP cleared); Stage 2 reuses the frame's value.
  5. Convert to flux density: `F = 1e12·Ω·Σ w (I − B)` in **µJy** (`flux_unit: "uJy"`), with Ω the pixel solid angle at the object pixel from the TAN-SIP WCS (checked 5 Nov 2026: Ω/(1″)² agrees with the IMAGE header's `OMEGA_MEDIAN`, the median of IRSA's solid-angle pixel map in arcsec², to within 0.8 % on all 15 cached cutouts; the map's own spread `OMEGA_STDDEV` is about 0.5 %). No aperture correction (Q-23).
- **Refusals** (in `missing` as `<reason>:<frame_id>`, never a guessed value): `saturated` (core `OVERFLOW`, or a NaN core with `OVERFLOW`/`SUR_ERROR` in the aperture), `aperture_flags`, `aperture_edge`, `background`, `unit`, `extension`, `flags_header`, `pixel_area`, `measure`, `cutout_unreadable`, `cutout`. When every listed frame is refused as saturated, `missing` also holds `spectrum:saturated` (D-31). Stage 1's own `missing` entries are passed through.
- **Output:** a spectrum `[(wavelength_um, flux, error, flagged)]` and a light curve `[(time, flux, error)]`, built from the same measurements. Optional per-point fields: `bandwidth_um`, `dropped_flags`, `dropped_weight_fraction`, `flag_reasons` (incl. `no_proper_motion`); light-curve points carry `wavelength_um` and `flagged`, because each SPHEREx frame is a different band (Q-24).
- **Endpoint:** `GET /v1/objects/{id}/spectrum` returns both, tagged `measured` (D-16), with a `provenance` map (flux and error formulas) and `cached_at`. Stage 2 reads only cutouts already in the cache (one read each) and never downloads; an uncached cutout is refused as `cutout:<frame_id>`. The result is cached as `derived.spectrum`, keyed by `DERIVATION_VERSION`, the measure version, the method settings, Stage 1's `missing`, every frame record and every cutout's SHA-256; it is stored, and served from the cache, only while the frame list is complete.
- **Status:** Built (issue #2). On the recorded fixtures, Epsilon Indi B and WISE 0855 give measured points; Barnard's Star, RW Aur and R Dra are refused as saturated in every recorded frame (D-31). On the full offline cache (6 Nov 2026) the counts are: Barnard's Star 0 points (239 `saturated`, 1 `aperture_flags`); eps Ind B 297 points (28 `aperture_flags`); WISE 0855 237 points (19 `aperture_flags`); RW Aur 15 points at 0.74–1.09 µm (200 `saturated`, 7 `aperture_flags`, 2 `aperture_edge`); R Dra 0 points (530 `saturated`, 6 `aperture_edge`, 1 Stage 1 `outside_cutout`). `spectrum:saturated` is therefore absent for Barnard's Star and R Dra there; the UI states why there is no spectrum from the grouped counts, not from that code (issue #24). The demo objects (D-31) on the same cache: SIMP 0136 236 points (13 `aperture_flags`); TWA 27 377 points (43 `aperture_flags`, 1 `saturated`); IRAS 04302+2247 197 points, every one flagged `no_proper_motion` (13 `aperture_flags`, 1 `aperture_edge`, 1 `saturated`). Each of those two `saturated` refusals is a dead core pixel (NaN with `NONFUNC` and `OVERFLOW`), not a saturated source.

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
- **Status:** Built (issue #5, `backend/app/core/classify/`). The class label is taken from the catalogue only (SIMBAD `sp_type`, SBDB `spec_B` then `spec_T`); its confidence is `catalogue` or `none`, and spectrum matching against reference types (step 2) is not built (Q-55). Exoplanet types are refused while R12 #12 has no thresholds: the object falls through to `candidate` with `type:exoplanet_thresholds` in `missing` (Q-56).

### A4.4 Stage 4: Check for a saved asset

```text
asset = store.get(object_id)
if asset exists            -> status = "saved"      -> load its ObjectCard
else if type is known      -> status = "generated"  -> build the ObjectCard from catalogues + spectrum
else                       -> status = "sketch"     -> build the ObjectCard from SPHEREx only
save the new card to the store
```

A sketch from SPHEREx only is often a `candidate`, which gets no 3D body (rendering doc §7.6).

What a saved asset holds: [section 5.4](data-contract.md#a54-asset-store) (D-22).

This is the lookup flow shown in the Surface Lab "Lookup" card of the mock-up.

**Status:** Built (issue #5, `backend/app/core/card/assets.py`). Pre-baked assets are read from `backend/assets/<type>/<id>.json` (A5.4; the id is percent-encoded). Generated assets are saved as `derived.asset` cache entries keyed by id, data release, `ASSET_VERSION` and the stage 7 `GENERATOR_VERSION` (which holds the baker's rules version), so a rule or release change never serves a stale asset, and only when their inputs are final (a spectrum from a complete frame list, and a catalogue match or typed coordinates), so a truncated search is never frozen into a saved asset. A saved asset is returned without re-running stages 3 and 7. A saved or pre-baked asset whose card id or params id is not the requested id, whose card and params disagree on `type`, or that fails the schema check is ignored with a warning, and the asset is built from the catalogues instead of returning an error. Where this differs from A5.4 (generated assets in IndexedDB) is Q-57. The status is sent as the `X-SX-Asset-Status` response header (Q-39).

### A4.5 Stage 5: ObjectCard

The backend builds the **ObjectCard**: every known value for the object, each as a tagged value with its source (rendering doc §3.1, §3.2). Missing values are `null`, never a guess.

- **Endpoint:** `GET /v1/objects/{id}/card` (D-16).
- **Schema:** [section 5](data-contract.md#a5-data-contract).
- **Status:** Built (issue #5, `backend/app/core/card/build.py`). Only the fields the object's type uses (R7) are written; a field with no source is `value: null` with the reason in `source`. Every reply is validated with `jsonschema` against `shared/schemas/` (Q-40). `cached_at` (D-16) is the `X-SX-Cached-At` response header, because the R3.2 shape forbids extra fields (Q-39).

### A4.6 Stage 6: Physics layer

Pure functions that turn measured values into `derived` values, each with its stated formula ([section 7](physics.md#a7-physics-layer)). The backend fills them into the card. In the browser the same functions rerun on every slider change against the `overrides` ([section 5.3](data-contract.md#a53-overrides)). The result is never written back to the card as truth.

- **Status:** Built in the browser only (`frontend/src/physics/`, issue #13). The backend half is not built (Q-60).

### A4.7 Stage 7: RenderParams

The backend turns the ObjectCard into **RenderParams** with deterministic rules (rendering doc §3.4, §6.2). The frontend renders RenderParams only. RenderParams lists the layers (each with a tag), texture URLs, lighting, view modes, the haptic profile, the alt text and the layers refused for `missing` data.

- **Endpoint:** `GET /v1/objects/{id}/render-params` (D-16).
- **Status:** Built (issue #5, `backend/app/core/render/card_to_params.py`). Seed = first 4 bytes of SHA-256(`id` + newline + `generator_version`) (Q-35). Texture URLs follow R6.7 with the Q-47 size directory (`2048x1024`); the endpoint does not bake or serve the textures yet. `candidate` gets a RenderParams with no layers and `mesh` in `missing` (Q-33). Refusals from earlier stages (`catalogue`, `spectrum`, `type:exoplanet_thresholds`) are appended to `missing`.

### A4.8 Stages 8 to 10: Generators

| Stage | Output | Detail |
|---|---|---|
| 8 Build the look | colour, relief, clouds, storms | Rendering-doc types: maps baked on the backend. Other types: browser shaders. See [section 6](generators.md#a6-generators). Optional Gemini layer on top. |
| 9 Build the shape | geometry | DAMIT or NASA mesh for `asteroid_shape`. Otherwise a sphere or ellipsoid, or a point cloud. |
| 10 Make the sound and touch | audio, haptics | Data sweep (spectrum to pitch), imagined drive, and haptics with paired audio (sections [8](sound-voice.md#a8-sound-and-voice) and [9](haptics.md#a9-haptics)). |
