# 07 Sky Sculptor viewer (classes)

The 3D viewer: the app class, the renderer chosen by `type`, and the helpers for lighting, view modes, honesty, scale and alt text. Drawn from rendering doc §4, §5, §7, §9, §10 and decisions D-01 (baked types vs shader kinds), D-03 (three r187), D-05 (budgets), D-12 (shared field worker) and D-21 (honesty states). Method names are illustrative where the spec gives only file names **[verify]**.

```mermaid
classDiagram
  direction TB
  class ViewerApp {
    <<ViewerApp.ts>>
    -renderer: WebGPURenderer, three r187
    -params: RenderParams
    -body: BodyRenderer
    -plan: RenderPlan
    -touchMode: boolean
    +setObject(card: ObjectCard, params: RenderParams, ctx: PlanContext) void
    +showPlan(plan: RenderPlan) void
    +setSpinPaused(paused: boolean) void
    +setTouchMode(on: boolean) void
    +render() void
    frames the camera to plan.extent, rebuilds only when sceneKey changes
  }
  class BodyRenderer {
    <<interface>>
    +build(params: RenderParams) void
    +applyHonesty(state: HonestyState) void
    +dispose() void
  }
  class RenderPlan {
    <<planTypes.ts>>
    pure data, no GPU
    layers drawn, notes, missing
    all honesty, mode and epoch decisions
  }
  class PlanRender {
    <<renderPlan.ts, planCommon.ts>>
    +planRender(card, params, ctx: PlanContext) RenderPlan
    PlanContext: honesty, view mode, comet epoch, light-curve scrub, failed loads
    per-type plan functions in renderers/
  }
  class PlanBuild {
    <<renderers/build.ts>>
    +build(plan: RenderPlan, hooks, cache: AssetCache) three.js objects
    AssetCache keeps textures and meshes by URL across rebuilds
    gas shells and dust are instanced Sprites (r187 Points are 1 px)
  }
  class AsteroidMesh {
    <<asteroid_shape>>
    requires shape_source, diameter_km
    GLB or OBJ, max 50k triangles, D-05
    spin sped up, factor shown
    three-mesh-bvh for raycast
  }
  class AsteroidProcedural {
    <<asteroid_procedural>>
    requires diameter_km
    SphereGeometry 1, 256, 128 scaled by ellipsoid_axes
    baked albedo (visible mode only), normal, roughness maps
    displacement on desktop only
  }
  class Comet {
    <<comet>>
    requires gas_Q per epoch (Q-42), coma_radius_km
    one-epoch gas_Q only when epochs has one entry
    nucleus at upper size limit, sizeQualifier upper_limit
    one point cloud per gas, density 1 over r squared
    dust cloud December only
    epoch toggle Aug or Dec 2025
  }
  class BrownDwarf {
    <<brown_dwarf, brown_dwarf_binary>>
    requires spectral_class, flux_45um
    sphere about 1 Jupiter radius
    baked bands, contrast from ch4_depth_33
    emissive from flux_45um
    binary orbit is artistic
  }
  class Star {
    <<star, star_mira, star_ttauri>>
    requires teff_K, radius_rsun optional (no radius: unit sphere, no scale bar)
    blackbody colour, linear limb darkening
    Mira brightness follows light curve
    T Tauri disc and dust screen
    motion trail from pm_mas_yr
  }
  class ShaderBody {
    <<planet_rocky, planet_water, gas_giant, nebula, nova>>
    browser shader generator, triplanar
    samples field as DataTexture
    finer noise is seen, not felt
  }
  class FieldWorker {
    <<Web Worker, D-12>>
    +seed: number
    512 x 256 equirectangular
    channels height, band, ocean, ice, storm
    runs once per body, not per frame
  }
  class Lighting {
    <<lighting.ts>>
    +mode: sun or self
    DirectionalLight at phase_angle_deg
    ambient intensity max 0.03
  }
  class Modes {
    <<modes.ts>>
    +current: visible or spherex_ir
    IR disabled if under 2 points per channel
  }
  class Honesty {
    <<honesty.ts>>
    +state: HonestyState, starts at PlusEstimated
    +visible(layer: Layer) boolean
  }
  class HonestyState {
    <<enumeration, D-21>>
    MeasuredOnly
    PlusEstimated
    PlusArtistic
  }
  class ScaleBar {
    <<scaleBar.ts>>
    +scale_m: number or null
    +sizeQualifier: upper_limit or null
    one familiar comparison, "at most" for an upper limit
  }
  class AltText {
    <<altText.ts>>
    +buildAltText(plan: RenderPlan) string
    built from the plan, not from RenderParams.alt_text
    updates canvas aria-label
    aria-live polite announcements
  }
  class HapticSource {
    <<interface, see 06>>
  }

  ViewerApp "1" *-- "1" Lighting
  ViewerApp "1" *-- "1" Modes
  ViewerApp "1" *-- "1" Honesty
  ViewerApp "1" *-- "1" ScaleBar
  ViewerApp "1" *-- "1" AltText
  ViewerApp ..> PlanRender : setObject calls planRender
  PlanRender ..> RenderPlan : returns
  ViewerApp ..> PlanBuild : showPlan builds the plan
  PlanBuild ..> RenderPlan : reads
  ViewerApp "1" --> "0..1" BodyRenderer : chosen by type, none for candidate
  ViewerApp "1" --> "0..*" HapticSource : touch mode pointer UV
  Honesty --> HonestyState
  AsteroidMesh ..|> BodyRenderer
  AsteroidProcedural ..|> BodyRenderer
  Comet ..|> BodyRenderer
  BrownDwarf ..|> BodyRenderer
  Star ..|> BodyRenderer
  ShaderBody ..|> BodyRenderer
  ShaderBody --> "1" FieldWorker : requests field
  HapticSource ..> FieldWorker : samples same array
```

## Notes

- Plan layer (issue #7): `ViewerApp.setObject` calls `planRender` to get a pure `RenderPlan`, and `showPlan` passes it to `renderers/build.ts`, which makes the three.js objects. The per-type renderer files hold the plan functions. `BodyRenderer` above is the conceptual contract; in code it is the plan function plus `build.ts`.

- `candidate` has no renderer. The panel shows "Not enough data for a 3D model: distance and albedo unknown" (rendering doc §7.6).
- The five baked renderers use backend textures (rendering doc §6); `ShaderBody` uses the shader generators from the mock-up, ported to ES modules (D-01, D-03). `ShaderBody` is listed in rendering doc §10 (name **[verify]**).
- Mesh budget: D-05 sets ≤ 50k triangles, tighter than the 300k in older text; D-05 wins.
- Pixel ratio is `min(devicePixelRatio, 1.5)`, and the scene renders only when the view changes (D-05).
- If a required card field is missing, the renderer does not draw that layer and it is listed in `RenderParams.missing`.
- Honesty states follow the badges (D-21): Measured only shows `measured`; + Estimated adds `derived`, `model_dependent` and `inferred_from_analog`; + Artistic adds `artistic`. The enum names are illustrative **[verify]**.
