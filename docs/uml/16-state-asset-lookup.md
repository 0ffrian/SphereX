# 16 State: asset lookup and texture cache

Diagram 1 is the asset status from pipeline stage 4 (`saved`, `generated`, `sketch`). Diagram 2 is the life of one backend texture-cache entry. Drawn from architecture spec §4.4, §5.4 and §10, rendering doc §6.6–6.7, §7.7, and decisions D-01, D-02 and D-07.

## Diagram 1: asset status

```mermaid
stateDiagram-v2
  [*] --> Lookup : object id
  Lookup --> Saved : asset exists in store
  Lookup --> Generated : no asset, kind known
  Lookup --> Sketch : no asset, kind unknown

  state "Look up asset" as Lookup
  state "saved" as Saved
  state "generated" as Generated
  state "sketch" as Sketch
  state "Stored" as Stored

  Saved --> Loaded : load it
  Generated --> Stored : build from catalogues + spectrum, save
  Sketch --> Stored : build from SPHEREx only, save
  Stored --> Loaded
  Loaded --> [*]

  note right of Sketch
    Labelled "Sketch from SPHEREx only".
  end note
  note right of Saved
    Pre-baked demo assets, always available offline.
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

- With D-02 the settings file is retired. What a `saved` asset contains now (card, RenderParams, textures) is not restated in the specs **[verify]**.
- The architecture spec put generated assets in browser IndexedDB; the backend texture cache is separate.
- Bumping `generator_version` does not delete old entries; it changes the key. Clean-up is not specified.
- Baking failures are not specified **[verify]**.
