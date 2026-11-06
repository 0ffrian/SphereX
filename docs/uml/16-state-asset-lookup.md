# 16 State: asset lookup and texture cache

Diagram 1 is the asset status from pipeline stage 4 (`saved`, `generated`, `sketch`). Diagram 2 is the life of one backend texture-cache entry. Drawn from architecture spec §4.4, §5.4 and §10, rendering doc §6.6–6.7, §7.7, and decisions D-01, D-02, D-07 and D-22.

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
  state "Ignored with a warning (Q-52)" as Rejected
  state "generated" as Generated
  state "sketch" as Sketch
  state "Stored" as Stored

  Saved --> Loaded : load it
  Generated --> Stored : build from catalogues + spectrum, save if inputs final
  Sketch --> Stored : build from SPHEREx only, save if inputs final
  Generated --> Loaded : inputs not final, not saved (Q-52)
  Sketch --> Loaded : inputs not final, not saved (Q-52)
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
- Baking failures are not specified **[verify]**.
- As built (issue #5): a `generated` or `sketch` asset is stored only when its inputs are final (a spectrum from a complete frame list, and a catalogue match or typed coordinates); otherwise it is rebuilt on every request (Q-52). The status reaches the client as the `X-SX-Asset-Status` header (Q-39). Pre-baked assets live in `backend/assets/<type>/<id>.json` (`SX_ASSETS_DIR`); generated ones in the D-25 cache as `derived.asset`, keyed by id, data release, `ASSET_VERSION` and `GENERATOR_VERSION`. A saved or pre-baked asset whose card or params id is not the requested id, whose card and params disagree on `type`, or that fails the `jsonschema` check is ignored with a warning and rebuilt from the catalogues, never returned as an error (the Rejected state). This differs from A5.4, which puts generated assets in IndexedDB (Q-52).
