# Object job and fan-out

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A4.10 · **Implements:** [Q-111](../decisions/pipeline-jobs.md), [Q-112](../decisions/pipeline-jobs.md), [Q-97](../decisions/sky-shell.md), [Q-99](../decisions/pipeline-jobs.md), [D-25](../decisions/data-sources.md), [D-32](../decisions/contract-tags.md) · **Read with:** [pipeline.md](pipeline.md) (A4), [endpoints.md](endpoints.md) (A4.11), [../../backend/README.md](../../backend/README.md#settings-sx_-environment-variables) (settings)

### A4.10 Object job and fan-out

Built in issue #41 (PR #58, 8 Nov 2026). The decisions are Q-111 (answers and endpoints) and Q-112 (settings), both "Open (implemented as described)". This section holds the as-built rules; the decision rows keep the open questions.

**One job per object** (`backend/app/core/jobs.py`, `ObjectPipeline` in `backend/app/core/card/service.py`).

- After Find (stage 1 resolve), the job starts three things together: the catalogue facts (SIMBAD or SBDB, Exoplanet Archive, shape-model registry; stage 3), the Horizons geometry (stage 5) and the frame list (stage 1). Catalogue and geometry join at the card.
- Repeat requests join the running job. A finished job is reused for `SX_JOB_TTL_S`; a failed job is not reused, so the next request starts a new one.
- Stages the job reports, in order: `queued`, `catalogue`, `frames`, `spectrum`, `card`, `done`.
- Results are assembled in row and frame order, so they never depend on which download finished first (tested with shuffled delays).

**Downloads and measurement.**

- Cutouts download in **one pool shared by every object**, `SX_CUTOUT_CONCURRENCY` at a time. Each frame list keeps at most that many of its own downloads in the pool, so objects take turns and a large object (Barnard's Star, 240 frames) cannot hold back another's first batch. A download dropped at shutdown is refused as `cutout:<id>`.
- At most `SX_MAX_JOBS` jobs download all their frames at once; the others wait in stage `queued` with their first and partial answers already out.
- Stage 2 measures each cutout in a `spawn` worker process (`SX_MEASURE_WORKERS`) the moment it lands. A result is reused only when the cached body's SHA-256 and the pixel position match ([A4.2](pipeline.md#a42-stage-2-measure-brightness-and-spectrum)).
- A web request (`/frames`, `/spectrum`, `/overlays`, `/composite`) downloads nothing itself: it starts or joins the job and lists the cutouts still to come as `cutouts:deferred:<n>`. The flipbook asks again, one request at a time, until none is deferred (progressive loading, Q-97). A `FrameService` used without the job (scripts) still caps live downloads at `SX_LIVE_CUTOUTS_PER_REQUEST` (Q-99). The pre-fetch has no cap.
- A cutout whose live download failed is skipped by web requests for `SX_LIVE_FAILURE_TTL_S` and listed as `cutout:<id>`.

**Answers in up to three steps.**

| Answer | When | What it holds |
|---|---|---|
| `first` | the first batch (at most `SX_LIVE_CUTOUTS_PER_REQUEST` cutouts, in time order) is not done when the card can be built, and the backend is online | Card and RenderParams from catalogue data. `spherex_rgb` and `flux_45um` are `value: null` with `source` starting `measuring:`; `lightcurve` is empty. `RenderParams.missing` lists `measuring:spectrum` and `measuring:<layer>` for each layer or haptic source that needs them. A layer that can answer from a lower tier (D-32) still does. |
| `partial` | frames remain after the first batch | Card and RenderParams measured from the first batch, with `measuring:frames` in `missing`. |
| `final` | the complete frame list | Saved as an asset when its inputs are final ([A4.4](pipeline-card.md#a44-stage-4-check-for-a-saved-asset)). |

- Intermediate answers are never guessed and never saved.
- `/card` and `/render-params` return the final answer if it comes within `SX_FIRST_ANSWER_WAIT_S`, else the newest intermediate one. With no intermediate answer yet (offline, or a first batch that finished before the card was built), `/card` waits for the final one with no time limit of its own.
- Offline (`SX_OFFLINE=1`) nothing downloads, so there is no intermediate answer.
- If the rest of the frames cannot be fetched, the last answer keeps `measuring:frames` and is not saved.
- **Headers:** a reply that still has `measuring:` items carries `X-SX-Measuring` (those items, comma-separated) and `X-SX-Progress` (`frames <done>/<total>` of all SIA rows, `?` before the search answers). A complete final reply carries neither. CORS exposes both ([A4.11](endpoints.md#a411-endpoint-register)).

**Progress endpoints** (beyond D-16, Q-111):

- `GET /v1/objects/{id}/job` returns `{id, state, stage, frames_done, frames_total, answer, started_at, finished_at, error, seq}`; `state` is `running`, `done` or `failed`; `answer` is `none`, `first`, `partial` or `final`; `seq` grows on every change. With no job it returns `{id, state: "idle"}` and never starts one. The model is `JobStatus` in `backend/app/api/models.py` (not in `shared/schemas/` yet; a schema is to add when the frontend reads it, D-18).
- `GET /v1/objects/{id}/job/events` streams the same JSON as server-sent events (`text/event-stream`): one `data:` line per change and a `: keep-alive` comment every 15 s, until the job ends; one `idle` event when there is no job.
- A client that gives up after replies without progress (the Q-97 loop) should read `stage` first: while a job waits for an `SX_MAX_JOBS` slot its frame count does not move.

**Texture bakes.** When a reply's RenderParams point at textures, both R5 sizes (2048×1024 and 1024×512, R6.7 size directories) are baked in a worker process (`SX_BAKE_WORKERS`, switch `SX_BAKE_TEXTURES`) off the request path and served at `/data/textures` (`SX_TEXTURES_DIR`). The reply does not wait: a bake takes about 17 s at 2048×1024, so a texture URL can answer 404 until it lands.

**Warm start.** `SX_PREFETCH_ON_START=1` runs the object job for every target of the `targets.toml` groups in `SX_PREFETCH_GROUPS` (default `demo`) at start-up, one at a time. Overlays and the composite stay with `scripts.prefetch`. Off by default because it reaches the network unless `SX_OFFLINE=1`. The event run uses it with `SX_OFFLINE=1` ([A10.2](frontend-platform.md#a102-running-the-event-build)).

**Settings** (defaults and meanings: [backend/README.md](../../backend/README.md#settings-sx_-environment-variables), the owner of every `SX_*` value; the defaults are assumptions to confirm, Q-112): `SX_CUTOUT_CONCURRENCY` (the polite IRSA limit is **[verify]**, Kevin), `SX_MAX_JOBS`, `SX_MEASURE_WORKERS`, `SX_FIRST_ANSWER_WAIT_S`, `SX_JOB_TTL_S`, `SX_LIVE_CUTOUTS_PER_REQUEST`, `SX_LIVE_FAILURE_TTL_S`, `SX_BAKE_TEXTURES`, `SX_BAKE_WORKERS`, `SX_TEXTURES_DIR`, `SX_PREFETCH_ON_START`, `SX_PREFETCH_GROUPS`.

**Owners (Q-111 item 7, proposed):** `core/jobs.py` and `core/warm.py` Kevin; `core/measure/pool.py` Moon (stage 2); `core/render/background.py` Atish (baker).

**Measured (issue #41, Q-111 item 6):** first answer 13.1 s cold for Barnard's Star (11.1 s of it the SIMBAD resolve); partial answer from the first 24 frames in 70 s; complete 240-frame answer in 458 s, limited by IRSA at about 20 s per cutout.

**Moving objects:** the Track frame search and the path endpoint run inside this job (Q-141 proposal, [A19](moving-objects/track.md)). The path search (PR #53, issue #26) lists the calls it leaves to the job as `frames:search_deferred:<n>` ([A4.1](pipeline.md#a41-stage-1-find-the-object)). **Track on demand** (issue #142, [Q-468](../decisions/moving-objects.md), proposed): `POST /v1/objects/{id}/track` starts a separate **Track job** for one object and one window around a given time (`ensure_track_job`, one per object and window, at most 8 running, else 429 `queue_full`): the window's path search, cutouts and spectrum, then `track.check` for that window. It builds no card. The window is passed to each call and never stored, so this object job, the card and the areas keep the base windows. Its reply is the `/job` JSON with 202, plus `track_window` and, once done, `track_available` and `reason`; `/job` and `/job/events` with the same `around` and `days` follow it. As built, this job's saved-card branch also stores a mover's spectrum once its frame list is complete, so the base-window Track is final in the cache too (A19.12).
