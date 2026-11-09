# Area search: Discovery backend

> **Part of:** Architecture spec ([index](../README.md)) · **Sections:** A17 to A17.11 · **Implements:** [Q-146](../../decisions/moving-objects.md), [Q-138](../../decisions/moving-objects.md), [Q-139](../../decisions/moving-objects.md), [Q-143](../../decisions/moving-objects.md), D-16, D-18, D-25 ([contract](../../decisions/contract.md), [data-sources](../../decisions/data-sources.md)) · **Read with:** [area-search.md](area-search.md) (A16), [area-ui.md](area-ui.md) (A18), [track.md](track.md) (A19)

Status: **agreed plan, not built** ([Q-146](../../decisions/moving-objects.md)). Owner: Kevin (ticket D1). Every threshold below is a **starting value**, written into the reply's `method` block the way Stage 2 reports its settings ([A4.2](../pipeline.md#a42-stage-2-measure-brightness-and-spectrum)). Values marked **[verify]** wait on the Day 0 count (A16.7). Track's backend (path, frames, star list, export writer) is [A19](track.md) and is not repeated here.

## A17 Discovery backend

An **area** pipeline in `backend/app/core/area/`, run offline by `backend/scripts/area_discovery.py`. It never runs inside a web request. Its outputs are `derived.area` cache entries that `backend/app/api/areas.py` serves (A17.8, A17.10).

**Units and symbols.** Pixel `p` = 6.15″. `Δt_v` = the time between the two visits' mid-times (Eros: 1.017 d). `σ_c` = a dot's centroid error in px.

### A17.1 Area and frames (`frames.py`)

- **Area:** a `[[area]]` table in `backend/targets.toml` (A16.4): `{id, ra, dec, width_deg, height_deg, data_release, windows}`. The Eros area is centred on Eros's 20 to 21 Mar 2026 path and sized to hold both visits' positions (Eros moves 0.97° between visits, mostly east). This choice used Eros's known path, which the UI says (A16.5).
- **Size rule.** A mover can only be paired when both its positions lie in the area, so `rate_max` (A17.4) is at most `(diagonal − 2·margin) / Δt_v`, `margin` 0.02°. For the Eros area (about 1.05° × 0.63°) that is 1.16 deg/day.
- **Frame search** (fixed position, not PR #53's path search): a grid of small SIA cones (`r = 0.001°`, about 4 s each, [A3.1](../data-sources.md#a31-spherex-irsa)) spaced at most 0.25° **[verify]** over the area, each through Stage 1's SIA adapter ([A4.1](../pipeline.md#a41-stage-1-find-the-object)) and the cache, through PR #53's process-wide `Pacer`, which spaces the starts of live cones by `SX_MOVING_CONE_PACE_S` (`moving_cone_pace_s`, default 0, so no spacing; a value is **[verify]**). It does not run cones one at a time; D1 adds a lock if IRSA needs that. A frame covering less than a strip about one grid step wide can be missed; it would add little coverage.
  1. Merge the answers by `frame_id`.
  2. Keep a frame only when its `s_region` polygon overlaps the area (gnomonic projection, PR #53's footprint helper extended from point-in-polygon to polygon overlap). A frame with no usable `s_region` is refused as `no_footprint:<frame_id>`.
  3. Keep a frame only when its midpoint lies inside the area's `windows`. The time filter runs in the backend after the cone answers, because a server-side time filter timed out (A3.1).
  4. A cone answer that hits MAXREC (500) is counted in `frames:cone_maxrec:<n>`; a failed cone in `frames:cone_failed:<n>`. A result with `cone_failed` is incomplete and is not stored.
- **Visits.** Frames sorted by midpoint, then grouped: frames less than `visit_gap_h` apart (start 1 h; Eros visits last 6.4 min and are 24.4 h apart) form one visit. Both detectors of one exposure (same midpoint) belong to the same exposure. Fewer than 2 visits: Discovery is refused as `area:visits` (Known still works).
- **Coverage.** Per visit, the union of its frames' `s_region` clipped to the area, stored as a mask on a 30″ grid. The fixed and glitch tests apply only where the frames they need cover the dot (A17.3); counts per step report what was covered.
- **Cutouts only, never whole frames** (D-25): one cutout per frame, the area's box clipped to the frame, through the shared cutout pool (Q-112) and the read-through cache.
- **Output:** `AreaFrame{frame_id, obs_id, detector, visit, exposure, time, t_min, t_max, wavelength_min_um, wavelength_max_um, s_region, cutout_key, cutout_sha256}`, sorted by `(time, detector, frame_id)`.

### A17.2 Dots (`dots.py`)

Per cutout, using the cached `IMAGE`, `FLAGS`, `VARIANCE` and `WCS-WAVE`:

1. **Background for detection:** sigma-clipped mean and std in a mesh (box 32 px, 3σ, 5 iterations). This is a new setting of the area pipeline (Stage 2 uses an annulus) and is written into `method`.
2. **Mask** pixels that carry a **hardware** flag: Stage 2's reject list ([A4.2](../pipeline.md#a42-stage-2-measure-brightness-and-spectrum)) **without `OUTLIER`**. `OUTLIER` is never masked here: Discovery cannot know which pixels are a mover's core, and masking it would remove Eros from 15 of its 16 frames (Q-139). A dot whose aperture holds `OUTLIER` pixels keeps them and lists `OUTLIER` in `flags`; one-off hits are removed by the glitch rule (A17.3). **Proposed (Q-158)**, extending Q-139 to the area pipeline.
3. **Detect** local maxima above `k_detect · sqrt(VARIANCE)` over the mesh background (start `k_detect = 5`), minimum separation 3 px. Peak finding and first-moment centroids in NumPy (pinned 2.5.4), so no new dependency; if D1 adds photutils it is pinned exactly in `backend/pyproject.toml`.
4. **Measure** each dot at its centroid with Stage 2's aperture photometry (3 px aperture with sub-pixel weights, 6 to 9 px annulus, flux in µJy, the same error formula), reusing `backend/app/core/measure/`. `σ_c` from the centroid's first-moment error (formula in `method`). Wavelength and bandwidth from `wcs.wavelength_at` at the centroid. RA/Dec through the WCS.

- **Output:** `Dot{dot_id, frame_id, detector, visit, exposure, time, x, y, sigma_c_px, ra, dec, flux_uJy, flux_err, snr, wavelength_um, bandwidth_um, flags[]}`. `dot_id` is `<frame_id>:<n>` with `n` in order of the peak pixel's row, then column, so ids are stable. Tags: centroid, flux, error, flags, wavelength and bandwidth `measured`; RA/Dec `derived` (A16.5).

### A17.3 Glitches, stars and fixed dots (`clean.py`)

Applied in this order; each label stays on the dot so the UI can replay the steps (Q-146 step 2 is "glitches", step 3 is "stars and fixed").

- **Match radius:** `r_match = max(2 px, 3·σ_c)`.
- **Glitch:** a dot must be found in at least `k_visit = min(3, n_frames(visit))` frames of its visit, itself included, where both detectors of an exposure count (Eros: 8 frames per visit). A counterpart in a frame taken `Δt` later or earlier lies within `r_match + rate_max·|Δt|` (Eros visit: up to 2 px + 3.1 px). The simultaneous frame on the other detector (`Δt` = 0) is the strongest test: a cosmic ray never hits both. A red source seen only on the long-wavelength detector still passes with 3 of its 4 exposures. Dots that fail are `glitch`.
- **Fixed:** a dot with a counterpart within `r_match` at the same RA/Dec in the other visit, where that visit covers it. This catches stars missing from both catalogues and defines `rate_min = r_match / Δt_v` (A17.4): anything slower is indistinguishable from a star and is labelled `fixed`.
- **Star:** dots not fixed are grouped into tracklets (A17.4 step 1). A tracklet is `star` when every one of its dots lies within `r_star(mag)` of the **same** Gaia DR3 or CatWISE2020 source of the per-visit star list ([A19.6](track.md#a196-star-list-for-movers), Q-143), propagated to the dot time. A mover passing a star touches it in one or two exposures only, so it is not dropped (the Eros area is at b = −4°, where a fixed 2 px radius around every catalogue source would drop many real dots). A dot whose core pixel carries a bright-star artefact flag (halo or bloom; the flag names are read from the `MP_*` keywords **[verify]**) is labelled `star` too.
- The star step needs the visit's star cones. A failed cone lists `stars:<cat>:<visit>` in `missing` and the step uses the other catalogue; the counts say so.
- What is left are **movers-to-be**. The Day 0 count records the share of dots in each label (A16.7).

### A17.4 Join across visits (`join.py`)

Simple and exhaustive, because an area holds few movers-to-be.

1. **Tracklets.** Inside each visit, chain movers-to-be across the visit's frames within the glitch radius into a straight line in time; fit `ra(t)`, `dec(t)`; keep when the fit residual is below `rms_max` (start 1 px). Each tracklet has a velocity `v_in` (east, north, in deg/day) and its error `σ_v` from the fit.
2. **Candidate pairs.** For each tracklet A in visit 1, every tracklet B in visit 2 whose displacement gives a rate `|v_AB|` between `rate_min = r_match / Δt_v` (Eros: 0.0034 deg/day) and `rate_max = min(1.2 deg/day, size rule of A17.1)` is a candidate. 1.2 deg/day is the strong-trailing limit (A16.6).
3. **Parallax-aware direction test.** The motion measured inside a 6.4 min visit carries SPHEREx's orbital parallax (Q-134): Eros's inside-visit direction differs from its between-visit direction by 25°. Over 24 h the parallax adds at most `2·A_par` (a few arcsec) to the displacement, so `v_AB` is close to the geocentric rate, while `v_in = v_AB − w·u`, where `w` is SPHEREx's velocity relative to the geocentre projected on the sky at the area centre (one Horizons vector per visit, `COMMAND='-163182'`, `CENTER='500@399'` **[verify]** that Horizons serves it) and `u = 1/Δ` is the unknown inverse distance. For each pair, fit `u ≥ 0` by least squares on both tracklets; the pair passes when the residual perpendicular to `w` is at most `v_tol = max(0.1 deg/day, 3·σ_v)` **[verify]** and `u ≤ 1/Δ_min` (`Δ_min` = 0.05 AU). **Proposed (Q-159)**, replacing a fixed direction tolerance (20°) and rate ratio (1.5): a fixed tolerance rejects Eros's own pair. If Day 0 cannot get `w`, the pair test uses the rate window only and the ranking below.
4. **Tracks.** A pair becomes a **track** when A and B are each other's best candidate (smallest perpendicular residual) and the best residual is at most `ambiguity_ratio` (start 0.5) times the next one. Otherwise the tracklet stays a **possible**: `ambiguous` (several candidates), `no_partner` (the other visit covers the place where it could be, nothing passed) or `one_visit` (the other visit does not cover it). A dot with a partner is never `one_visit`. A tracklet with no partner that moves less than `min_motion_px` (1 px) inside its visit is dropped as `static_one_visit` and only counted. With 3 or more visits, pairs chain; a track then needs every consecutive pair to pass.
- **Output:** `Track{track_id, visits[], tracklets[{visit, dot_ids[], v_in_deg_day, pa_in_deg, rms_px}], rate_deg_day, pa_deg, u_inv_au, status: track | possible, reason}`. `rate_deg_day` and `pa_deg` come from `v_AB` ("apparent, seen from SPHEREx"). Ids `T1…` in order of first time, ties broken by the first `dot_id`.
- **Eros test (D1):** on the recorded Eros area, the rules above must give exactly one `track` holding Eros's dots. If not, the gate of A16.7 applies.
- **Phase 2** (not the event build): the THOR-style rate grid (Moeyens et al. 2021, [arXiv:2105.01056](https://arxiv.org/abs/2105.01056)) or HelioLinC (Holman et al. 2018, [arXiv:1805.02638](https://arxiv.org/abs/1805.02638)) for many visits, and the SED smoothness score.

### A17.5 Known-object check (`match.py`)

Positions for matching and drawing are SPHEREx-centred (Q-138). SkyBoT only lists candidates. **Proposed (Q-160).**

1. **Candidates:** one SkyBoT cone per visit at the visit's mid-time ([A3.5](../data-sources.md#a35-imcce-skybot)), radius = the area's half-diagonal + `rate_max × visit span / 2` + `p_max` (60″ **[verify]**, parallax and orbit error), cached; objects with V ≤ `v_lim` (start 22 **[verify]**). The union over visits is the candidate list.
2. **Positions:** for each candidate, one Horizons `TLIST` at every frame midpoint of the area, observer `500@-163182`, with RA/Dec and their 3σ uncertainty, through the cache and the Horizons one-request gate ([A19.5](track.md#a195-path-endpoint)). The `/known` positions and Track use these, tagged `model_dependent`.
3. **Match:** a track matches a candidate when at least two thirds of its dots lie within `r_known = max(3 px, 3·σ_c + ephemeris 3σ)` of the candidate's position at the dot time. Ties go to the smallest median separation, then the designation.
4. **Known list:** candidates whose position lies inside a visit's coverage at one frame time or more, with that count; `object_id` from the cached resolver; `track_available` per [A19.12](track-contract.md#a1912-cache-offline-and-pre-fetch).

- **Verdict:** `found_blind` (a track that matches), `unexplained` (a track that matches nothing, "as of" the SkyBoT `fetched_at`), `unchecked` (the SkyBoT cone of a visit or a candidate's Horizons call failed: `skybot:<visit>` or `horizons:<designation>` in `missing`), `possible` (not a track; A17.4). Output: `match{designation, number, object_id, v_mag, median_sep_px, fetched_at}` or `null`.
- **Not built yet:** `backend/app/adapters/skybot.py:84` asks for the geocentre (`"-loc": "500"`); SkyBoT takes observatory codes and SPHEREx has none (Q-145), so the cone is padded by `p_max` instead. `SkybotBody` (lines 20 to 27) keeps neither the position error (`Err`) nor the motion rates; D1 adds them. [A3.5](../data-sources.md#a35-imcce-skybot) needs the observer, output fields, radius limit **[verify]** and terms of use.

### A17.6 Injection, completeness and control

**Phase 2, not in the event build.** Injected movers in memory only, a completeness curve per condition, and a shuffled-time control, as in the first proposal (git history of PR #59, commit 9822a3b). Until it exists, the UI makes no claim about how many movers Discovery misses.

### A17.7 Export

- **ECSV** through the shared writer of [A19.9](track-contract.md#a199-export), which owns the base columns and the per-column tags in the metadata. One row per dot of each track or possible. A17.7 adds only `track_id`, `dot_id`, `status`, `verdict` and `match_designation`. Times are ISO-8601 UTC plus `mjd_utc` (UTC).
- **ADES:** phase 2 (no SPHEREx MPC observatory code, Q-145).

### A17.8 Endpoints

Beyond D-16, which keys every endpoint on one object id; Q-146 (6) answered the `/v1/areas` routes and a D-16 note is pending. The endpoint register is [A4.11](../endpoints.md); refusal codes are also in [A4.12](../refusals.md).

| Endpoint | Returns |
|---|---|
| `GET /v1/areas` | Index: `[{area_id, ra, dec, width_deg, height_deg, data_release, n_frames, n_visits, computed_at, cached_at}]`, only areas prepared with the running code and settings (A17.10) |
| `GET /v1/areas/{area_id}` | The summary plus `frames[{frame_id, detector, visit, exposure, time, wavelength_min_um, wavelength_max_um, s_region}]`, `coverage[{visit, polygon}]`, `steps{n_dots, n_glitches, n_stars, n_fixed, n_static_one_visit, n_tracks, n_possible, n_found_blind, n_unexplained, n_unchecked}`, `method`, `missing`, `provenance` |
| `GET /v1/areas/{area_id}/known` | `[{designation, number, object_id, kind, v_mag, n_frames, n_visits, positions[{frame_id, time, ra, dec}], track_available}]`, positions tagged `model_dependent` |
| `GET /v1/areas/{area_id}/dots` | Per visit: `[{dot_id, frame_id, detector, exposure, time, x, y, ra, dec, flux_uJy, flux_err, snr, wavelength_um, bandwidth_um, flags[], label: glitch \| star \| fixed \| mover}]` |
| `GET /v1/areas/{area_id}/tracks` | Tracks and possibles (A17.4) with their dots, `match` and `verdict` (A17.5) |
| `GET /v1/areas/{area_id}/stamps/{dot_id}.png` | A 15 × 15 px stamp from the cached cutout, stretched as `/cutouts/{frame_id}.png` is |
| `GET /v1/areas/{area_id}/export.ecsv` | The file of A17.7 |

- Every JSON reply carries `cached_at`, `computed_at`, `missing` and `provenance`. Times are ISO-8601 UTC with `Z`; every RA is in [0, 360).
- **`missing` codes:** `area:visits` (fewer than 2 visits; Discovery refused, A17.1), `frames:cone_maxrec:<n>`, `no_footprint:<frame_id>`, `cutout:<frame_id>`, `stars:<cat>:<visit>` (that visit's Gaia DR3 or CatWISE2020 cone failed; the star step used the other catalogue, A17.3), `skybot:<visit>` (that visit's SkyBoT cone failed; its tracks are `unchecked`, A17.5), `horizons:<designation>` (a candidate's Horizons call failed; the tracks it could match are `unchecked`, A17.5), `stamp:<dot_id>` (the stamp's cutout is not cached). A square outside every prepared area is `area:not_prepared`, decided in the frontend from the index; the wording lives in `refusals.ts`. The register of every code is [A4.12](../refusals.md).
- **Errors:** 404 `area_not_found` (unknown id or not prepared with the running code), 404 `dot_not_found`, 503 `stamp_unavailable` (cutout not cached).

### A17.9 Schemas and fixtures

- `shared/schemas/area-index.schema.json`, `area-summary.schema.json`, `area-known.schema.json`, `area-dots.schema.json`, `area-tracks.schema.json`; generated code in `backend/app/contract/` and `frontend/src/contract/` (D-18). Owner Moon (D-17).
- `shared/fixtures/area/`: a synthetic area (2 visits × 4 exposures × 2 detectors; about 30 stars, 18 glitches; 4 movers: one `found_blind`, one `unexplained`, one `unchecked`, one `possible` with `one_visit`), served by the dev fixture server with `X-SX-Fixture: synthetic` (Q-32). The frontend builds against it before the backend exists (D-29).

### A17.10 Cache, offline and determinism

- **Inputs** go through the read-through cache (D-25): SIA cones, cutouts, Gaia and CatWISE cones, SkyBoT cones, Horizons TLISTs and vectors.
- **Outputs** are `derived.area` entries in the same cache (as `derived.spectrum`, [A4.2](../pipeline.md#a42-stage-2-measure-brightness-and-spectrum)): `summary`, `known`, `dots`, `tracks`, `export`. Key: `derived.area` + data release + `area_id` + `params_hash`. `params_hash` covers `AREA_VERSION`, `MEASURE_VERSION`, every `method` setting and the sorted SHA-256 of every input body. The API serves the entry whose `params_hash` matches the running code and settings; an older entry is not listed in the index (the operator re-runs the script).
- **Offline:** the API only reads entries. Under `SX_OFFLINE=1` an absent area is 404 `area_not_found`.
- **Determinism:** the same cache and settings give byte-identical entries (inputs sorted, fixed float formatting, ids as in A17.2 and A17.4). Nothing is random.
- **Fixtures for tests:** PR #53's Eros fixtures are 0.1° cutouts centred on Eros and do not cover an area. D1 records area cutouts with the pre-fetch script (D-25, never hand-edited); the determinism test runs twice on a small synthetic area and compares bytes.

### A17.11 Compute budget

Estimates, **not measured**; D1 records the real times.

| Step | Event scale (1 to 3 areas, tens of frames each) | Note |
|---|---|---|
| Frame search | About 15 cones of 4 s per area | Grid of A17.1 |
| Downloads | Tens to a few hundred MB | Slowest step; IRSA at about 20 s per cutout (Q-111) |
| Dots | Seconds per frame | Measure workers (Q-112) can run it |
| Glitches, stars, join | Seconds | Few movers-to-be per area; exhaustive pairing is cheap |
| Star lists, SkyBoT, Horizons | One cone per catalogue and visit; one SkyBoT cone per visit; one TLIST per candidate | Horizons one request at a time |
| Serving | Reads cache entries | No compute in requests |
