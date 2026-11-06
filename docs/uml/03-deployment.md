# 03 Deployment

Where each part runs at the event, and what talks to what. Drawn from architecture spec §3, §6.3, §9, §10 and §12, rendering doc §2, §5.5, §8.1, and decisions D-05, D-06, D-08, D-15, D-24 and D-25. Dashed nodes are post-event or optional.

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

  subgraph Laptop["Demo laptop: Zenbook 14X, Intel Iris Xe (Q-15: may be replaced by the A15)"]
    LaptopBrowser["Browser [verify which]: web app"]
    AudioOnly2["Web Audio only"]
    LaptopBrowser --- AudioOnly2
  end

  LAN["Local network: own router or hotspot (D-24)"]

  subgraph A15["Asus A15 laptop: local server (D-24)"]
    subgraph Origin["One process, one origin, HTTPS"]
      Bundle["Built frontend: Vite bundle"]
      PyAPI["FastAPI API (D-15, D-16)"]
    end
    PipelineN["Pipeline + data adapters"]
    BakerN["Texture baker: numpy, scipy, opencv-headless, Pillow (CPU only)"]
    GemN["gemini_paint (P3, admin token, off when offline)"]
    Cache[("Read-through cache (D-25): outside git, zipped backup")]
    Textures[("/data/textures")]
    Shapes[("/data/shapes/{name}.glb from backend/assets/shapes")]
    PreFetch["Pre-fetch script (D-25): 5 test targets + every demo object"]
    PyAPI --- PipelineN
    PyAPI --- BakerN
    PyAPI --- GemN
    PipelineN --- Cache
    BakerN --- Textures
    PreFetch --> Cache
  end

  subgraph TeamLaptop["Team laptop (offline jobs, RTX 3050 4 GB)"]
    DepthAny["Depth Anything V2 Small"]
    Marigold["Marigold v1-1 fp16 + TAESD (fallback)"]
    Decimate["Mesh decimation to 50k triangles (D-05)"]
    Prebake["Pre-bake demo assets"]
  end

  subgraph Archives["External archives and APIs"]
    IRSA["IRSA SIA + S3 nasa-irsa-spherex"]
    Gaia["Gaia DR3 TAP"]
    Horizons["JPL Horizons"]
    SkyBoT["IMCCE SkyBoT"]
    SBDB["JPL SBDB"]
    DAMIT["DAMIT (not called live: OBJ converter only, site was down)"]
    SIMBAD["SIMBAD"]
    Exo["NASA Exoplanet Archive (PSCompPars, tested)"]
    GeminiAPI["Gemini image API"]
  end

  Tauri["Tauri Android app (B-01, post-event)"]
  Colab["Colab: image-to-3D (B-04, post-event)"]

  Chrome -->|"HTTPS: app + /v1 API"| LAN
  Safari -->|"HTTPS"| LAN
  LaptopBrowser -->|"HTTPS"| LAN
  LAN --> Origin

  Cache -.->|"only on a cache miss and when SX_OFFLINE is not set"| IRSA
  Cache -.-> Gaia
  Cache -.-> Horizons
  Cache -.-> SkyBoT
  Cache -.-> SBDB
  Cache -.-> DAMIT
  Cache -.-> SIMBAD
  Cache -.-> Exo
  GemN -.->|"server-side key only, through the cache"| GeminiAPI

  Prebake -->|"copy assets to the A15 [verify how]"| Textures
  Decimate --> Prebake
  DepthAny --> Prebake
  Marigold -.-> Prebake

  Tauri -.->|"HTTPS"| Origin
  Colab -.-> Prebake

  classDef post stroke-dasharray: 5 5
  class Tauri,Colab,Marigold,Exo,GemN post
```

## Notes

- Haptics can only be shown on the two Android phones (D-05, D-08). Every device gets the paired audio (D-10).
- Budgets (D-05): ≥ 30 fps while rotating, pixel ratio ≤ 1.5, textures 2048×1024 desktop and 1024×512 mobile, displacement on desktop only.
- HTTPS is needed because WebGPU needs a secure context. A local root certificate (e.g. `mkcert`) is installed on both Android phones; whether a clicked-through self-signed certificate is enough is **[verify]** (D-24).
- Venue Wi-Fi may block device-to-device traffic, so the team brings a router or hotspot (D-24).
- The demo runs with `SX_OFFLINE=1`: nothing touches the network, and the Gemini layer stays off so the code path shows (D-24, D-25). The pre-fetch script fills the cache while the internet is good. Cutouts only, never whole frames. Where the script runs is not stated; it is drawn on the A15 because the cache lives there.
- The baker is CPU-only (rendering doc §2).
- There is no public URL after the event. A static hosted copy is a later, separate decision (D-24).
- Whether the A15 also replaces the Zenbook as the demo screen is Q-15. Whether the team laptop for offline jobs is the A15 is not stated.
