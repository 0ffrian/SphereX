# Area search: Discovery endpoints, cache and gated checks

> **Part of:** Architecture spec ([index](../README.md)) · **Sections:** A17.6 to A17.13 (A17 to A17.5 in [area-backend.md](area-backend.md)) · **Implements:** [Q-146](../../decisions/moving-objects.md), [Q-203](../../decisions/moving-objects.md), D-16, D-18, D-25 ([contract](../../decisions/contract.md), [data-sources](../../decisions/data-sources.md)) · **Read with:** [area-backend.md](area-backend.md) (A17 to A17.5), [area-search.md](area-search.md) (A16), [area-ui.md](area-ui.md) (A18), [endpoints.md](../endpoints.md) (A4.11), [refusals.md](../refusals.md) (A4.12)

The second half of the Discovery backend ([A17](area-backend.md#a17-discovery-backend)): injection, completeness and the control (A17.6, gated), the export (A17.7), the `/v1/areas` routes, schemas and fixtures, cache and determinism, the compute budget, the rate-grid linker, a gated extra of [Q-203](../../decisions/moving-objects.md) (A17.12), and the spectrum check (A17.13, Q-474). Status, owner and starting values: the [area-backend.md](area-backend.md) intro.

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

> **As built (issue #141, [Q-462](../../decisions/moving-objects.md), Q-463, Q-467):** live areas add three routes, served before the `/{area_id}` ones. `POST /v1/areas/live` takes `{ra, dec, width_deg, height_deg, start, visits?}`; with `start=false` it answers the plan (`shared/schemas/area-live-plan.schema.json`), with `start=true` it queues a job (202, `area-job.schema.json`); a stored area answers `done`, a queued or running one its job. `GET /v1/areas/live/{area_id}` answers the job (queued, running, done, failed with `error.code`); `DELETE` stops it (204). Error codes: `area:too_large`, `area:bad_box`, `area:no_visit_pair` (422); `queue_full` (429: at most 5 jobs wait behind the running one); `offline`, `upstream_unavailable` (503); `job_not_found` (404); job errors `area:frames_incomplete`, `area:no_cutouts`, `area:no_dots`, `cancelled`, `internal`. A done live area is served by the routes below like a prepared one; the index lists areas of every release present (Q-463).

> **As built (issue #156, [Q-470](../../decisions/moving-objects.md), Q-471):** scans and runs, in `backend/app/api/runs.py` (`core/area/scan.py`, `core/area/runs.py`, the scan job in `core/area/live_jobs.py`). `POST /v1/scans` takes `{ra, dec, width_deg, height_deg, kind, start}` (`kind` is `discovery` or `known`): `start=false` answers the plan, with no SIA call (`scan-plan.schema.json`: the snapped region, `cols`, `rows`, the squares in scan order (they always cover the region with overlap, so a 4° × 2° region is 3 × 2 squares) with `area_id` when a stored area has the same box, `estimate_s` for the rest); `start=true` queues the scan (202, `run.schema.json`). `GET /v1/runs` lists every run, newest first (`run-list.schema.json`). `GET /v1/runs/{run_id}` answers the full record with its events (`run.schema.json`; while live it also carries `queue_position` or `progress`). `POST /v1/runs/{run_id}/pause` and `/resume` answer the record (a paused scan leaves the worker; resume queues it again at the back; a pause while the last square runs is 409 `run_not_pausable`). `DELETE /v1/runs/{run_id}` stops the run (204). `GET /v1/runs/{run_id}/results` answers the finished squares' stored results with duplicates merged (`run-results.schema.json`). `POST /v1/areas/live` gains an optional `kind` (no default, unlike `POST /v1/scans`, whose `kind` defaults to `discovery`): a job started with it is recorded as a run of one square and its area-job reply carries `run_id`; without it, no run is recorded. A start for a box a scan is computing queues a job of its own behind the scan's square, never joining it. Error codes: `scan:too_large`, `area:bad_box` (422); `queue_full` (429, the same 5-job queue as live areas, also on resume); `offline` (503, when starting); `run_not_found` (404); `run_not_pausable`, `run_not_paused`, `run_finished` (409). Square errors in a run record: `area:no_visit_pair` (skipped), and the live job codes (failed). Every reply is checked against its schema before it is sent.

| Endpoint | Returns |
|---|---|
| `GET /v1/areas` | Index: `[{area_id, ra, dec, width_deg, height_deg, data_release, n_frames, n_visits, computed_at, cached_at}]`, only areas prepared with the running code and settings (A17.10) |
| `GET /v1/areas/{area_id}` | The summary plus `frames[{frame_id, detector, visit, exposure, time, wavelength_min_um, wavelength_max_um, s_region}]`, `coverage[{visit, polygon}]`, `steps{n_dots, n_glitches, n_stars, n_fixed, n_static_one_visit, n_tracks, n_possible, n_found_blind, n_unexplained, n_unchecked}`, `method`, `missing`, `provenance` |
| `GET /v1/areas/{area_id}/known` | `[{designation, number, object_id, kind, v_mag, n_frames, n_visits, positions[{frame_id, time, ra, dec}], track_available}]`, positions tagged `model_dependent` |
| `GET /v1/areas/{area_id}/dots` | Per visit: `[{dot_id, frame_id, detector, exposure, time, x, y, ra, dec, flux_uJy, flux_err, snr, wavelength_um, bandwidth_um, flags[], label: glitch \| star \| fixed \| mover}]` |
| `GET /v1/areas/{area_id}/tracks` | Tracks and possibles (A17.4) with their dots, `match` and `verdict` (A17.5), and `linker` (`pairs` or `rate_grid`, A17.12) |
| `GET /v1/areas/{area_id}/spectra` | The spectrum check per track (A17.13, Q-474): `verdict`, `heat_glow`, the colour pairs, the steadiness steps and the chart values; 404 `spectra_not_prepared` when the area has no stored check (proposed) |
| `GET /v1/areas/{area_id}/checks` | The planted test mover, the completeness grid, the control and the linker used (A17.6); 404 `area_not_found` as the others; `missing: ["checks:not_run"]` when the area was prepared without the checks |
| `GET /v1/areas/{area_id}/stamps/{dot_id}.png` | A 15 × 15 px stamp of the dot's cutout, stretched as `/cutouts/{frame_id}.png` is, made when the area is prepared and stored with it |
| `GET /v1/areas/{area_id}/export.ecsv` | The file of A17.7 |

- Every JSON reply carries `cached_at`, `computed_at`, `missing` and `provenance`. Times are ISO-8601 UTC with `Z`; every RA is in [0, 360).
- **`missing` codes:** `spectra:calibration_default` (fewer than 10 star pairs in a visit and detector, so the spectrum check used the default floor, A17.13); `checks:not_run` (the area was prepared without D4 to D7; the Checks section is hidden, A18.11; it covers only the area-level checks in `/checks`, while D6 `sed` and D7 `linker` are reported per track in `/tracks`, [Q-208](../../decisions/moving-objects.md) (25)), `checks:d4_not_run` and `checks:d5_not_run` (only that ticket did not run: D4 drops the test mover and the grid, D5 the control; [Q-208](../../decisions/moving-objects.md) (12)), `rate_grid:visits` (fewer than 3 visits; pairs used, A17.12), `area:visits` (fewer than 2 visits; Discovery refused, A17.1), `frames:cone_maxrec:<n>`, `no_footprint:<frame_id>`, `cutout:<frame_id>`, `stars:<cat>:<visit>` (that visit's Gaia DR3 or CatWISE2020 cone failed, was not cached offline, or reached `STAR_LIST_MAX_ROWS`; the star step used the other catalogue, A17.3, [A19.6](track.md#a196-star-list-for-movers), Q-403 (5)), `skybot:<visit>` (that visit's SkyBoT cone failed; its tracks are `unchecked`, A17.5), `horizons:<designation>` (a candidate's Horizons call failed; the tracks it could match are `unchecked`, A17.5), `stamp:<dot_id>` (the stamp's cutout is not cached). A square outside every prepared area is `area:not_prepared`, decided in the frontend from the index; the wording lives in `refusals.ts`. The register of every code is [A4.12](../refusals.md).
- **Errors:** 404 `area_not_found` (unknown id or not prepared with the running code), 404 `dot_not_found`, 404 `spectra_not_prepared` (proposed, A17.13), 503 `stamp_unavailable` (the dot's cutout was absent or unreadable when the area was prepared, so it has no stored stamp).
- **As built (issue #108, P7, [Q-420](../../decisions/moving-objects.md)):** `backend/app/api/areas.py` serves the index, the summary, `/known`, `/dots`, `/tracks`, `/stamps/{dot_id}.png` and `/export.ecsv` from `derived.area` entries, byte for byte as stored (each reply is checked against its schema when stored; the index is built from the summaries and checked on every request). **`/checks` is not served:** D4 and D5 are cut by the Q-203 gate, and `summary.missing` carries `checks:not_run`. `rate_grid:visits` is in `/tracks.missing` for fewer than 3 visits; frame and star codes are in `/dots.missing`; `skybot:` and `horizons:` codes in `/known` and `/tracks`. A stamp is the 15 × 15 px crop of the stretched cutout around the rounded centroid (0 outside the cutout), made at prepare time and read from the stored `stamps` stage (raw pixels, encoded as PNG when served), so the committed pack serves stamps under `SX_OFFLINE=1` on a machine without the cutouts (PR #110 review).

### A17.9 Schemas and fixtures

Payload shapes as built: `shared/schemas/area-*.schema.json`; gap choices in [Q-208](../../decisions/moving-objects.md) (Proposed).

- `shared/schemas/area-index.schema.json`, `area-summary.schema.json`, `area-known.schema.json`, `area-dots.schema.json`, `area-tracks.schema.json`, `area-checks.schema.json` (gated, Q-203); generated code in `backend/app/contract/` and `frontend/src/contract/` (D-18). Owner Moon (D-17).
- `shared/fixtures/area/`: a synthetic area (2 visits × 4 exposures × 2 detectors; about 30 stars, 18 glitches; 4 movers: one `found_blind`, one `unexplained`, one `unchecked`, one `possible` with `one_visit`), plus a `checks` sample (a recovered test mover, a grid, a control of 0 in 20) and, for D7, a synthetic area of 4 visits in `shared/fixtures/area/multivisit/`, all with the Fixture badge and served by the dev fixture server with `X-SX-Fixture: synthetic` (Q-32). The frontend builds against it before the backend exists (D-29).

### A17.10 Cache, offline and determinism

- **Inputs** go through the read-through cache (D-25): SIA cones, cutouts, Gaia and CatWISE cones, SkyBoT cones, Horizons TLISTs and vectors.
- **Outputs** are `derived.area` entries in the same cache (as `derived.spectrum`, [A4.2](../pipeline.md#a42-stage-2-measure-brightness-and-spectrum)): `summary`, `known`, `dots`, `tracks`, `checks` (gated), `export`. Key: `derived.area` + data release + `area_id` + `params_hash`. `params_hash` covers `AREA_VERSION`, `MEASURE_VERSION`, every `method` setting and the sorted SHA-256 of every input body. The API serves the entry whose `params_hash` matches the running code and settings; an older entry is not listed in the index (the operator re-runs the script).
- **Offline:** the API only reads entries. Under `SX_OFFLINE=1` an absent area is 404 `area_not_found`.
- **As built (issue #108, [Q-420](../../decisions/moving-objects.md)):** the stages are `summary`, `known`, `dots`, `tracks`, `export` and an internal `stamps` (each dot's 15 × 15 px raw uint8 pixels, base64; the API encodes the PNG when serving, because compressed PNG bytes depend on the zlib build), keyed `derived.area` + release + `{id, v, stage, p}`. A `head` entry (`{id, v, stage: head}`) is written last; it names the `params_hash` and the SHA-256 of the `method.settings` the run used (not the defaults), so the API serves only an area whose settings match the running code, without re-reading the inputs. The API reads the D-25 cache first, then the committed pack `backend/assets/areas/` (`SX_AREA_PACK_DIR`, the same layout), which holds the recorded-fixture Eros area made by `scripts/area_discovery.py --recorded --steps all --pack assets/areas`; a test remakes it and compares every byte (bodies and metas), on any platform. `cached_at` and `computed_at` are the earliest and latest `fetched_at` of the inputs read after the dots step (star cones, SPHEREx vectors, SkyBoT, Horizons), or, when none was read, of the frame cones; never the wall clock, so the entries are byte-identical.
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

### A17.13 Spectrum check (`spectrum.py`)

**Proposed ([Q-474](../../decisions/moving-objects.md), [Q-475](../../decisions/moving-objects.md), 13 Nov 2026).** Replaces the D6 smoothness score (cut by the Q-203 gate, never built). UI: [A18.7](area-ui.md#a187-result-card) and the approved mock-up (linked from Q-474). Owner: Moon (`shared/`, D-17); the module is one ticket with its UI.

**The question.** Is the light of this mover sunlight reflected off a solid body? Two physical rules answer it from data SPHEREx already gives us:

1. **Colour.** Reflected sunlight has the Sun's colour times the body's reflectance, which changes slowly and within known bounds. A warm body adds heat glow, and heat glow only makes the long wavelengths brighter.
2. **Steadiness.** A body larger than about 200 m spins no faster than once per 2.2 h (the spin barrier, Pravec and Harris 2000), so its brightness can change only a little between exposures 2 minutes apart.

**Why SPHEREx can do this.** Bands 1 and 4, 2 and 5, and 3 and 6 see the same sky at the same moment, split by a dichroic at 2.42 µm ([arXiv:2511.02985](https://arxiv.org/abs/2511.02985)). Every exposure of a mover therefore gives a short-arm (below 2.42 µm) and a long-arm (2.42 µm and above) brightness at the same instant. Their ratio does not depend on spin, distance or phase angle, which change both together. A ratio across visits does: Eros was 2.4 times fainter at 0.8 µm a day later than at 1.0 µm, where the Sun is about as bright, most likely from rotation, so **colours are only ever taken within one exposure.**

**What it never does.** It never removes, reorders or re-labels a track, and never changes its `verdict` (A17.5). It says whether the light behaves like sunlight off a rock, not what the body is made of.

#### Inputs

All stored; nothing is fetched. From the area's `derived.area` entries (A17.10): `tracks` (dot ids per tracklet, `u_inv_au`), `dots` (every dot with `flux_uJy`, `flux_err`, `snr`, `wavelength_um`, `detector`, `exposure`, `time`, `label`, `ra`, `dec`) and the summary (`frames`, centre). Plus one committed asset, the solar spectrum table (below).

#### Steps

1. **Points.** Every dot of the track. A dot with `snr ≥ snr_min` (start 3) is a **point**; below it, it is used only as a limit in step 3. The arm is `short` for `wavelength_um < 2.42`, else `long` (the split, not a band edge, so no band table is hard-coded).
2. **Calibration floor, measured per area.** For each visit and detector: stars (`label: star`, `snr ≥ 30`) matched within 4″ between consecutive exposures; `σ_sys = 1.4826 · MAD(F_{i+1}/F_i − 1)`. With fewer than 10 star pairs, `σ_sys = 0.06` and `spectra:calibration_default` goes to `missing`. (Recorded Eros area: median steps 2.7 % to 6.4 %.)
3. **Colour pairs.** For each exposure in which the track has a short-arm and a long-arm dot:
   `ρ = (F_L / F_S) / (F☉(λ_L) / F☉(λ_S))`, the colour divided by the Sun's colour at the same two wavelengths. `σ_ρ` from both flux errors and `√2·σ_sys`, in quadrature. When the short dot is below `snr_min` and the long one has `snr ≥ 5`, the pair is a **lower limit** `ρ > F_L / (max(F_S, 0) + 2σ_S) / (F☉ ratio)`; the reverse gives an **upper limit**.
4. **Distance.** When the track has `u_inv_au > 0` (the parallax-aware join, A17.4, Q-179): `Δ = 1/u`; `r = |S + Δ·ŝ|`, with `S` the observer's heliocentric position at the visit's middle time (minus the Sun's geocentric position from the low-precision solar formula of the Astronomical Almanac, about 0.01°; no network) and `ŝ` the unit vector to the track's mean RA/Dec. `r_source: parallax`, tag `derived`. Otherwise (`possible` and one-visit tracks) the **worst case**: the closest the line of sight comes to the Sun, `r_min = R⊕·sin ε` for elongation `ε < 90°`, else `R⊕`; `r_source: worst_case`, tag `model_dependent`.
5. **Bounds** (starting values, [Q-475](../../decisions/moving-objects.md)):
   - **Reflected range** `R_min ≤ ρ ≤ R_max`, start 0.6 and 3.0 **[verify V-S2]**. Bluest: B-types (Bennu, about −0.043 per µm from 0.55 to 2.5 µm) and the 3 µm hydration band of C-types. Reddest: D-types and phase reddening.
   - **Heat glow allowance** `G(λ_L, r)`: the largest ratio of thermal to reflected flux at `λ_L` over `p_V ∈ [0.03, 0.5]` and `η ∈ [0.7, 2.0]`, from NEATM (Harris 1998; `ε = 0.9`, `A = q·p_V`, `q = 0.39`, the same phase angle in both terms; a diameter cancels). Heat glow grows with wavelength, so it can only raise `ρ`: `too_blue` never depends on it. Values: a dark body at 1 AU gives `G` = 4 at 2.4 µm and 140 at 3.3 µm; a bright one at 2.8 AU gives under 0.4 below 4.6 µm (Q-475 grid).
   - `ρ_max(r) = R_max · (1 + G(λ_L, r))`.
6. **Steadiness.** For consecutive exposures of one visit and one detector with both dots at `snr ≥ snr_min`: change `c = F_{i+1}/F_i − 1`, allowed `a = spin(Δt) + √2·σ_sys + slope_arm · |ln(λ_{i+1}/λ_i)|`.
   - `spin(Δt) = 0.921 · 2π · A_max · Δt / P_min`, with `A_max` = 1 mag and `P_min` = 2.2 h (9.4 % for 129 s) **[verify V-S5]**.
   - `slope_arm` = 4 on the short arm (reflected light) and 15 on the long arm (heat glow rises with a slope of about `hc/λkT` ≈ 12 at 3.5 µm and 340 K).
   - The step fails when `|c| > a + 3σ_c`. A tiny fast rotator (under about 200 m) can fail honestly; the verdict says "faster than a rock larger than 200 m can spin".
7. **Verdict** (the first that applies):

   | `verdict` | When | Card title |
   |---|---|---|
   | `flickers` | any steadiness step fails | Flickers between exposures |
   | `too_blue` | any pair with `ρ + 2σ_ρ < R_min` (or an upper limit below it) | Bluer than sunlight off any rock |
   | `too_red` | `r_source: parallax` and a pair with `ρ − 2σ_ρ > ρ_max(r)` | Too red for sunlight off a rock |
   | `very_red` | `r_source: worst_case` and a pair (or lower limit) above `R_max` | Redder than sunlight off any rock |
   | `rock` | at least one informative pair, every pair inside `[R_min, ρ_max(r)]` | Looks like sunlight off a rock |
   | `too_faint` | pairs exist, none with `ρ / σ_ρ ≥ 3` | Too faint to tell |
   | `one_colour` | no pair: every dot in one arm, or never in the same exposure | One colour only |

   `heat_glow: true` on a `rock` with `r_source: parallax` and a pair above `R_max`: the colour needs heat glow, and heat glow at that distance allows it. `null` when the distance is unknown.
8. **Chart values.** Each point's brightness divided by sunlight, `rel = (F/F☉(λ)) / median over the visit's short-arm points of (F/F☉)`, so each visit's short arm sits at 1. `null` for a visit with no short-arm point. The card draws `rel`, the reflected range, and the Sun at 1 (A18.7).

#### Output and storage

- **Reply** `GET /v1/areas/{area_id}/spectra` (`shared/schemas/area-spectra.schema.json`): `area_id`, `cached_at`, `computed_at`, `missing`, `provenance`, `method {spectrum_version, settings, formulas, sun}`, `calibration [{visit, detector, sigma_sys, n_pairs, source: stars | default}]`, `tracks [{track_id, verdict, heat_glow, r_au, r_source, pairs [{visit, exposure, time, lambda_short_um, lambda_long_um, rho, rho_err, limit: null | lower | upper, rho_max}], steps [{visit, detector, time_a, time_b, change, allowed, ok}], points [{dot_id, lambda_um, flux_uJy, flux_err, snr, arm, rel, used}]}]`, one entry per track of `/tracks`, in its order.
  - **As built (issue #161, PR #163):** the schema adds, per track, `phase_deg`; per pair, `short_dot_id` and `long_dot_id` (`rho_err` is null for a limit); per step, `dot_id_a` and `dot_id_b`; per point, `visit`, `detector`, `exposure`, `time` and `point` (`snr ≥ snr_min`), with `used` meaning the dot entered a pair or a step. `r_au` is always a number (the worst case when `r_source` is `worst_case`). The UI (A18.7, issue #162) reads these as they are.
- **Computed once, when the area is stored**, never in a web request (A16.2): by the live job right after `store_area` (no new job step; it takes milliseconds), by `scripts/area_discovery.py`, and by `scripts/area_spectra.py`, which backfills every stored area in a cache or the committed pack.
- **Its own key**: `derived.area`, `stage: spectra`, `v: SPECTRUM_VERSION`, `p:` the area's `params_hash`, `s:` the sha of the spectrum settings. The area's `settings_sha` does not change, so no stored area stops being served (Q-474). A threshold change bumps `s` and needs the backfill (seconds per area), not a 10-minute recompute.
- **Served byte for byte** by `AreaStore`, as every area stage. No entry for a served area: 404 `spectra_not_prepared`, and the UI lists "Spectrum check not run" under Not shown.
- **Solar table**: `backend/assets/solar/sun.json`, made by `scripts/bake_solar.py`: CALSPEC `sun_reference_stis` (observed, to about 2.5 µm) joined to the Kurucz model `sun_mod_001` beyond, averaged at R = 41 from 0.70 to 5.10 µm, with source URLs and SHA-256 **[verify V-S3]** (file names, coverage, the join). Interpolated in `ln λ`.
- **Deterministic**: sorted keys, fixed rounding; the same stored inputs and settings give the same bytes.

#### Provenance

| Value | Tag |
|---|---|
| `flux_uJy`, `flux_err`, `snr`, `lambda_um` | `measured` (A17.2) |
| `sigma_sys`, `rel` | `derived` |
| `rho`, `rho_err` (use the solar model beyond 2.5 µm) | `model_dependent` |
| `r_au` from parallax | `derived`; worst case `model_dependent` |
| bounds, `rho_max`, `heat_glow`, `verdict` | `model_dependent` |

#### Tests

- **Recorded Eros area** (QR2 pack): T3 (433 Eros) `rock` with `heat_glow: true`, `r_au` within 0.05 of Horizons' 1.157; T1 and T4 `rock`; T8 `very_red`; T2, T5, T6, T7 and T9 `one_colour`. Byte-identical on a second run.
- **Synthetic**: a solar-coloured mover is `rock`; a mover at `ρ = 0.3` is `too_blue`; a +70 % step at SNR 30 is `flickers`; `u = 0.33` (`r` about 3) with `ρ = 6` at 2.6 µm is `too_red`; only one arm is `one_colour`; SNR 4 on both arms is `too_faint`.
- **Physics units**: NEATM and the reflected term in the same unit (both scale with the same diameter, so their ratio is unit-free): a test pins `G(3.3 µm, r = 1.2, p_V = 0.25, η = 1.4)` against an independent integration, and a published NEATM flux **[verify V-S4]**. (Writing this spec, a mJy/Jy slip first hid Eros's heat glow.)
- **Storage**: the stage is written after `store_area`; the area's `settings_sha` is unchanged; a missing stage answers 404 `spectra_not_prepared`; the API never imports `spectrum.py` (the A16.2 import test, unchanged list).

#### Verify before it ships

| Id | Item | How |
|---|---|---|
| V-S1 | Colour bias between arms: no aperture correction per band (Q-23), so a fixed 3 px aperture keeps a different share of each band's PSF | Solar-type stars in the Eros frames give 0.20 to 0.25 against 0.26 expected; check on a DR1 area |
| V-S2 | `R_min` 0.6 and `R_max` 3.0 | astro-verifier: B, C, S, D-type and TNO reflectance ratios across 0.75 to 5 µm, the 3 µm band, phase reddening |
| V-S3 | Solar table sources, coverage and join | Read the CALSPEC file headers |
| V-S4 | NEATM implementation | Reproduce one published NEATM flux |
| V-S5 | Spin term for faint, small NEAs | Light-curve surveys of small NEAs |

#### Phase 2

Fit the heat glow when the distance is known (a temperature, with `η` and `p_V` degenerate, so reported as a range); the verdict in the ECSV export and the scan results (#156, per square); colours from more than one exposure when both arms are steady.
