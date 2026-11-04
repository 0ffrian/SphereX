# Data contract

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A5–A5.4 · **Implements:** D-02 · **Read with:** [../rendering/README.md](../rendering/README.md)

## A5 Data contract

The settings-file schema of draft v1 is retired (D-02). The data contract is in **rendering doc §3**:

| Item | Where | Produced by |
|---|---|---|
| Tagged value `TV` | Rendering doc §3.1 | Every value in the card |
| `ObjectCard` | Rendering doc §3.2 | Backend, `GET /v1/objects/{id}/card` |
| Type selection | Rendering doc §3.3 | Backend, stage 3 |
| `RenderParams` | Rendering doc §3.4 | Backend, `GET /v1/objects/{id}/render-params` |
| JSON schemas | `shared/schemas/object-card.schema.json`, `render-params.schema.json` (rendering doc §10) | Shared by backend and frontend |

Do not copy the type definitions into this doc. Change them in the rendering doc.

### A5.1 Ids and seeds

- `id` is a stable id, for example `sbdb:101955` or `exo:trappist-1e`.
- Seed = hash of (object id + generator version) (rendering doc §1, principle 5).

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
- Sliders on baked bodies are open (Q-03). Changing relief needs a re-bake, so the event build may allow only colour, lighting and spin sliders on baked types.

### A5.4 Asset store

| Layer | Where | Purpose |
|---|---|---|
| Pre-baked | JSON files in the repo, `assets/<type>/<id>.json` | Demo objects. Always available offline. |
| Baked texture cache | Backend, `/data/textures/{id}/{generator_version}/{seed}/` (`albedo.webp`, `height.png`, `height.bin`, `normal.png`) | Baked maps for rendering-doc types. The cache key includes `generator_version` (rendering doc §6.7). |
| Generated | Browser IndexedDB | Files created during a session. |
| Optional backend | Small service | Shared saves. Not needed for the demo. |
