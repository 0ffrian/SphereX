# Track: data and backend

> **Part of:** Architecture spec ([index](../README.md)) · **Sections:** A19 to A19.8 (A19.9 to A19.15 in [track-contract.md](track-contract.md)) · **Implements:** [Q-131, Q-138, Q-139, Q-141, Q-142, Q-143, Q-144](../../decisions/moving-objects.md), [Q-125, Q-126, Q-140](../../decisions/moving-frames.md), [Q-137](../../decisions/scope-process.md), [Q-111](../../decisions/pipeline-jobs.md), D-16, D-18 ([contract](../../decisions/contract.md)), D-21 ([contract-tags](../../decisions/contract-tags.md)), D-25 ([data-sources](../../decisions/data-sources.md)) · **Read with:** [track-contract.md](track-contract.md) (A19.9 to A19.15), [track-ui.md](track-ui.md) (A20), [A4.1](../pipeline.md#a41-stage-1-find-the-object), [A4.2](../pipeline.md#a42-stage-2-measure-brightness-and-spectrum), [A4.9](../overlays.md#a49-overlays-flag-mask-and-combine), [area-backend.md](area-backend.md) (A17), [uml/23](../../uml/23-track.md)

Status: **agreed in parts, not built.** PR #53 (merged, Kevin; issue #26) built the frame search for moving objects, and Stage 2 measures those frames; everything else here is **To build**. Owner: Kevin (**Proposed (Q-183)**: Track backend Kevin, Track screen Atish). The mock-up `mockup/chase-the-rock.html` is visual input only (D-01); its approximations are listed in the [A20](track-ui.md) header and are never ported as values.

## A19 Track

Track follows **one known solar-system object** across the SPHEREx frames that caught it: its path seen from SPHEREx, the frames, a north-up zoom with stars masked and a spectrum built exposure by exposure. This fragment owns the data; [A20](track-ui.md) owns the screen.

### A19.1 Scope

- Known objects only: ids with `moving = true` (solar-system bodies, Q-22). No blind search and no discovery claims (Q-131); Discovery is Area search ([A16](area-search.md)).
- **MVP demo:** 433 Eros on its 20 to 21 Mar 2026 frames (Q-137). 3I/ATLAS is a stretch goal (A19.8).
- The demo is frozen on QR2 with a local cache on the A15; no switch to DR1 before the event (DR1 expected 12 Nov 2026 **[verify]**, Q-137).
- Desktop browser only (Q-132). Sound is specified in R8.9.2 ([audio-pairing.md](../../rendering/haptics/audio-pairing.md)).

### A19.2 Entry points

Track receives one thing: the object id that `/v1/resolve` returns (D-16). It never takes positions from the caller.

| From | Id comes from | Spec |
|---|---|---|
| Area search, Known card, **Track it** | `/known[].object_id` (A17.5) | [A18.5](area-ui.md#a185-options-and-known-objects) |
| Area search, Discovery, **Open in Track** (found blind only) | `match.object_id` (A17.5) | [A18.7](area-ui.md#a187-result-card) |
| Object panel of any `moving = true` object, **Track it** | the resolved id | **Proposed (Q-181)** |
| A link with `track=<id>` in the hash | the hash (A21.11) | [A20.1](track-ui.md#a201-where-track-lives) |

Track is the `track` kind of the shell's split pane (A21.8 in [sky-shell-behaviour.md](../sky-shell-behaviour.md), pane kinds proposed as Q-171), not a rail tool: it has no `ToolId` (**Proposed (Q-181)**, amending Q-131's "tool id"). An id with `moving = false` is refused in the frontend as `track:not_moving`.

### A19.3 Frame list

- **Source:** `GET /v1/objects/{id}/frames`, the moving-object path search of [A4.1](../pipeline.md#a41-stage-1-find-the-object) as PR #53 built it: one SPHEREx-centred Horizons ephemeris per window, SIA cones along the path, merged by `frame_id`, kept when the exact `TLIST` position at the frame midpoint is inside the frame's `s_region`. Its settings (`SX_MOVING_*`: cone radius, step clamp, cone cap, MAXREC, pacing) are **[verify]** (`backend/app/settings.py`; A3.1 "Moving objects" row).
- **Track window:** the target's `moving_windows` in `backend/targets.toml`. For 433 Eros: `[["2026-03-20T00:00:00Z", "2026-03-22T00:00:00Z"]]` (**Proposed (Q-184)**). Without it the default window covers the whole release (a live search for 20 Mar to 10 Apr alone found 102 frames). Expected result: 16 frames (2 visits × 4 exposures × 2 detectors) **[verify]** with production settings.
- **Footprint for movers:** the overlays reply serves each frame's `s_region` as `footprint` for movers too (the path search already reads it), instead of refusing `footprint:<id>`. **To build** ([A4.9](../overlays.md#a49-overlays-flag-mask-and-combine) change).
- **MOST:** whether IRSA's Moving Object Search Tool replaces the cone search is one question: [Q-126](../../decisions/moving-frames.md) (PR #53's entry, Kevin) and [Q-140](../../decisions/moving-frames.md) (this branch's) ask the same thing. Q-140's data point (about 115 images over 10 to 31 Mar 2026 against 16 in the 2-day fixture) compares different windows and has to be redone over one window. Open: whether MOST positions are SPHEREx-centred **[verify]**.

### A19.4 Positions

- **Observer:** SPHEREx, `500@-163182` ([A3.4](../data-sources.md#a34-jpl-horizons), Q-138). Everything Track draws for the object uses it: path, marker, predicted ring, path segment in the zoom.
- **At each frame:** an exact Horizons `TLIST` at the frame midpoint (`exact_positions` in `backend/app/core/find/moving.py`). The 3σ RA/Dec uncertainty is added from the same request (Horizons quantity 36 **[verify]**); the code does not ask for it yet (`QUANTITIES='1'`).
- **Path line:** the 10-min samples of the same ephemeris (`SX_MOVING_EPHEM_STEP_MIN`, inside the ~95 min orbit, so the parallax wobble is sampled). Windows are never joined across a gap.
- **Marker between exposures** (Q-142): linear in the unit vector between the two nearest 10-min samples (the path search's interpolation formula, A4.1 step 3). Error bound for a parallax amplitude `A` and orbital period `P`: about `A·(π·h/P)²/2` for a step `h`; for Eros (`A` ≈ 25″, `h` = 10 min) about 1.4″ (0.2 px) **[verify]** against the TLIST positions. At an exposure time the marker snaps to the exact TLIST position. An hourly table is never used (up to 6″ on Eros, Q-138). **Proposed (Q-185)**, clarifying Q-138 and Q-142.
- **Tags:** RA/Dec, `x`/`y`, path and marker `model_dependent`, with the path search's assumption ([Q-125](../../decisions/moving-frames.md)): "JPL Horizons orbit solution; astrometric RA/Dec (ICRF) seen from the SPHEREx spacecraft (CENTER=500@-163182), TIME_TYPE=UT, at the frame midpoint" (for the path: "every 10 min, linear between samples").
- **End of the SPHEREx ephemeris:** Horizons' SPHEREx ephemeris ends 2026-12-07 (Q-62). The cached QR2 frame times end on 2026-05-14 (A3.1), well before it. A time without a SPHEREx ephemeris is refused (`path:observer`); Track never falls back to the geocentre (the lighting fallback of Q-62 is a different use). The resolve-epoch position (14 Nov 2026) is never drawn in Track (Q-142).

### A19.5 Path endpoint

`GET /v1/objects/{id}/path[?start=<iso>&end=<iso>]` (Q-141, open, Kevin). Beyond D-16; a D-16 note is pending. Listed in the endpoint register [A4.11](../endpoints.md).

- **Reply:** `{id, observer: "500@-163182", step_min, windows[{start, end}], points[{time, ra, dec}], frame_points[{frame_id, time, ra, dec, ra_3sigma_arcsec, dec_3sigma_arcsec}], tag: "model_dependent", assumption, formula, interp_error_arcsec, missing, fetched_at, cached_at}`. Times ISO-8601 UTC with `Z`; RA in [0, 360).
- **Cache only.** It reads the `derived.path` entry. The object job (Q-111) fills it in the same run as the frame list, reusing the ephemeris the path search already fetched (same cache keys). When the entry is absent and the backend is online, the request starts or joins the job and answers 200 with `points: []` and `missing: ["path:deferred"]`; the frontend polls as for frames (Q-97: one request in flight, backing off). Offline and absent: `path:not_cached`.
- **Size cap:** `start`/`end` are clipped to the windows; a span over 31 days **[verify]** answers 400 `path_span_too_long`. Without parameters: every window when the total is under the cap, else the first window.
- **Codes in `missing`** (A19.10): `path:deferred` (the job is filling the entry; poll); `path:not_cached` (offline and absent); `path:observer` (a time with no SPHEREx ephemeris, A19.4); `path:ephemeris` (Horizons gave no usable ephemeris for a window: a failed call or a 200 text without an ephemeris block; the reply is incomplete and not stored); `path:window` (`start` and `end` lie outside every window, so `points` is empty).
- **Errors:** 404 `not_found` (unknown id), 404 `not_moving`.
- **JPL terms (Q-141):** one Horizons request at a time, with a User-Agent that names the app. A process-wide gate (a lock plus `SX_HORIZONS_PACE_S` **[verify]**) wraps every call in `backend/app/adapters/horizons.py`: resolve, lighting (Q-62), the path search, TLISTs and Area search's checks. An answer that comes back as HTTP 200 text without an ephemeris block (over the limit, or an error) is a failure and is never cached as success. **Not built yet:** the path search paces SIA cones (`Pacer` in `backend/app/core/find/moving.py`) but not Horizons, and Q-111 starts the lighting geometry and the frame list together.

### A19.6 Star list for movers

Built once (Kevin) and shared with Discovery's star step ([A17.3](area-backend.md#a173-glitches-stars-and-fixed-dots-cleanpy)), Q-143. **To build** in `backend/app/core/find/overlays.py`, which skips the catalogue cones for movers today.

- **Cones:** per visit, one Gaia DR3 cone and one CatWISE2020 cone. Track: at the visit's mean predicted position, radius = the cutout's half-diagonal (0.0707° for a 0.1° cutout) + the object's motion over the visit + 30″. Area: at the area centre, radius = half-diagonal + 30″.
- **Limits:** Gaia `G < 20`; CatWISE `W1 < 16.5` **[verify]**. Sources propagated with their proper motion to each frame time (`derived`).
- **Mask radius from magnitude** (starting values, **[verify]** on the Eros frames): Gaia `r = clamp(2 + (14 − G), 2, 10)` px; CatWISE-only sources `r = clamp(2 + (11 − W1), 2, 10)` px. A fixed `G < 20` cut with one radius over-masks in the Galactic plane (Q-143).
- **Shown near the track only:** masks within 8 px **[verify]** of the predicted path in the cutout. Tag `derived`.
- **Contamination:** the aperture and annulus lists of [A4.9](../overlays.md#a49-overlays-flag-mask-and-combine), computed at the predicted pixel. A4.9's rule that the nearest source within 2 px is the target itself (Q-53) does not apply to movers: a mover is never a catalogue source.
- **Codes:** `overlay:<cat>`, `overlay:<cat>:pending`, `overlay:<cat>:truncated` (A4.9); Area search lists `stars:<cat>:<visit>` (A17.8).

### A19.7 Photometry for movers

- Stage 2 measures each kept frame at the predicted pixel, with no re-centring ([A4.2](../pipeline.md#a42-stage-2-measure-brightness-and-spectrum)).
- **OUTLIER on the core** (Q-139; the rule's owner is A4.2, ticket T4, Moon): for `moving = true` only, `OUTLIER` within the 1.5 px core is recorded, not refused: the point is `flagged: true` and `flag_reasons` gains `outlier_core`. Hardware flags in the core still refuse (`aperture_flags:<frame_id>`). `MEASURE_VERSION` is bumped. Expected on Eros: 14 of 16 points; the 2 refused frames carry `NONFUNC`, `SUR_ERROR`, `TRANSIENT`.
- **Tags:** the spectrum and light curve stay `measured`; the aperture centre is `model_dependent` ([Q-125](../../decisions/moving-frames.md)).
- **Not built yet:** Stage 2 still refuses `OUTLIER` on the core (`backend/app/core/measure/config.py:39`), so 15 of 16 Eros frames are refused as `aperture_flags` (A4.2). Q-125 raises the same question; Q-139 answers it.
- Each spectrum and light-curve point carries `frame_id`, so the zoom and the spectrum can follow the same exposure ([A19.13](track-contract.md#a1913-contract)).

### A19.8 Extended sources

3I/ATLAS only, a stretch goal (Q-137, Q-144). Specified here, built after Eros works.

- **Caption** on every point: "aperture, not total flux; background taken from inside the coma" (D-31 precedent). The coma (about 3′) is larger than the 6 to 9 px annulus (37″ to 55″), so the background is coma light.
- **Measurable refusal test** (**Proposed (Q-186)**, making "the coma fills the aperture" measurable): concentration `C = F(r ≤ 1.5 px) / F(r ≤ 3 px)` with the Stage 2 weights. `C_psf` is the median `C` of isolated, unmasked catalogue stars in the same frame (A19.6). A steady coma with brightness falling as 1/ρ gives `C` = 0.5 before the PSF. A frame with `C ≤ 0.5 + δ` (`δ` = 0.05 **[verify]**) shows no point-like core above the coma, so the coma fills the aperture: it is refused as `extended_source:<frame_id>`, and as `spectrum:extended_source` when every frame is. A frame with `0.5 + δ < C < C_psf − δ` is shown with the caption.
