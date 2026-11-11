# Data contract

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A5–A5.4 · **Implements:** [D-02, D-32](../decisions/contract-tags.md), [D-18, D-22, D-27, Q-35](../decisions/contract.md), [D-26](../decisions/rendering-bodies.md), [Q-57, Q-61](../decisions/pipeline-jobs.md) · **Read with:** [../rendering/data-contract.md](../rendering/data-contract.md) (R3), [../../shared/README.md](../../shared/README.md), [refusals.md](refusals.md) (A4.12)

## A5 Data contract

The settings-file schema of draft v1 is retired (D-02). The data contract is in **rendering doc §3**:

| Item | Where | Produced by |
|---|---|---|
| Tagged value `TV` | Rendering doc §3.1 | Every value in the card |
| `ObjectCard` | Rendering doc §3.2 | Backend, `GET /v1/objects/{id}/card` |
| Type selection | Rendering doc §3.3 | Backend, stage 3 |
| `RenderParams` | Rendering doc §3.4 | Backend, `GET /v1/objects/{id}/render-params` |
| Shape-model mesh | Q-61, [A3.10](object-sources.md#a310-added-for-the-object-view) | Backend, `GET /data/shapes/{name}.glb` (named by `shape_source`) |
| `missing` codes | [A4.12](refusals.md#a412-missing-and-refusal-codes) | Every stage |
| Every route and header | [A4.11](endpoints.md#a411-endpoint-register) | Backend |
| JSON schemas | `shared/schemas/object-card.schema.json`, `render-params.schema.json` (rendering doc §10) | Shared by backend and frontend. Owner: D-17 |

Do not copy the type definitions into this doc. Change them in the rendering doc.

**Generated code (D-18).** `shared/schemas/*.json` (JSON Schema draft-07) is the single source of the contract in code. The backend generates `backend/app/contract/` with `datamodel-code-generator` 0.89.0; the frontend generates `frontend/src/contract/generated.ts` with `json-schema-to-typescript` 16.0.0. CI fails if regenerated files differ from the committed ones. Hand-written helpers such as `assertTagged()` sit next to the generated types, not inside them. How to regenerate: [shared/README.md](../../shared/README.md).

### A5.1 Ids and seeds

- `id` is a stable id, for example `sbdb:101955` or `exo:trappist-1e`.
- Seed = hash of (object id + generator version) (rendering doc §1, principle 5). Which hash is still open ([Q-35](../decisions/contract.md)). **As built (issue #5, an assumption until Q-35 is answered):** SHA-256 of `id` + newline + `generator_version` (UTF-8), first 4 bytes read big-endian, so the seed is a 32-bit integer that survives JSON in the browser. `generator_version` is `p<CARD_TO_PARAMS_VERSION>-b<BAKER_RULES_VERSION>` (values: [A4.4](pipeline-card.md#a44-stage-4-check-for-a-saved-asset)), computed in `backend/app/core/render/card_to_params.py`.
- The shared fixtures use labelled fixture seeds (1 to 14), not the hash.

### A5.2 Provenance tags and badges

Internally every value carries one of 5 tags. The UI shows 3 badges (D-02):

| Tag | Badge |
|---|---|
| `measured` | **Measured** |
| `derived`, `model_dependent`, `inferred_from_analog` | **Estimated** (tooltip shows the formula, assumption or analog) |
| `artistic` | **Default** (artist's choice) |

SPHEREx gives only spectrum, brightness, position and time. Most values will therefore be Estimated or Default for a new object. This is expected and is shown in the interface.

### A5.3 Overrides

- User slider edits live in a client-side `overrides` map, kept separate from the card.
- Reset clears the map and restores the data values.
- **Type (D-27):** `overrides` is `Partial<Record<SliderKey, number | boolean>>`. A slider registry lists every allowed key as `{ key, min, max, step, unit, appliesTo: ObjectType[] }`, so an unknown key fails the type check. Values use the same units as the card.
- **Sliders on baked bodies (D-26):** for the event, baked types allow only colour, lighting and spin sliders. Relief sliders exist only on the shader kinds, which redraw live. A re-bake on every drag would be too slow.
- `overrides` stay in the browser and are never sent to the server (D-22). D-22 puts them in IndexedDB. **Not built yet:** the store keeps them in memory and clears them when another object loads (`frontend/src/state/store.ts`); nothing in `frontend/src` uses IndexedDB. Owner Moon (D-17).
- **Where:** one registry for the viewer and the physics layer: `SLIDER_REGISTRY`, `SliderKey` and `Overrides` are in `frontend/src/viewer/sliders.ts`. Each entry also carries `group` (`colour`, `lighting`, `spin`, `relief` or `physics`, for the D-26 check) and `spec` (the section it feeds, or "artistic look" for the R7.7 sliders). **One invalid-value policy:** a value is used only when `isValidOverride` accepts it (registered for the type, finite, in range); nothing is clamped. The store's `setOverride` keeps a value only when a card is loaded and the value is valid for its type, and returns `false` otherwise; `setOverride(key, undefined)` clears that one slider. The viewer's `sliderValue` returns nothing for an invalid value, so the body default is drawn. In the physics layer, an override that applies to the type but is invalid, or that is shadowed by another slider (the star sliders when the `teq_K` slider is set), is not used and its key is listed in `ignored`. Keys that do not apply to the type are skipped and not listed. When only some of the four star sliders are set, `teq_from_star` is refused and `needs` names the missing ones. A formula that gets an input it cannot use (for example a radius of 0) refuses its quantity rather than dropping it.

### A5.4 Asset store

A saved asset holds the ObjectCard, the RenderParams, the texture URLs, `generator_version`, `seed` and `created_at` (D-22). `generator_version` and `seed` keep the rendering doc §6.7 cache key reproducible.

| Layer | Where | Purpose |
|---|---|---|
| Pre-baked | JSON files in the repo, `assets/<type>/<id>.json` | Demo objects. Always available offline. |
| Baked texture cache | Backend, `SX_TEXTURES_DIR`, served at `/data/textures/`; path and files: [R6.7](../rendering/surface-generation.md) (with the Q-47 size directory) | Baked maps for `asteroid_procedural`, `brown_dwarf` and `brown_dwarf_binary` (Q-47). The path includes `generator_version` and the seed. Baked off the request path ([A4.10](jobs.md#a410-object-job-and-fan-out)). |
| Generated | Browser IndexedDB (D-22) | Files created during a session, and the user's `overrides`. **Not built yet** (see A5.3); the backend saves generated assets instead (below, Q-57). |
| Optional backend | Small service | Shared saves. Not needed for the demo. |

**Demo pack (issue #68, [Q-164](../decisions/demo-pack.md); answers Q-57 for pre-baked assets).** `backend/scripts/bake_demo_pack.py` writes the 16 search rows' assets to `backend/assets/<type>/<id>.json`, their maps to `backend/assets/textures/<id>/<generator_version>/<seed>/<W>x<H>/` (the R5 mobile size, 1024x512, to stay under the 15 MB budget) and the search list `frontend/src/app/search/demoTargets.ts`. The maps are served read-only at `/data/demo-textures` (`SX_DEMO_TEXTURES_DIR`, also under `SX_OFFLINE=1`, [A4.11](endpoints.md#a411-endpoint-register)), and the pack's texture URLs point there. A pack asset has no spectrum (`spectrum` is in `missing`); SPHEREx frames and spectra are never committed. So the pack never hides a measurement ([Q-206](../decisions/demo-pack.md), issue #75): a generated asset is read before it, and a pack asset with no spectrum only stands in when the live build cannot measure the object (rule in [A4.4](pipeline-card.md#a44-stage-4-check-for-a-saved-asset)). `created_at` is the fixed `PACK_EPOCH` (not a release date), so a re-run is byte-identical. A pack asset also holds `asset_version` and `inputs_sha256` ([Q-167](../decisions/catalogue-values.md)): `AssetStore` ignores one whose `asset_version` is not the code's `ASSET_VERSION`, and `--check` fails on a stale version, a changed input hash (`literature.toml`, `pm13_dwarf_teff.toml`, shape `registry.toml`) or a literature field that drifted from the registry, all without the cache. `bake_demo_pack --check` rebuilds in memory and fails on any differing byte (`--strict`: catalogues from the D-25 cache, no card-only fallback); CI runs it next to `bake_fixtures --check`.

As built (issue #5): the backend stores generated assets as `derived.asset` entries in the D-25 cache, and reads pre-baked ones from `backend/assets/<type>/<id>.json` (`SX_ASSETS_DIR`). Keys and save conditions: [A4.4](pipeline-card.md#a44-stage-4-check-for-a-saved-asset). The pre-baked layer is filled by the demo pack above ([Q-57](../decisions/pipeline-jobs.md)).

The read-through cache of external calls (D-25) is separate from the asset store. It lives on the A15, outside git, with a zipped backup.
