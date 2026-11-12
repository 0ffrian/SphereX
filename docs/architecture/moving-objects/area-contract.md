# Area search: Discovery endpoints, cache and gated checks

> **Part of:** Architecture spec ([index](../README.md)) · **Sections:** A17.6 to A17.13 (A17 to A17.5 in [area-backend.md](area-backend.md)) · **Implements:** [Q-146](../../decisions/moving-objects.md), [Q-203](../../decisions/moving-objects.md), D-16, D-18, D-25 ([contract](../../decisions/contract.md), [data-sources](../../decisions/data-sources.md)) · **Read with:** [area-backend.md](area-backend.md) (A17 to A17.5), [area-search.md](area-search.md) (A16), [area-ui.md](area-ui.md) (A18), [endpoints.md](../endpoints.md) (A4.11), [refusals.md](../refusals.md) (A4.12)

The second half of the Discovery backend ([A17](area-backend.md#a17-discovery-backend)): injection, completeness and the control (A17.6, gated), the export (A17.7), the `/v1/areas` routes, schemas and fixtures, cache and determinism, the compute budget, and two of the gated extras of [Q-203](../../decisions/moving-objects.md) (A17.12, A17.13). Status, owner and starting values: the [area-backend.md](area-backend.md) intro.

### A17.6 Injection, completeness and control

**Gated extras D4 and D5 (Q-203).** Everything planted here lives in memory and in the `checks` entry only. A planted source never enters `dots`, `tracks`, `known`, `steps` or the real ECSV, and the cutouts in the cache are never altered, so `/stamps` never shows one.

**Planting (`inject.py`).**

1. **Source.** A point source added to every frame's recorded cutout along a straight sky path: a rate (deg/day), a direction and a start position, with its in-visit motion computed by the same relation as A17.4 (`v_in = v_AB − w·u`, `u` from a chosen distance **[verify]**) so a planted mover looks like a real one. The position in each frame follows from the frame time.
2. **Brightness.** Set by a target S/N in the Stage 2 aperture ([A4.2](../pipeline.md#a42-stage-2-measure-brightness-and-spectrum)) against the local noise from `VARIANCE`, so no assumed survey depth is needed. The PSF is the SPHEREx PSF cube if D1 can read it, else a Gaussian whose width is measured on isolated stars of the area **[verify]**.
3. **Placement.** Random inside the coverage by a seeded draw, at least 30 px from another planted source in the same run. Landing on or near a star is allowed and recorded (`near_star`), because crowding is part of what completeness measures.
4. **Recovery.** The run goes through A17.2, A17.3 and A17.4 exactly as the real data does (no Known check). A planted source is **recovered** when a `track` exists whose dots lie within `r_match` of the planted path in at least two thirds of its frames. A re-run may be limited to patches around the planted sources if a spot check shows the same result as the full run.

**Test mover.** One planted mover at a fixed seed, S/N near the detection limit (start 8) and a mid rate (start 0.3 deg/day), run through A17.2 to A17.5. It is stored as `test_mover{ra, dec, rate_deg_day, pa_deg, snr, dots[], recovered, reason}` and shown by A18.11. Its Known check is expected to find nothing; that is the point.

**Completeness grid.** S/N bins 5 to 8, 8 to 12, 12 to 20 and above 20, by rate bins 0.02 to 0.1, 0.1 to 0.3, 0.3 to 0.6 and 0.6 to 1.2 deg/day (the top is the trailing limit, A16.6). Start 50 planted sources per cell (800 in all), 10 per run. Each cell stores `n`, `k` (recovered), `frac` and the Wilson 95 % interval. **No single figure** (such as a mean over cells) is computed or served.

**Shuffled-time control (`control.py`).** The same search on the same pixels with the frame mid-times permuted at random among the frames of the area. A real mover no longer lies on a line in time, so any `track` found is chance alignment. 20 runs (start) with fixed seeds, through A17.3 and A17.4 only. Stored as `control{n_runs, tracks_per_run[], mean, max}`.

**Output (`checks`).** `{test_mover, completeness{snr_bins, rate_bins, cells[]}, control, linker, method.checks{seeds, n_per_cell, snr_bins, rate_bins, n_control_runs, psf, distance_model}, missing, provenance}`; tags `model_dependent` (planted sources, completeness) and `derived` (control), as A16.5.

**What it does not do.** The control tests chance alignment of dots, not glitch pairs that mimic motion (A17.13 looks at those). The grid is for this area and its frames; it says nothing about another square or the sky.

### A17.7 Export

- **ECSV** through the shared writer of [A19.9](track-contract.md#a199-export), which owns the base columns and the per-column tags in the metadata. One row per dot of each track or possible. A17.7 adds only `track_id`, `dot_id`, `status`, `verdict` and `match_designation`. Times are ISO-8601 UTC plus `mjd_utc` (UTC).
- **ADES:** phase 2 (no SPHEREx MPC observatory code, Q-145).
- **As built (P7, issue #108):** `backend/app/core/export/ecsv.py` (astropy 8.0.2) is the shared writer; it puts each column's tag in `meta.column_tags`. The area export keeps the A19.9 base columns an area dot has values for (`frame_id`, `detector`, `time_utc`, `mjd_utc`, `ra_deg`, `dec_deg`, `x_px`, `y_px`, `wavelength_um`, `bandwidth_um`, `flux_ujy`, `flux_err_ujy`, `flagged`, `flags`) plus the five of A17.7; the others (`exptime_s`, the 3σ columns, `flag_reasons`, `contamination`, `refusal`) are left out and named in `meta.columns_not_applicable` ([Q-420](../../decisions/moving-objects.md)).

### A17.8 Endpoints

Payload shapes as built: `shared/schemas/area-*.schema.json`; gap choices in [Q-208](../../decisions/moving-objects.md) (Proposed).

Beyond D-16, which keys every endpoint on one object id; Q-146 (6) answered the `/v1/areas` routes and a D-16 note is pending. The endpoint register is [A4.11](../endpoints.md); refusal codes are also in [A4.12](../refusals.md).

| Endpoint | Returns |
|---|---|
| `GET /v1/areas` | Index: `[{area_id, ra, dec, width_deg, height_deg, data_release, n_frames, n_visits, computed_at, cached_at}]`, only areas prepared with the running code and settings (A17.10) |
| `GET /v1/areas/{area_id}` | The summary plus `frames[{frame_id, detector, visit, exposure, time, wavelength_min_um, wavelength_max_um, s_region}]`, `coverage[{visit, polygon}]`, `steps{n_dots, n_glitches, n_stars, n_fixed, n_static_one_visit, n_tracks, n_possible, n_found_blind, n_unexplained, n_unchecked}`, `method`, `missing`, `provenance` |
| `GET /v1/areas/{area_id}/known` | `[{designation, number, object_id, kind, v_mag, n_frames, n_visits, positions[{frame_id, time, ra, dec}], track_available}]`, positions tagged `model_dependent` |
| `GET /v1/areas/{area_id}/dots` | Per visit: `[{dot_id, frame_id, detector, exposure, time, x, y, ra, dec, flux_uJy, flux_err, snr, wavelength_um, bandwidth_um, flags[], label: glitch \| star \| fixed \| mover}]` |
| `GET /v1/areas/{area_id}/tracks` | Tracks and possibles (A17.4) with their dots, `match` and `verdict` (A17.5), `sed` (A17.13) and `linker` (`pairs` or `rate_grid`, A17.12) |
| `GET /v1/areas/{area_id}/checks` | The planted test mover, the completeness grid, the control and the linker used (A17.6); 404 `area_not_found` as the others; `missing: ["checks:not_run"]` when the area was prepared without the checks |
| `GET /v1/areas/{area_id}/stamps/{dot_id}.png` | A 15 × 15 px stamp from the cached cutout, stretched as `/cutouts/{frame_id}.png` is |
| `GET /v1/areas/{area_id}/export.ecsv` | The file of A17.7 |

- Every JSON reply carries `cached_at`, `computed_at`, `missing` and `provenance`. Times are ISO-8601 UTC with `Z`; every RA is in [0, 360).
- **`missing` codes:** `checks:not_run` (the area was prepared without D4 to D7; the Checks section is hidden, A18.11; it covers only the area-level checks in `/checks`, while D6 `sed` and D7 `linker` are reported per track in `/tracks`, [Q-208](../../decisions/moving-objects.md) (25)), `checks:d4_not_run` and `checks:d5_not_run` (only that ticket did not run: D4 drops the test mover and the grid, D5 the control; [Q-208](../../decisions/moving-objects.md) (12)), `rate_grid:visits` (fewer than 3 visits; pairs used, A17.12), `area:visits` (fewer than 2 visits; Discovery refused, A17.1), `frames:cone_maxrec:<n>`, `no_footprint:<frame_id>`, `cutout:<frame_id>`, `stars:<cat>:<visit>` (that visit's Gaia DR3 or CatWISE2020 cone failed, was not cached offline, or reached `STAR_LIST_MAX_ROWS`; the star step used the other catalogue, A17.3, [A19.6](track.md#a196-star-list-for-movers), Q-403 (5)), `skybot:<visit>` (that visit's SkyBoT cone failed; its tracks are `unchecked`, A17.5), `horizons:<designation>` (a candidate's Horizons call failed; the tracks it could match are `unchecked`, A17.5), `stamp:<dot_id>` (the stamp's cutout is not cached). A square outside every prepared area is `area:not_prepared`, decided in the frontend from the index; the wording lives in `refusals.ts`. The register of every code is [A4.12](../refusals.md).
- **Errors:** 404 `area_not_found` (unknown id or not prepared with the running code), 404 `dot_not_found`, 503 `stamp_unavailable` (cutout not cached).
- **As built (issue #108, P7, [Q-420](../../decisions/moving-objects.md)):** `backend/app/api/areas.py` serves the index, the summary, `/known`, `/dots`, `/tracks`, `/stamps/{dot_id}.png` and `/export.ecsv` from `derived.area` entries, byte for byte as stored (each reply is checked against its schema when stored; the index is built from the summaries and checked on every request). **`/checks` is not served:** D4 and D5 are cut by the Q-203 gate, and `summary.missing` carries `checks:not_run`. `rate_grid:visits` is in `/tracks.missing` for fewer than 3 visits; frame and star codes are in `/dots.missing`; `skybot:` and `horizons:` codes in `/known` and `/tracks`. A stamp is the 15 × 15 px crop of the stretched cutout around the rounded centroid (0 outside the cutout), read from the cache by the cutout key's digest.

### A17.9 Schemas and fixtures

Payload shapes as built: `shared/schemas/area-*.schema.json`; gap choices in [Q-208](../../decisions/moving-objects.md) (Proposed).

- `shared/schemas/area-index.schema.json`, `area-summary.schema.json`, `area-known.schema.json`, `area-dots.schema.json`, `area-tracks.schema.json`, `area-checks.schema.json` (gated, Q-203); generated code in `backend/app/contract/` and `frontend/src/contract/` (D-18). Owner Moon (D-17).
- `shared/fixtures/area/`: a synthetic area (2 visits × 4 exposures × 2 detectors; about 30 stars, 18 glitches; 4 movers: one `found_blind`, one `unexplained`, one `unchecked`, one `possible` with `one_visit`), plus a `checks` sample (a recovered test mover, a grid, a control of 0 in 20) and, for D7, a synthetic area of 4 visits in `shared/fixtures/area/multivisit/`, all with the Fixture badge and served by the dev fixture server with `X-SX-Fixture: synthetic` (Q-32). The frontend builds against it before the backend exists (D-29).

### A17.10 Cache, offline and determinism

- **Inputs** go through the read-through cache (D-25): SIA cones, cutouts, Gaia and CatWISE cones, SkyBoT cones, Horizons TLISTs and vectors.
- **Outputs** are `derived.area` entries in the same cache (as `derived.spectrum`, [A4.2](../pipeline.md#a42-stage-2-measure-brightness-and-spectrum)): `summary`, `known`, `dots`, `tracks`, `checks` (gated), `export`. Key: `derived.area` + data release + `area_id` + `params_hash`. `params_hash` covers `AREA_VERSION`, `MEASURE_VERSION`, every `method` setting and the sorted SHA-256 of every input body. The API serves the entry whose `params_hash` matches the running code and settings; an older entry is not listed in the index (the operator re-runs the script).
- **Offline:** the API only reads entries. Under `SX_OFFLINE=1` an absent area is 404 `area_not_found`.
- **As built (issue #108, [Q-420](../../decisions/moving-objects.md)):** the stages are `summary`, `known`, `dots`, `tracks`, `export` and an internal `cutouts` (each frame's cutout key digest and SHA-256, for the stamps), keyed `derived.area` + release + `{id, v, stage, p}`. A `head` entry (`{id, v, stage: head}`) is written last; it names the `params_hash` and the SHA-256 of the running `method.settings`, so the API serves only an area whose settings match, without re-reading the inputs. The API reads the D-25 cache first, then the committed pack `backend/assets/areas/` (`SX_AREA_PACK_DIR`, the same layout), which holds the recorded-fixture Eros area made by `scripts/area_discovery.py --recorded --steps all --pack assets/areas`; a test remakes it and compares every byte. `cached_at` and `computed_at` are the earliest and latest `fetched_at` of the inputs read after the dots step (star cones, SPHEREx vectors, SkyBoT, Horizons), not the wall clock, so the entries are byte-identical.
- **Determinism:** the same cache and settings give byte-identical entries (inputs sorted, fixed float formatting, ids as in A17.2 and A17.4). The checks of A17.6 draw from seeded generators (the seed list is in `method.checks`), so the same cache, settings and seeds still give the same bytes. Nothing else is random.
- **Fixtures for tests:** PR #53's Eros fixtures are 0.1° cutouts centred on Eros and do not cover an area. D1 records area cutouts with the pre-fetch script (P3 uses the recorded 0.1° Eros cutouts instead, `backend/tests/area_recorded.py`; [Q-402](../../decisions/moving-objects.md) (3)) (D-25, never hand-edited); the determinism test runs twice on a small synthetic area and compares bytes.

### A17.11 Compute budget

Estimates, **not measured**; D1 records the real times.

| Step | Event scale (1 to 3 areas, tens of frames each) | Note |
|---|---|---|
| Frame search | About 15 cones of 4 s per area | Grid of A17.1 |
| Downloads | Tens to a few hundred MB | Slowest step; IRSA at about 20 s per cutout (Q-111) |
| Dots | Seconds per frame (estimate); measured offline: about 4 000 dots per area frame, Stage 2 13 to 21 ms a dot, so about 25 min per Eros area on one worker ([Q-401](../../decisions/moving-objects.md)) | Measure workers (Q-112) can run it |
| Glitches, stars, join | Seconds | Few movers-to-be per area; exhaustive pairing is cheap |
| Star lists, SkyBoT, Horizons | One cone per catalogue and visit; one SkyBoT cone per visit; one TLIST per candidate | Horizons one request at a time |
| Serving | Reads cache entries | No compute in requests |
| Checks (gated extras) | Completeness: 800 planted sources in 80 runs of 10, each re-running dots on the area's frames (about 1 to 2 min a run unless patch re-detection is used); control: 20 runs of glitch and join only; rate grid and spectrum score: seconds | Offline only, on cached cutouts, so no downloads. Estimates, D4 to D7 record the real times |

### A17.12 Rate-grid linker (`rategrid.py`)

**Gated extra D7 (Q-203).** Used only for an area with 3 or more visits; with fewer, `rate_grid:visits` goes to `missing` and A17.4 runs alone. It works on the movers-to-be that A17.3 leaves, not on every dot, so it is cheap.

1. **Grid.** Sky-rate vectors `(v_E, v_N)` with `|v| ≤ rate_max`, step `dv = r_cluster / T_max`, where `T_max` is the longest span in the area (capped at 7 days **[verify]**; a longer span is split).
2. **Project.** For each grid point, move every mover-to-be to the reference time, `x_ref = x − v (t − t_ref)`.
3. **Cluster.** Group dots closer than `r_cluster = max(r_match, A_par)` in the projected plane (`A_par`: the parallax allowance of A17.4 **[verify]**). A cluster is kept when it holds dots from at least 3 distinct visits.
4. **Refine.** Fit a straight line in time to each kept cluster; keep it when the residual is below `rms_max` and the parallax-aware test of A17.4 passes for its visit pairs. A dot in two clusters goes to the cluster with the smaller residual.
5. **Output.** `track` entries as A17.4, with `linker: rate_grid` and 3 or more `visits`. They go through A17.5 unchanged.

**Why.** Pairing needs every pair of visits to pass on its own. A mover too faint to be seen in each visit, or seen in only some, can still gather enough dots across all of them. This is the approach of THOR (Moeyens et al. 2021, [arXiv:2105.01056](https://arxiv.org/abs/2105.01056)) and HelioLinC (Holman et al. 2018, [arXiv:1805.02638](https://arxiv.org/abs/1805.02638)).

**Test.** On a synthetic area of 4 visits with one faint mover that fails pairing in one visit pair: the rate grid links it and A17.4 alone does not. On 2 visits the rate grid does not run. A real area with 3 or more visits is added if Day 0 finds one (A16.6); until then no real result is shown for it.

### A17.13 Spectrum smoothness score (`sed.py`)

**Gated extra D6 (Q-203).** Each track's dots form `(λ, F, σ)` with `λ` from `wavelength_um` and `F` from `flux_uJy` (both `measured`, A17.2).

1. **Select** dots with `snr ≥ 3` (start). A track with fewer than 6 such dots, or dots from only one detector, is `too_few`.
2. **Fit** `ln F` against `ln λ` with a weighted polynomial of degree 2. The error on `ln F` is `σ/F` added in quadrature to a floor `σ_floor` (start 0.15 **[verify]**) for calibration and for Eros's rotation, which changes brightness between exposures.
3. **Score** `chi2_red` of the fit. `smooth` when `chi2_red ≤ 3` (start **[verify]**), else `rough`.
4. **Tune.** D6 sets the threshold so Eros is `smooth` and most chance chains found by the shuffled control (A17.6) are `rough`; if the two cannot be separated, the label is withheld (`sed: not_informative`) and the chip is not shown.
5. **Output.** `sed{label, chi2_red, n_dots, sigma_floor}` on each track; tag `derived`; the points stay `measured`.

**A flag, never a gate.** The label never removes or reorders a track in `tracks`, never changes its verdict, and says nothing about what the body is made of. It only tells the reader whether the points look like one smooth source.

