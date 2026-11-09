# Area search: Discovery backend

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A17–A17.11 · **Overview:** [linker.md](linker.md) (A16) · **Sky UI:** [linker-ui.md](linker-ui.md) (A18)

Status: **agreed plan, not built** ([Q-146](../decisions/moving-objects.md)). Every threshold below is a starting value, written into the reply's `method` block the way Stage 2 reports its settings ([A4.2](pipeline.md#a42-stage-2-measure-brightness-and-spectrum)). Values marked **[verify]** wait on the Day 0 count (A16.7). Track's backend (path endpoint, frame list, export) is Kevin's under Q-140, Q-141 and Q-145 and is not repeated here.

## A17 Discovery backend

An **area** pipeline in `backend/app/core/area/`, run offline by `backend/scripts/area_discovery.py`. It never runs inside a web request. Its outputs are cached JSON that `backend/app/api/areas.py` serves (A17.8).

### A17.1 Area and frames (`frames.py`)

- **Area:** `{area_id, ra, dec, width_deg, height_deg, data_release, visits}` from `scripts/targets.toml`, group `areas`. The demo area is centred on Eros's 20 to 21 Mar 2026 path (Q-137) and sized to hold it, about 1° **[verify]**.
- **Frame search.** Reuse PR #53's frame search for a fixed position, run on a grid of points across the area (large SIA cones time out, [A3.1](data-sources.md#a31-spherex-irsa)); rows joined by observation id and detector. An overflowing cone is refused as `frames:truncated`.
- **Visits.** Frames are sorted by exposure midpoint and grouped into **visits**: exposures less than `visit_gap_h` apart (start 1 h **[verify]**). An area with fewer than 2 visits is refused for Discovery as `area:visits` (Known still works).
- **Cutouts only, never whole frames** (D-25): one cutout per frame covering the area, through the shared cutout pool (Q-112) and the read-through cache.
- **Output:** `AreaFrame{frame_id, obs_id, detector, visit, exposure, time, wcs, cutout_key}`, time order.

### A17.2 Dots (`dots.py`)

Per cutout, using the cached `IMAGE`, `FLAGS`, `VARIANCE` and `WCS-WAVE`:

1. **Background:** sigma-clipped mean and std in a mesh (box 32 px, 3σ, 5 iterations), the Stage 2 settings.
2. **Mask** pixels with any bit of the Stage 2 reject list. For moving objects, OUTLIER on the core is recorded, not masked (Q-139); hardware flags still mask.
3. **Detect** peaks above `k_detect · sqrt(VARIANCE)` (start `k_detect = 5`) with photutils, minimum separation 3 px.
4. **Measure** each dot: centroid (`measured`), aperture flux and error with the Stage 2 formulas in µJy, S/N, wavelength at the centroid from `wcs.wavelength_at` (`derived`), RA/Dec through the WCS (`derived`).
- **Output:** `Dot{dot_id, frame_id, visit, exposure, time, x, y, ra, dec, flux_uJy, flux_err, snr, wavelength_um, flags}`. `dot_id` is `<frame_id>:<n>` with `n` in order of RA then Dec, so ids are stable.

### A17.3 Glitches and stars (`clean.py`)

Applied in this order; each label is kept on the dot, so the UI can replay the steps.

- **Glitch:** a dot with no counterpart within `r_match = max(2 px, 3 σ_centroid)` (allowing for motion, see A17.4) in at least `k_visit` (start 3) of the exposures of its visit. Cosmic rays and hot pixels appear once.
- **Star:** within `r_match` of a Gaia DR3 or CatWISE2020 source propagated to the frame time. The star list is the same one Track uses for its masks (Q-143): one cone per visit, Gaia `G < 20`, CatWISE with no magnitude limit.
- **Fixed:** at the same RA/Dec, within `r_match`, in both visits. This catches sources missing from both catalogues.
- What is left are **movers-to-be**: dots that repeat inside their visit and are not fixed on the sky.

### A17.4 Join across visits (`join.py`)

Simple and exhaustive, because an area holds few movers-to-be:

1. **Tracklets.** Inside each visit, group the movers-to-be that repeat across its exposures into a tracklet: a straight line in time with a fit residual below `rms_max` (start 1 px). A tracklet's own rate and direction are kept when the motion inside the visit is at least 1 px, else marked `slow`.
2. **Pairs.** For each tracklet in visit A, every tracklet in visit B whose displacement gives a rate between `rate_min` and `rate_max` (start 0.02 and 1.2 deg/day; the top is the strong-trailing limit, A16.6) is a candidate partner. When both tracklets have a measured direction, the pair must agree within `pa_tol` (start 20°) and its rate within a factor `rate_tol` (start 1.5).
3. **Tracks.** A tracklet with exactly one candidate partner becomes a **track**. One with several partners, or none, stays a **possible** (with the reason: `ambiguous` or `one_visit`). With 3 or more visits the same rule chains pairs; a track then needs consistent pairs.
- **Output:** `Track{track_id, visits[], tracklets[{visit, dot_ids[], rate_deg_day, pa_deg, rms_px}], rate_deg_day, pa_deg, status: track | possible, reason}`, ids `T1…` in order of first time.
- **Phase 2** (not the event build): the THOR-style rate grid (Moeyens et al. 2021, [arXiv:2105.01056](https://arxiv.org/abs/2105.01056)) or HelioLinC (Holman et al. 2018, [arXiv:1805.02638](https://arxiv.org/abs/1805.02638)) for many visits, and the SED smoothness score.

### A17.5 SkyBoT check (`match.py`)

- **SkyBoT** cone search per visit epoch ([A3.5](data-sources.md#a35-imcce-skybot)) covering the area, cached. The same reply feeds the **Known objects** list (A18.5).
- A track **matches** a known object if at least two thirds of its dots lie within `r_known = max(3 px, 3 σ_position)` of that object's SkyBoT position at the dot time. Ties go to the smallest median separation.
- **Output:** `match{designation, number, v_mag, median_sep_px, source: "skybot"}` or `null`.
- **Verdict:** `found_blind` (a track that matches), `unexplained` (a track that matches nothing), `possible` (not a track; A17.4).

### A17.6 Injection, completeness and control

**Phase 2, not in the event build.** Injected movers in memory only, a completeness curve per condition, and a shuffled-time control, as in the first proposal of this fragment (git history of PR #59, commit 9822a3b). Until it exists, the UI makes no claim about how many movers Discovery misses.

### A17.7 Export (`export.py`)

- **ECSV** (astropy), one row per dot of each track or possible: `track_id, dot_id, frame_id, visit, mjd, ra, dec, ra_err, dec_err, wavelength_um, flux_uJy, flux_err, flags, status, verdict, match_designation`, each column's provenance tag in the ECSV metadata, as Track's export (Q-145).
- **ADES:** phase 2 (no SPHEREx MPC observatory code, Q-145).

### A17.8 Endpoints (beyond D-16)

| Endpoint | Returns |
|---|---|
| `GET /v1/areas` | `[{area_id, ra, dec, width_deg, height_deg, data_release, n_frames, n_visits, computed_at, cached_at}]` |
| `GET /v1/areas/{area_id}` | The summary plus `frames[{frame_id, visit, exposure, time, wavelength_min_um, wavelength_max_um}]`, `steps{n_dots, n_glitches, n_stars, n_fixed, n_tracks, n_possible, n_found_blind}`, `method`, `missing`, `provenance` |
| `GET /v1/areas/{area_id}/known` | SkyBoT objects in the area per visit: `[{designation, number, kind, v_mag, positions[{time, ra, dec}], track_available}]` |
| `GET /v1/areas/{area_id}/dots` | Per visit: dots `[{dot_id, exposure, ra, dec, flux_uJy, flux_err, snr, wavelength_um, label: glitch | star | fixed | mover}]` |
| `GET /v1/areas/{area_id}/tracks` | Tracks and possibles (A17.4) with each dot, `match` and `verdict` (A17.5) |
| `GET /v1/areas/{area_id}/stamps/{dot_id}.png` | A 15 × 15 px stamp from the cached cutout |
| `GET /v1/areas/{area_id}/export.ecsv` | The file of A17.7 |

- Every JSON reply carries `cached_at`, `computed_at`, `missing` and `provenance`, as the other routes do.
- **Errors:** 404 `area_not_found` (unknown, or not precomputed), 404 `dot_not_found`, 503 `stamp_unavailable` (cutout not cached).

### A17.9 Schemas and fixtures

- `shared/schemas/area-summary.schema.json`, `area-known.schema.json`, `area-dots.schema.json`, `area-tracks.schema.json`; generated code in `backend/app/contract/` and `frontend/src/contract/` (D-18).
- `shared/fixtures/area/`: a synthetic area (2 visits × 4 exposures; about 30 stars, 18 glitches; 3 movers: one `found_blind`, one `unexplained`, one `possible` with `one_visit`), served by the dev fixture server with `X-SX-Fixture: synthetic` (Q-32). The frontend builds against it before the backend exists (D-29).

### A17.10 Cache, offline and determinism

- Inputs go through the read-through cache (D-25). Outputs go to `{SX_CACHE_DIR}/area/v1/<area_id>/<params_hash>/` as `area.json`, `known.json`, `dots.json`, `tracks.json` and `export.ecsv`. `params_hash` covers the code version and every threshold.
- **Offline:** the API only reads these files. Under `SX_OFFLINE=1` an absent area is 404 `area_not_found`.
- **Determinism:** same cache and parameters give byte-identical files (sorted inputs, fixed float formatting). A test runs the script twice on recorded fixtures and compares bytes. Nothing here is random.

### A17.11 Compute budget

Estimates, **not measured**; D1 records the real times.

| Step | Event scale (1 to 3 areas, tens of frames each) | Note |
|---|---|---|
| Downloads | Tens to a few hundred MB | Slowest step; IRSA at about 20 s per cutout (Q-111) |
| Dots | Seconds per frame | Measure workers (Q-112) can run it |
| Glitches, stars, join | Seconds | Few movers-to-be per area; exhaustive pairing is cheap |
| SkyBoT | One cached call per visit | |
| Serving | Reads JSON | No compute in requests |
