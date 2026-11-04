# 04 Packages

The repo and code layout as packages, with their dependencies and owners. Drawn from `CLAUDE.md` (layout), rendering doc §10 (file layout and owners) and decisions D-01, D-11, D-12, D-13 and Q-14. Arrows mean "depends on" or "uses".

```mermaid
flowchart TB
  subgraph Repo["SphereX repo"]
    subgraph Docs["docs/"]
      DocSpecs["decisions.md, architecture/, rendering/, handover.md"]
      DocUML["uml/ (these diagrams)"]
    end

    Mockup["mockup/ : spherex-ui.html (three r128, not the app)"]

    subgraph Backend["backend/ (Python 3.12) : Atish, Kevin"]
      BApi["app/api : objects.py (Kevin) : /card, /render-params, texture URLs"]
      BPipe["pipeline + data adapters (path not in §10 [verify])"]
      BRender["app/core/render (Atish) : card_to_params, noise, craters, height, normals, palette, bake, spherex_rgb, gemini_paint"]
    end

    subgraph Frontend["frontend/ (Vite + TS + React) : owners per package"]
      FApp["src/app (React shell), src/state (Zustand store) : owner Q-14; flipbook and panel [verify paths]"]
      FContract["src/contract : R3 and R8.8 types, assertTagged : owner Q-14"]
      subgraph FViewer["src/viewer (Moon)"]
        VCore["ViewerApp, lighting, modes, honesty, scaleBar, altText"]
        VRend["renderers/ : AsteroidMesh, AsteroidProcedural, Comet, BrownDwarf, Star, ShaderBody [verify]"]
        VFields["fields/ : shader generators + field worker (D-01, D-12) [verify path, owner]"]
      end
      subgraph FHaptics["src/haptics : design Atish (D-13), code Moon and Atish"]
        HCore["haptics.ts, calibration.ts"]
        HDrivers["drivers/ : webVibrate, audio, tauri (stub)"]
        HSources["sources/ : heightMap, meshNormal, field, spectrum, lightcurve, terrain, flow [verify]"]
      end
    end

    Schemas["shared/schemas : object-card.schema.json, render-params.schema.json (owner not stated)"]
  end

  DocUML -.->|"illustrates"| DocSpecs
  BApi --> BPipe
  BApi --> BRender
  BPipe --> BRender
  BRender -->|"validates"| Schemas
  BApi -->|"validates"| Schemas

  FApp --> VCore
  FApp --> FContract
  VCore --> FContract
  HCore --> FContract
  FContract -.->|"mirrors (Q-14)"| Schemas
  FApp --> HCore
  FApp -->|"HTTP"| BApi
  VCore --> VRend
  VRend --> VFields
  VCore -->|"pointer UV, honesty state"| HSources
  HSources --> HCore
  HSources -->|"sample field"| VFields
  HCore --> HDrivers
  VCore -->|"types"| Schemas
  HSources -->|"HapticProfile type"| Schemas
  VFields -.->|"generators ported from"| Mockup
```

## Notes

| Package | Owner (rendering doc §10) |
|---|---|
| `backend/app/core/render` | Atish |
| `backend/app/api` | Kevin |
| `frontend/src/viewer`, `viewer/renderers` | Moon |
| `frontend/src/haptics` (engine, `drivers`, `sources`) | Haptics design: Atish (D-13). Code: Moon and Atish |
| `viewer/fields`, `shared/schemas`, backend pipeline and adapters | Not stated **[verify]** |
| `src/contract`, `src/state`, `src/app` | Open (Q-14) |

- `viewer/fields`, `ShaderBody`, `sources/terrain` and `sources/flow` follow from D-01 and D-12 (Proposed). They are now listed in rendering doc §10, but the `ShaderBody` and `fields/fieldWorker` file names stay **[verify]**.
- `src/contract`, `src/state` and `src/app` were added by the frontend scaffold (4 Nov 2026) and are listed in rendering doc §10. Owners: Q-14.
- D-13: Atish owns the creative direction of haptics (what each body feels like, patterns, sound pairing). Engineering choices (drivers, timing, rate limits) stay with the implementer.
- The shader generators move from the mock-up into ES modules; the mock-up is not ported in place (D-03).
