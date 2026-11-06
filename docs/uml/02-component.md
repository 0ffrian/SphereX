# 02 Components

The main components and the interfaces between them. Diagram 1 is the system and backend view; diagram 2 opens up the frontend. Drawn from architecture spec §2, §3, §4, §9, rendering doc §3, §6, §7.7, §8, §10 and decisions D-01, D-02, D-07, D-08, D-10, D-12, D-15, D-16, D-18, D-19, D-20, D-22, D-25 and D-28.

## Diagram 1: system and backend

```mermaid
flowchart LR
  subgraph FE["Frontend (Vite + TS + React, see diagram 2)"]
    FEFlip["Flipbook"]
    FEPanel["Object panel"]
    FEViewer["Sky Sculptor viewer"]
  end

  subgraph BE["Backend (FastAPI on Python 3.12, D-15)"]
    API["API (D-16): resolve, frames, cutouts, spectrum, card, render-params"]
    Adapters["Data adapters (proxy)"]
    DataCache[("Read-through disk cache (D-25): raw responses, spectra, cards, render params; SX_OFFLINE=1 never calls out")]
    subgraph Pipe["Pipeline"]
      S1["1 Find object (core/find)"]
      S2["2 Measure flux and spectrum (core/measure)"]
      subgraph Classify["core/classify"]
        S3["3 Classify: rules.py (catalogue label, Q-55)"]
        TypeSel["Type selection (rendering doc §3.3; exoplanet thresholds Q-56)"]
      end
      subgraph CardPkg["core/card"]
        Svc["service.py: ObjectPipeline, stages 3-5 and 7 for one id"]
        Catalogue["catalogue.py: re-reads the cached SIMBAD / SBDB answer"]
        S4["4 Asset lookup, assets.py: saved / generated / sketch"]
        CardB["5 Card builder, build.py: ObjectCard with tags"]
        Validate["validate.py: jsonschema check of every reply (Q-40)"]
      end
      Physics["6 Physics layer (derived values)"]
    end
    subgraph Render["core/render"]
      C2P["7 card_to_params.py"]
      SpxRGB["spherex_rgb.py"]
      Blackbody["blackbody.py: Teff to display colour"]
      Baker["Texture baker: noise, craters, height, normals, palette, bake"]
      GemPaint["gemini_paint.py (P3, admin token)"]
    end
    TexCache[("/data/textures/{id}/{generator_version}/{seed}/")]
    Prebaked[("backend/assets/{type}/{id}.json (SX_ASSETS_DIR), pre-baked assets")]
  end

  subgraph Shared["shared/ (single source of the contract, D-18)"]
    CardSchema["schemas/object-card.schema.json"]
    RPSchema["schemas/render-params.schema.json"]
    Fixtures["fixtures/ (D-17)"]
  end

  subgraph Ext["External services"]
    IRSA["IRSA SIA + S3 (SPHEREx QR2)"]
    Resolver["SBDB / SIMBAD name resolve (D-19: SBDB first for small-body names, SIMBAD first otherwise)"]
    Horizons["JPL Horizons"]
    SkyBoT["IMCCE SkyBoT"]
    Gaia["Gaia DR3 TAP"]
    SBDB["JPL SBDB phys-par"]
    DAMIT["DAMIT shape.obj"]
    Exo["NASA Exoplanet Archive (untested)"]
    Gemini["Gemini image API"]
  end

  FEFlip -->|"GET /v1/resolve, /v1/objects/{id}/frames, /cutouts/{frame_id}.png"| API
  FEPanel -->|"GET /v1/objects/{id}/spectrum, /card"| API
  FEViewer -->|"GET /v1/objects/{id}/render-params"| API
  FEViewer -->|"texture URLs: albedo.webp, height.png, height.bin, normal.png"| TexCache

  API --> S1
  API -->|"/card, /render-params"| Svc
  Svc --> S4
  S1 --> S2 --> S3 --> TypeSel --> S4 --> CardB
  Catalogue -->|"catalogue facts"| S3
  Catalogue -->|"SBDB phys-par, SIMBAD values"| CardB
  S4 -->|"read"| Prebaked
  S4 <-->|"derived.asset (Q-57)"| DataCache
  Physics -->|"derived TVs with formula"| CardB
  SpxRGB -->|"spherex_rgb TV"| CardB
  Blackbody -->|"star colour from Teff"| C2P
  CardB --> C2P
  C2P -->|"RenderParams"| API
  C2P -->|"baked types only (D-01)"| Baker
  Baker -->|"write maps"| TexCache
  GemPaint -->|"AI albedo if corr >= 0.3"| TexCache

  S1 & S2 & Catalogue --> Adapters
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

  Validate -.->|"validates cards against"| CardSchema
  Validate -.->|"validates render params against"| RPSchema
  FE -.->|"src/contract generated from (D-18)"| Shared

  classDef stretch stroke-dasharray: 5 5
  class GemPaint,Exo stretch
```

## Diagram 2: frontend

```mermaid
flowchart TB
  BackendAPI["Backend API (diagram 1)"]

  subgraph UI["UI shell (React, Tailwind, animate-ui)"]
    Router["Hash routing: share link"]
    Flipbook["Flipbook, with the Rainbow Trails view mode (P1, D-28)"]
    Panel["Object panel: spectrum, card, 3 badges"]
    Listen["Audio / Listen: data sweep, imagined drive"]
    Store["Store (Zustand): card, RenderParams, honesty state, overrides"]
    PulseInd["On-screen pulse indicator (D-20)"]
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
      DAud["AudioDriver (audio.ts)"]
      DTauri["TauriDriver stub (B-01, post-event)"]
    end
  end

  IDB[("IndexedDB: session assets, overrides (D-22)")]
  LS[("localStorage: calibration, settings")]
  Vibrate["navigator.vibrate"]
  WebAudio["Web Audio AudioContext"]

  Router --> Store
  Flipbook -->|"resolve, frames, cutouts"| BackendAPI
  Panel -->|"GET spectrum, card"| BackendAPI
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
  Engine -.->|"spherex:haptic debug event"| PulseInd
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
- Endpoints follow D-16. Every endpoint is keyed by the object id that `resolve` returns; there is no separate flipbook endpoint. Responses served from the cache carry `cached_at` (D-25); for `/card` and `/render-params` it is the `X-SX-Cached-At` header, next to `X-SX-Asset-Status`, because the R3 shapes forbid extra fields (Q-39).
- Every external call goes through the read-through cache (D-25): cache, then a live call with a timeout and retries, then an older cached entry, then refuse.
- `core/classify`, `core/card` and the `card_to_params`, `blackbody` and `spherex_rgb` modules of `core/render` were built in issue #5. The `/card` and `/render-params` replies are plain dicts checked with `jsonschema`; the generated Pydantic models (D-18) only describe them in the OpenAPI docs (Q-40). The render-params endpoint names the texture URLs but does not call the baker yet.
- The physics layer is drawn on the backend, feeding derived values into the card. The browser reruns the same functions on slider changes (architecture spec §4.6). Baked types allow only colour, lighting and spin sliders; relief sliders exist only on the shader kinds (D-26).
- The `spherex:haptic` DOM event is a debug hook that also drives the on-screen pulse indicator (D-20). Which module fires it is not stated; it is drawn from the engine.
- `ShaderBody` and the `fields/` folder follow from D-01 and D-12 and are now listed in rendering doc §10. Their file names are **[verify]**.
- The `terrain` and `flow` sources come from D-12. The brown dwarf `bands` source and the `flux_pulse`, `teq_pulse`, `motion` and `detections` data haptics have no source file named in §10 **[verify]**.
