# Pipeline

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A4–A4.9 · **Implements:** D-04, D-16, D-19, D-31 · **Read with:** [data-contract.md](data-contract.md)

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

### A4.9 Overlays, flag mask and combine

The P1 overlays of A1.1 (Gaia and WISE markers, contamination flags, field of view, add and subtract). Built in issue #12 (`backend/app/core/find/overlays.py`, `flagmask.py`, `combine.py`; routes in `backend/app/api/overlays.py`). The endpoints are not yet in D-16 (Q-50). The reply shapes are hand-typed in `backend/app/api/models.py` and `frontend/src/app/api/types.ts`, not generated from `shared/schemas/` (D-18).

- **`GET /v1/objects/{id}/overlays`** returns `{ id, data_release, cached_at, catalogs, aperture, flag_groups, frames, missing, provenance }`:
  - `catalogs`: Gaia then WISE, each `{ catalog, available, table, epoch, mag_band, mag_limit, sources: [{ id, ra, dec, mag, pmra_mas_yr, pmdec_mas_yr }] }`. Gaia: `gaia_dr3_source` (IRSA TAP first, then ESA), band `G`, `mag_limit` 20 (Q-52), epoch `J2016.0` ([A3.2](data-sources.md#a32-gaia-dr3)). WISE: CatWISE2020 `catwise_2020`, band `W1`, no `mag_limit`, epoch of MJD 57170 (Q-51, [A3.3](data-sources.md#a33-wise--neowise)).
  - One cone per catalogue per object, centred on the SIA search position. Radius = half the cutout diagonal + the largest offset of the object between the search position and any frame time + 30″ margin (an assumption, for field-star motion), rounded up to a whole arcsecond.
  - `aperture`: `{ radius_px, annulus_inner_px, annulus_outer_px }`, the Stage 2 method radii ([A4.2](#a42-stage-2-measure-brightness-and-spectrum)).
  - `frames[]`: `{ frame_id, flags_url, markers, contamination, footprint, cutout_box }`.
    - `markers`: `{ catalog, id, x, y }`. Each catalogue position is propagated linearly from its epoch to the frame time, then placed with the cutout's WCS and the same PNG flip as the frames reply `x`, `y` ([A4.1](#a41-stage-1-find-the-object)). Only sources inside the cutout are listed.
    - `contamination`: `{ catalog, id, mag, zone, sep_px }`, the catalogue sources inside the Stage 2 aperture (`zone: "aperture"`) or annulus (`"annulus"`), sorted by `sep_px`. The nearest source of each catalogue within 2 px of the object is taken as the target itself: it stays a marker but is left out of this list (Q-53).
    - `footprint`: the SIA `s_region` polygon `[[ra, dec], …]` (closing vertex removed), or `null`. `cutout_box`: the four sky corners of the cutout, in PNG order top-left, top-right, bottom-right, bottom-left.
  - `flag_groups`: `{ group, rgba, names }` for `saturation`, `bad_pixel`, `artefact` and `source`, in that order, coloured from the Okabe-Ito palette at alpha 160.
  - Every RA in the reply is in [0, 360).
  - `missing` holds overlay codes only (frame refusals stay in `/frames`): `overlay:<cat>` (cannot be served, or a moving object, as for frames: Q-21), `overlay:<cat>:pending`, `overlay:<cat>:truncated` (5000-row cap), `cutout:<id>` (cutout not cached; only cached cutouts are read, as in Stage 2), `footprint:<id>`, `flags_mask:<id>`.
  - `provenance`: `catalog_positions`, `catalog_mags`, `footprint` and `flags_mask` are `measured`. `markers`, `contamination` and `cutout_box` are `derived`, each with its formula. `flag_colours` is `artistic` (a display choice).
- **`GET /v1/objects/{id}/flags/{frame_id}.png`** returns an RGBA PNG with one pixel per cutout pixel, the same size and flip as the cutout PNG. Each pixel takes the colour of the first group whose FLAGS bit is set; bit numbers come from the `MP_*` header keywords, never assumed (Q-31). Pixels with no grouped bit are transparent. A cutout without a FLAGS extension with `MP_*` names answers **404 `flags_unavailable`**; that is permanent, not a retryable 503, and the overlays reply lists the frame as `flags_mask:<id>`.
- **`GET /v1/objects/{id}/combine.png?op=add|sub&a=<frame_id>&b=<frame_id>`** returns A + B or A − B in MJy/sr on frame A's grid. B is resampled onto A by bilinear interpolation through both WCSs; a pixel outside B, or next to a non-finite B pixel, is NaN. `add` uses the frames' asinh stretch; `sub` uses a symmetric asinh stretch with 0 at mid-grey. Both cutouts must have `BUNIT` MJy/sr, and the result needs a finite pixel; otherwise it answers 400 `bad_request`. Metadata is in the **`X-SX-Combine`** response header, compact JSON: `{ op, a, b, wavelength_a_um, wavelength_b_um, unit, stretch, tag: "derived", formula }`, exposed to the browser through CORS. Each SPHEREx frame samples a different wavelength, so A ± B mixes two bands; the header states both (Q-54).
- **Errors** shared by the routes: 404 `not_found` (unknown object id), 404 `frame_not_found`, 503 `cutout_unavailable`. Both PNGs carry `Cache-Control: public, max-age=86400` (Q-50).
- **Fetching** (`OverlayService`): the Gaia and CatWISE cones run in parallel. One `/overlays` request waits at most `overlay_wait_s` = 75 s for them (an assumption, below the frontend's 90 s API timeout). A cone still running after that is reported as `overlay:<cat>:pending` and keeps filling the cache in the background; a later request joins the running fetch instead of starting another. A cone that failed live is remembered for `catalog_failure_ttl_s` (60 s) and reported as `overlay:<cat>` without a new call. Each TAP reply must be CSV with exactly the requested columns, and is parsed row by row before it is cached, so a VOTable error or one unparsable number is a failed call, never a cached value. A complete reply is kept in an in-process memo, not in the disk cache. The pre-fetch script (`backend/scripts/prefetch.py`, D-25) fetches one Gaia and one CatWISE2020 cone per fixed target (`--overlays-only` skips the cutouts); a failed cone is reported but does not make the target incomplete.
- **UI** (`frontend/src/app/flipbook/overlays/`, `skyToggleOverlay` and `skyLoadOverlays` in `frontend/src/state/store.ts`): four toggles (Gaia stars, WISE sources, Flagged pixels, Field of view), all off after every search. The overlays load lazily on the first switch-on, and again after an error. A catalogue with `overlay:<cat>:pending` keeps its toggle enabled and shows a "Try again" button that reloads the overlays; switching it back on reloads too. The previous overlays reply stays drawn while a reload runs, and after a failed reload (the error box offers a retry). A catalogue that is not available is disabled with its reason. The combine panel defaults to frame A = the current frame and frame B = the previous one (the next one on the first frame), and does not combine a frame with itself.
- **Status:** Built (issue #12, PR #32).
