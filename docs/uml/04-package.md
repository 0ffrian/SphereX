# 04 Packages

The repo and code layout as packages, with their dependencies and owners. Drawn from `CLAUDE.md` (layout), rendering doc R10 ([layout.md](../rendering/layout.md#r10-file-layout-and-ownership)) and R10.1 ([layout-repo.md](../rendering/layout-repo.md#r101-rest-of-the-repository-interim)), the shell spec A21, the Track and Area search specs A16 to A20 and decisions D-01, D-11, D-12, D-13, D-15, D-17, D-18 and D-35 (sky-view prototype: Q-87 to Q-91; colour composite, colour views, progressive frames and cached markers: Q-92, Q-93, Q-95, Q-97 and Q-98; object jobs and worker pools: Q-111, Q-112). Arrows mean "depends on" or "uses".

```mermaid
flowchart TB
  subgraph Repo["SphereX repo"]
    subgraph Docs["docs/"]
      DocSpecs["decisions/ (index + topic files), architecture/ (incl. moving-objects/), rendering/, handover.md"]
      DocUML["uml/ (these diagrams)"]
    end

    Mockup["mockup/ : spherex-ui.html (three r128), chase-the-rock.html (Track) : not the app"]

    subgraph Backend["backend/ (FastAPI, Python 3.12) : Kevin, Moon, Atish"]
      BApi["app/api (Kevin) : D-16 endpoints, app/main.py mounts /data/textures and the read-only /data/demo-textures (Q-164), objects.py : /card, /render-params, texture URLs, /job, /job/events (Q-111), sky.py : /v1/sky (prototype, Q-87, /v1/sky/cached, Q-98), composite.py : /composite, /composite.png (prototype, Q-92), overlays.py : /overlays, /flags, /combine.png (Q-50), gemini.py : /admin/.../gemini-repaint, /albedo-ai, /albedo-ai.webp (Q-122)"]
      BPipe["app/core/find (stage 1, overlays, flagmask, combine, A4.9), app/adapters (gaia, wise = CatWISE2020, tap), app/cache, app/core/card (stages 4, 5; reference.py, reference objects, Q-328) : Kevin, app/core/measure (stage 2, pool.py MeasurePool, Q-112) and physics : Moon, app/core/classify (stage 3) : Atish"]
      BRender["app/core/render (Atish) : card_to_params, gas_giant, blackbody, params, noise, craters, height, normals, palette, bake, __main__, spherex_rgb, gemini_paint, background (TextureBaker, Q-112)"]
      BScripts["backend/scripts/bake_fixtures.py (Atish, with the baker): bakes the shared fixture textures with the real baker (Q-114); --check fails on drift"]
      BPack["backend/scripts/bake_demo_pack.py (Moon, Q-164): runs the pipeline per search row, writes assets/<type>/<id>.json, assets/textures/ (served read-only at /data/demo-textures, also offline) and frontend/src/app/search/demoTargets.ts; --check fails on drift"]
      BAssets["backend/assets/ : shapes/ (registry.toml, GLBs), literature.toml (A3.13, Q-153), pm13_dwarf_teff.toml (Q-152), textures/ (demo pack maps, Q-164), <type>/*.json (demo pack assets)"]
      BJobs["app/core/jobs.py (Job, JobRegistry), app/core/warm.py (WarmCache) : issue #41, owner proposed: Kevin (Q-111)"]
      BContract["app/contract : generated from shared/schemas (D-18) : follows the schemas owner"]
      BSky["app/core/sky : surveys, healpix, bake (HiPS to equirect), scripts/sky_mirror, sky_bake : prototype, no D-17 owner yet (Q-87, D-35)"]
      BComp["app/core/composite : config, select, grid, service (SPHEREx false colour) : prototype, no D-17 owner yet (Q-92, Q-94)"]
      BTrack["/path, /track.ecsv, track writer (A19, to build, on PR #53's path search) : Kevin"]
      BArea["app/core/area : frames, dots, clean, join, match, export ; /v1/areas (A17, to build) : Kevin"]
    end

    subgraph Frontend["frontend/ (Vite + TS + React) : owners per package"]
      FApp["src/app (React shell: App, ViewerPanel (tier text: tier N of 5 and its meaning, Q-106), StatusLine, FixtureBanner, LiveAnnouncer, Badge, StatusBoxes, urlHash + useHashSync, format, messages, refusals, RefusalList, ui), src/state (Zustand store with the sky slice) : Moon"]
      FFlip["src/app/api (M1 client, D-16, sky index, Q-87), src/app/search, src/app/flipbook (with Rainbow Trails, D-28, session.tsx shared playback, colourMode + ColourViews, Q-93, Q-95, progressive + FramesProgress, Q-97, frameGrid, overlays/, issue #12, drawn on the frame grid, Q-102), src/app/spectrum : Moon"]
      FShell["src/app/island (Island, GridLoader, islandStore, islandText, loaderLooks; Q-121, Q-123), src/app/shell (SkyDock, SkyZoom, AreaCard, areaStore, ToolRail, railIcons, icons, Transport, PanelCard, Panels, Readout, shellStore, shortcuts; D-38, Q-296), src/app/area (areaService demo seam, KnownList, DiscoveryCard, ErosCard, AreaTrackLayer, DemoTag; Q-414), src/app/sky (SkyPane, useTargetMarkers, cachedMarkers + useCachedMarkers (Q-98), readout, positionTags), src/app/Segmented : A21, Moon"]
      FBuild["src/app/build (BuildPane, SelectedCard, MouldStrip, MouldAnimation, mouldBody, HearPanel, hearAudio, useMould, selectedBody, focus; Q-415, Q-416) : issue #60, R5.8, Moon"]
      FTrack["src/app/track (Track pane, A20.13, to build) : Atish, proposed"]
      FArea["src/app/sky/area (Area search tool and layer, A18, to build) : Moon"]
      FDev["fixtures/ (dev-only synthetic fixture server), scripts/ (check-dist), src/test (test helpers), src/fixtures.test.ts, e2e/ (Playwright) : dev and test only"]
      FPhysics["src/physics : A7 physics layer, derivePhysics, slider registry (D-26, D-27) : Moon"]
      FContract["src/contract : generated from shared/schemas (D-18), assertTagged next to it : follows the schemas owner"]
      FEngine["src/engine (D-37, raw WebGL2) : worlds/ (WorldEngine, cardToWorld, core.js, gas.js, shaders.js, presets.js, terrain.js, helpers.js), stars/ (StarEngine, cardToStar, protoStar1-4), rocks/ (RockView, cardToRock, source.ts), parity/ (dev only) : Moon"]
      FEngineStages["src/app WorldEngineStage, StarEngineStage, build/RockStage, RockCloseUp : engine hosts, + Artistic only (Q-287) : Moon"]
      FEngineScripts["frontend/scripts extract-world-engine.py, extract-rock-engine.py, engine-parity.cjs : need SX_PREVIEW_HTML or REF; the prototype HTML is not in the repo (Q-335) : Moon"]
      subgraph FViewer["src/viewer (Moon)"]
        VCore["ViewerApp, lighting, modes, honesty, scaleBar, altText"]
        VRend["renderers/ : AsteroidMesh, AsteroidProcedural, Comet, BrownDwarf, Star, ShaderBody, bodyRenderer, fieldTexture, shaderPlan, shaderSpec, shaderPalette, pointClouds, StarBody, jetSurface, jetPalette, linearColour (sRGB to linear, once), asteroidLift (Q-117), ttauriDisc (Q-118), textureMean (Q-116, Q-117), sliders.ts"]
        VSky["sky/ : SkyView, skyMath, surveys (prototype, Q-89, Q-90)"]
        VRender["render/ : pipeline (RenderChain), quality (quality levels, FrameGovernor), clock (SimClock), workerPool (WorkerPool), fanout (loadBody, asset prefetch)"]
        VShaders["shaders/ : TSL noise (fbm, ridged, domainWarp, animatedCells, OCTAVES) and sphere helpers (latLon, tangentFrame, differentialRotate), star and loops (issue #42)"]
        VMotion["motion/ : motion (resolveMotion, D-32 chain), planMotion, phase, bodies/ : starModel (CPU star surface model, pure in seed, rates, t) : issue #42"]
        VFields["fields/ : fieldGenerator, flowModel (storms, issue #42), noise, fieldWorker, fieldClient (D-12) : Atish (D-17), shader generators (D-01) : Moon"]
        VMould["mould/ : MouldRig, mouldSteps (R5.8) ; volume/, shape/ (Q-103)"]
      end
      subgraph FHaptics["src/sound : Atish (D-13, D-17; haptics cut, D-39)"]
        HCore["engine, voices, audioContext, audioGraph (buses), settings, pitch, spectrumMapping, tuning, listenSweep, appSound, ui/SoundSettings"]
      end
      FShaderlab["src/shaderlab + shaderlab.html : dev-only shader harness, not a build input, not in dist/ : no owner named in D-17"]
      FGpuProbe["src/gpuProbe + gpu-probe.html : dev-only GPU probe (R11.4), not a build input : Atish"]
      FPerf["src/perf : adapter report, frame stats, __sxPerf recorder; fixtures build only (R11.4) : Atish"]
    end

    Schemas["shared/schemas : object-card.schema.json, render-params.schema.json, shared/fixtures (cards, params, baked textures) : Moon"]
  end

  DocUML -.->|"illustrates"| DocSpecs
  BApi --> BPipe
  BApi --> BRender
  BApi -->|"reads (read-only)"| BAssets
  BApi -->|"/job, /job/events, startup and shutdown"| BJobs
  BPipe -->|"ObjectPipeline runs one Job per object"| BJobs
  BJobs -->|"warm.py: resolve, ensure_job"| BPipe
  BPipe --> BRender
  BScripts --> BRender
  BRender -->|"validates"| Schemas
  BApi -->|"Pydantic models"| BContract
  BContract -.->|"generated from (D-18)"| Schemas

  FApp --> VCore
  FApp -->|"engine stages"| FEngineStages
  FEngineStages -->|"+ Artistic only (Q-287)"| FEngine
  FEngineStages -->|"setEngineOwned, fallback to three.js"| VCore
  FEngine -->|"climate, fluids, gasDynamics, stellar"| FPhysics
  FEngineScripts -.->|"generates the copied blocks"| FEngine
  FApp --> FPhysics
  FPhysics -->|"SliderKey, Overrides (viewer/sliders.ts)"| VRend
  VRend -->|"LAVA_START_K"| FPhysics
  FPhysics --> FContract
  FApp --> FContract
  VCore --> FContract
  HCore --> FContract
  FContract -.->|"generated from (D-18)"| Schemas
  FApp --> HCore
  FApp --> FFlip
  FApp -->|"App renders the shell"| FShell
  FShell -->|"search origin sky, session, panels"| FFlip
  FShell -->|"sky view, picking maths"| VSky
  FShell -->|"split pane, rail 3D viewer"| FBuild
  FBuild -->|"ViewerApp in the build pane, setMould"| VCore
  VCore --> VMould
  FBuild -->|"GET card, render-params"| FFlip
  FShell -.->|"pane kind track (A21.8, proposed)"| FTrack
  FShell -.->|"tool area, sky layer slot (A21.13)"| FArea
  FArea -.->|"Track it"| FTrack
  FTrack -.->|"HTTP /path, track.ecsv"| BApi
  FArea -.->|"HTTP /v1/areas"| BApi
  BApi -.-> BTrack
  BApi -.-> BArea
  BTrack -.->|"stage 1 frames, stage 2 for movers"| BPipe
  BArea -.->|"adapters, cache"| BPipe
  FFlip -->|"HTTP /v1/sky (Q-87)"| BApi
  BApi -->|"sky.py serves the local copy"| BSky
  BApi -->|"composite.py"| BComp
  BComp -->|"stage 1 frames, stage 2 verdicts"| BPipe
  FFlip -->|"HTTP /v1 (D-16), /composite beyond D-16 (Q-92)"| BApi
  FDev -.->|"answers /v1 and /data (textures, shapes) instead of the backend (npm run dev:fixtures)"| FFlip
  VCore --> VRend
  VCore -->|"RenderChain, SimClock, FrameGovernor"| VRender
  VRender -->|"OCTAVES"| VShaders
  VCore -->|"resolveMotion, planMotion"| VMotion
  VMotion -->|"SimClock processes"| VRender
  VRend -->|"starModel, flowModel"| VMotion
  VRender -->|"fanout: AssetCache, isLoadableMeshUrl"| VRend
  FShaderlab -.->|"dev server only"| VShaders
  VRend --> VFields
  HCore -->|"honesty filter"| VCore
  VCore -->|"types"| Schemas
  VFields -.->|"generators ported from"| Mockup

  classDef todo stroke-dasharray: 5 5
  class BTrack,BArea,FTrack,FArea todo
```

## Notes

| Package | Owner (rendering doc §10, D-17) |
|---|---|
| `backend/app/core/render` (baker, `card_to_params`, Gemini layer), `backend/app/core/classify` (stage 3) | Atish |
| `backend/app/api`, `backend/app/adapters`, `backend/app/cache`, `backend/app/core/find` (stage 1), `backend/app/core/card` (stages 4, 5), backend scaffold | Kevin |
| `backend/app/core/measure` (stage 2), physics layer, `shared/schemas`, `shared/fixtures` | Moon (Munazir) |
| Pipeline stage 3 | Atish |
| `frontend/src/viewer`, `viewer/renderers`, `viewer/render`, `viewer/shaders`, shader kinds, `src/app`, `src/state`, `src/physics` | Moon |
| `src/shaderlab`, `shaderlab.html` | Not named in D-17; dev-only harness for `viewer/shaders` |
| `src/app/api`, `src/app/search`, `src/app/flipbook`, `src/app/spectrum` (flipbook UI) | Moon |
| `backend/app/api/sky.py` (in Kevin's `app/api`), `backend/app/core/sky`, `scripts/sky_mirror.py`, `scripts/sky_bake.py` | Prototype (Q-87); D-17 names no owner for `core/sky` |
| `backend/app/api/composite.py` (in Kevin's `app/api`), `backend/app/core/composite` | Prototype (Q-92); D-17 names no owner for `core/composite`; its constants are a creative call for Atish (Q-94) |
| `src/app/shell`, `src/app/sky`, `src/viewer/sky`, `src/app/flipbook/session.tsx` | Moon (under `app/` and `viewer/`, D-17), provisional until Moon confirms the shell (Q-89) |
| `src/app/flipbook/colourMode.ts`, `ColourViews.tsx`, `progressive.ts`, `FramesProgress.tsx`, `frameGrid.ts`, `src/app/sky/cachedMarkers.ts`, `useCachedMarkers.ts`, `src/app/Segmented.tsx` | Moon (under `app/`, D-17), provisional until Moon confirms (Q-95, Q-97) |
| `frontend/fixtures`, `frontend/scripts`, `src/test`, `src/fixtures.test.ts`, `frontend/e2e` | Not named in D-17; dev and test tooling for the flipbook UI |
| `frontend/src/viewer/fields` | Atish |
| `frontend/src/sound` (engine, voices, buses, settings, `ui`; was `frontend/src/haptics`, D-39) | Atish (D-13, D-17) |
| `backend/app/core/jobs.py`, `backend/app/core/warm.py` | Not named in D-17; Kevin proposed (Q-111 (7)), issue #41. `measure/pool.py` sits in Moon's `core/measure`, `render/background.py` in Atish's `core/render` |
| `src/contract`, `backend/app/contract` | Generated (D-18); follows the owner of `shared/schemas` |

- `viewer/fields`, `ShaderBody`, `sources/terrain` and `sources/flow` follow from D-01 and D-12 and are listed in R10 (`viewer/renderers/ShaderBody.ts`, `viewer/fields/fieldWorker.ts`).
- Dashed boxes are **to build**: Track (A19, A20; backend Kevin, screen Atish, per A19.14) and Area search (A16 to A18). Their file names follow A18.9 and A20.13 and may change when built.
- The Build split view (issue #60, R5.8) added `app/build` and `viewer/mould`; the shell's names and files are in A21 ([sky-shell.md](../architecture/sky-shell.md#a211-status-and-sources)).
- D-39 (12 Nov 2026, issue #111): haptics are cut; the audio code moved to `src/sound/` (the drivers, sources, profiles, probe, haptic UI and the test page are deleted). Before that, issue #9 (6 Nov 2026) built the haptics core: the engine, both web drivers, the shared AudioContext, the settings store, calibration types, platform defaults, the λ→pitch and spectrum mappings, `tuning.ts` (every tuning value, D-13), the `ui/` pulse indicator and unlock button, and the dev-only test page. Issues #10 and #11 added the spectrum pad, calibration wizard and settings UI, `profiles.ts`, `probe.ts`, the texture and data sources and `sound/listenSweep.ts`. Imports from outside `src/haptics` are type-only or pure functions: `viewer/honesty.ts` (honesty filter), `viewer/fields/fieldGenerator.ts` (the shared field and its functions), `viewer/renderers/` (`Comet`, `Star`, `BrownDwarf`, `shaderSpec`, `pointClouds` plan helpers), `viewer/planCommon.ts`, `viewer/planTypes.ts`, `viewer/sliders.ts` (the `Overrides` type), `app/spectrum/scale.ts`, `app/api/types.ts` and `app/ui.ts` (button class). None of them creates GPU or browser state at import.
- `src/contract`, `src/state` and `src/app` were added by the frontend scaffold (4 Nov 2026) and are listed in rendering doc §10. `src/contract/generated.ts` is generated from `shared/schemas` (D-18), as is `backend/app/contract/`; the hand-written scaffold types were replaced in issue #4.
- The flipbook and spectrum view (M1, issue #3, 5 Nov 2026) added `src/app/api`, `src/app/search`, `src/app/flipbook`, `src/app/spectrum`, the `sky` slice in `src/state/store.ts`, `src/test`, `fixtures/` and `scripts/` (rendering doc §10). `fixtures/` is a Vite dev-server plugin used only by `npm run dev:fixtures` and the Playwright tests; `scripts/check-dist.js` fails the build if a fixture marker reaches `dist/`. Since issue #62 (Q-114) it also serves `/data/textures/...` from `shared/fixtures/textures/` (baked by `backend/scripts/bake_fixtures.py`) and `/data/shapes/*.glb` from `backend/assets/shapes/`.
- The demo pack (issue #68 Track F, Q-164) added `backend/scripts/bake_demo_pack.py`, `backend/assets/<type>/*.json` and `backend/assets/textures/`, the read-only `/data/demo-textures` mount in `app/main.py` and the generated `src/app/search/demoTargets.ts`.
- The sky-view prototype (branch `feat/sky-view-prototype`, 7 Nov 2026) added `app/shell`, `app/sky`, `viewer/sky`, `flipbook/session.tsx`, `backend/app/core/sky` and `backend/app/api/sky.py` (rendering doc §10). The sky index goes through the M1 client (`app/api/client.ts`); its types are hand-written in `app/api/types.ts` until a sky schema exists (Q-89). The tiles come from a local copy of IRSA's HiPS (architecture spec §3.11, D-35).
- Later on the same branch (7 Nov 2026): `backend/app/core/composite` and `backend/app/api/composite.py` (the colour composite, Q-92; sequence in [20](20-sequence-composite.md)), `GET /v1/sky/cached` in `sky.py` (Q-98), and in the frontend the colour views (`colourMode`, `ColourViews`, Q-93, Q-95), progressive frames (`progressive`, `FramesProgress`, Q-97), the fixed frame grid (`frameGrid`), the cached markers (`cachedMarkers`, `useCachedMarkers`) and `Segmented`. The composite types are hand-written in `app/api/types.ts` until a schema exists (D-18, Q-95).
- The physics layer and slider registry (issue #13) added `src/physics` (rendering doc §10, architecture spec §7). There is one slider registry, `src/viewer/sliders.ts` (drawn in the `VRend` box): `src/state/store.ts`, the shader kinds and `src/physics` all take `SliderKey` and `Overrides` from it (D-27). `shaderPalette` takes the lava threshold `LAVA_START_K` from `src/physics/constants.ts`, so the two agree. The backend half of stage 6 is not built (Q-60).
- The overlays (M4, issue #12) added `backend/app/api/overlays.py`, `backend/app/core/find/overlays.py`, `flagmask.py` and `combine.py`, the `gaia`, `wise` and `tap` adapters, `src/app/flipbook/overlays/` and the `overlays` and `combine` parts of the `sky` slice (A4.9). D-17 gives the Gaia and WISE adapters to Kevin and the overlay UI to Moon.
- The viewer render core (issue #39) added `viewer/render/` (the frame pipeline, quality levels, the sim clock, a worker pool and the fan-out loader) and `viewer/shaders/` (shared TSL helpers). `quality.ts` takes its octave counts from `shaders/noise.ts`; `fanout.ts` uses the asset cache from `renderers/build.ts` and the mesh-URL rule from `renderers/AsteroidMesh.ts`. `src/shaderlab` with `shaderlab.html` is a dev-only harness: Vite builds `index.html` only, so it never reaches `dist/`.
- The pipeline fan-out (issue #41) added `backend/app/core/jobs.py` (one background job per object, its answers and progress), `core/warm.py` (the opt-in warm cache at start-up), `core/measure/pool.py` (photometry in `spawn` worker processes) and `core/render/background.py` (texture bakes in a worker process, served at `/data/textures`), plus the `/job` and `/job/events` routes in `api/objects.py` (Q-111, Q-112).
- D-13: Atish owns the creative direction of haptics (what each body feels like, patterns, sound pairing). Engineering choices (drivers, timing, rate limits) stay with the implementer.
- The shader generators move from the mock-up into ES modules; the mock-up is not ported in place (D-03).
