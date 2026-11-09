# 23 Track: components and sequences

Track of [A19](../architecture/moving-objects/track.md) (data and backend, with [A19.9 to A19.15](../architecture/moving-objects/track-contract.md)) and [A20](../architecture/moving-objects/track-ui.md) (the screen): one known solar-system object, its path seen from SPHEREx, the SPHEREx frames that caught it, a north-up zoom with stars masked and a spectrum built exposure by exposure (Q-131, Q-134 to Q-145). Three diagrams: components, opening Track (with the object job filling the path), and moving the time slider. Drawn 9 Nov 2026 from the spec; PR #53 builds the frame search, everything else is to build. Items marked "proposed" wait on a decision (Q-158 to Q-167 in the spec).

## Components

```mermaid
flowchart TB
  subgraph Job["backend object job (Q-111)"]
    PS["core/find/moving.py<br/>path search, exact TLIST (PR 53)"]
    PATH["path builder<br/>derived.path, 10 min samples"]
    OVL["core/find/overlays.py<br/>star list and footprint for movers (A19.6)"]
    MEAS["core/measure (Stage 2)<br/>OUTLIER-core rule Q-139"]
  end
  HOR["adapters/horizons.py<br/>observer 500@-163182, one-request gate"]
  SIA["adapters/irsa_sia.py + irsa_cutout.py"]
  CAT["adapters/gaia.py + wise.py"]
  CACHE[("Read-through cache D-25<br/>raw replies, derived.path, frames, spectrum")]
  subgraph API["FastAPI, reads the cache"]
    FR["/v1/objects/id/frames"]
    PA["/v1/objects/id/path (A19.5)"]
    OV["/v1/objects/id/overlays"]
    SP["/v1/objects/id/spectrum"]
    EX["/v1/objects/id/track.ecsv (A19.9)"]
  end
  subgraph FE["frontend/src/app/track (Atish, proposed D-17 amendment)"]
    PANE["TrackPane in the split pane, kind track (A21.8)"]
    HEAD[TrackHeader]
    DET["DetailView<br/>local imagery, 2MASS fallback"]
    ZOOM["Zoom<br/>masks, ring, path, flagged pixels"]
    SPEC["SpectrumHops + SpinSlider"]
    TIME["TimeBar + trackTime.ts"]
    LAYER["TrackLayer<br/>sky layer slot"]
    SOUND["Track path sound (R8.9.2)"]
  end
  STORE["state/store.ts track slice"]
  PS --> HOR
  PS --> SIA
  PATH --> HOR
  OVL --> CAT
  MEAS --> CACHE
  HOR --> CACHE
  SIA --> CACHE
  CAT --> CACHE
  PATH --> CACHE
  CACHE --> FR
  CACHE --> PA
  CACHE --> OV
  CACHE --> SP
  CACHE --> EX
  FR --> STORE
  PA --> STORE
  OV --> STORE
  SP --> STORE
  STORE --> PANE
  PANE --> HEAD
  PANE --> DET
  PANE --> ZOOM
  PANE --> SPEC
  PANE --> TIME
  STORE --> LAYER
  TIME --> SOUND
```

## Opening Track

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant K as Opener (Known card, Result card or object panel)
  participant SH as Shell split pane (A21.8)
  participant ST as Store (track slice)
  participant API as Backend API
  participant J as Object job (Q-111)
  participant H as Horizons (one request at a time)
  U->>K: Track it (object id)
  K->>SH: open kind track, hash track=id, closes Build if open
  SH->>ST: track.id, track.from
  par frames
    ST->>API: GET frames
    API-->>ST: frames so far, frames:search_deferred while the job runs
  and path
    ST->>API: GET path
    API->>J: start or join the job (online only)
    API-->>ST: points empty, path:deferred
  end
  J->>H: SPHEREx-centred ephemeris per window, then TLIST at frame midpoints
  H-->>J: positions (an over-limit text answer is a failure, never cached)
  J->>J: cones, s_region test, cutouts, Stage 2, derived.path
  loop Q-97 polling, one request in flight
    ST->>API: GET frames, GET path
    API-->>ST: final frames and path
  end
  ST->>API: GET overlays, GET spectrum (after the frame list is complete)
  API-->>ST: star masks, footprints, 14 points on Eros (13 flagged OUTLIER)
  ST-->>SH: panels ready, Track layer draws the path, camera fits it
  Note over ST,API: Offline and not pre-fetched: path:not_cached, the pane says so
```

## Moving the time slider

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant TB as TimeBar
  participant TT as trackTime.ts
  participant ST as Store (track slice)
  participant L as TrackLayer (sky) and DetailView
  participant Z as Zoom
  participant S as SpectrumHops
  participant A as Sound (R8.9.2)
  U->>TB: drag, arrow key or play
  TB->>TT: time t
  alt t at an exposure (or snapped within 4 px)
    TT-->>ST: exact TLIST position, frameIndex
    ST-->>Z: show that frame, ring, masks
    ST-->>S: add the exposure's points, one per frame (hollow if flagged)
    ST-->>A: exposure tick, one note per frame (heard in Measured only too)
  else between exposures
    TT-->>ST: position interpolated from 10 min samples, error bound stated
  end
  ST-->>L: redraw marker and path so far (render on change, D-34)
  Note over L,S: Measured only hides path, marker and ring, keeps pixels and points
```
