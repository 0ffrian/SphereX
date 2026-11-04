# 03 Deployment

Where each part runs at the event, and what talks to what. Drawn from architecture spec §3, §6.3, §9 and §12, rendering doc §2, §5.5, §8.1, and decisions D-05, D-06, D-08, Q-01, Q-02. Dashed nodes are post-event or optional.

```mermaid
flowchart LR
  subgraph Phones["Android 16 phones: realme 14 Pro, Samsung"]
    Chrome["Chrome: web app (three r187, WebGPU or WebGL2 [verify])"]
    Vib["navigator.vibrate + Web Audio"]
    Chrome --- Vib
  end

  subgraph Apple["iPhone / iPad"]
    Safari["Any browser: web app"]
    AudioOnly1["Web Audio only (no vibration)"]
    Safari --- AudioOnly1
  end

  subgraph Laptop["Demo laptop: Zenbook 14X, Intel Iris Xe"]
    LaptopBrowser["Browser [verify which]: web app"]
    AudioOnly2["Web Audio only"]
    LaptopBrowser --- AudioOnly2
  end

  subgraph Hosting["Frontend hosting (Q-02 open: same AWS server or static host)"]
    Bundle["Static bundle: Vite build"]
  end

  subgraph AWS["AWS server (CPU only, no GPU)"]
    PyAPI["Python 3.12 API (framework Q-01 open)"]
    PipelineN["Pipeline + data adapters"]
    BakerN["Texture baker: numpy, scipy, opencv-headless, Pillow"]
    GemN["gemini_paint (P3, admin token)"]
    DataDir[("/data: pre-fetched cutouts, cards, /data/textures")]
    PyAPI --- PipelineN
    PyAPI --- BakerN
    PyAPI --- GemN
    PipelineN --- DataDir
    BakerN --- DataDir
  end

  subgraph TeamLaptop["Team laptop (offline jobs, RTX 3050 4 GB)"]
    DepthAny["Depth Anything V2 Small"]
    Marigold["Marigold v1-1 fp16 + TAESD (fallback)"]
    Decimate["Mesh decimation to 50k triangles (D-05)"]
    Prebake["Pre-fetch cutouts, pre-bake demo assets"]
  end

  subgraph Archives["External archives and APIs"]
    IRSA["IRSA SIA + S3 nasa-irsa-spherex"]
    Gaia["Gaia DR3 TAP"]
    Horizons["JPL Horizons"]
    SkyBoT["IMCCE SkyBoT"]
    SBDB["JPL SBDB"]
    DAMIT["DAMIT"]
    SIMBAD["SIMBAD"]
    Exo["NASA Exoplanet Archive (untested)"]
    GeminiAPI["Gemini image API"]
  end

  Tauri["Tauri Android app (B-01, post-event)"]
  Colab["Colab: image-to-3D (B-04, post-event)"]

  Chrome -->|"HTTPS: load app"| Bundle
  Safari -->|"HTTPS: load app"| Bundle
  LaptopBrowser -->|"HTTPS: load app"| Bundle
  Chrome -->|"HTTPS: /v1/objects/{id}/card, /render-params, textures"| PyAPI
  Safari -->|"HTTPS"| PyAPI
  LaptopBrowser -->|"HTTPS"| PyAPI

  PipelineN -->|"HTTPS (proxy, cached)"| IRSA
  PipelineN --> Gaia
  PipelineN --> Horizons
  PipelineN --> SkyBoT
  PipelineN --> SBDB
  PipelineN --> DAMIT
  PipelineN --> SIMBAD
  PipelineN -.-> Exo
  GemN -->|"server-side key only"| GeminiAPI

  Prebake -->|"upload assets and cache [verify how]"| DataDir
  Decimate --> Prebake
  DepthAny --> Prebake
  Marigold -.-> Prebake
  Prebake --> IRSA

  Tauri -.->|"HTTPS"| PyAPI
  Colab -.-> Prebake

  classDef post stroke-dasharray: 5 5
  class Tauri,Colab,Marigold,Exo post
```

## Notes

- Haptics can only be shown on the two Android phones (D-05, D-08). Every device gets the paired audio (D-10).
- Budgets (D-05): ≥ 30 fps while rotating, pixel ratio ≤ 1.5, textures 2048×1024 desktop and 1024×512 mobile, displacement on desktop only.
- IRSA is slow and sometimes returns 504, so every demo target is pre-fetched into `/data` before the event (architecture spec §3.1, §13).
- The AWS server has no GPU and needs none; the baker is CPU-only (rendering doc §2).
- Q-02: if the frontend is hosted on the same AWS server, the "Frontend hosting" node merges into it.
