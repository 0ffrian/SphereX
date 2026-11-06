# backend

FastAPI on Python 3.12 ([D-15](../docs/decisions.md#d-15-backend-framework-fastapi-answers-q-01)). It holds the API, the data adapters and the read-through cache. The pipeline and the texture baker will join it. The event build runs locally on the team's Asus A15 (D-24). CPU only.

## Run

Needs Python 3.12 and [uv](https://docs.astral.sh/uv/) 0.12. Dependencies are pinned exactly in `pyproject.toml` and locked in `uv.lock`.

```bash
cd backend
uv sync --locked
uv run uvicorn app.main:create_app --factory --host localhost --port 8000   # http://localhost:8000/v1/...
uv run pytest -q          # offline, recorded fixtures only
uv run ruff check . && uv run ruff format --check . && uv run mypy
uv run python -m scripts.generate_contract   # after changing shared/schemas/ (add --check to compare only)
```

`app/contract/` is generated from [`shared/schemas/`](../shared/README.md) by `datamodel-code-generator` 0.89.0 (D-18). Do not edit it. The Pydantic models cannot express the R3.1 `formula` and `assumption` rules; fixture tests use `jsonschema` 4.26.0 for those. Serialise them with `exclude_unset=True`: a plain dump adds `null` for unset fields, and `exclude_none` drops the required `value: null` and `scale_m: null` (Q-40). `app/api/models.py` still holds the hand-written M1 response models. `/card` and `/render-params` are built as plain dicts and checked with `jsonschema` 4.26.0 (now a runtime dependency) by `app/core/card/validate.py` (Q-40).

From the repo root: `npm run backend:setup`, `backend:dev`, `backend:test`, `backend:check`, `backend:prefetch` and `backend:smoke-offline`.

In development the frontend's Vite server proxies `/v1` to `http://localhost:8000`. At the event, one process serves the built frontend and the API from one origin (D-24, M5).

## Endpoints (D-16)

| Endpoint | Returns |
|---|---|
| `GET /v1/resolve?q=<name or "ra,dec">` | `{id, name, ra, dec, moving, resolver, cached_at}` plus optional `epoch`, `pm_ra_mas_yr`, `pm_dec_mas_yr` and `provenance` |
| `GET /v1/objects/{id}/frames` | `{id, frames[], stretch, data_release, cached_at, missing, north_up}` plus a `provenance` map. Each frame: `frame_id, time, wavelength_um, x, y, cutout_url, flags`, plus optional `ra, dec, bandwidth_um, detector, width, height, north_angle_deg, mirrored` |
| `GET /v1/objects/{id}/cutouts/{frame_id}.png` | 8-bit grey PNG, asinh stretch, the same bytes every time |
| `GET /v1/objects/{id}/spectrum` | `{id, spectrum[], light_curve[], flux_unit, tag, cached_at, missing}` plus optional `data_release`, `method`, `provenance`. Flux in `uJy`, tagged `measured`. Spectrum points: `wavelength_um, flux, error, flagged, frame_id` plus optional `bandwidth_um, dropped_flags, dropped_weight_fraction, flag_reasons`. Light-curve points: `time, flux, error, frame_id` plus optional `wavelength_um, flagged`. Refused frames are listed in `missing` as `<reason>:<frame_id>` (e.g. `saturated:…`); `spectrum:saturated` when every frame saturated (A4.2, Q-26) |
| `GET /v1/objects/{id}/card` | ObjectCard (R3.2), exactly the `shared/schemas` shape and validated with `jsonschema` before it is sent. Headers: `X-SX-Asset-Status` (`saved`, `generated` or `sketch`, A4.4) and `X-SX-Cached-At` (D-16; the schema forbids extra fields, Q-39) |
| `GET /v1/objects/{id}/render-params` | RenderParams (R3.4), validated the same way, with the same headers. Refused layers are listed in `missing` |
| `GET /v1/health` | `{status, offline, data_release}` |

Per-target spectrum report on a cache: `SX_OFFLINE=1 uv run python -m app.core.measure [--only NAME]`.

Errors are `{"error": code, "detail": sentence}`. The codes are:
- `bad_query` and `bad_request` (400)
- `not_found` and `frame_not_found` (404)
- `offline_cache_miss`, `upstream_unavailable` and `cutout_unavailable` (503)
- `internal` (500): any unexpected error. The traceback is logged on the server, never sent. It is produced inside the CORS middleware, so it carries CORS headers too.

**Contract rules:**
- Every time is ISO-8601 UTC with a trailing `Z`.
- Pixel positions:
  - `x` and `y` are 0-based positions in the PNG as served, with the origin at the top left and y pointing down. An integer coordinate is a pixel centre.
  - The PNG is the FITS array flipped vertically, so `y = (height - 1) - y_fits0`.
- Orientation:
  - `north_up` is `false`: the frames are in native orientation.
  - To show north up, rotate the PNG clockwise by `north_angle_deg` about `(x, y)`. Then flip it horizontally if `mirrored` is true.
- `epoch` in `resolve` is ISO-8601 UTC: `2000-01-01T11:58:55.816Z` (J2000.0) for SIMBAD positions, `SX_EPHEMERIS_EPOCH` for moving objects, absent for typed coordinates.
- Typed coordinates are tagged `derived` (user input, Q-25).
- A Flamsteed name (`61 Cyg`, `51 Pegasi`) goes to SIMBAD first. Its SBDB fallback is accepted only when the asteroid's name is the query (`849 Ara`), so a star name never resolves to a numbered asteroid.
- Moving objects (solar-system bodies, Q-22) get `frames: []` and `missing: ["frames:moving_object_search"]` in M1 (Q-21).

## Texture baker (R6, issue #6)

`app/core/render/` bakes equirectangular maps on the CPU with numpy and Pillow: `albedo.webp` (lossless), `height.png`, `height.bin` (float16 little-endian, W×H) and `normal.png`, and `bake.json` (a hash of parameters, size and rules version; a mismatch rebakes) into `{root}/{id}/{generator_version}/{seed}/{width}x{height}/` (R6.7 plus a size directory, Q-47; `:` and other unsafe characters in the id are percent-encoded, so `sbdb:101955` is `sbdb%3A101955`). Baked types: `asteroid_procedural`, `brown_dwarf`, `brown_dwarf_binary`; any other type is refused (Q-47).

```bash
uv run python -m app.core.render ../shared/fixtures/cards/asteroid_procedural.json --seed 2 --out ./textures   # ~17 s at 2048x1024
```

`params_from_card(card, seed)` applies the R6.2 rules. It raises `BakeRefusal` (with the missing card fields) only when an asteroid's diameter is missing or not finite, a brown dwarf's spectral class has no palette, or the type has no recipe. Other missing inputs bake flat and are listed in `BakeParams.missing` (`albedo_map` for no colour, `gaia_rgb` for an unusable one, `brightness`, `bands`); NaN and infinity count as missing. `bake()` returns the arrays; `bake_to_cache()` writes the files atomically and skips a bake whose four files exist and whose `bake.json` hash matches; it is safe for concurrent callers. Bump `BAKER_RULES_VERSION` whenever a rule in R6.2 to R6.5 changes. Same card and seed give the same bytes on a given numpy and Pillow build; the tests check it by SHA-256.

## Settings (`SX_*` environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `SX_OFFLINE` | `0` | `1` never touches the network: no HTTP client is created, and astropy downloads are off (D-25). The demo runs this way. |
| `SX_CACHE_DIR` | `%LOCALAPPDATA%\ShiftSpectrum\cache` on Windows, `~/.cache/shift-spectrum` elsewhere | The cache stays outside git. The app warns if the directory is inside a git work tree. |
| `SX_DATA_RELEASE` | `spherex_qr2` | The SIA collection. It is part of every IRSA cache key. |
| `SX_SIA_MAXREC` | `500` | The frames limit for one search. 2000 timed out; Barnard's Star returned 240 frames at 500. |
| `SX_SIA_RADIUS_DEG` | `0.001` | A tiny cone (A3.1). |
| `SX_CUTOUT_SIZE_ARCSEC` | `360` | About 58 px. A display choice, not a physical value. |
| `SX_CUTOUT_KEEP_PSF` | `0` | Q-20: the PSF extension is not cached. With `1`, cutouts are cached under a different key. |
| `SX_LIVE_CUTOUTS_PER_REQUEST` | `24` | A web request downloads at most this many cutouts live; the rest are listed as `cutouts:deferred:<n>` and the list is not stored. The pre-fetch has no cap. |
| `SX_LIVE_FAILURE_TTL_S` | `600` | A cutout whose live download failed is skipped by web requests for this long (listed as `cutout:<id>`), so it cannot use up the live budget. The pre-fetch always retries. |
| `SX_SIMBAD_TAP_URLS` | CDS, then the Harvard mirror | Comma-separated and tried in order. |
| `SX_EPHEMERIS_EPOCH` | `2026-11-14T00:00:00Z` | The time used for a moving object's `resolve` position. |
| `SX_SEARCH_EPOCH` | `2026-01-01T00:00:00Z` | The time used for a proper-motion star's SIA search cone. |
| `SX_HTTP_*` | 10 s connect, 60 s read, 3 retries, 1 s backoff (doubles) | |
| `SX_CORS_ORIGINS` | empty | Needed only when the frontend runs without the Vite proxy. |
| `SX_ASSETS_DIR` | `backend/assets` | Pre-baked assets read by stage 4 (A5.4), `<type>/<id>.json` with the D-22 fields. |

## Cache (D-25)

- **Every external call goes through `app/cache/store.py`.**
- **Key:** the source, the data release and the normalised query. Coordinates are rounded to 1e-5° and RA is wrapped to [0, 360). The key is hashed with SHA-256.
- **Layout:** `<SX_CACHE_DIR>/v1/<source>/<release>/<sha[:2]>/<sha>.body` holds the raw bytes, and `<sha>.json` holds the meta: key, URL, status, `fetched_at` and the body's SHA-256.
- **Order:** cache, then a live call with a timeout and retries, then an older entry, then refuse. There is no expiry.
- **What is cached:** "not found" answers are cached. Timeouts and 5xx answers are not.
- **SIA entries:** the key leaves out MAXREC. The MAXREC used is in the meta. An answer with `QUERY_STATUS=OVERFLOW`, or with as many rows as MAXREC, puts `frames:truncated` in `missing`.
- **Cutouts:** the IBE response with the `PSF` extension cut out at its byte boundaries (Q-20). The meta keeps the original SHA-256 and size.
- **Derived entries:** `derived.object`, the object registry that `resolve` fills, and `derived.frames`, the frame list. A frame list is not stored when the search was truncated or a cutout failed to download, because more data could still change it. Each key carries `DERIVATION_VERSION`. PNGs are rendered on request and never cached.
- **`cached_at`:** the earliest `fetched_at` among the cache entries a response used.

## Pre-fetch, fixtures, offline check

```bash
uv run python -m scripts.prefetch                 # all targets in targets.toml (resumable)
uv run python -m scripts.prefetch --only "R Draconis" --concurrency 6
uv run python -m scripts.prefetch --refresh       # re-download resolve, SIA and cutouts; rebuild frame lists
uv run python -m scripts.smoke_offline --group test   # Done-when check: SX_OFFLINE=1, network blocked
uv run python -m scripts.backup_cache             # zip the cache next to it
uv run python -m scripts.record_fixtures          # re-record tests/fixtures/cache (needs the internet)
```

- **What is pre-fetched:** `targets.toml` lists the five test targets and `433 Eros`, a moving object for the SBDB and Horizons path. Demo objects go there with `group = "demo"`.
- **Timing:** a cutout takes 10–30 s to download, because IRSA sends the 5 MB PSF extension too. A full pre-fetch takes about 30 minutes per target at concurrency 6.
- **Test fixtures:**
  - They are plain cache entries recorded live by `record_fixtures`: three frames per target (MAXREC=3) at the default cutout size, about 2 MB in all.
  - `derived.*` entries are removed after recording, so the tests run the real SIA, cutout and WCS path.
  - The tests block every non-loopback socket.

## Layout

```
app/main.py, settings.py, errors.py, context.py, offline.py, timefmt.py
app/api/          (Kevin, R10)  resolve.py, objects.py, models.py, deps.py; spectrum.py (issue #2)
app/cache/        keys.py, store.py: D-25 read-through cache
app/adapters/     http.py, irsa_sia.py, irsa_cutout.py, simbad.py, sbdb.py, horizons.py, skybot.py
app/contract/     generated from shared/schemas/ (D-18, do not edit): ObjectCard, RenderParams
app/core/find/    (Kevin, Stage 1, A4.1) ids, resolver, propagate, wcs, frames, cutouts, png
app/core/measure/ (Moon, Stage 2, A4.2) config, flags, aperture, solid_angle, photometry, spectrum
app/core/classify/ (Atish, Stage 3, A4.3) rules.py: R3.3 type selection; R12 #12 exoplanet thresholds block (all None)
app/core/card/    (Kevin, Stages 4-5, A4.4-A4.5) catalogue, build, assets (A5.4 store), validate, service
app/core/render/  (Atish, R10) texture baker; card_to_params (Stage 7, A4.7), blackbody, spherex_rgb
assets/           A5.4 pre-baked assets, <type>/<id>.json (SX_ASSETS_DIR; none yet)
scripts/          prefetch, smoke_offline, backup_cache, record_fixtures, generate_contract
tests/            pytest; tests/fixtures/cache holds the recorded cache entries
```
