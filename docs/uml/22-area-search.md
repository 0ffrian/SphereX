# 22 Area search: components and sequences

Area search of [A16](../architecture/moving-objects/area-search.md) (agreed plan, Q-146): a square drawn on the sky, then **Known objects** (hand-off to Track, [A19](../architecture/moving-objects/track.md) and [A20](../architecture/moving-objects/track-ui.md)) or **Discovery** (dots, glitches, stars and fixed dots removed, joined across visits with a parallax-aware test, checked against known objects). Three diagrams: components, the offline precompute, and the sky interaction. Drawn 9 Nov 2026 from A16 to A18 (backend [A17](../architecture/moving-objects/area-backend.md), sky UI [A18](../architecture/moving-objects/area-ui.md), shell [A21](../architecture/sky-shell.md)); nothing here is built yet. Items marked "proposed" wait on a decision (Q-178 to Q-187 in the spec).

## Components

```mermaid
flowchart TB
  subgraph Script["backend/scripts/area_discovery.py (offline)"]
    SVC["AreaService<br/>core/area/service.py"]
  end
  subgraph Core["backend/app/core/area/"]
    FRM["frames.py<br/>grid of small SIA cones, s_region overlap, time windows, visits, coverage"]
    DOT["dots.py<br/>mesh background, hardware flags masked, OUTLIER kept as a flag, detect, measure"]
    CLN["clean.py<br/>glitches, fixed, stars per tracklet"]
    JON["join.py<br/>tracklets, pairs, parallax-aware test, mutual best"]
    MAT["match.py<br/>SkyBoT candidates, Horizons positions from SPHEREx"]
    INJ["inject.py (gated D4)<br/>planted movers in memory, test mover, completeness grid"]
    CTL["control.py (gated D5)<br/>shuffled-time runs"]
    SED["sed.py (gated D6)<br/>smoothness label per track"]
    RGL["rategrid.py (gated D7)<br/>3 or more visits"]
  end
  subgraph Reused["Reused or shared modules"]
    SIA["adapters/irsa_sia.py + PR 53 footprint helper and pacer"]
    CUT["adapters/irsa_cutout.py + cutout pool Q-112"]
    MEAS["core/measure (Stage 2 aperture)"]
    STAR["star list per visit, Gaia + CatWISE (A19.6, Q-143)"]
    SKB["adapters/skybot.py"]
    HOR["adapters/horizons.py behind the one-request gate (A19.5)"]
    WCS["core/find/wcs.py"]
    ECSV["core/export/ecsv.py shared writer (A19.9)"]
  end
  CACHE[("Read-through cache D-25<br/>raw replies + derived.area entries")]
  API["api/areas.py<br/>/v1/areas/... incl. /checks (gated)"]
  subgraph FE["frontend/src"]
    RAIL["app/shell ToolRail + railIcons<br/>ToolId area"]
    CARDS["Feature cards in the object card's slot (proposed Q-172)<br/>Area, Options, Known, Discovery, Result, Checks (gated)"]
    ISL["Island progress pill (proposed)"]
    LAYER["app/sky/area AreaLayer<br/>sky layer slot"]
    STORE["state/store.ts area slice"]
    TRK["Track pane, split kind track (A20)"]
    SKY["app/sky/SkyPane + viewer/sky/SkyView"]
  end
  SVC --> FRM --> DOT --> CLN --> JON --> MAT
  SVC --> ECSV
  SVC -.-> INJ
  SVC -.-> CTL
  SVC -.-> SED
  SVC -.-> RGL
  INJ --> DOT
  CTL --> JON
  RGL --> CLN
  SED --> MAT
  FRM --> SIA
  FRM --> CUT
  DOT --> WCS
  DOT --> MEAS
  CLN --> STAR
  JON --> HOR
  MAT --> SKB
  MAT --> HOR
  SIA --> CACHE
  CUT --> CACHE
  STAR --> CACHE
  SKB --> CACHE
  HOR --> CACHE
  SVC --> CACHE
  CACHE --> API
  API --> STORE
  RAIL --> CARDS
  STORE --> CARDS
  CARDS --> ISL
  STORE --> LAYER
  SKY --> LAYER
  CARDS --> TRK
```

`join.py` asks Horizons for SPHEREx's velocity relative to the geocentre, one vector per visit, for the parallax-aware test (A17.4, proposed).

## Offline precompute

```mermaid
sequenceDiagram
  autonumber
  participant Op as Operator
  participant S as area_discovery.py / AreaService
  participant F as frames.py
  participant D as dots.py + clean.py
  participant J as join.py
  participant M as match.py
  participant C as Cache (D-25)
  Op->>S: --area eros-2026-03 (online, before the event)
  S->>F: frames for the area
  F->>C: grid of small SIA cones, then cutouts (read-through)
  C-->>F: frame rows and cutouts, or frames:cone_maxrec, no_footprint, cutout codes
  F-->>S: frames in the time windows, visits, coverage (or area:visits)
  S->>D: dots per frame, then glitch, fixed and star labels
  D->>C: Gaia and CatWISE cones per visit (shared star list)
  D-->>S: movers-to-be per visit, step counts
  S->>J: tracklets, candidate pairs
  J->>C: Horizons vector of SPHEREx per visit
  J-->>S: tracks and possibles (ambiguous, no_partner, one_visit)
  S->>M: check the tracks
  M->>C: SkyBoT cone per visit (candidates only)
  M->>C: Horizons TLIST per candidate at every frame time, one request at a time
  M-->>S: verdicts found_blind, unexplained, unchecked, and the Known list
  opt gated extras D4 to D7 (Q-203)
    S->>D: planted movers in memory (test mover, completeness grid)
    S->>J: shuffled-time runs, rate grid when 3 or more visits, spectrum score
    J-->>S: checks (planted and control results never enter tracks)
  end
  S->>C: pre-fetch Track for every Known object (or list it as skipped)
  S->>C: write derived.area entries (summary, known, dots, tracks, checks, export)
  Note over S,C: Same cache + settings give byte-identical entries (A17.10)
```

## In the sky view

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant P as Area feature cards
  participant ST as Store (area slice)
  participant A as /v1/areas (reads the cache only)
  participant SP as SkyPane + AreaLayer
  participant T as Track pane (A20)
  U->>P: Area search tool
  P-->>SP: pointer mode draw
  U->>SP: drag a square
  SP->>ST: square
  SP-->>SP: pointer mode back to pan (proposed)
  ST->>A: GET /v1/areas (index)
  alt square outside every prepared area
    ST-->>P: area:not_prepared, list the areas with Fly there
  else inside a prepared area
    ST->>A: GET /v1/areas/area_id
    A-->>ST: summary, frames, coverage
    ST-->>P: Options card: Known objects or Discovery
  end
  alt Known objects
    U->>P: Known objects
    ST->>A: GET known
    A-->>P: known list with Horizons positions and track_available
    U->>P: Track it (433 Eros)
    P->>T: open the split pane, kind track, hash track=id
  else Discovery
    U->>P: Discovery, Look for movers
    ST->>A: GET dots, tracks
    ST-->>SP: Dots and Tracks layers, five steps one by one
    U->>P: Minimise (proposed island progress pill)
    SP-->>U: T1 found blind = 433 Eros, T2 unexplained, T3 possible, T4 not checked
    U->>SP: click T1 (layer hit-test before the pick)
    SP->>P: Result card, hash atrack=T1
    U->>P: Open in Track
    P->>T: open the split pane, kind track
  end
  U->>T: Back to the area (or Escape)
  T->>P: close Track, reopen the card the user came from, focus returns
```
