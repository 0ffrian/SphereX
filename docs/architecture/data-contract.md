# Data contract

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A5–A5.4 · **Implements:** D-02, D-18, D-22, D-26, D-27 · **Read with:** [../rendering/README.md](../rendering/README.md)

## A5 Data contract

The settings-file schema of draft v1 is retired (D-02). The data contract is in **rendering doc §3**:

| Item | Where | Produced by |
|---|---|---|
| Tagged value `TV` | Rendering doc §3.1 | Every value in the card |
| `ObjectCard` | Rendering doc §3.2 | Backend, `GET /v1/objects/{id}/card` |
| Type selection | Rendering doc §3.3 | Backend, stage 3 |
| `RenderParams` | Rendering doc §3.4 | Backend, `GET /v1/objects/{id}/render-params` |
| JSON schemas | `shared/schemas/object-card.schema.json`, `render-params.schema.json` (rendering doc §10) | Shared by backend and frontend. Owner: D-17 |

Do not copy the type definitions into this doc. Change them in the rendering doc.

**Generated code (D-18).** `shared/schemas/*.json` (JSON Schema draft-07) is the single source of the contract in code. The backend generates `backend/app/contract/` with `datamodel-code-generator` 0.89.0; the frontend generates `frontend/src/contract/generated.ts` with `json-schema-to-typescript` 16.0.0. CI fails if regenerated files differ from the committed ones. Hand-written helpers such as `assertTagged()` sit next to the generated types, not inside them. How to regenerate: [shared/README.md](../../shared/README.md).

### A5.1 Ids and seeds

- `id` is a stable id, for example `sbdb:101955` or `exo:trappist-1e`.
- Seed = hash of (object id + generator version) (rendering doc §1, principle 5). The hash itself is not specified yet (Q-35).

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
- `overrides` stay in the browser (IndexedDB) and are never sent to the server (D-22).
- **Where:** the registry, `SliderKey` and `Overrides` are in `frontend/src/physics/sliders.ts`. Each entry also carries `group` (`colour`, `lighting`, `spin`, `relief` or `physics`, for the D-26 check) and `spec` (the A7 section). The store's `setOverride` keeps a value only when a card is loaded and the value is valid for its type (registered for the type, finite, in range); `setOverride(key, undefined)` clears that one slider. The physics layer never clamps: an override that applies to the type but is invalid, or that is shadowed by another slider (the star sliders when the `teq_K` slider is set), is not used and its key is listed in `ignored`. Keys that do not apply to the type are skipped and not listed. When only some of the four star sliders are set, `teq_from_star` is refused and `needs` names the missing ones. A formula that gets an input it cannot use (for example a radius of 0) refuses its quantity rather than dropping it.

### A5.4 Asset store

A saved asset holds the ObjectCard, the RenderParams, the texture URLs, `generator_version`, `seed` and `created_at` (D-22). `generator_version` and `seed` keep the rendering doc §6.7 cache key reproducible.

| Layer | Where | Purpose |
|---|---|---|
| Pre-baked | JSON files in the repo, `assets/<type>/<id>.json` | Demo objects. Always available offline. |
| Baked texture cache | Backend, `/data/textures/{id}/{generator_version}/{seed}/` (`albedo.webp`, `height.png`, `height.bin`, `normal.png`) | Baked maps for rendering-doc types. The cache key includes `generator_version` (rendering doc §6.7). |
| Generated | Browser IndexedDB | Files created during a session, and the user's `overrides` (D-22). |
| Optional backend | Small service | Shared saves. Not needed for the demo. |

The read-through cache of external calls (D-25) is separate from the asset store. It lives on the A15, outside git, with a zipped backup.
