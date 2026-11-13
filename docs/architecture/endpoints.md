# Endpoint register

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A4.11 · **Implements:** [D-16](../decisions/contract.md), [D-25, Q-328](../decisions/data-sources.md), [Q-39](../decisions/contract.md), [Q-50](../decisions/data-sources.md), [Q-87](../decisions/sky-shell.md), [Q-92](../decisions/data-sources.md), [Q-98](../decisions/sky-shell.md), [Q-111](../decisions/pipeline-jobs.md), [Q-122](../decisions/gemini.md), [Q-141](../decisions/moving-objects.md), [Q-145](../decisions/moving-objects.md), [Q-146](../decisions/moving-objects.md), [Q-164](../decisions/demo-pack.md), [Q-195](../decisions/contract.md), [Q-468](../decisions/moving-objects.md) · **Read with:** [refusals.md](refusals.md) (A4.12), [../../backend/README.md](../../backend/README.md#endpoints-d-16) (response shapes)

### A4.11 Endpoint register

Every HTTP route the backend serves or is planned to serve, in one list. D-16 decides six routes; the others are "beyond D-16" until the decision named in the row is answered. Each row links the section that specifies the route. **Response shapes** (every field) are owned by [backend/README.md](../../backend/README.md#endpoints-d-16), which is kept in step with `backend/app/api/models.py`; specs describe behaviour and link there instead of copying shapes.

**Built** (`backend/app/main.py` mounts these routers and paths, 10 Nov 2026):

| Route | Purpose | Decision | Spec |
|---|---|---|---|
| `GET /v1/resolve?q=<name or ra,dec>` | name or position → object id, position, `moving` and `resolver` (`simbad`, `sbdb`, `coords` or `reference`; a reference object has no sky position, Q-328) | D-16, D-19, Q-22, Q-25, Q-258, Q-328 | [A4.1](pipeline.md#a41-stage-1-find-the-object) |
| `GET /v1/objects/{id}/frames` | the frame list the flipbook plays | D-16 | [A4.1](pipeline.md#a41-stage-1-find-the-object) |
| `GET /v1/objects/{id}/path[?start=&end=]` | a mover's Horizons path seen from SPHEREx and the exact position at each frame, cache only (the path search's cached ephemeris; a missing answer starts the object job); errors 400 `path_span_too_long`, 400 `bad_request`, 404 `not_moving`; built (issue #74), beyond D-16 | Q-141 (open, Kevin; built as option b) | A19.5 ([moving-objects/track.md](moving-objects/track.md#a195-path-endpoint)); schema `track-path.schema.json` (A19.13) |
| `GET /v1/objects/{id}/cutouts/{frame_id}.png` | one stretched cutout | D-16 | [A4.1](pipeline.md#a41-stage-1-find-the-object) |
| `GET /v1/objects/{id}/spectrum` | spectrum and light curve, `measured` | D-16 | [A4.2](pipeline.md#a42-stage-2-measure-brightness-and-spectrum) |
| `GET /v1/objects/{id}/card` | ObjectCard (R3.2) | D-16 | [A4.5](pipeline-card.md#a45-stage-5-objectcard) |
| `GET /v1/objects/{id}/render-params` | RenderParams (R3.4) | D-16 | [A4.7](pipeline-card.md#a47-stage-7-renderparams) |
| `GET /v1/objects/{id}/job` | the object job's state | Q-111 (open) | [A4.10](jobs.md#a410-object-job-and-fan-out) |
| `GET /v1/objects/{id}/job/events` | the same, as server-sent events | Q-111 (open) | [A4.10](jobs.md#a410-object-job-and-fan-out) |
| `POST /v1/objects/{id}/track` | Track on demand: body `{around, days}` (days default 3, 1 to 15, a strict number) starts the object's Track job for `around` +- `days` (clipped to its `moving_windows` or the release window); nothing is stored, so callers without the window keep the base windows. `/frames`, `/path`, `/spectrum`, `/overlays`, the cutout, flags and combine PNGs, `/job` and `/job/events` take the same optional `around` and `days`. Reply 202 with the `/job` JSON plus `track_window` (and `track_available`, `reason` once done); errors 400 `bad_request`, 400 `track_window_outside`, 404 `not_found`, 404 `not_moving`, 404 `no_ephemeris`, 429 `queue_full`; built (issue #142), beyond D-16 | Q-468 (proposed) | A19.3 ([moving-objects/track.md](moving-objects/track.md#a193-frame-list)), [A4.10](jobs.md#a410-object-job-and-fan-out) |
| `GET /v1/objects/{id}/overlays` | Gaia and CatWISE markers, contamination, footprint, star masks for movers (A19.6) | Q-50 (open) | [A4.9](overlays.md#a49-overlays-flag-mask-and-combine) |
| `GET /v1/objects/{id}/flags/{frame_id}.png` | flag mask PNG | Q-50 (open) | [A4.9](overlays.md#a49-overlays-flag-mask-and-combine) |
| `GET /v1/objects/{id}/combine.png?op=add\|sub&a=&b=` | A ± B on frame A's grid | Q-50, Q-54 (open) | [A4.9](overlays.md#a49-overlays-flag-mask-and-combine) |
| `GET /v1/objects/{id}/composite` | false-colour SPHEREx composite, metadata | Q-92, Q-94 (open) | [backend/README.md#composite](../../backend/README.md#composite); colour views in [A11](honesty-policy.md#a11-honesty-policy-user-facing) |
| `GET /v1/objects/{id}/composite.png[?v=<sha>]` | the composite image | Q-92 (open) | same |
| `POST /v1/admin/objects/{id}/gemini-repaint[?refresh=true]` | admin: Gemini albedo repaint | Q-122 (open) | [A6.2](generators.md#a62-optional-gemini-artistic-layer), [R6.6](../rendering/surface-generation.md) |
| `GET /v1/objects/{id}/albedo-ai` | repaint status for the shown bake | Q-122 (open) | same |
| `GET /v1/objects/{id}/albedo-ai.webp` | the AI albedo | Q-122 (open) | same |
| `GET /v1/sky/index.json` | the sky surveys on disk | Q-87 (open) | [A3.11](object-sources.md#a311-sky-background-irsa-hips), A21 ([sky-shell.md](sky-shell.md)) |
| `GET /v1/sky/cached` | positions whose frame list is cached | Q-98 (open) | A21 ([sky-shell.md](sky-shell.md)) |
| `GET /v1/sky/{survey}/equirect_{W}x{H}.jpg` | baked all-sky image | Q-87 (open) | [A3.11](object-sources.md#a311-sky-background-irsa-hips) |
| `GET /v1/sky/{survey}/hips/properties`, `…/hips/Norder3/Allsky.jpg`, `…/hips/Norder{k}/Dir{d}/Npix{n}.jpg` | mirrored HiPS files | Q-87 (open) | [A3.11](object-sources.md#a311-sky-background-irsa-hips) |
| `GET /data/textures/{id}/{generator_version}/{seed}/{W}x{H}/<file>` | baked texture files (static mount) | R6.7, Q-47, Q-112 | [A5.4](data-contract.md#a54-asset-store), [A4.10](jobs.md#a410-object-job-and-fan-out) |
| `GET /data/demo-textures/{id}/{generator_version}/{seed}/{W}x{H}/<file>` | the pre-built demo pack's maps (static mount of `SX_DEMO_TEXTURES_DIR`, read only, mounted under `SX_OFFLINE=1` too; only when the folder exists) | Q-164 (proposed) | [A5.4](data-contract.md#a54-asset-store) |
| `GET /data/shapes/{name}.glb` | a registered shape-model mesh | Q-44, Q-61 | [A3.10](object-sources.md#a310-added-for-the-object-view), [A5](data-contract.md#a5-data-contract) |
| `GET /v1/health` | `{status, offline, data_release, warm}`; built (`main.py`), beyond D-16; `warm` = warm-start progress `{state, total, done, failed}`; `finished` = every query in the warm list tried (issue #103) | Q-195 (proposed), Q-454 (proposed) | [A10.2](frontend-platform.md#a102-running-the-event-build) |

**Planned** (not built; proposals in open decisions):

| Route | Purpose | Decision | Spec |
|---|---|---|---|
| `GET /v1/objects/{id}/track.ecsv` | Track export (shared ECSV writer with Area search) | Q-145 (open, Kevin) | A19.9 ([moving-objects/track-contract.md](moving-objects/track-contract.md)) |
| `/v1/areas/...` (list, one area, known objects, dots, tracks, stamps, export; spectra proposed, A17.13, Q-474; checks gated and not served, D4 and D5 cut); errors 404 `area_not_found`, 404 `dot_not_found`, 503 `stamp_unavailable`. Built (issue #108, `backend/app/api/areas.py`) | Area search | Q-146 item 6; payload shapes Q-208 (proposed); as built Q-420 (proposed) | A17.8 ([moving-objects/area-contract.md](moving-objects/area-contract.md#a178-endpoints)) owns the route list |
| `POST /v1/areas/live`, `GET` and `DELETE /v1/areas/live/{area_id}` (a box drawn anywhere: plan 200, job 202, stored area 200 `done`, stop 204); errors 422 `area:too_large`, `area:bad_box`, `area:no_visit_pair`, 429 `queue_full` (more than 5 waiting), 503 `offline`, `upstream_unavailable`, 404 `job_not_found`. Built (issue #141, `backend/app/api/areas.py`, `core/area/live.py`, `core/area/live_jobs.py`) | Area search, live areas | Q-462, Q-463, Q-467 (proposed) | A17.8 ([moving-objects/area-contract.md](moving-objects/area-contract.md#a178-endpoints)) |
| `POST /v1/scans` (plan 200 without SIA, start 202), `GET /v1/runs`, `GET /v1/runs/{run_id}`, `POST /v1/runs/{run_id}/pause` and `/resume`, `DELETE /v1/runs/{run_id}` (204), `GET /v1/runs/{run_id}/results`; errors 422 `scan:too_large`, `area:bad_box`, 429 `queue_full` (also on resume), 503 `offline`, 404 `run_not_found`, 409 `run_not_pausable`, `run_not_paused`, `run_finished`. `POST /v1/areas/live` gains `kind`. Built (issue #156, `backend/app/api/runs.py`, `core/area/scan.py`, `core/area/runs.py`, `core/area/live_jobs.py`) | Area search, scans and runs | Q-470, Q-471 (proposed) | A17.8 ([moving-objects/area-contract.md](moving-objects/area-contract.md#a178-endpoints)) |

**Rules shared by every route.**

- Every object route is keyed by the id `resolve` returns (D-16). Times are ISO-8601 UTC with a trailing `Z`.
- Only `GET` and `POST` are allowed through CORS (`SX_CORS_ORIGINS`); `POST` for Track on demand (Q-468). This also lets an allowed origin send `POST /v1/areas/live` (Q-462, which has its own 429 `queue_full` cap). The admin `POST` stays `curl` only, because its `X-SX-Admin-Token` header is not an allowed header.
- JSON replies served from the cache carry `cached_at` (D-25). For the card and RenderParams, whose schema forbids extra fields, it is the `X-SX-Cached-At` header (Q-39).
- **Error envelope:** `{"error": <code>, "detail": <sentence>}` with a 4xx or 5xx status (`backend/app/errors.py`). A refusal of one value or layer is never an error: it is a 200 with the code in `missing` ([A4.12](refusals.md#a412-missing-and-refusal-codes)).

  | Status | Code | Raised by |
  |---|---|---|
  | 400 | `bad_query` | `resolve`: a query that is neither a name nor a valid position |
  | 400 | `bad_request` | a request the route cannot use (bad parameters; `combine.png` with a non-MJy/sr cutout or no finite pixel) |
  | 403 | `forbidden` | admin route with a missing or wrong `X-SX-Admin-Token` |
  | 404 | `not_found` | unknown object id or survey; a sky file not on disk; a refused composite PNG; admin routes while `SX_ADMIN_TOKEN` is unset; a name no resolver knows (`resolve`); a shape name not in the registry (`/data/shapes`) |
  | 404 | `frame_not_found` | a frame id the object's list does not hold |
  | 404 | `flags_unavailable` | a cutout with no usable FLAGS mask (permanent) |
  | 404 | `albedo_ai_unavailable` | no applied, current AI albedo |
  | 400 | `path_span_too_long` | `/path` with a `start`–`end` span over `SX_PATH_MAX_SPAN_DAYS` (A19.5) |
  | 404 | `not_moving` | `/path` or `POST /track` for an id with `moving = false`, or a Track reader given `around` for one (A19.5, Q-468) |
  | 404 | `no_ephemeris` | `POST /track` (or a Track reader given `around`) for a mover without an SPK id: Horizons has no path (Q-468) |
  | 400 | `track_window_outside` | `POST /track` or a Track reader with a window that misses every search window of the object (its `moving_windows` or the release window); no job is started (Q-468) |
  | 429 | `queue_full` | `POST /track` while 8 Track jobs already run (Q-468) |
  | 503 | `offline_cache_miss` | `SX_OFFLINE=1` and the call is not in the cache (D-25) |
  | 503 | `upstream_unavailable` | an external service failed after retries and no older cache entry exists |
  | 503 | `cutout_unavailable` | a cutout that cannot be fetched or read |
  | 503 | `reference_asset_missing` | `/card` or `/render-params` for a reference object (`resolver: reference`) with no current pre-built asset and no row in `reference_objects.toml`; re-bake with `scripts.bake_reference_objects` (Q-328) |
  | 500 | `internal` | any unexpected error; the traceback is logged, never sent |
  | other | `http_error` | any other framework HTTP error |

- **Response headers the frontend reads** (all exposed through CORS):

  | Header | On | Meaning | Spec |
  |---|---|---|---|
  | `X-SX-Cached-At` | `/card`, `/render-params` | when the answer was cached (D-16, D-25) | Q-39 |
  | `X-SX-Asset-Status` | `/card`, `/render-params` | `saved`, `generated` or `sketch` | [A4.4](pipeline-card.md#a44-stage-4-check-for-a-saved-asset) |
  | `X-SX-Measuring` | `/card`, `/render-params` | the `measuring:` items of an intermediate answer | [A4.10](jobs.md#a410-object-job-and-fan-out) |
  | `X-SX-Progress` | same | `frames <done>/<total>` | [A4.10](jobs.md#a410-object-job-and-fan-out) |
  | `X-SX-Combine` | `combine.png` | compact JSON metadata, tag `derived` | [A4.9](overlays.md#a49-overlays-flag-mask-and-combine) |
  | `X-SX-Layer-Tag` | `albedo-ai.webp` | `artistic` | [A6.2](generators.md#a62-optional-gemini-artistic-layer) |

- **Request header:** `X-SX-Admin-Token` on admin routes (A6.2).
- **Static caching:** flags and combine PNGs `Cache-Control: public, max-age=86400`; mirrored sky files `immutable`.
- **Static mounts** (`/data/textures`, `/data/demo-textures`): FastAPI `StaticFiles`, no directory listing, no path outside the root.
