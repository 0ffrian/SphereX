# 22 Area search: components and sequences

Area search of [A16](../architecture/moving-objects/area-search.md) (agreed plan, Q-146): a square drawn on the sky, then **Known objects** (hand-off to Atish's Track, Q-131) or **Discovery** (dots, glitches and stars removed, joined across visits, checked with SkyBoT). Three diagrams: components, the offline precompute, and the sky interaction. Drawn 9 Nov 2026 from the spec; nothing here is built yet.

## Components

```mermaid
flowchart TB
  subgraph Script["backend/scripts/area_discovery.py (offline)"]
    SVC[AreaService<br/>core/area/service.py]
  end
  subgraph Core["backend/app/core/area/"]
    FRM[frames.py<br/>frame search grid, visits]
    DOT[dots.py<br/>background, flags, detect, measure]
    CLN[clean.py<br/>glitches, stars, fixed]
    JON[join.py<br/>tracklets, pairs across visits]
    MAT[match.py<br/>SkyBoT per visit]
    EXP[export.py<br/>ECSV]
  end
  subgraph Reused["Reused modules"]
    SIA[adapters/irsa_sia.py + PR #53 frame search]
    CUT[adapters/irsa_cutout.py + cutout pool Q-112]
    STAR[star list per visit, Gaia + CatWISE, Q-143]
    SKB[adapters/skybot.py]
    WCS[core/find/wcs.py]
    FLG[Stage 2 reject list, OUTLIER rule Q-139]
  end
  CACHE[(Read-through cache D-25<br/>+ area/v1/area_id/params_hash/)]
  API[api/areas.py<br/>/v1/areas/...]
  PATH[path endpoint Q-141]
  subgraph FE["frontend/src"]
    RAIL[app/shell ToolRail<br/>ToolId area]
    ISL[Island cards<br/>Area, Options, Known, Discovery, Track card<br/>minimise]
    LAYER[app/sky/area AreaLayer<br/>canvas on SkyPane]
    STORE[state/store.ts area slice]
    TRK[Track view, Atish Q-131<br/>split pane]
    SKY[app/sky/SkyPane + viewer/sky/SkyView]
  end
  SVC --> FRM --> DOT --> CLN --> JON --> MAT --> EXP
  FRM --> SIA
  FRM --> CUT
  DOT --> WCS
  DOT --> FLG
  CLN --> STAR
  MAT --> SKB
  SIA --> CACHE
  CUT --> CACHE
  STAR --> CACHE
  SKB --> CACHE
  SVC --> CACHE
  CACHE --> API
  CACHE --> PATH
  API --> STORE
  PATH --> TRK
  RAIL --> ISL
  STORE --> ISL
  STORE --> LAYER
  SKY --> LAYER
  ISL --> TRK
```

## Offline precompute

```mermaid
sequenceDiagram
  autonumber
  participant Op as Operator
  participant S as area_discovery.py / AreaService
  participant F as frames.py
  participant D as dots.py + clean.py
  participant J as join.py + match.py
  participant C as Cache (D-25)
  Op->>S: --area eros-2026-03 (online, before the event)
  S->>F: frames for the area
  F->>C: frame search grid and cutouts (read-through)
  C-->>F: frame rows, cutouts (or refusals: frames:truncated, cutout:frame_id)
  F-->>S: frames grouped into visits (or area:visits)
  S->>D: dots per frame, then glitch, star and fixed labels
  D-->>S: movers-to-be per visit, step counts
  S->>J: tracklets per visit, pairs across visits, SkyBoT per visit
  J-->>S: tracks and possibles with verdicts, known list
  S->>C: write area.json, known.json, dots.json, tracks.json, export.ecsv
  Note over S,C: Same cache + parameters give byte-identical files (A17.10)
```

## In the sky view

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant I as Island cards
  participant ST as Store (area slice)
  participant A as /v1/areas (reads cache only)
  participant SP as SkyPane + AreaLayer
  participant T as Track view (Q-131)
  U->>I: Area search tool
  I-->>SP: drawing mode
  U->>SP: drag a square
  SP->>ST: square
  ST->>A: GET /v1/areas, then the area holding the square
  A-->>ST: summary (or 404 area_not_found: "not prepared", list areas)
  ST-->>I: Options card: Known objects or Discovery
  alt Known objects
    U->>I: Known objects
    ST->>A: GET known
    A-->>I: list of known objects
    U->>I: Track it (433 Eros)
    I->>T: open Track in the split pane
  else Discovery
    U->>I: Discovery, Look for movers
    ST->>A: GET dots, tracks
    ST-->>SP: Dots and Tracks layers, blink the visits, five steps one by one
    U->>I: minimise (pill shows the current step)
    SP-->>U: T1 found blind = 433 Eros, T2 unexplained, T3 possible
    U->>SP: click T1
    SP->>I: Track card
    U->>I: Open in Track
    I->>T: open Track in the split pane
  end
  U->>T: Back to the area
  T->>I: reopen the card the user came from
```
