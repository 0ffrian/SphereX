# 16 State: asset lookup and texture cache

Diagram 1 is the asset status from pipeline stage 4 (`saved`, `generated`, `sketch`). Diagram 2 is the life of one backend texture-cache entry. Drawn from architecture spec §4.4, §5.4 and §10, rendering doc §6.6–6.7, §7.7, and decisions D-01, D-02, D-07 and D-22, and Q-111 and Q-112 (issue #41: intermediate answers, background bake).

## Diagram 1: asset status

```mermaid
stateDiagram-v2
  [*] --> Lookup : object id
  Lookup --> Saved : asset exists in store
  Saved --> Rejected : ids or type mismatch, or fails schema check
  Rejected --> Generated : kind known
  Rejected --> Sketch : kind unknown
  Lookup --> Generated : no asset, kind known
  Lookup --> Sketch : no asset, kind unknown

  state "Look up asset" as Lookup
  state "saved" as Saved
  state "Ignored with a warning (Q-57)" as Rejected
  state "generated" as Generated
  state "sketch" as Sketch
  state "Stored" as Stored
  state "First stage (measuring:), never stored" as FirstStage
  state "Partial (measuring:frames), never stored" as Partial

  Saved --> Loaded : load it
  Generated --> Stored : build from catalogues + spectrum, save if inputs final
  Sketch --> Stored : build from SPHEREx only, save if inputs final
  Generated --> Loaded : inputs not final, not saved (Q-57)
  Sketch --> Loaded : inputs not final, not saved (Q-57)
  Stored --> Loaded
  Generated --> FirstStage : first batch not done when the card can be built, online (Q-111)
  Sketch --> FirstStage : first batch not done when the card can be built, online (Q-111)
  Generated --> Partial : frames remain after the first batch (Q-111)
  Sketch --> Partial : frames remain after the first batch (Q-111)
  FirstStage --> Loaded : served while the final is not ready
  Partial --> Loaded : served while the final is not ready
  Loaded --> [*]

  note right of Sketch
    Labelled "Sketch from SPHEREx only".
  end note
  note right of Saved
    Pre-baked demo assets, always available offline,
    or a generated asset stored earlier.
    Holds card, RenderParams, texture URLs,
    generator_version, seed, created_at (D-22).
  end note
```

## Diagram 2: texture cache entry

```mermaid
stateDiagram-v2
  [*] --> CheckType
  state CheckType <<choice>>
  CheckType --> NoBake : shader kind (D-01)
  CheckType --> CheckReq : baked type

  state CheckReq <<choice>>
  CheckReq --> Refused : required field missing
  CheckReq --> NotCached : fields present, key not on disk
  CheckReq --> Cached : key on disk

  state "No texture cache: field built in browser" as NoBake
  state "Layer refused, listed in missing" as Refused
  state "Not cached" as NotCached
  state "Queued, URL answers 404" as Queued
  state "Baking in a worker process, URL answers 404" as Baking
  state "Cached (code colour)" as Cached
  state "Repaint pending" as Pending
  state "Cached + AI albedo" as CachedAI

  NotCached --> Queued : a reply's RenderParams have textures, queued by the object job off the request path (Q-112)
  Queued --> Baking : SX_BAKE_WORKERS worker free, both R5 sizes
  Baking --> Cached : albedo, height.png, height.bin, normal.png written
  Cached --> Pending : admin requests Gemini repaint (P3)
  Pending --> CachedAI : edge correlation 0.3 or more
  Pending --> Cached : below 0.3 or timeout, keep code colour
  Cached --> NotCached : generator_version bumped (new key)
  CachedAI --> NotCached : generator_version bumped (new key)
  NoBake --> [*]
  Refused --> [*]

  note right of Cached
    Key: /data/textures/id/generator_version/seed/
  end note
```

## Notes

- With D-02 the settings file is retired. A `saved` asset holds the ObjectCard, the RenderParams, the texture URLs, `generator_version`, `seed` and `created_at` (D-22, architecture spec §5.4). `generator_version` and `seed` keep the texture cache key reproducible.
- The architecture spec puts generated assets and the user's `overrides` in browser IndexedDB; `overrides` are never sent to the server (D-22). The backend texture cache is separate, and so is the read-through cache of external calls (D-25).
- Bumping `generator_version` does not delete old entries; it changes the key. Clean-up is not specified.
- Baking failures are not specified **[verify]**. As built (issue #41) a failed bake is logged and writes nothing, so its URL answers 404 until a later reply queues it again (`render/background.py`).
- As built (issue #5): a `generated` or `sketch` asset is stored only when its inputs are final (a spectrum from a complete frame list, and a catalogue match or typed coordinates); otherwise it is rebuilt on every request (Q-57). The status reaches the client as the `X-SX-Asset-Status` header (Q-39). Pre-baked assets live in `backend/assets/<type>/<id>.json` (`SX_ASSETS_DIR`); generated ones in the D-25 cache as `derived.asset`, keyed by id, data release, `ASSET_VERSION` and `GENERATOR_VERSION`. A saved or pre-baked asset whose card or params id is not the requested id, whose card and params disagree on `type`, or that fails the `jsonschema` check is ignored with a warning and rebuilt from the catalogues, never returned as an error (the Rejected state). This differs from A5.4, which puts generated assets in IndexedDB (Q-57). A saved asset whose card type is `candidate` is reported as `sketch`, not `saved`, so the "Sketch from SPHEREx only" label survives the save; a saved generated asset reports the `fetched_at` of its cache entry as `X-SX-Cached-At` (PR #34 review). Since issue #41 (Q-111) a `generated` or `sketch` asset without a saved copy comes from the object's job, which can serve a first-stage answer (catalogue only, `measuring:`) and a partial one (first batch, `measuring:frames`) before the final one; both are loaded by the client but never stored, and only the final answer goes to Stored.
