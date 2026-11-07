# 16 State: asset lookup and texture cache

Diagram 1 is the asset status from pipeline stage 4 (`saved`, `generated`, `sketch`). Diagram 2 is the life of one backend texture-cache entry. Drawn from architecture spec §4.4, §5.4 and §10, rendering doc §6.6–6.7, §7.7, and decisions D-01, D-02, D-07 and D-22, and the open Q-87 (Gemini layer files).

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

  Saved --> Loaded : load it
  Generated --> Stored : build from catalogues + spectrum, save if inputs final
  Sketch --> Stored : build from SPHEREx only, save if inputs final
  Generated --> Loaded : inputs not final, not saved (Q-57)
  Sketch --> Loaded : inputs not final, not saved (Q-57)
  Stored --> Loaded
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
  state "Baking" as Baking
  state "Cached (code colour)" as Cached
  state "Repaint pending" as Pending
  state "Cached + AI albedo" as CachedAI

  NotCached --> Baking : render-params requested
  Baking --> Cached : albedo, height.png, height.bin, normal.png written
  Cached --> Pending : admin requests Gemini repaint (P3, Q-87)
  Pending --> CachedAI : edge correlation 0.3 or more, albedo_ai.webp, gemini.json, then the .gemini pointer written (image cached only now)
  Pending --> Cached : any failure (no key, offline, timeout, refused, no image, bad image, below 0.3, flat height), keep code colour
  Cached --> NotCached : card or size changed (bake.json key differs)
  CachedAI --> NotCached : card or size changed, the rebake removes the AI files
  Cached --> NotCached : generator_version bumped (new key)
  CachedAI --> NotCached : generator_version bumped (new key)
  NoBake --> [*]
  Refused --> [*]

  note right of Cached
    Key: /data/textures/id/generator_version/seed/WxH/
    plus bake.json (params hash)
  end note
  note right of CachedAI
    albedo_ai.webp + gemini.json (bake key, tag artistic)
    in the same size directory
  end note
```

## Notes

- With D-02 the settings file is retired. A `saved` asset holds the ObjectCard, the RenderParams, the texture URLs, `generator_version`, `seed` and `created_at` (D-22, architecture spec §5.4). `generator_version` and `seed` keep the texture cache key reproducible.
- The architecture spec puts generated assets and the user's `overrides` in browser IndexedDB; `overrides` are never sent to the server (D-22). The backend texture cache is separate, and so is the read-through cache of external calls (D-25).
- Bumping `generator_version` does not delete old entries; it changes the key. Clean-up is not specified.
- Baking failures are not specified **[verify]**.
- As built (issue #14, Q-87): a Gemini repaint never leaves the entry broken. Every failure returns to `Cached` with the code colour, and the reason is in the status body (`albedo_ai` in `missing`). The status endpoint reports `not_painted` for `Cached`, and `stale` when `gemini.json` does not match the current `bake.json`. The backend root is `SX_TEXTURES_DIR` (default `<SX_CACHE_DIR>/textures`).
- As built (issue #5): a `generated` or `sketch` asset is stored only when its inputs are final (a spectrum from a complete frame list, and a catalogue match or typed coordinates); otherwise it is rebuilt on every request (Q-57). The status reaches the client as the `X-SX-Asset-Status` header (Q-39). Pre-baked assets live in `backend/assets/<type>/<id>.json` (`SX_ASSETS_DIR`); generated ones in the D-25 cache as `derived.asset`, keyed by id, data release, `ASSET_VERSION` and `GENERATOR_VERSION`. A saved or pre-baked asset whose card or params id is not the requested id, whose card and params disagree on `type`, or that fails the `jsonschema` check is ignored with a warning and rebuilt from the catalogues, never returned as an error (the Rejected state). This differs from A5.4, which puts generated assets in IndexedDB (Q-57). A saved asset whose card type is `candidate` is reported as `sketch`, not `saved`, so the "Sketch from SPHEREx only" label survives the save; a saved generated asset reports the `fetched_at` of its cache entry as `X-SX-Cached-At` (PR #34 review).
