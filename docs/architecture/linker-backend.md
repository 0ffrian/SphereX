# Band-Hop Linker: backend

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A17–A17.11 · **Overview:** [linker.md](linker.md) (A16) · **Sky UI:** [linker-ui.md](linker-ui.md) (A18)

Status: **proposal, not built** (Q-113). Every threshold below is a starting value to be tuned on injections and written into the reply's `method` block, the way Stage 2 reports its settings ([A4.2](pipeline.md#a42-stage-2-measure-brightness-and-spectrum)). Values marked **[verify]** wait on the Day 0 measurement (A16.7).

## A17 Linker backend

A **field** pipeline in `backend/app/core/link/`, run offline by `backend/scripts/link_field.py`. It never runs inside a web request. Its outputs are cached JSON that `backend/app/api/link.py` serves (A17.8).

### A17.1 Field and frames (`field.py`)

- **Field:** `{field_id, ra, dec, radius_deg, data_release, pass_index}` from `scripts/targets.toml`, group `linker`. Start radius 0.25° **[verify]** (set after Day 0 from the pass length and the rate range).
- **Frame search.** Large SIA cones time out ([A3.1](data-sources.md#a31-spherex-irsa)), so the field is covered by a grid of tiny cones (`r = 0.001°`, spacing below the frame size), each cached, and the rows are joined by observation id and detector. `MAXREC=500` per cone; `QUERY_STATUS=OVERFLOW` refuses the cone as `frames:truncated`.
- **Pass.** Frames are sorted by exposure midpoint and split into passes at gaps longer than `pass_gap_days` (start 5 days). The field's pass is chosen by `pass_index`. A pass with fewer than `min_frames` (start 6) frames refuses the field as `link:frames`.
- **Cutouts only, never whole frames** (D-25): one cutout per frame, centred on the field, size `2 × radius_deg` (about 290 px at 0.25°). Downloaded through the shared cutout pool (Q-112) and the read-through cache.
- **Output:** `FieldFrame{frame_id, obs_id, detector, time, wcs, cutout_key}`, time order.

### A17.2 Detection (`extract.py`)

Per cutout, using the cached `IMAGE`, `FLAGS`, `VARIANCE` and `WCS-WAVE`:

1. **Background:** sigma-clipped mean and std in a mesh (box 32 px, 3σ, 5 iterations), the Stage 2 clipping settings.
2. **Mask** pixels with any bit of the Stage 2 reject list (bit numbers from the `MP_*` keywords; a header without `OVERFLOW` and `SUR_ERROR` refuses the frame as `flags_header`).
3. **Detect** peaks above `k_detect · sqrt(VARIANCE)` (start `k_detect = 5`) with photutils, minimum separation 3 px.
4. **Measure** each source: windowed centroid (`measured`), aperture flux and error with the Stage 2 formulas in µJy, S/N, wavelength at the centroid from `wcs.wavelength_at` (`derived`), RA/Dec through the TAN-SIP WCS (`derived`).
- **Output:** `Detection{det_id, frame_id, time, x, y, ra, dec, flux_uJy, flux_err, snr, wavelength_um, flags}`. `det_id` is `<frame_id>:<n>` with `n` in order of RA then Dec, so ids are stable.

### A17.3 Static removal (`static.py`)

A detection is **static** if either test holds; the rest are **orphans**.

- **Catalogue:** within `r_match = max(2 px, 3 σ_centroid)` of a Gaia DR3 or CatWISE2020 source propagated to the frame time. The cones reuse the overlay catalogue fetch and limits ([A4.9](pipeline.md#a49-overlays-flag-mask-and-combine)): Gaia `G < 20`, CatWISE with no magnitude limit.
- **Repeat:** a counterpart within `r_match` at the same RA/Dec in at least `k_repeat` (start 3) other frames of the pass. This catches sources missing from both catalogues.
- Static detections are kept (count per frame) so the UI can show them on demand; they are never linked.

### A17.4 Linking (`link.py`)

Cadence-independent linking in the style of THOR (Moeyens et al. 2021, [arXiv:2105.01056](https://arxiv.org/abs/2105.01056)), simplified to a rate grid on the tangent plane at the field centre:

1. **Hypotheses:** rates 0.02 to 1.2 deg/day (log steps, 24 values) × position angles every 7.5° (48 values). The top rate is the strong-trailing limit (A16.6).
2. **Shift** every orphan to the pass reference time `t0` (first frame): `p' = p − v (t − t0)`, in pixel units of 6.15″.
3. **Cluster** shifted positions with DBSCAN, `eps` start 2 px, `min_samples = 3`.
4. **Keep** a cluster with at least 3 detections in at least 3 distinct frames, spanning at least `min_span_h` (start 2 h). One detection per frame per cluster: keep the one closest to the cluster centre.
5. **Merge** clusters from neighbouring hypotheses that share detections (union-find); keep the member with the lowest fit residual.
6. **Fit** each chain with a quadratic in time per tangent-plane axis (curvature absorbs short-arc orbital motion). Keep it if the residual RMS is below `rms_max` (start 1 px).
7. **SED smoothness score.** Fit `ln F` against `ln λ` with a quadratic by weighted least squares; `score = exp(−χ²_ν / 2)`. Hops more than 4σ off the fit are reported as `sed_jump` hops. The tolerance includes 0.2 to 0.5 mag of rotational modulation, so a spinning rock is not rejected; that tolerance is set from the injections (A17.6).
- **Output:** `Chain{chain_id, hops[det_id], t_span_h, rate_deg_day, pa_deg, fit{coef, rms_px}, sed{coef, chi2_nu, score, jumps[]}}`, ids `T01…` in order of first hop time.
- HelioLinC (Holman et al. 2018, [arXiv:1805.02638](https://arxiv.org/abs/1805.02638)) is the alternative if the rate grid misses curved arcs. KBMOD-style shift-and-stack (Whidden et al. 2019, [arXiv:1901.02492](https://arxiv.org/abs/1901.02492)) works on pixels and is out of scope.

### A17.5 Known-object match (`match.py`)

- **SkyBoT** cone search per distinct hop epoch (Julian day, [A3.5](data-sources.md#a35-imcce-skybot)), radius = field radius + 0.1°, cached.
- A chain **matches** a known object if at least two thirds of its hops lie within `r_known = max(3 px, 3 σ_position)` of that object's SkyBoT position at the hop time. Ties go to the smallest median separation.
- **Output:** `match{designation, number, v_mag, median_sep_px, source: "skybot"}` or `null`. Horizons is used only to draw the matched object's predicted track for comparison (`derived`).
- **Verdict code:** `known` (matched), `candidate` (unmatched, `score ≥ 0.5`), `low_confidence` (unmatched, `score < 0.5` or any `sed_jump`).

### A17.6 Injection, completeness and control (`inject.py`)

- **Injection.** Synthetic movers are added to the cutout arrays **in memory only**, never written to the cache and never served. Per mover: straight-plus-curvature track across the pass, rate drawn from 0.05 to 0.3 deg/day **[verify]**, flat reflectance SED, magnitude drawn uniformly in the axis range, rotational modulation `A ∈ {0, 0.3}` mag with a period from 3 to 12 h, a Gaussian PSF per band **[verify]** (A16.6).
- **Batches:** about 50 movers per run, so they do not crowd, until at least 500 per condition. Each run repeats A17.2 to A17.4 on the injected frames.
- **Recovered:** a chain with at least 3 hops of the same mover and at most 1 foreign detection.
- **Curve:** recovered fraction in 0.5 mag bins with Wilson 68 % intervals; a logistic fit gives the 50 % magnitude. **Recall above the limit** averages bins brighter than the measured per-exposure limit; with no measured limit it is refused (`link:limit`).
- **Conditions:** rotation 0 or 0.3 mag × rate band slow (0.05 to 0.15) or fast (0.15 to 0.3 deg/day); four precomputed curves.
- **Shuffled-time control:** frame times are permuted within the pass (20 seeded permutations) and A17.4 is re-run on the real orphans. Chains that survive are false links; the reply gives the count per field.
- **Seeds:** every random draw comes from a `numpy` generator seeded with `field seed + run index`; the seeds are in the reply.

### A17.7 Export (`export.py`)

- **ECSV** (astropy): one row per hop: `chain_id, det_id, frame_id, mjd, ra, dec, ra_err, dec_err, wavelength_um, flux_uJy, flux_err, rms_px, sed_score, verdict, match_designation, provenance`.
- **ADES PSV** ([MPC ADES documentation](https://docs.minorplanetcenter.net/mpc-ops-docs/observations/)): written for `candidate` chains, with a header comment `not submittable: no SPHEREx observatory code` while A16.6 says so. The UI shows the same text.

### A17.8 Endpoints (beyond D-16, Q-113)

| Endpoint | Returns |
|---|---|
| `GET /v1/link/fields` | `[{field_id, ra, dec, radius_deg, data_release, pass_start, pass_end, n_frames, n_detections, n_orphans, n_chains, computed_at, seed, cached_at}]` |
| `GET /v1/link/fields/{field_id}` | The summary plus `frames[{frame_id, time, wavelength_min_um, wavelength_max_um, cutout_box}]`, `method`, `missing`, `provenance` |
| `GET /v1/link/fields/{field_id}/detections` | Per frame: orphans `[{det_id, ra, dec, flux_uJy, flux_err, snr, wavelength_um}]` and `n_static`; `?frame_id=` limits it to one frame |
| `GET /v1/link/fields/{field_id}/chains` | Chains (A17.4) with each hop's `det_id, frame_id, time, ra, dec, wavelength_um, flux_uJy, flux_err`, `match` and `verdict` (A17.5) |
| `GET /v1/link/fields/{field_id}/stamps/{det_id}.png` | A 15 × 15 px stamp from the cached cutout, the frames' asinh stretch |
| `GET /v1/link/fields/{field_id}/completeness` | `conditions[{rotation_mag, rate_band, bins[{mag, n_injected, n_recovered, lo, hi}], m50, recall_above_limit}]`, `limit` or `null`, `false_links{n_permutations, n_chains}`, `assumptions`, `missing` |
| `GET /v1/link/fields/{field_id}/export.ecsv`, `export.ades.psv` | The files of A17.7 |

- Every JSON reply carries `cached_at`, `computed_at`, `missing` and `provenance`, as the other routes do.
- **Errors:** 404 `field_not_found` (unknown, or not precomputed), 404 `det_not_found`, 503 `stamp_unavailable` (cutout not cached).

### A17.9 Schemas and fixtures

- `shared/schemas/link-field.schema.json`, `link-detections.schema.json`, `link-chains.schema.json`, `link-completeness.schema.json`; generated code in `backend/app/contract/` and `frontend/src/contract/` (D-18).
- `shared/fixtures/link/`: a synthetic field (4 chains: 2 known, 1 candidate, 1 low confidence; about 8 orphans per frame; 12 frames) for every endpoint, served by the dev fixture server with `X-SX-Fixture: synthetic` (Q-32). The frontend builds against these before the backend exists (D-29).

### A17.10 Cache, offline and determinism

- Inputs go through the read-through cache (D-25). Outputs go to `{SX_CACHE_DIR}/link/v1/<field_id>/<params_hash>/` as `field.json`, `detections.json`, `chains.json`, `completeness.json` and the two exports. `params_hash` covers the code version, every threshold and the seed.
- **Offline:** the API only reads these files. Under `SX_OFFLINE=1` an absent field is 404 `field_not_found`.
- **Determinism:** same cache, parameters and seed give byte-identical files (sorted inputs, seeded generators, fixed float formatting in JSON). A test runs the script twice on recorded fixtures and compares bytes.
- The derived files are not test fixtures in the D-25 sense; re-run the script to change them.

### A17.11 Compute budget

Estimates, **not measured**; L1 records the real times.

| Step | Event scale (1 to 2 fields, about 100 to 300 frames) | Note |
|---|---|---|
| Downloads | A few hundred MB | Slowest step; IRSA at about 20 s per cutout (Q-111) |
| Detection | Seconds per frame | Measure workers (Q-112) can run it |
| Linking, one run | Seconds to minutes on a laptop CPU | Grows faster than linearly with orphans per frame |
| Injections | Minutes to about an hour | Dominant cost; batches of about 50 |
| Serving | Reads JSON | No compute in requests |

All-sky scale needs per-tile parallel runs on the public S3 bucket and is out of scope (A16.2).
