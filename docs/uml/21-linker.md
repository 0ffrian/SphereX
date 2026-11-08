# 21 Band-Hop Linker: components and sequences

The Band-Hop Linker of [A16](../architecture/linker.md) (proposal, Q-113): the offline field pipeline, the cached results, the `/v1/link` routes, and how the sky view draws them as layers. Three diagrams: components, the offline precompute, and the sky interaction. Drawn 8 Nov 2026 from the spec; nothing here is built yet.

## Components

```mermaid
flowchart TB
  subgraph Script["backend/scripts/link_field.py (offline)"]
    SVC[LinkService<br/>core/link/service.py]
  end
  subgraph Core["backend/app/core/link/"]
    FLD[field.py<br/>tiny-cone grid, pass split]
    EXT[extract.py<br/>background, flags, detect, measure]
    STA[static.py<br/>catalogue + repeat test]
    LNK[link.py<br/>rate grid, DBSCAN, fit, SED score]
    MAT[match.py<br/>SkyBoT per epoch]
    INJ[inject.py<br/>in-memory movers, shuffled control]
    EXP[export.py<br/>ECSV, ADES]
  end
  subgraph Reused["Reused modules"]
    SIA[adapters/irsa_sia.py]
    CUT[adapters/irsa_cutout.py + cutout pool Q-112]
    GAI[adapters/gaia.py, adapters/wise.py]
    SKB[adapters/skybot.py]
    WCS[core/find/wcs.py]
    FLG[Stage 2 reject list, core/measure/flags.py]
  end
  CACHE[(Read-through cache D-25<br/>+ link/v1/field_id/params_hash/)]
  API[api/link.py<br/>/v1/link/fields/...]
  subgraph FE["frontend/src"]
    RAIL[app/shell ToolRail + Panels<br/>ToolId linker]
    PANEL[app/sky/linker LinkerPanel<br/>Field, Chain, Atlas views]
    LAYER[app/sky/linker LinkerLayer<br/>canvas on SkyPane]
    STORE[state/store.ts linker slice]
    TR[app/shell Transport<br/>linker session]
    SKY[app/sky/SkyPane + viewer/sky/SkyView]
  end
  SVC --> FLD --> EXT --> STA --> LNK --> MAT --> EXP
  EXT --> INJ
  INJ --> LNK
  FLD --> SIA
  FLD --> CUT
  EXT --> WCS
  EXT --> FLG
  STA --> GAI
  MAT --> SKB
  SIA --> CACHE
  CUT --> CACHE
  GAI --> CACHE
  SKB --> CACHE
  SVC --> CACHE
  CACHE --> API
  API --> STORE
  RAIL --> PANEL
  STORE --> PANEL
  STORE --> LAYER
  TR --> STORE
  SKY --> LAYER
```

## Offline precompute

```mermaid
sequenceDiagram
  autonumber
  participant Op as Operator
  participant S as link_field.py / LinkService
  participant F as field.py
  participant E as extract.py + static.py
  participant L as link.py + match.py
  participant I as inject.py
  participant C as Cache (D-25)
  Op->>S: --field F1 --seed n (online, before the event)
  S->>F: frames for the field
  F->>C: tiny SIA cones and cutouts (read-through)
  C-->>F: frame rows, cutouts (or refusals: frames:truncated, cutout:frame_id)
  F-->>S: one pass, time order (or link:frames)
  S->>E: detect per frame, remove static (Gaia, CatWISE, repeat test)
  E-->>S: orphans per frame, n_static
  S->>L: link orphans, fit, SED score, SkyBoT match
  L-->>S: chains with verdicts
  loop 4 conditions x batches of about 50 movers
    S->>I: inject in memory (never cached, never served)
    I->>E: detect on injected frames
    I->>L: link
    I-->>S: recovered or not, per mover
  end
  S->>L: 20 time permutations of the real orphans
  L-->>S: false-link count
  S->>C: write field.json, detections.json, chains.json, completeness.json, exports
  Note over S,C: Same cache + parameters + seed give byte-identical files (A17.10)
```

## In the sky view

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant R as ToolRail / LinkerPanel
  participant ST as Store (linker slice)
  participant A as /v1/link (reads cache only)
  participant SP as SkyPane + LinkerLayer
  participant T as Transport
  U->>R: Linker tool
  R->>ST: load fields
  ST->>A: GET /v1/link/fields
  A-->>ST: precomputed fields (404 field_not_found offline if absent)
  U->>R: choose field F1
  ST->>A: GET field, chains, detections (current frame and neighbours)
  ST-->>SP: Detections layer on, fly to the field (chains clear of the panel)
  U->>R: Show the linked chains
  ST-->>SP: Chains layer on, chains revealed one by one, jump to the last frame
  SP-->>U: tracks with labels: found blind = designation, or unmatched chain
  U->>T: scrub frames
  T->>ST: frameIndex
  ST-->>SP: redraw on change (D-34)
  U->>SP: click near a track
  alt a revealed chain within 12 px
    SP->>R: open the Chain view (SED, stamps, facts, verdict)
  else nothing near
    SP->>ST: existing pick: search "ra,dec"
  end
  U->>R: Atlas
  ST->>A: GET completeness
  A-->>R: four curves, false links, limit or link:limit
```
