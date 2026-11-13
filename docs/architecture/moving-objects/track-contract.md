# Track: export, codes, provenance, cache and contract

> **Part of:** Architecture spec ([index](../README.md)) · **Sections:** A19.9 to A19.15 · **Implements:** [Q-137](../../decisions/scope-process.md), [Q-135, Q-136, Q-141, Q-145](../../decisions/moving-objects.md), D-16, D-18 ([contract](../../decisions/contract.md)), D-02, D-21 ([contract-tags](../../decisions/contract-tags.md)), D-25 ([data-sources](../../decisions/data-sources.md)) · **Read with:** [track.md](track.md) (A19 to A19.8), [track-ui.md](track-ui.md) (A20), [area-contract.md](area-contract.md) (A17.7)

Status: **not built**, except the star list for movers ([A19.6](track.md#a196-star-list-for-movers), #95). Owner: Kevin (**Proposed (Q-183)**). Sections A19.1 to A19.8 (scope, entry points, frames, positions, path endpoint, star list, photometry, extended sources) are in [track.md](track.md).

## A19 Track (continued)

### A19.9 Export

`GET /v1/objects/{id}/track.ecsv` (Q-145, open, Kevin). The **shared ECSV writer** `backend/app/core/export/ecsv.py` (astropy 8.0.2) owns the base columns below; Area search adds its own columns ([A17.7](area-contract.md#a177-export)).

| Column | Unit | Tag (Track) |
|---|---|---|
| `frame_id`, `detector`, `time_utc` (ISO), `mjd_utc`, `exptime_s` | `mjd_utc` in d (UTC), `exptime_s` in s | `measured` |
| `ra_deg`, `dec_deg`, `ra_3sigma_arcsec`, `dec_3sigma_arcsec`, `x_px`, `y_px` | deg, deg, arcsec, arcsec, px, px | `model_dependent` (Area dots: RA/Dec `derived`, `x`/`y` `measured`) |
| `wavelength_um`, `bandwidth_um` | µm | `measured` |
| `flux_ujy`, `flux_err_ujy`, `flagged`, `flags`, `flag_reasons` | µJy | `measured` |
| `contamination` (sources in aperture and annulus) | | `derived` |
| `refusal` (code, empty when measured) | | (a code, no tag) |

- One row per frame of the frame list; refused frames stay as rows with empty flux and the `refusal` code. The metadata holds each column's tag, the object id, designation, `spkid`, observer, assumption, data release, windows, `MEASURE_VERSION`, the `method` block, `generated_at` and `cached_at`.
- Built from the cached frames, spectrum and overlays only; while any of them is not final the endpoint answers 503 `track_incomplete`.
- Never written: the synthetic spin data (Q-135). No ADES (no SPHEREx MPC observatory code).

### A19.10 Refusal codes

Wording for every code lives in `frontend/src/app/refusals.ts` and `messages.ts` (`backendReasons.test.ts`, from PR #53, checks that every code in `moving.py` has wording). This table owns the Track codes; the register of every code, with its meaning, is [A4.12](../refusals.md#a412-missing-and-refusal-codes), which lists the new ones as planned.

| Code | Where | Marks the result incomplete (not stored) |
|---|---|---|
| `frames:ephemeris`, `frames:cone_failed:<n>`, `frames:search_deferred:<n>` (poll), `ephemeris:<frame_id>` | `/frames` (built, issue #26) | Yes |
| `frames:moving_window`, `frames:cone_cap:<n>`, `frames:cone_maxrec:<n>`, `frames:sparse_path:<n>`, `frames:outside_window:<n>`, `no_footprint:<frame_id>` | `/frames` (built, issue #26) | No |
| `cutout:<id>`, `wavelength:<id>`, `outside_cutout:<id>`, `cutouts:deferred:<n>`; `aperture_flags:<id>`, `aperture_edge:<id>`, `saturated:<id>` and the rest of A4.2 | `/frames`, `/spectrum` | As A4.1, A4.2 |
| `overlay:<cat>`, `overlay:<cat>:pending`, `overlay:<cat>:truncated`, `footprint:<id>`, `flags_mask:<id>` | `/overlays` (A4.9) | No |
| `path:deferred` (poll), `path:ephemeris`, `path:observer` (meanings in [A19.5](track.md#a195-path-endpoint); built, issue #74) | `/path` | Yes |
| `path:not_cached`, `path:window` (A19.5; built, issue #74) | `/path` | No |
| `path:frames_incomplete` (poll; built, issue #74, A19.5) | `/path` | Yes |
| **New:** `extended_source:<frame_id>`, `spectrum:extended_source` | `/spectrum` (A19.8) | No |
| **New:** `imagery:<survey>` (A20.5), `track:not_moving` | frontend | |

Q-21's text still says `frames:truncated` past the cone cap; PR #53's entry, merged as [Q-125](../../decisions/moving-frames.md), and the code use `frames:cone_cap:<n>`, and Track follows Q-125. A fixed object keeps `frames:truncated`.

### A19.11 Provenance per value

| Value | Tag | Note |
|---|---|---|
| Cutout pixels, time, exposure time, wavelength, bandwidth, flux, error, flags, flag mask | `measured` | A4.1, A4.2 |
| Footprint (`s_region`) | `measured` | IRSA metadata |
| Path line, marker, predicted ring, path segment in the zoom, per-frame RA/Dec and `x`/`y` | `model_dependent` | A19.4 assumption |
| Cutout box, star masks, contamination, wavelength colour (Q-27 open), apparent rate between visits | `derived` | Formula in `provenance` |
| Other known objects in a frame (SkyBoT candidates at Horizons positions) | `model_dependent` | A17.5 |
| SBDB facts in the header (class, rotation period, H) | as the ObjectCard tags them | [A4.5](../pipeline-card.md#a45-stage-5-objectcard) |
| Sky backdrop and high-resolution imagery | per Q-88 (open) | A20.5 |
| Spin slider and its lightcurve | `artistic` | Q-135; never exported or sonified |
| Exposure tick sound; reference click; path voice | `measured`; `measured`; `model_dependent` | Q-134, Q-194, R8.9.2 |

### A19.12 Cache, offline and pre-fetch

- **Raw answers** (D-25): Horizons range ephemerides, TLISTs and vectors; SIA cones; cutouts; Gaia TAP and CatWISE cones. Never hand-edited; re-recorded with the pre-fetch script.
- **`derived.path`**: not used as built (Q-141 option b, issue #74). `/path` reads the Horizons range answers of the path search directly, so the raw answers above are the only entries; frames and spectrum keep their A4.1 and A4.2 entries.
- **Pre-fetch for the demo** (Q-137): `scripts.prefetch` for the group that holds Eros (`demo` since #73, Q-197 in [A3.12](../targets.md); or `--only "433 Eros"`) fetches Eros's frames, path, overlays with star lists, cutouts and spectrum **with production settings** and `SX_OFFLINE=0`, then the run is checked under `SX_OFFLINE=1`. PR #53's fixtures used a deliberately sparse 24 h step, so their keys do not serve production settings.
- **Area search** pre-fetches Track for every Known object of each prepared area, or lists the ones it skipped. `track_available` is true when the frame list, path and spectrum of that id are final in the cache.
- **On demand** (issue #142, Q-468): instead of that pre-fetch, `POST /v1/objects/{id}/track` runs a Track job for one object over a window around a given time ([A19.3](track.md#a193-frame-list)). It writes the same kinds of entries (frame list, Horizons range answers, cutouts, `derived.spectrum`) under that window's keys; the Track readers given the same `around` and `days` read them, and the job reports `track_available` for that window. Nothing is stored for other callers, so an area's `track_available` (above) and the pre-fetch's keys never change because of such a request. Offline, a window whose entries are not cached reports why (`reason`) and nothing else changes.
- **Imagery:** the order-11 HiPS copy around the demo path waits for CDS permission (Q-136, D-35) **[verify]**; until then the detail view uses the 2MASS mirror (A20.5).

### A19.13 Contract

- `shared/schemas/track-path.schema.json` for the `/path` reply (D-18), generated into `backend/app/contract/` and `frontend/src/contract/`. Owner of `shared/schemas/`: Moon (D-17). **Built** (issue #74).
- `shared/fixtures/track/eros-2026-03/`: the path reply built from PR #53's recorded Horizons answers (real data, no Fixture badge; `path.json`, written by `scripts/track_fixtures.py`, built in issue #74), plus, **not built yet**, a synthetic mover with a refused frame, a deferred path and an extended source (`X-SX-Fixture: synthetic`, Q-32).
- Hand-typed replies (Q-50) gain: `detector` per frame in `/frames`; `north_angle_deg` and `mirrored` always set for movers; `frame_id` on spectrum and light-curve points; `footprint` for movers in `/overlays`. **Built (issue #95):** `frames[].masks` (`StarMask {catalog, id, x, y, r_px}`, `[]` for fixed objects) in `backend/app/api/models.py`; the frontend type and parser come with T2 (#82) (`validate.ts` drops the unknown field until then, without rejecting the reply).
- The ECSV column list of A19.9 is the export's contract and is tested.

### A19.14 Owners, tickets and tests

| Part | Owner | Ticket |
|---|---|---|
| Path endpoint, Horizons gate, `moving_windows` for Eros, footprints for movers, ECSV writer, contract fields, pre-fetch | Kevin | **T1 Track backend** |
| Star list for movers (A19.6), shared with Discovery | Atish (Q-404) | **P1** (#95, built) |
| OUTLIER-core rule in Stage 2 (A4.2) | Moon | **T4** |
| Track screen; Track sound | Atish | T2, T3 ([A20.15](track-ui.md#a2015-tests-and-tickets)) |

Milestone M4 Extras, priority P1 because Track is the MVP demo (**Proposed (Q-187)**). Tests (backend, offline on recorded answers): the path from the recorded Horizons replies; an over-limit 200 text answer is not cached; the interpolated marker against the TLIST positions within the stated bound; the Horizons gate never runs two calls at once; Eros gives 14 of 16 points, 13 flagged `outlier_core` **[verify]**; the star list's radii and the near-track filter; the ECSV round trip (tags in the metadata, refusal rows kept, no spin columns); `path:deferred` then a final path.

### A19.15 Open items

| Item | Owner | Status |
|---|---|---|
| MOST against the cone search; MOST's observer | Kevin | Q-126 (Q-140 asks the same) **[verify]** |
| DR1 release date | Atish | **[verify]** (Q-137) |
| CDS permission for an order-11 copy | Atish | Open (Q-136) |
| Mask radius formula (G and W1 zero points, 2 to 10 px), `W1 < 16.5`, the 8 px near-track distance, the 3″ de-dupe radius | Atish (Q-404) | **[verify]** on the Eros frames: radial profiles of isolated stars per magnitude bin; W1 depth against SPHEREx QR2 point-source depth (Q-403) |
| `MAX_LIVE_VISIT_CONES` = 8 per catalogue per request | Atish | Assumption (Q-403 (6)) |
| ESA archive synchronous row limit for the 50000-row area cone | Atish | **[verify]**; until verified, P4 refuses an area Gaia answer not served from `gaia_dr3_source` (Q-403 (5)) |
| Size of the marker's interpolation error | Kevin | **[verify]** against TLIST |
| `SX_MOVING_*` limits, path span cap, Horizons pacing | Kevin | **[verify]** (`backend/app/settings.py`; A3.1 "Moving objects" row; A3.4) |
