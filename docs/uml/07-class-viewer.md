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
    -chain: RenderChain or null, null on the plain renderer.render fallback
    -clock: SimClock
    -governor: FrameGovernor
    +setObject(card: ObjectCard, params: RenderParams, ctx: PlanContext) void
    +showPlan(plan: RenderPlan) void
    +setSpinPaused(paused: boolean) void
    +setQualityTier(name: TierName) void
    +renderStats() RenderStats
    +freezeClock(simSeconds: number) Promise~void~
    +whenSettled() Promise~void~
    +timeLapses() id, label, speedup list
    +setTouchMode(on: boolean) void
    +render() void
    frames the camera to plan.extent, rebuilds only when sceneKey changes
  }
  class RenderChain {
    <<render/pipeline.ts>>
    scene pass to half-float HDR target, bloom, clipHighlights, TAAU or SMAA
    +config: ChainConfig
    +setTier(tier: TierName) void
    +setReducedMotion(reduced: boolean) void
    +compileAsync(object: Object3D) Promise~void~
    +restartTemporal() void
    +render() void
    +dispose() void
    SMAA replaces TAAU under reduced motion (R9)
  }
  class FrameGovernor {
    <<render/quality.ts>>
    +tier: TierName, quality level low, medium or high
    +setTier(t: TierName) void
    +reset() void
    +feed(frameMs, nowMs) TierDrop or null
    lowers one quality level after 2 s of slow frames, never raises
  }
  class SimClock {
    <<render/clock.ts>>
    one sim time per process, real time x speedup
    +setProcess(p: ClockProcess) void
    +removeProcess(id) void
    +simTime(id) number
    +setAllSimTimes(simS) void
    +pause(reason: PauseReason) void
    +resume(reason: PauseReason) void
    +running: boolean
    +tick() number
  }
  class WorkerPool~Req, Res~ {
    <<render/workerPool.ts>>
    stateless workers, cores - 1, at most 4
    inline fallback when no Worker
    +run(payload: Req, opts) Promise~Res~
    +dispose() void
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
    issue #42: StarBody draws spots, faculae, flares, loops, granulation, glow
    from the CPU model bodies/starModel.ts (pure in seed, rates, t)
  }
  class MotionPlan {
    <<issue #42, motion/motion.ts>>
    resolveMotion: measured card field, dynamics, class value, else dynamics:key in missing
    a process runs only with a stated speed-up and every rate it needs
    SimClock processes carry their tag and tier
  }
  class ShaderBody {
    <<planet_rocky, planet_water, gas_giant, nebula, nova>>
    made by buildScene from plan.shader (ShaderBody.start), kept across plans that only change honesty or light
    visibleTags from allowedTags(plan.honesty), light from planLighting, onChange from BuildHooks
    plain sphere at once (never blank), surface swaps in when the field is ready
    plain sphere follows Q-45: only while the size on the card is shown
    TSL node materials on three r187
    reads field as 2 Float32 DataTextures via textureLoad
    finer noise is seen, not felt
    nebula and nova are instanced Sprites
    refused layers go in missing
    issue #42: setTime(time) poses spin, jets, storms, clouds; jetSurface.ts shared with brown dwarfs
    storms from fields/flowModel.ts go to the shader and to FieldSampler.setStorms (same t)
  }
  class FieldWorker {
    <<Web Worker, D-12>>
    fieldWorker.ts wraps generateField
    fieldGenerator.ts is pure and seeded
    512 x 256 equirectangular, R6.1 mapping
    texture A height, band, storm
    texture B ocean, ice, lava crack
    runs once per body, not per frame
  }
  class FieldSampler {
    <<fieldGenerator.ts>>
    bilinear height and masks, nearest ids
    +setStorms(storms: Storm list or null) void, issue #42: the storm channel at the same t as the shader
    sampleDirection and sampleUV
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

  ViewerApp "1" *-- "0..1" RenderChain : draws through it, compiles new content with it
  ViewerApp "1" *-- "1" SimClock : spin process, pause reasons
  ViewerApp "1" *-- "1" FrameGovernor : fed during continuous frames
  note for WorkerPool "issue #39: built and tested, no caller in ViewerApp yet"
  ViewerApp "1" *-- "1" Lighting
  ViewerApp "1" *-- "1" Modes
  ViewerApp "1" *-- "1" Honesty
  ViewerApp "1" *-- "1" ScaleBar
  ViewerApp "1" *-- "1" AltText
  ViewerApp ..> PlanRender : setObject calls planRender
  PlanRender ..> RenderPlan : returns
  ViewerApp ..> PlanBuild : showPlan builds the plan
  PlanBuild ..> RenderPlan : reads
  ViewerApp "1" --> "0..1" BodyRenderer : the generated body of a shader kind (ViewerApp.body), none for the baked kinds and candidate
  PlanBuild ..> ShaderBody : creates it from plan.shader
  ViewerApp "1" --> "0..*" HapticSource : touch mode pointer UV
  Honesty --> HonestyState
  AsteroidMesh ..|> BodyRenderer
  AsteroidProcedural ..|> BodyRenderer
  Comet ..|> BodyRenderer
  BrownDwarf ..|> BodyRenderer
  Star ..|> BodyRenderer
  ShaderBody ..|> BodyRenderer
  ShaderBody --> "1" FieldWorker : requests field
  HapticSource ..> FieldSampler : samples same array
  FieldSampler --> FieldWorker : reads its arrays
```

## Notes

- Render core (issue #39): `ViewerApp` draws through a `RenderChain` (`render/pipeline.ts`); if the chain cannot be built it falls back to plain `renderer.render`. New content is compiled with `RenderChain.compileAsync` before it is swapped in (diagram [10](10-sequence-view-3d.md)). The quality level (low, medium or high, `render/quality.ts`) sets bloom resolution, anti-aliasing (TAAU or SMAA), noise octaves and volume steps. `FrameGovernor` only lowers the quality level; `setQualityTier` picks one by hand. `SimClock` (`render/clock.ts`) holds one sim time per moving process (the spin, and since issue #42 the processes `motion/planMotion.ts` states for stars, gas giants, brown dwarfs and worlds, Q-103) and the pause reasons shown in diagram [15](15-state-interaction.md). `renderStats`, `whenSettled` and `freezeClock` are test and tuning hooks; `timeLapses` lists each process with its shown speed-up. Motion and quality levels follow R5.7 and D-34; the implementation is Q-66 in [decisions](../decisions.md).
- Tier labels (issue #42): the viewer panel (`app/ViewerPanel.tsx`, `tierText`) writes every process speed-up and layer tier as "tier N of 5, <meaning>" (for example "tier 3 of 5, worked out with a typical value"), so the D-32 tier is said in words next to it.
- `WorkerPool` (`render/workerPool.ts`) and the fan-out loader (`render/fanout.ts`, `loadBody`) exist and are tested, but nothing in the viewer calls them yet.

- Plan layer (issue #7): `ViewerApp.setObject` calls `planRender` to get a pure `RenderPlan`, and `showPlan` passes it to `renderers/build.ts`, which makes the three.js objects. The per-type renderer files hold the plan functions. `BodyRenderer` above is the conceptual contract; in code it is the plan function plus `build.ts`.

- `candidate` has no renderer. The panel shows "Not enough data for a 3D model: distance and albedo unknown" (rendering doc §7.6).
- The five baked renderers use backend textures (rendering doc §6); `ShaderBody` uses the shader generators from the mock-up, ported to ES modules (D-01, D-03). `ShaderBody` is listed in rendering doc §10 (name **[verify]**). The shader kinds use the same entry point as the baked kinds: `renderers/shaderPlan.ts` (pure) plans them with `PlanBuilder` (legend, missing, notes, Q-45 plain sphere), `renderers/build.ts` creates the `ShaderBody` from `plan.shader`, and `BuiltScene.update(plan)` applies a new honesty state or light to it in place, so a toggle never regenerates the field (Q-49). `bodyRenderer.ts` holds the `BodyRenderer` contract. There is no per-type registry and no `ViewerApp.setBody`.
- Mesh budget: D-05 sets ≤ 50k triangles, tighter than the 300k in older text; D-05 wins.
- Pixel ratio is `min(devicePixelRatio, 1.5)`, and the scene renders only when the view changes (D-05).
- If a required card field is missing, the renderer does not draw that layer and it is listed in `RenderParams.missing`.
- Honesty states follow the badges (D-21): Measured only shows `measured`; + Estimated adds `derived`, `model_dependent` and `inferred_from_analog`; + Artistic adds `artistic`. The enum names are illustrative **[verify]**.
