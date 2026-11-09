# File layout and ownership

> **Part of:** Rendering & haptics spec ([index](README.md)) · **Sections:** R10 · **Implements:** [D-11, D-17](../decisions/scope-process.md), [D-18](../decisions/contract.md), [D-13](../decisions/haptics-design.md) · **Read with:** [layout-repo.md](layout-repo.md) (R10.1, the rest of the repo), [../uml/04-package.md](../uml/04-package.md)

## R10. File layout and ownership

The paths this spec owns: the texture baker, the 3D viewer, haptics and sound, and the shared schemas. The rest of the repository is in [R10.1](layout-repo.md). Owners follow D-17 (Munazir is Moon); a folder's owner owns its tests.

```
backend/app/core/render/            (Atish)
  card_to_params.py   # §6.2 rules + tags; pipeline stage 7 (A4.7), issue #5, built; seed_for (R6.3, Q-35); measuring: refusals (Q-111)
  background.py       # TextureBaker: R6.7 bakes off the request path, both sizes, worker process (issue #41, Q-112)
  blackbody.py        # §7.5 Teff -> display colour, issue #5
  noise.py craters.py height.py normals.py palette.py bake.py   # issue #6, built; height.band_field and palette.BROWN_DWARF_PALETTE (R6.2)
  params.py           # §6.2 generator parameters (BakeParams, BakeRefusal; Kind asteroid | bands); card_to_params adds the tags
  __main__.py         # python -m app.core.render <card.json> --seed N --out DIR
  gemini_paint.py     # R6.6, stretch, behind the admin token; issue #14, built (Q-122)
  spherex_rgb.py      # §5.2 channel extraction (CHANNELS_BY_TYPE), issue #5, built
frontend/src/viewer/                 (Moon)
  ViewerApp.ts lighting.ts modes.ts honesty.ts scaleBar.ts altText.ts sliders.ts
  planTypes.ts planCommon.ts renderPlan.ts   # pure RenderPlan: types, shared helpers, planRender (no GPU)
  renderers/AsteroidMesh.ts AsteroidProcedural.ts Comet.ts BrownDwarf.ts Star.ts   # per-type plan functions (R7)
  renderers/build.ts        # turns a RenderPlan into three.js objects
  renderers/ShaderBody.ts   # browser-shader kinds (§7.7, D-01, D-12)
  renderers/bodyRenderer.ts # BodyRenderer contract (field, status, onChange) of the generated body
  renderers/shaderPlan.ts shaderSpec.ts shaderPalette.ts pointClouds.ts fieldTexture.ts   # shader kinds: plan, card -> what to draw, palettes, point sets (unused), field upload
  renderers/StarBody.ts     # star surface (R7.5.1, issue #42)
  renderers/jetSurface.ts jetPalette.ts   # brown dwarf moving jets (R7.4, issue #42)
  renderers/linearColour.ts # sRGB <-> linear colour helpers
  bodies/starModel.ts       # CPU model of star groups, flares and loops (R7.5, issue #42)
  volume/             # nebula, nova, coma, tails (issue #43): VolumeBody.ts, noiseVolume.ts (48³ cube), volumeMath.ts, volumeSpecs.ts
  shape/              # real shape models (R7.1, issue #43): shapeModel.ts (load, LOD), ShapeMaterial.ts (Lommel-Seeliger), ShapeAo.ts (baked AO)
  motion/             # R5.7 (issue #42): motion.ts (MOTION_CONFIG, caps), planMotion.ts (motion layers until stage 6), phase.ts
  render/             # render core (issue #39): pipeline.ts (RenderChain: HDR pass, bloom, highlight clip, TAAU or SMAA),
                      # quality.ts (quality levels, initialTier, FrameGovernor), clock.ts (SimClock, pause reasons),
                      # workerPool.ts (WorkerPool), fanout.ts (card and render-params fan-out loader, asset prefetch)
  mould/              # build animation (R5.8, issue #60, Q-113): mouldSteps.ts (pure: steps per type from the mock-up PLAN,
                      # step -> plan layers, progress, pose), MouldRig.ts (applies and exactly undoes a pose on a built scene)
  shaders/            # TSL helpers on three r187 (issue #39): noise.ts, sphere.ts, star.ts, loops.ts; index.ts re-exports
  sky/                # sky view (A21): SkyView.ts, skyMath.ts, surveys.ts
  fields/             (Atish)  # shared field for shader kinds (§7.7, D-12): fieldGenerator.ts (pure, FieldSampler), noise.ts,
                               # fieldWorker.ts, fieldClient.ts (main-thread fallback), flowModel.ts (moving storms, Q-105)
frontend/src/app/build/              (Moon)   # R5.8 (issue #60): BuildPane, SelectedCard, MouldStrip, useMould, selectedBody, focus.ts
frontend/src/haptics/                (Atish: design D-13, all haptics D-17)
  haptics.ts          # R8.8 HapticEngine: honesty gate, rate cap, multiplier, trains (Q-71), createHaptics; issue #9
  audioContext.ts     # the one shared AudioContext, created only by a click (R8.9); shared unlock state
  audioGraph.ts       # one master bus and limiter per AudioContext; the shared bell (playBell)
  settings.ts         # R8.7 settings, own Zustand store, one localStorage key; bindEngine
  calibration.ts      # R8.7 calibration (after the event): types, offset rule, levels, tap-along maths, persistence
  platform.ts pitch.ts spectrumMapping.ts   # default outputs and deviceVibrates (Q-73), pitch from λ (Q-70), spectrum → sample (R8.6)
  tuning.ts           # every tuning constant, marked CREATIVE placeholder (D-13) or [verify]
  drivers/audio.ts drivers/webVibrate.ts (after the event) drivers/tauri.ts (stub, B-01)
  sources/heightMap.ts meshNormal.ts field.ts terrain.ts flow.ts spectrum.ts lightcurve.ts dataPulse.ts
  sources/types.ts relief.ts   # TouchSample, TrainSlot; R8.4 peak rule
  profiles.ts         # R8.5 buildHaptics per ObjectType + TouchHaptics (move, hold-still poll, scrub); issue #11
  probe.ts            # pointer → ray → analytic ellipsoid → body direction, UV, normal, distance, ring radius, pan (#11)
  ui/                 # PulseIndicator (D-20), UnlockButton (#9); CalibrationWizard, HapticsSettings, SpectrumHapticsPad (#10)
  sound/              # listenSweep.ts (A8 Listen sweep, issue #11); body tone and Track path sound not built (R8.9.1, R8.9.2)
frontend/src/contract/               (generated, D-18)  # generated.ts from shared/schemas/; hand-written helpers next to it:
                                                        # assertTagged(), tags.ts (TV<T>), haptics.ts (the R8.8 runtime types, Q-19)
frontend/src/hapticsTestPage/        (Atish)  # dev-only test page behind frontend/haptics-test.html; not a build input
frontend/src/shaderlab/                       # dev-only shader harness behind frontend/shaderlab.html; not a build input, not in dist/
shared/schemas/object-card.schema.json  render-params.schema.json   (Moon)
shared/fixtures/                     (Moon)  # cards/ and params/: one synthetic pair per ObjectType; invalid/: rejected cases
```

`frontend/src/contract/` is generated code and follows the owner of `shared/schemas/`. D-17 names no owner for `shaderlab/`; Moon owns `viewer/sky/` provisionally (Q-89).

| Owner (D-17) | Also owns, outside the paths above |
|---|---|
| Kevin | Backend scaffold, data adapters (including Gaia and WISE), pipeline stages 1, 4 and 5, local hosting (D-24) |
| Moon (Munazir) | The flipbook UI, the shader kinds, the overlay UI; pipeline stage 2 (brightness and spectrum), the physics layer (architecture spec §7) |
| Atish | Pipeline stage 3 (classify), stage 7 (`card_to_params`), the texture baker, the Gemini layer, haptics and sound (D-13) |
