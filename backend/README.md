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

From the repo root: `npm run backend:setup`, `backend:dev`, `backend:test`, `backend:check`, `backend:prefetch`, `backend:smoke-offline`, `backend:sky-mirror` and `backend:sky-bake`.

In development the frontend's Vite server proxies `/v1` and `/data` (shape meshes, baked textures) to `http://localhost:8000`. At the event, one process serves the built frontend and the API from one origin (D-24, M5).

**Object jobs and the live budget (issue #41, Q-111):** the API builds each object in one background job: catalogue, Horizons geometry and the frame list start together, cutouts download `SX_CUTOUT_CONCURRENCY` at a time in one pool shared by every object, and each cutout is measured in a worker process as it lands. Answers improve in up to three steps: first stage (catalogue data, SPHEREx layers listed as `measuring:`), partial (measured from the first `SX_LIVE_CUTOUTS_PER_REQUEST` frames, `measuring:frames`) and final. `/card` and `/render-params` return the final answer if it is ready within `SX_FIRST_ANSWER_WAIT_S`, else the newest intermediate one, with the headers `X-SX-Measuring` and `X-SX-Progress`. `/frames`, `/spectrum` and the overlays download nothing themselves: they join the job and list what is still to come as `cutouts:deferred:<n>`, so `SX_LIVE_CUTOUTS_PER_REQUEST` (Q-99) is the size of the job's first batch, and still caps a `FrameService` used without the API. Progress: `GET /v1/objects/{id}/job` and the event stream `/job/events`. On the A15 at the event, `SX_OFFLINE=1` (D-25) serves only the cache, and there is no first stage; run it with `SX_PREFETCH_ON_START=1` so the demo textures are baked before visitors arrive (Q-112). See [Settings](#settings-sx_-environment-variables).

## Shape models (A3.7, Q-61)

`assets/shapes/` holds the shape-model GLBs (`<slug>.glb` at full detail, `<slug>.lod1.glb` at half the grid) and `registry.toml`. The app reads the registry to type an asteroid `asteroid_shape` and serves the meshes at `/data/shapes/<name>.glb`. Set `SX_SHAPES_DIR` to use another folder. To add or refresh a model, download the dataset by hand (the PDS host blocks scripts), then:

```bash
uv run python -m scripts.ingest_shape --zip ~/Downloads/gaskell.ast-eros.shape-model_V1_1.zip \
  --member gaskell.ast-eros.shape-model_V1_1/data/quad/quad64q.tab --slug eros-gaskell \
  --spkid 20000433 --name "433 Eros" --doi 10.26033/d0gq-9427 --licence CC0-1.0 \
  --citation "Gaskell, R.W., Gaskell Eros Shape Model V1.1, urn:nasa:pds:gaskell.ast-eros.shape-model, NASA Planetary Data System." \
  --frame "Eros body-fixed frame of the model, origin as given (not recentred); see PCK note eros_alex.tpc.txt"
```

Input is an ICQ `.tab` (`--zip` plus `--member`, or `--input`) or an OBJ (`--input`, `--convex` for DAMIT). Output is byte-identical for the same input. Meshes over 50,000 triangles with no exact reduction are refused.

`assets/literature.toml` is a reviewed, read-only table of cited values for objects the catalogues leave empty ('Oumuamua's size and light-curve amplitude, Epsilon Indi B's component temperatures). Stage 4 uses a row only where the catalogue value is null (A3.12, Q-153); `SX_LITERATURE_FILE` points elsewhere. `assets/pm13_dwarf_teff.toml` is the Pecaut & Mamajek main-sequence Teff table behind a star's third Teff source (Q-152); `SX_DWARF_TEFF_FILE` points elsewhere. Both are edited by hand, never by code.

`assets/textures/` holds the demo pack's baked maps, served read-only at `/data/demo-textures` (`SX_DEMO_TEXTURES_DIR`, also under `SX_OFFLINE=1`, Q-164).

## Endpoints (D-16)

| Endpoint | Returns |
|---|---|
| `GET /v1/resolve?q=<name or "ra,dec">` | `{id, name, ra, dec, moving, resolver, cached_at}` plus optional `epoch`, `pm_ra_mas_yr`, `pm_dec_mas_yr` and `provenance` |
| `GET /v1/objects/{id}/frames` | `{id, frames[], stretch, data_release, cached_at, missing, north_up}` plus a `provenance` map. Each frame: `frame_id, time, wavelength_um, x, y, cutout_url, flags`, plus optional `ra, dec, bandwidth_um, detector, width, height, north_angle_deg, mirrored` |
| `GET /v1/objects/{id}/cutouts/{frame_id}.png` | 8-bit grey PNG, asinh stretch, the same bytes every time |
| `GET /v1/objects/{id}/spectrum` | `{id, spectrum[], light_curve[], flux_unit, tag, cached_at, missing}` plus optional `data_release`, `method`, `provenance`. Flux in `uJy`, tagged `measured`. Spectrum points: `wavelength_um, flux, error, flagged, frame_id` plus optional `bandwidth_um, dropped_flags, dropped_weight_fraction, flag_reasons`. Light-curve points: `time, flux, error, frame_id` plus optional `wavelength_um, flagged`. Refused frames are listed in `missing` as `<reason>:<frame_id>` (e.g. `saturated:…`); `spectrum:saturated` when every frame saturated (A4.2, D-31) |
| `GET /v1/objects/{id}/card` | ObjectCard (R3.2), exactly the `shared/schemas` shape and validated with `jsonschema` before it is sent. Headers: `X-SX-Asset-Status` (`saved`, `generated` or `sketch`, A4.4) and `X-SX-Cached-At` (D-16; the schema forbids extra fields, Q-39) |
| `GET /v1/objects/{id}/render-params` | RenderParams (R3.4), validated the same way, with the same headers. Refused layers are listed in `missing`. An intermediate answer (issue #41, Q-111) lists `measuring:spectrum`, `measuring:<layer>` or `measuring:frames` there and carries `X-SX-Measuring` and `X-SX-Progress`; so does `/card` |
| `GET /v1/objects/{id}/job` | The object's background job (beyond D-16, Q-111): `{id, state, stage, frames_done, frames_total, answer, started_at, finished_at, error, seq}`, or `{id, state: "idle"}` when there is none. Never starts a job |
| `GET /v1/objects/{id}/job/events` | The same JSON as server-sent events (`text/event-stream`), one `data:` line per change and a `: keep-alive` comment every 15 s, until the job ends; one `idle` event when there is no job (Q-111) |
| `GET /v1/objects/{id}/composite` | SPHEREx false-colour composite (beyond D-16, Q-92; constants Q-94). `{id, data_release, image_url, width, height, scale_arcsec_px, north_up: true, x, y, bands[], tag: "derived", formula, missing, cached_at}` plus optional `ra, dec, epoch` (the grid centre). Each band: `channel` (`blue`, `green`, `red`), `frame_id, wavelength_um, time` plus optional `bandwidth_um, nodata_px`. A refusal is a 200 with `image_url`, `width`, `height`, `scale_arcsec_px`, `x`, `y` all `null`, `bands: []` and the reasons in `missing` (see [Composite](#composite)) |
| `GET /v1/objects/{id}/composite.png[?v=<sha>]` | 8-bit RGB PNG, north up, east left; the same bytes for the same inputs. `v` (from `image_url`) only changes the URL when the image changes. 404 `not_found` when the composite is refused |
| `GET /v1/objects/{id}/overlays` | `{id, data_release, cached_at, catalogs[], aperture, flag_groups[], frames[], missing, provenance}`: Gaia DR3 and CatWISE2020 sources, per-frame markers in cutout pixels, aperture/annulus contamination, SIA footprint and cutout box. `missing` holds overlay codes only (`overlay:<cat>`, `overlay:<cat>:pending`, `overlay:<cat>:truncated`, `cutout:<id>`, `footprint:<id>`, `flags_mask:<id>`). A4.9, Q-50 |
| `GET /v1/objects/{id}/flags/{frame_id}.png` | RGBA mask from the cutout's FLAGS extension, colour per flag group; 404 `flags_unavailable` without a usable mask. A4.9 |
| `GET /v1/objects/{id}/combine.png?op=add\|sub&a=&b=` | 8-bit grey PNG of A ± B on A's grid; metadata (both wavelengths, unit, stretch, `tag: "derived"`, formula) in the `X-SX-Combine` JSON header. A4.9, Q-54 |
| `GET /data/shapes/{name}.glb` | A registered shape-model mesh (glTF binary, `model/gltf-binary`), metres, glTF +Y up (Q-61). Only names listed in `assets/shapes/registry.toml` are served; anything else is 404 |
| `GET /v1/health` | `{status, offline, data_release}` |
| `POST /v1/admin/objects/{id}/gemini-repaint[?refresh=true]` | Gemini artistic layer (beyond D-16, Q-122; A6.2). Admin only: `X-SX-Admin-Token` must equal `SX_ADMIN_TOKEN` (404 when unset, 403 when missing or wrong). Bakes if needed, asks Gemini, runs the D-07 edge check. Always 200 with `{id, status: "applied" \| "code", reason, detail, missing, model, edge_correlation, edge_correlation_min, cached_at, from_cache, checks, provenance}`, plus `label`, `size`, `layer` (D-32 `Layer`, tier 5) and `albedo_url` when applied. A first-stage card is refused (`measuring`) |
| `GET /v1/objects/{id}/albedo-ai` | The same status body for the last applied repaint, checked against the bake the viewer shows; `stale` when the generator version, baker rules, seed or bake changed. Disk only |
| `GET /v1/objects/{id}/albedo-ai.webp` | The checked AI albedo (`image/webp`, `X-SX-Layer-Tag: artistic`), or 404 `albedo_ai_unavailable` |
| `GET /v1/sky/index.json` | Sky background prototype (beyond D-16, Q-87). `{surveys: [{id, title, credit, tag: "derived", formula, frame: "icrs", convention, equirect: [{url, width, height}], hips: {url, max_order_local, tile_width, format} \| null}]}`, only surveys on disk; `[]` when none |
| `GET /v1/sky/cached` | Positions whose frame list is complete in the derived cache, so the sky can mark them "loads instantly" (beyond D-16, Q-98). `{objects: [{id, name, query, ra, dec, resolver, frames, provenance: {ra, dec}}], data_release, provenance: {frames: {tag: "derived", formula}}}`, sorted by id. Read only: it globs the `derived.frames/<release>/` meta files (one per object, never the cutouts), keeps a meta only when its digest equals the `frames_key` built now from the id it names (so another cutout size, radius, epoch or derivation version is skipped), and takes the position from the `derived.object` registry or the coordinate id. Not registered, moving, zero frames, corrupt or torn entries are left out. Frame counts are memoised per (entry, body SHA-256); each body is read and verified once per process. `name`/`query` are `null` for a position; `query` is the text the resolver was given, so searching it again is a cache hit |
| `GET /v1/sky/{survey}/equirect_{W}x{H}.jpg` | Baked all-sky image: column x is RA = 360·(x+0.5)/W° (RA 0 at the left, increasing right), row y is Dec = 90 − 180·(y+0.5)/H° (north up), ICRS |
| `GET /v1/sky/{survey}/hips/properties`, `.../hips/Norder3/Allsky.jpg`, `.../hips/Norder{k}/Dir{d}/Npix{n}.jpg` | The mirrored HiPS files, local only (never fetched upstream from a request). `Cache-Control: immutable`; missing is 404 `not_found` |

Per-target spectrum report on a cache: `SX_OFFLINE=1 uv run python -m app.core.measure [--group test|demo] [--only NAME]` (default `--group test`).

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

## Composite

`app/core/composite/` (`config`, `select`, `grid`, `service`; route in `app/api/composite.py`). Three SPHEREx frames of one pass, at a short, middle and long wavelength, resampled onto one grid and written as B, G, R. Tagged `derived` (false colour, Q-27); the `formula` names the frames, dates, stretch and grid.

- **Bands:** targets 1.2, 2.2 and 4.5 µm (`TARGET_UM`, a display choice, `CREATIVE: placeholder`). A frame counts for a channel within 10 % of the target (`MAX_OFFSET_FRACTION`). Only frames that Stage 2 measured are used: a frame it refused (`saturated`, `aperture_flags` and the other A4.2 reasons) never is. Within a channel: unflagged before flagged (Stage 2 dropped aperture pixels), then nearest wavelength, then frame id.
- **One pass:** all three frames within 14 days (`MAX_PASS_SPAN_DAYS`, ASSUMPTION). Every window that starts at a usable frame is tried; the chosen one has the fewest flagged channels, then the smallest summed relative wavelength offset, the shortest span, the earliest start.
- **Grid:** TAN, north up, east left, centred on the object's position at the mean time of the three frames (proper motion propagated; without one, the catalogue position and `composite:no_proper_motion`). Scale = median over the three frames of √(pixel solid angle) at the object pixel from the WCS, rounded to 0.01″ (6.15–6.16″ on the cache). Side = the odd number of pixels nearest to `SX_CUTOUT_SIZE_ARCSEC` / scale (59 px). The object is at the centre pixel, `x = y = 29`.
- **Resampling:** each output pixel → (RA, Dec) → the frame's own TAN-SIP WCS (`all_world2pix`) → bilinear on IMAGE. Pixels with a Stage 2 reject flag are masked first. Outside the frame, a masked or non-finite neighbour → no data, drawn black, counted in `nodata_px` (the rotated cutouts leave black corners: 13–26 % of the grid on the cache).
- **Stretch:** per band, `lo` = median (50th percentile), `hi` = max(99.5th percentile, median + 10 × 1.4826 MAD), then `asinh(v/0.1)/asinh(1/0.1)`. The floor keeps a band without a bright source (often 4.5 µm) from stretching its noise to full brightness.
- **Refusals in `missing`:** `composite:moving_object` (Q-21); `composite:<channel>:no_frame`, `composite:<channel>:saturated`, `composite:<channel>:no_usable_frame`, then `composite:too_few_bands` and, when a channel failed on saturation only, `composite:saturated`; `composite:no_common_pass`; `composite:<channel>:stretch`, `composite:pixel_scale`, `cutout:<id>`. Notes on a built image: `composite:<channel>:skipped:<reason>:<frame_id>` (a refused frame nearer the target in the chosen pass), `composite:no_proper_motion`, `composite:flags_unmasked:<id>`; `frames:truncated` and `cutouts:deferred:<n>` are passed through.
- **Live budget and cache:** Stage 1 runs once per request; inside the API it downloads nothing itself and starts or joins the object's job, which downloads the cutouts (issue #41, Q-111), so a composite request may list some as not ready yet; Stage 2 and the composite read only cached cutouts. The body and PNG are stored as `derived.composite`, keyed by the object's position and proper motion, the chosen frame records and cutout SHA-256s, the cutout size, every constant and `COMPOSITE_VERSION`; stored only while the frame list is complete. The pre-fetch builds it for every non-moving target.
- **On the full cache (7 Nov 2026):** built for eps Ind B, WISE 0855, SIMP 0136, TWA 27 and IRAS 04302+2247; Barnard's Star, R Dra and RW Aur are refused (`composite:saturated`, `composite:too_few_bands`).

## Texture baker (R6, issue #6)

`app/core/render/` bakes equirectangular maps on the CPU with numpy and Pillow: `albedo.webp` (lossless), `height.png`, `height.bin` (float16 little-endian, W×H) and `normal.png`, and `bake.json` (a hash of parameters, size and rules version; a mismatch rebakes) into `{root}/{id}/{generator_version}/{seed}/{width}x{height}/` (R6.7 plus a size directory, Q-47; `:` and other unsafe characters in the id are percent-encoded, so `sbdb:101955` is `sbdb%3A101955`). Baked types: `asteroid_procedural`, `brown_dwarf`, `brown_dwarf_binary`; any other type is refused (Q-47).

Since issue #41 (Q-112) the API bakes too, off the request path: when a reply's render params point at textures, both sizes (2048×1024 and 1024×512) are queued in a worker process (`SX_BAKE_WORKERS`) under `SX_TEXTURES_DIR` and served at `/data/textures/...`. The reply does not wait (a bake takes about 17 s at 2048×1024), so a texture URL can answer 404 until the bake lands.

```bash
uv run python -m app.core.render ../shared/fixtures/cards/asteroid_procedural.json --seed 2 --out ./textures   # ~17 s at 2048x1024
```

`params_from_card(card, seed)` applies the R6.2 rules. It raises `BakeRefusal` (with the missing card fields) only when an asteroid's diameter is missing or not finite, a brown dwarf's spectral class has no palette, or the type has no recipe. Other missing inputs bake flat and are listed in `BakeParams.missing` (`albedo_map` for no colour, `gaia_rgb` for an unusable one, `brightness`, `bands`); NaN and infinity count as missing. `bake()` returns the arrays; `bake_to_cache()` writes the files atomically and skips a bake whose four files exist and whose `bake.json` hash matches; it is safe for concurrent callers. Bump `BAKER_RULES_VERSION` whenever a rule in R6.2 to R6.5 changes. Same card and seed give the same bytes on a given numpy and Pillow build; the tests check it by SHA-256.

## Sky background (prototype)

A colour HiPS from IRSA (`2mass_color`, or `allwise_color`) mirrored into `<SX_CACHE_DIR>/sky/<survey>/hips/` in IRSA's layout, and baked to equirectangular JPEGs next to it. Both scripts are separate from the D-25 read-through cache.

```bash
uv run python -m scripts.sky_mirror --allow-unclonable              # 2mass_color, orders 0-4, --max-mb 900, --concurrency 4
uv run python -m scripts.sky_mirror --max-order 6 --max-mb 45000 --allow-unclonable --bake   # e.g. on the A15
uv run python -m scripts.sky_bake --preview preview.jpg             # 4096x2048 (order >= 3) and 8192x4096 (order >= 4)
```

- **Mirror:** `--max-mb` (10^6 bytes) is a hard cap on everything under `<cache>/sky/`, files already there included; a run that reaches it stops and exits 1. Files are written to a temp name and renamed, so a rerun skips what is there. Lowest orders first. At most 4 requests at a time with the `SX_HTTP_*` retries. Refuses with `SX_OFFLINE=1`. The 2MASS and AllWISE properties say `hips_status = public mirror unclonable`, so the script stops unless `--allow-unclonable` is given (licence settled by D-35; the exact credit line is **[verify]**). It writes `mirror.json` with the complete orders, which `/v1/sky/index.json` reads.
- **Bake:** numpy HEALPix NESTED (`app/core/sky/healpix.py`), each tile box-averaged and sampled at the nearest parent pixel. In a decoded HiPS JPEG, row = `lx` and column = `ly` (the face coordinates of the nested sub-pixel); `tests/test_sky_landmarks.py` checks it on the real tiles and the bake (skipped when they are absent).
- **Measured on 7 Nov 2026 (dev PC):** 2MASS orders 0-4 (4092 tiles plus properties and Allsky, 351 MB downloaded; 357 MB on disk with the two baked equirects) in 11 min at about 0.5 MB/s; the bake (both from order 4) took 41 s for 4096x2048 (1.1 MB) and 34 s for 8192x4096 (4.8 MB).

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
| `SX_LIVE_CUTOUTS_PER_REQUEST` | `24` | Inside the API (issue #41): the size of the object job's first batch, after which a partial answer goes out and the rest download; web requests download none themselves. A `FrameService` used without the job still caps its live downloads at this and lists the rest as `cutouts:deferred:<n>` (the list is not stored). The pre-fetch has no cap. |
| `SX_CUTOUT_CONCURRENCY` | `6` | Live cutout downloads at a time, in one pool shared by every object (issue #41, Q-112). Each object keeps at most this many of its own in the pool, so objects take turns. `1` downloads one after another. **[verify]** the polite limit with IRSA. |
| `SX_MEASURE_WORKERS` | `2` | Photometry worker processes (`spawn`). `0` measures in the calling thread. |
| `SX_FIRST_ANSWER_WAIT_S` | `2` | How long `/card` and `/render-params` wait for the final answer before returning the newest intermediate one (first stage or partial, Q-111). |
| `SX_MAX_JOBS` | `4` | Object jobs downloading all their frames at once (after the first batch); the rest wait in `stage: queued` with their first and partial answers already out. `0` means no cap. |
| `SX_JOB_TTL_S` | `600` | A finished object job is reused this long; after that a request starts a new run. |
| `SX_BAKE_TEXTURES` | `1` | Bake the textures a reply points at, both R5 sizes, off the request path (Q-112). Served at `/data/textures`. |
| `SX_BAKE_WORKERS` | `1` | Bake worker processes. `0` bakes in one background thread. |
| `SX_TEXTURES_DIR` | `<SX_CACHE_DIR>/textures` | R6.7 texture directory, outside git. |
| `SX_PREFETCH_ON_START` | `0` | `1` runs the object job for every target in `SX_PREFETCH_GROUPS` (default `demo`) at start-up, one at a time (D-25 warm cache). Set it on the demo laptop. |
| `SX_LIVE_FAILURE_TTL_S` | `600` | A cutout whose live download failed is skipped by web requests for this long (listed as `cutout:<id>`), so it cannot use up the live budget. The pre-fetch always retries. |
| `SX_SIMBAD_TAP_URLS` | CDS, then the Harvard mirror | Comma-separated and tried in order. |
| `SX_EPHEMERIS_EPOCH` | `2026-11-14T00:00:00Z` | The time used for a moving object's `resolve` position. |
| `SX_SEARCH_EPOCH` | `2026-01-01T00:00:00Z` | The time used for a proper-motion star's SIA search cone. |
| `SX_HTTP_*` | 10 s connect, 60 s read, 3 retries, 1 s backoff (doubles) | |
| `SX_CORS_ORIGINS` | empty | Needed only when the frontend runs without the Vite proxy. CORS then exposes the `X-SX-Cached-At` and `X-SX-Asset-Status` headers (Q-39), `X-SX-Combine` (Q-50), the issue #41 `X-SX-Measuring` and `X-SX-Progress` (Q-111) and `X-SX-Layer-Tag` (Q-122) so the browser can read them. Only `GET` is allowed, so the admin repaint is for `curl`. |
| `SX_ASSETS_DIR` | `backend/assets` | Pre-baked assets read by stage 4 (A5.4), `<type>/<id>.json` with the D-22 fields. |
| `SX_TEXTURES_AI_DIR` | `<SX_CACHE_DIR>/textures-ai` | The Gemini AI albedo, its `gemini.json` and the per-object pointers (Q-122). Must be outside `SX_TEXTURES_DIR`, which is served as static files without the status checks; the API refuses to start otherwise. |
| `SX_ADMIN_TOKEN` | unset | Admin endpoints (Gemini repaint) need it in the `X-SX-Admin-Token` header. Unset: they answer 404 (Q-122). |
| `SX_GEMINI_API_KEY` | unset | Server-side only, never returned or logged (D-07). Unset: the Gemini layer is off and the code colour shows. |
| `SX_GEMINI_MODEL` | `gemini-nano-banana-2.1` | **[verify]** R12 #3. |
| `SX_GEMINI_API_URL` | `https://generativelanguage.googleapis.com/v1beta` | **[verify]** URL and request shape (R12 #3). |
| `SX_GEMINI_ASPECT_RATIO` | empty | **[verify]** R12 #3. Empty: none requested; the output is resampled to 2:1 anyway. |
| `SX_GEMINI_TIMEOUT_S` | `90` | ASSUMPTION: A6.2 says "a set time". Total budget for the call, retries and backoff included. The reply is streamed against that deadline and capped at 32 MiB. Only connection failures and HTTP 429/503 are retried, while budget is left; HTTP 500/502/504, a read error, a read or write timeout or a protocol error is not, so a request that may have reached Google is never sent twice. |
| `SX_GEMINI_COOLDOWN_S` | `60` | ASSUMPTION (Q-122): after a live Gemini call for an object, no other live call for it for this long (reason `cooldown`). Cache hits are not affected. `0` turns it off. |
| `SX_GEMINI_OFFLINE_CACHE` | `0` | Q-29: `1` shows a cached repaint under `SX_OFFLINE=1`; `0` keeps the layer off offline (D-24). |

## Cache (D-25)

- **Every external call goes through `app/cache/store.py`.**
- **Key:** the source, the data release and the normalised query. Coordinates are rounded to 1e-5° and RA is wrapped to [0, 360). The key is hashed with SHA-256.
- **Layout:** `<SX_CACHE_DIR>/v1/<source>/<release>/<sha[:2]>/<sha>.body` holds the raw bytes, and `<sha>.json` holds the meta: key, URL, status, `fetched_at` and the body's SHA-256.
- **Order:** cache, then a live call with a timeout and retries, then an older entry, then refuse. There is no expiry.
- **What is cached:** "not found" answers are cached. Timeouts and 5xx answers are not.
- **SIA entries:** the key leaves out MAXREC. The MAXREC used is in the meta. An answer with `QUERY_STATUS=OVERFLOW`, or with as many rows as MAXREC, puts `frames:truncated` in `missing`.
- **Cutouts:** the IBE response with the `PSF` extension cut out at its byte boundaries (Q-20). The meta keeps the original SHA-256 and size.
- **Derived entries:** `derived.object`, the object registry that `resolve` fills, and `derived.frames`, the frame list. A frame list is not stored when the search was truncated or a cutout failed to download, because more data could still change it. Each key carries `DERIVATION_VERSION`. Cutout PNGs are rendered on request and never cached; `derived.composite` holds the composite's body and PNG (see [Composite](#composite)).
- **`cached_at`:** the earliest `fetched_at` among the cache entries a response used.

## Pre-fetch, fixtures, offline check

```bash
uv run python -m scripts.prefetch                 # all targets in targets.toml (resumable)
uv run python -m scripts.prefetch --only "R Draconis" --concurrency 6
uv run python -m scripts.prefetch --group demo --concurrency 6   # the demo objects only (D-31)
uv run python -m scripts.prefetch --refresh       # re-download resolve, SIA and cutouts; rebuild frame lists
uv run python -m scripts.smoke_offline --group test   # Done-when check: SX_OFFLINE=1, network blocked
uv run python -m scripts.smoke_offline --group demo
uv run python -m scripts.backup_cache             # zip the cache next to it
uv run python -m scripts.record_fixtures          # re-record tests/fixtures/cache (needs the internet)
```

- **What is pre-fetched:** `targets.toml` lists the five test targets (`group = "test"`), `433 Eros`, a moving object for the SBDB and Horizons path (`group = "fixture"`), and the demo objects (`group = "demo"`, D-31): SIMP 0136, TWA 27 (2M1207 A) and IRAS 04302+2247. Barnard's Star, RW Aur and R Dra saturate: on the full cache Barnard's Star and R Dra have no measured point and RW Aur only 15 points at 0.74–1.09 µm; `spectrum:saturated` appears only on the recorded fixtures (A4.2). The demo objects are fainter and have measured spectra. A clean pre-fetch of all targets is about 320 MB on disk. The only full cache so far is on Atish's PC, not yet on the A15: 356 MB (it also holds about 35 MB of unused cutouts of a screened object), 122 MB zipped (6 Nov 2026).
- **Timing:** a cutout takes 10–30 s to download, because IRSA sends the 5 MB PSF extension too. A full pre-fetch takes about 30 minutes per target at concurrency 6.
- **Test fixtures:**
  - They are plain cache entries recorded live by `record_fixtures`: three frames per target (MAXREC=3) at the default cutout size, about 3.3 MB in all (5 test targets, 3 demo objects).
  - `derived.*` entries are removed after recording, so the tests run the real SIA, cutout and WCS path.
  - The tests block every non-loopback socket.

## Layout

```
app/main.py, settings.py, errors.py, context.py, offline.py, timefmt.py
app/api/          (Kevin, R10)  resolve.py, objects.py, models.py, deps.py; spectrum.py (issue #2); sky.py; composite.py
app/cache/        keys.py, store.py: D-25 read-through cache
app/adapters/     http.py, irsa_sia.py, irsa_cutout.py, simbad.py, sbdb.py, horizons.py, skybot.py
app/contract/     generated from shared/schemas/ (D-18, do not edit): ObjectCard, RenderParams
app/core/find/    (Kevin, Stage 1, A4.1) ids, resolver, propagate, wcs, frames, cutouts, png
app/core/measure/ (Moon, Stage 2, A4.2) config, flags, aperture, solid_angle, photometry, spectrum
app/core/classify/ (Atish, Stage 3, A4.3) rules.py: R3.3 type selection; R12 #12 exoplanet thresholds block (all None)
app/core/card/    (Kevin, Stages 4-5, A4.4-A4.5) catalogue, build, assets (A5.4 store), validate, service
app/core/render/  (Atish, R10) texture baker; card_to_params (Stage 7, A4.7), blackbody, spherex_rgb
app/core/sky/     sky background: survey registry and layout, HEALPix NESTED, HiPS -> equirect bake
app/core/composite/ (no D-17 owner yet) SPHEREx false-colour composite: config, select, grid, service
assets/           A5.4 pre-baked assets, <type>/<id>.json (SX_ASSETS_DIR); the demo pack (Q-164) and its maps in assets/textures/
scripts/          prefetch, smoke_offline, backup_cache, record_fixtures, generate_contract, sky_mirror, sky_bake, bake_demo_pack (`--check`, `--strict`)
tests/            pytest; tests/fixtures/cache holds the recorded cache entries
```
