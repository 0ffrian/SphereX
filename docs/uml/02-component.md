# 02 Components

The main components and the interfaces between them. Diagram 1 is the system and backend view; diagram 2 opens up the frontend. Drawn from architecture spec §2, §3, §4, §9, rendering doc §3, §6, §7.7, §8, §10 and decisions D-01, D-02, D-07, D-08, D-10, D-12.

## Diagram 1: system and backend

```mermaid
flowchart LR
  subgraph FE["Frontend (Vite + TS + React, see diagram 2)"]
    FEFlip["Flipbook"]
    FEPanel["Object panel"]
    FEViewer["Sky Sculptor viewer"]
  end

  subgraph BE["Backend (Python 3.12, framework Q-01 open)"]
    API["API objects.py"]
    Adapters["Data adapters (proxy)"]
    DataCache[("/data cache: SIA results, cutouts, cards")]
    subgraph Pipe["Pipeline"]
      S1["1 Find object"]
      S2["2 Measure flux and spectrum"]
      S3["3 Classify"]
      TypeSel["Type selection (rendering doc §3.3)"]
      S4["4 Asset lookup: saved / generated / sketch"]
      CardB["Card builder: ObjectCard with tags"]
      Physics["6 Physics layer (derived values)"]
    end
    subgraph Render["core/render"]
      C2P["card_to_params.py"]
      SpxRGB["spherex_rgb.py"]
      Baker["Texture baker: noise, craters, height, normals, palette, bake"]
      GemPaint["gemini_paint.py (P3, admin token)"]
    end
    TexCache[("/data/textures/{id}/{generator_version}/{seed}/")]
  end

  subgraph Shared["shared/schemas"]
    CardSchema["object-card.schema.json"]
    RPSchema["render-params.schema.json"]
  end

  subgraph Ext["External services"]
    IRSA["IRSA SIA + S3 (SPHEREx QR2)"]
    Resolver["SIMBAD / SBDB name resolve (Q-05)"]
    Horizons["JPL Horizons"]
    SkyBoT["IMCCE SkyBoT"]
    Gaia["Gaia DR3 TAP"]
    SBDB["JPL SBDB phys-par"]
    DAMIT["DAMIT shape.obj"]
    Exo["NASA Exoplanet Archive (untested)"]
    Gemini["Gemini image API"]
  end

  FEFlip -->|"search + frames + cutouts (endpoint not named in spec)"| API
  FEPanel -->|"GET /v1/objects/{id}/card"| API
  FEViewer -->|"GET /v1/objects/{id}/render-params"| API
  FEViewer -->|"texture URLs: albedo.webp, height.png, height.bin, normal.png"| TexCache

  API --> S1
  S1 --> S2 --> S3 --> TypeSel --> S4 --> CardB
  Physics -->|"derived TVs with formula"| CardB
  SpxRGB -->|"spherex_rgb TV"| CardB
  CardB --> C2P
  C2P -->|"RenderParams"| API
  C2P -->|"baked types only (D-01)"| Baker
  Baker -->|"write maps"| TexCache
  GemPaint -->|"AI albedo if corr >= 0.3"| TexCache

  S1 & S2 & CardB --> Adapters
  Adapters <--> DataCache
  Adapters -->|"SIA?COLLECTION=spherex_qr2, cutouts"| IRSA
  Adapters -->|"name to RA/Dec"| Resolver
  Adapters -->|"position per frame"| Horizons
  Adapters -->|"conesearch.php, -ep in JD"| SkyBoT
  Adapters -->|"sso_reflectance_spectrum"| Gaia
  Adapters -->|"sbdb.api?sstr=...&phys-par=1"| SBDB
  Adapters -->|"shape.obj"| DAMIT
  Adapters -.->|"planet columns (P2)"| Exo
  GemPaint -->|"hillshade + prompt (server-side key)"| Gemini

  CardB -.->|"validates against"| CardSchema
  C2P -.->|"validates against"| RPSchema
  FE -.->|"types from"| Shared

  classDef stretch stroke-dasharray: 5 5
  class GemPaint,Exo stretch
```

## Diagram 2: frontend

```mermaid
flowchart TB
  BackendAPI["Backend API (diagram 1)"]

  subgraph UI["UI shell (React, Tailwind, animate-ui)"]
    Router["Hash routing: share link"]
    Flipbook["Flipbook"]
    Panel["Object panel: spectrum, card, 3 badges"]
    Listen["Audio / Listen: data sweep, imagined drive"]
    Store["Store (Zustand): card, RenderParams, overrides"]
    Settings["Haptics + audio settings"]
  end

  subgraph Viewer["Sky Sculptor viewer (three r187, three/webgpu)"]
    ViewerApp["ViewerApp"]
    Support["lighting, modes, honesty, scaleBar, altText"]
    subgraph Renderers["renderers/"]
      RBaked["AsteroidMesh, AsteroidProcedural, Comet, BrownDwarf, Star (baked or mesh)"]
      RShader["ShaderBody (planet_rocky, planet_water, gas_giant, nebula, nova)"]
    end
    ShaderGen["Shader generators: terra-planet, banded-giant, gas-cloud, shell-remnant (triplanar)"]
    FieldWorker["Field worker (Web Worker): 512x256 field"]
  end

  subgraph Haptics["haptics/"]
    Engine["HapticEngine: rate limit, fan-out"]
    Calib["Calibration"]
    subgraph Sources["sources/"]
      SrcSurface["heightMap, meshNormal, terrain, flow"]
      SrcData["field, spectrum, lightcurve"]
    end
    subgraph Drivers["drivers/"]
      DVib["WebVibrateDriver"]
      DAud["AudioDriver (audioClick.ts)"]
      DTauri["TauriDriver stub (B-01, post-event)"]
    end
  end

  IDB[("IndexedDB: session assets [verify role after D-02]")]
  LS[("localStorage: calibration, settings")]
  Vibrate["navigator.vibrate"]
  WebAudio["Web Audio AudioContext"]

  Router --> Store
  Flipbook -->|"frames"| BackendAPI
  Panel -->|"GET card"| BackendAPI
  ViewerApp -->|"GET render-params, textures"| BackendAPI
  Flipbook -->|"click ring: object id"| Panel
  Panel -->|"View in 3D"| ViewerApp
  Panel --> Listen
  Store <--> Panel
  Store <--> ViewerApp
  Store <--> IDB
  ViewerApp --> Support
  ViewerApp -->|"choose by type"| Renderers
  RShader --> ShaderGen
  RShader -->|"request field (seed)"| FieldWorker
  FieldWorker -->|"DataTexture"| ShaderGen
  ViewerApp -->|"pointer UV, honesty state"| Sources
  SrcSurface -->|"sample height.bin or field"| FieldWorker
  Panel -->|"drag on plot, scrub"| SrcData
  Listen -->|"same events as spectrum haptics"| SrcData
  Sources -->|"HapticEvent"| Engine
  Engine -->|"emit"| DVib
  Engine -->|"emit"| DAud
  Engine -.->|"emit"| DTauri
  DVib --> Vibrate
  DAud --> WebAudio
  Listen --> WebAudio
  Calib <--> LS
  Settings <--> LS
  Calib --> DVib
  Calib --> DAud

  classDef post stroke-dasharray: 5 5
  class DTauri post
```

## Notes

- Baked types (rendering doc types) fetch textures from the backend; shader kinds generate a field in the browser instead (D-01, D-12).
- The flipbook and search endpoints are not named in either spec. Only `/v1/objects/{id}/card` and `/render-params` are.
- The physics layer is drawn on the backend, feeding derived values into the card. Whether sliders re-run it on the client is part of Q-03.
- `ShaderBody` and the `fields/` folder are not in rendering doc §10 yet; they follow from D-01 and D-12. Their file names are **[verify]**.
- The `terrain` and `flow` sources come from D-12. The brown dwarf `bands` source and the `flux_pulse`, `teq_pulse`, `motion` and `detections` data haptics have no source file named in §10 **[verify]**.
