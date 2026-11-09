# Generators

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A6–A6.3 · **Implements:** [D-01, D-26, Q-47](../decisions/rendering-bodies.md), [Q-103, Q-104](../decisions/rendering-motion.md), [D-07, Q-29, Q-122](../decisions/gemini.md), [D-12](../decisions/haptics-design.md), [D-24](../decisions/platform-hosting.md), [D-25](../decisions/data-sources.md), [D-32](../decisions/contract.md) · **Read with:** [../rendering/surface-generation.md](../rendering/surface-generation.md) (R6), [../rendering/renderers/shader-kinds.md](../rendering/renderers/shader-kinds.md) (R7.7), [physics.md](physics.md) (A7)

## A6 Generators

D-01 splits generators into backend-baked maps for the rendering-doc types and browser shaders for the types of this doc. As built, the split is finer: the backend bakes only three types (Q-47), stars and brown-dwarf jets are animated in the browser (issue #42, Q-104), and comets, nebulae and novae are emission volumes (issue #43, Q-103). D-01 has no amendment note for this yet (pointer requested). See the Surface Lab tab of the [mock-up](../../mockup/spherex-ui.html) for what the browser shaders look like; the mock-up is input only.

**How each type is drawn (as built, 9 Nov 2026).** Code paths are under `frontend/src/viewer/` unless they start with `backend/`.

| Type | How it is drawn | Code | Spec |
|---|---|---|---|
| `asteroid_shape` | Registered shape-model mesh (GLB, real size, Q-61), lit with a Lommel-Seeliger term; no texture bake (Q-47) | `renderers/AsteroidMesh.ts`, `shape/`; mesh from `/data/shapes/` | [R7.1](../rendering/renderers/asteroid.md) |
| `asteroid_procedural` | **Baked** on the backend CPU: albedo, height and normal maps, displaced sphere | `backend/app/core/render/`; `renderers/AsteroidProcedural.ts` | [R6](../rendering/surface-generation.md), [R7.2](../rendering/renderers/asteroid.md) |
| `comet` | Nucleus plus gas shells drawn as emission volumes; not baked | `renderers/Comet.ts`, `volume/` | [R7.3](../rendering/renderers/comet.md) |
| `brown_dwarf`, `brown_dwarf_binary` | **Baked** banded texture; when winds are sped up the browser draws the jets (Q-104 item 7) | `renderers/BrownDwarf.ts`, `renderers/jetSurface.ts` | [R7.4](../rendering/renderers/brown-dwarf.md) |
| `star`, `star_mira`, `star_ttauri` | Animated browser shader: colour from Teff, limb darkening, granulation, spots, flares; not baked | `shaders/star.ts`, `renderers/StarBody.ts`, `bodies/` | [R7.5](../rendering/renderers/stars.md) |
| `candidate` | No 3D body | none | [R7.6](../rendering/renderers/candidate.md) |
| `planet_rocky`, `planet_water` | Browser shader `terra-planet`: fractal terrain with sea level, polar ice, lava cracks, cloud shell, atmosphere glow; triplanar | `renderers/ShaderBody.ts`, `renderers/shaderSpec.ts` | [R7.7](../rendering/renderers/shader-kinds.md) |
| `gas_giant` | Browser shader `banded-giant`: bands warped by noise, counter-flowing jets, seeded storms, optional rings | same | [R7.7](../rendering/renderers/shader-kinds.md) |
| `nebula` | Emission volume `gas-cloud`, ray-marched through a baked 3D noise cube; additive glow plus dark dust; no points, no stars, no haptics (Q-103) | `volume/VolumeBody.ts` | [R7.7](../rendering/renderers/shader-kinds.md) |
| `nova` | Volume shell `shell-remnant`: filaments, hot inner gas, core glow, expansion by age; no haptics (Q-103) | `volume/VolumeBody.ts` | [R7.7](../rendering/renderers/shader-kinds.md) |

- **Haptics and sound** on shader-drawn bodies read a shared CPU field (D-12, `viewer/fields/`, [A9](haptics.md#a9-haptics)).
- **Settings and sliders:** the app's sliders are the entries of `SLIDER_REGISTRY` in `viewer/sliders.ts` ([A5.3](data-contract.md#a53-overrides)): relief, sea level, ice, lava heat, cloud cover, atmosphere, bands, turbulence, storms, rings, plus the physics sliders of [A7](physics.md#a7-physics-layer). The mock-up's other settings (continent size, land colour, haze, flattening as a slider, the nebula and nova sliders) are **mock-up only**. On baked bodies only colour, lighting and spin sliders exist (D-26).
- **Superseded mock-up generators:** brown dwarfs follow R7.4, not the `banded-dwarf` shader; asteroids follow the baked path (R6, R7.1, R7.2), not the `rock-body` shader, which remains in the mock-up only.

### A6.1 Why triplanar mapping (browser shaders only)

A flat image wrapped on a stretched shape pinches at the poles and smears along the long axis. Triplanar mapping reads the texture from three axes using the 3D position, so grain keeps the same size everywhere. The Surface Lab test grid shows both modes side by side.

The baked types do not use triplanar mapping. Their maps are sampled from 3D noise on the unit sphere, so they are seamless by construction (rendering doc §6.1).

### A6.2 Optional Gemini artistic layer

For the baked types, follow **rendering doc §6.6** (D-07): Gemini repaints albedo using a hillshade of the baked height map as its reference. Output whose edge correlation is below 0.3 is rejected.

For the browser-shader types only, the tile method below applies:

| Step | Behaviour |
|---|---|
| Trigger | User switches on "Ask Gemini for an artistic version". |
| Request | Server-side call (the API key must never be in the browser). Ask for a seamless, top-down close-up of the surface, with no horizon and no lighting. |
| Timeout | If no answer in a set time, keep the code version and show "Failed, using code". |
| On success | Use the image as a colour tile, fitted by triplanar mapping. Relief stays procedural. |
| Label | Always "AI-made". |

Both methods: server-side only, labelled "AI-made", tag `artistic`. Gemini only produces images. It cannot produce a mesh or a relief map.

**Status (issue #14, PR #48 merged 9 Nov 2026; issue #14 still open):** the baked-type method is built (`backend/app/core/render/gemini_paint.py`, routes in `backend/app/api/gemini.py`), behind the admin token. Not built: the tile method for browser-shader types and the viewer swap-in, because RenderParams has no slot for the AI albedo, so the frontend would have to read the status route (Q-122 item 9). Only the desktop size (2048×1024) is painted; the mobile 1024×512 bake keeps the code colour. The admin mechanism, routes and file layout are assumptions until [Q-122](../decisions/gemini.md) is answered.

This section owns the layer's contract (R6.6 points here). The route list is in [A4.11](endpoints.md#a411-endpoint-register), and the full reply shapes and setting defaults in [backend/README.md](../../backend/README.md#endpoints-d-16); Q-122 and the D-16 note repeat parts of it as history.

- **Routes** (beyond D-16, Q-122):
  - `POST /v1/admin/objects/{id}/gemini-repaint[?refresh=true]`: bakes the bake the viewer shows if needed (the RenderParams seed and generator version), asks Gemini (`refresh=true` skips the cache hit; a failed refresh is reported, not hidden), checks the edge correlation and writes the AI albedo. Always 200 with a status body: `status` is `applied` or `code` (code colour kept), with `reason`; on success it adds `label` ("AI-made"), `size`, `layer` (a D-32 `Layer`, tier 5) and `albedo_url`. The edge correlation is reported as a process check with no tag (Q-122 item 7). A first-stage card ([A4.10](jobs.md#a410-object-job-and-fan-out)) is refused with reason `measuring`, and a card that cannot be built with `card_unavailable`.
  - `GET /v1/objects/{id}/albedo-ai`: the same status body for the last applied repaint, checked against the bake the viewer shows. Disk only: no card build, no bake, no Gemini call.
  - `GET /v1/objects/{id}/albedo-ai.webp`: the image (header `X-SX-Layer-Tag: artistic`), or 404 `albedo_ai_unavailable`.
- **Admin gate:** header `X-SX-Admin-Token`, compared in constant time with `SX_ADMIN_TOKEN`. Unset or blank: the admin route answers 404. Missing or wrong token: 403 `forbidden`. CORS allows `GET` only, so the `POST` is for `curl`.
- **Settings:** `SX_ADMIN_TOKEN`, `SX_GEMINI_API_KEY` (server-side only, never returned or logged), `SX_GEMINI_MODEL`, `SX_GEMINI_API_URL`, `SX_GEMINI_ASPECT_RATIO`, `SX_GEMINI_TIMEOUT_S` (the "set time" of the tile method; a whole-call deadline, reply streamed and capped at 32 MiB), `SX_GEMINI_COOLDOWN_S` (between live calls for one object), `SX_GEMINI_OFFLINE_CACHE`, `SX_TEXTURES_AI_DIR`. Defaults: [backend/README.md](../../backend/README.md#settings-sx_-environment-variables). Model name, aspect ratios and the REST shape are **[verify]** (R12 #3 in [../rendering/open-items.md](../rendering/open-items.md); Atish, Kevin).
- **Files:** `albedo_ai.webp`, then `gemini.json`, then a pointer `pointers/<sha256(id)>.json` (commit marker, read by the GET routes), all under `SX_TEXTURES_AI_DIR` (default `<SX_CACHE_DIR>/textures-ai`) at the same relative path as the R6.7 size directory. That root is **not** the `/data/textures` static mount (`SX_TEXTURES_DIR`), so the AI files are only served through the status-checked route; the painter refuses to start if the AI root is inside the texture root. The pointer and `gemini.json` carry a stamp (generator version, baker rules, seed, size, `bake_key`); any difference from the shown bake, or a changed `bake.json`, answers `stale` (Q-122 items 4 and 5).
- **Cache:** the image is stored in the D-25 cache only after it passes the decode and edge checks, so a rejected image is never replayed (Q-122 item 10; an exception to D-25's "raw response"). One repaint per object at a time: a per-object lock covers the call and the writes. Only connection failures and HTTP 429/503 are retried, so a request that may have reached Google is never sent twice (Q-122 item 11).
- **Offline ([Q-29](../decisions/gemini.md), open):** `SX_GEMINI_OFFLINE_CACHE` is an interim switch. Default 0 follows D-24 (the layer stays off under `SX_OFFLINE=1`); 1 serves a cached repaint offline, as D-25 allows.
- **Failure reasons** (the code colour stays and `missing` starts with `albedo_ai`): `gemini_key_missing`, `offline`, `cooldown`, `measuring`, `card_unavailable`, `gemini_timeout`, `gemini_reply_too_large`, `gemini_unreachable`, `gemini_refused`, `gemini_no_image`, `gemini_bad_response`, `gemini_http_<n>`, `gemini_unavailable`, `bad_image`, `low_edge_correlation`, `flat_height` (nothing to align to), `not_baked_type`, `bake_refused` (its own `missing` follows), `bake_failed` and `write_failed` (a disk error while baking or writing the AI files). The status route adds `not_painted` and `stale`.

### A6.3 Offline jobs (not on the demo laptop)

| Job | Where | Note |
|---|---|---|
| Depth Anything V2 Small (Apache-2.0) to turn an image into a height map | Any laptop, or Colab | Small model. Only for images not generated from a height map (rendering doc §6.6). |
| Marigold (albedo, roughness, metallic from one image) | A GPU with about 8 GB, or a free Colab T4 | Trained on indoor scenes, so quality on rock is unknown. Optional experiment, not on the critical path. |

Image-to-3D (TRELLIS, TripoSR) is out of scope for the event (B-04).
