# 03 Deployment

Where each part runs at the event, and what talks to what. Drawn from [A10–A10.2](../architecture/frontend-platform.md) (the event build), A3, A6.3, A9, A12, rendering doc R2, R5.5, R8.1, and decisions D-05, D-06, D-08, D-15, D-24, D-25, D-35, Q-111 and Q-112 (object jobs and worker processes), **Q-132** (the event is a desktop browser on the Asus A15 laptop, sound only; answers Q-15) and Q-137 (data frozen on QR2). Dashed nodes and edges are post-event, optional or proposed.

```mermaid
flowchart LR
  subgraph A15["Asus TUF A15 laptop: the only machine at the event (Q-132)"]
    Browser["Desktop Chrome: web app (three r187, WebGPU or WebGL2 fallback, GPU check open)"]
    AudioOut["Web Audio only (sound, no vibration)"]
    Browser --- AudioOut
    subgraph Origin["One origin on localhost (secure context, no certificate needed)"]
      Bundle["Built frontend: Vite bundle (one-origin server #15 to build, vite preview until then)"]
      PyAPI["FastAPI API (D-15, A4.11), SX_OFFLINE=1"]
    end
    PipelineN["Pipeline + data adapters: one background job per object, shared cutout pool (Q-111, Q-112)"]
    MeasureW["Measure workers: 2 spawn processes, photometry per cutout (Q-112)"]
    BakeW["Bake worker: 1 spawn process, texture baker off the request path (Q-112)"]
    BakerN["Texture baker: numpy, scipy, opencv-headless, Pillow (CPU only)"]
    GemN["gemini_paint (admin token unset at the event, so off)"]
    Cache[("Read-through cache (D-25), frozen on QR2 (Q-137), zipped backup")]
    SkyStore[("Sky mirror: SX_CACHE_DIR/sky/ HiPS tiles (D-35)")]
    Textures[("/data/textures")]
    Shapes[("/data/shapes/{name}.glb from backend/assets/shapes")]
    PreFetch["Pre-fetch, sky_mirror, smoke_offline scripts (A10.2): test, demo and the Track object"]
    Browser -->|"http://localhost: app + /v1 + /data"| Origin
    PyAPI --- PipelineN
    PipelineN --- MeasureW
    PyAPI --- BakeW
    BakeW --- BakerN
    PyAPI --- GemN
    PipelineN --- Cache
    PyAPI --- SkyStore
    BakerN --- Textures
    PyAPI --- Shapes
    PreFetch --> Cache
    PreFetch --> SkyStore
  end

  subgraph TeamLaptop["Team laptop (offline jobs, RTX 3050 4 GB)"]
    DepthAny["Depth Anything V2 Small"]
    Marigold["Marigold v1-1 fp16 + TAESD (fallback)"]
    Decimate["Mesh decimation to 50k triangles (D-05)"]
    Prebake["Pre-bake demo assets"]
  end

  subgraph Archives["External archives and APIs (before the event, with internet)"]
    IRSA["IRSA SIA, cutouts, HiPS"]
    Gaia["Gaia DR3 TAP"]
    Horizons["JPL Horizons"]
    SkyBoT["IMCCE SkyBoT"]
    SBDB["JPL SBDB"]
    DAMIT["DAMIT (not called live: OBJ converter only)"]
    SIMBAD["SIMBAD"]
    Exo["NASA Exoplanet Archive (PSCompPars)"]
    GeminiAPI["Gemini image API"]
  end

  subgraph AfterEvent["After the event (Q-132)"]
    Phones["Android 16 phones (realme 14 Pro, Samsung): Chrome, navigator.vibrate + Web Audio"]
    Apple["iPhone / iPad: Web Audio only"]
    LAN["Local network: own router or hotspot, mkcert certificate (D-24, amendment pending)"]
    Tauri["Tauri Android app (B-01)"]
    Colab["Colab: image-to-3D (B-04)"]
  end

  Phones -.->|"HTTPS"| LAN
  Apple -.->|"HTTPS"| LAN
  Tauri -.->|"HTTPS"| LAN
  LAN -.-> Origin

  Cache -.->|"only on a cache miss and when SX_OFFLINE is not set"| IRSA
  Cache -.-> Gaia
  Cache -.-> Horizons
  Cache -.-> SkyBoT
  Cache -.-> SBDB
  Cache -.-> DAMIT
  Cache -.-> SIMBAD
  Cache -.-> Exo
  SkyStore -.->|"sky_mirror, before the event"| IRSA
  GemN -.->|"server-side key only, through the cache"| GeminiAPI

  Prebake -->|"copy assets to the A15 (how: open)"| Textures
  Decimate --> Prebake
  DepthAny --> Prebake
  Marigold -.-> Prebake
  Colab -.-> Prebake

  classDef post stroke-dasharray: 5 5
  class Phones,Apple,LAN,Tauri,Colab,Marigold,Exo,GemN post
```

## Notes

- **At the event (Q-132):** one machine, the Asus A15 laptop, runs the browser and the server. Sound is the only output; there is no vibration and no phone. The run steps are [A10.2](../architecture/frontend-platform.md#a102-running-the-event-build).
- `http://localhost` is a secure context, so WebGPU needs no certificate when the browser runs on the A15 itself. HTTPS, `mkcert` and the router of D-24 matter only once phones join, after the event.
- Budgets: owned by R5.5 and R5.7; the A15's GPU and browser version are still to measure (A10.1, A14.1).
- The demo runs with `SX_OFFLINE=1`: nothing touches the network, and the Gemini route does not exist because `SX_ADMIN_TOKEN` is unset (A10.2, D-24, D-25). The pre-fetch script fills the cache while the internet is good; the sky mirror holds the HiPS tiles (D-35). Cutouts only, never whole frames.
- The baker is CPU-only (rendering doc R2). It runs in a `spawn` worker process (`SX_BAKE_WORKERS=1`) queued by the API, and photometry runs in 2 more (`SX_MEASURE_WORKERS=2`), which leaves cores for the API (Q-112). With `SX_PREFETCH_ON_START=1` the API warms the cache for the demo targets at start-up (warm start, A4.10); overlays and composites still need the pre-fetch script.
- How pre-baked assets reach the A15 is open. Whether the team laptop for offline jobs is the A15 is not stated.
- There is no public URL after the event. A static hosted copy is a later, separate decision (D-24).
