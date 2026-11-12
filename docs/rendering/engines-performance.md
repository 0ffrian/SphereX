# Engine and viewer performance (issue #93 waves)

> **Part of:** Rendering & haptics spec ([index](README.md)) · **Sections:** R5.9.1 · **Implements:** [Q-381 to Q-387](../decisions/rendering-engines-perf.md), [Q-337 to Q-346, Q-367](../decisions/rendering-engines-tuning.md), [Q-64](../decisions/platform-hosting.md), [Q-66, Q-67](../decisions/rendering-motion.md) · **Read with:** [engines.md](engines.md) (R5.9), [display-rules.md](display-rules.md) (R5.5 budget, R5.7 quality levels), [reference/frame-time.md](reference/frame-time.md) (R11.3), [open-items.md](open-items.md) (R12 #56 to #60)

### R5.9.1 Engine and viewer performance (issue #93 waves)

The two performance waves of issue #93 (Moon's research in PR #101, built by Atish). This section owns how each engine starts, what it caches and the switches that change it; R5.9 owns when an engine draws and the fallback. Numbers are from the RTX 4060 Ti desktop (`frontend/scripts/engine-bench`); none is from the A15 yet (R12 #59).

**Star engine (Q-381).**

- **Compile.** `new StarEngine(...)` submits its program without waiting for the driver (`KHR_parallel_shader_compile`). `pollReady()` returns true once it is linked (and throws the compile or link log), `whenReady()` checks every 16 ms and draws the star once when it resolves, and `pending()` says whether a compile is still running. Without the extension it links at once, which blocks as before.
- **Wait.** `app/StarEngineStage.tsx` shows a non-blocking "Preparing the star" loader over the three.js star; after `STAR_READY_TIMEOUT_MS` (60 s, `app/engineWatchdog.ts`) or on a compile error it takes the three.js path.
- **Dispose.** `dispose()` never calls `loseContext()` while a compile runs: it polls every 100 ms and leaves the context to the browser after 120 s (`STAR_DISPOSE_MAX_WAIT_MS`).
- **Canvases.** The surface close-up (`surface: true`) keeps one canvas and one WebGL2 context, with no plasma targets or passes. The inert canvases of the other mode no longer log "no webgl2"; a live canvas without WebGL2 still logs.
- **Plasma.** When the plasma can only be black (true colour, close-up, no spot groups) its pass runs once to clear and not again until it draws or the size changes.
- **Frame rate.** The host draws at most 60 frames a second (`STAR_FPS_CAP`, Q-386).

**Rock engine (Q-382).**

- **Compile.** `ROCK_FS` keeps its loops (`noUnroll`); the programs are submitted with `compileStart` and linked once the driver reports done. `RockView.whenReady(canvas)` resolves when a canvas's programs are linked, `whenDrawn(canvas)` when it has a picture, and `whenBuilt()` when the height map is built.
- **Build.** The height map is built in a worker (`rockBuild.worker.ts`, the pure `rockBuild.ts`; the newest request wins; `worker: false` keeps the synchronous path). The Surface age slider applies 150 ms after it stops.
- **Wait.** `RockStage` keeps the three.js body drawing under "Preparing the detailed surface…" until the engine is compiled and built; `RockCloseUp` shows the note until its canvas has a picture. A compile error or `ROCK_READY_TIMEOUT_MS` (60 s) hands the body back to three.js.
- **Baked detail.** `BAKE_FS` fills cube maps once per height map and shading inputs (1024² a face, RGBA16F colour and R16F; about 60 MB per canvas); `ROCK_FS_BAKED` reads them. `RockView.setBake(on, n)` sets it for canvases attached afterwards. Without `EXT_color_buffer_float` the prototype's per-pixel `ROCK_FS` draws. Baked against per-pixel: mean difference 0.3 to 0.6 %, no seams.
- **Draw.** Back faces are culled. Comet jets move in `JET_VS` from data uploaded once. Off screen (`IntersectionObserver`) or in a hidden tab the canvas stops drawing and its clock stops.
- **Two panes.** When the two canvases' aspect ratios match within 1 % (`MIRROR_ASPECT_TOLERANCE`), the larger draws and the other copies it (`Mirror`); otherwise each draws.
- **Dispose.** A canvas is released only once its compile is done (polled every 100 ms; after 180 s, `ROCK_DISPOSE_MAX_WAIT_MS`, it is left to the browser).

**World engine and the fly view (Q-383, Q-384).**

- **Programs.** The fly engine compiles 3 programs and never `WORLD_FS`; its entry draw sets `W.view` and draws nothing. `FLY_FS` has 14 loops, all `N+uZ0`.
- **Kept mounted.** Once opened, the fly view stays mounted while the close-up is closed and is paused (`paused`: no tick, no draw, no frame loop, no redraw from control changes, no globe pick). Reopening skips the new context, the `FLY_FS` compile and the spin-up: 0.3 s instead of about 10 s. Another object or preset, the kill switch or a failure unmounts it; `dispose()` stays non-blocking (R5.9). It re-renders React on its 400 ms timer only while it forms.
- **March.** `heightPyramid.js` builds a 7-level pyramid of ceilings of the marched surface once per terrain (the height grid as the warp and bilinear read reach it, plus the most every noise octave can add); `FLY_FS` steps over air above it, less the hit tolerance, and skips shadow steps that cannot darken. The shaded height at the hit is evaluated once.
- **Static G-buffer.** Once the camera stops, one full pass writes the march, normal, gullies and shadow into 3 RGBA32F targets beside the colour (about 26 MB at 768 × 720; `WorldGL.flyDraw`); later frames redo only light, colour, climate, clouds, water and air (the shadow too while the Sun is still). A still frame is pixel-identical to the full pass (0 levels). While the camera moves the view draws straight to the canvas; gas giants never use it.
- **Reads.** 14 reads of the height grid and the gas fields are `textureLod(..., 0.)` (no texture has mipmaps: the same texels and weights), so fxc on ANGLE D3D11 no longer flattens the branches around them. All 21 compiled slower (median 32 s against 22 s), so only these are converted.
- **Scaler (B9).** The footprint follows the eased real pixel (`uScale = scale / W.fp93`). The scale shrinks ×0.8 above 34 ms at most once a second and grows ×1.25 below 20 ms at most once every 3 s, between 0.45 and 1.
- **Frame rate.** The host loop draws at most 60 frames a second (`engineHostCap()`, Q-386). GPU time of each tick: `WorldEngine.gpuMs()` through `glTimer.ts`, dev only.
- **Numbers.** Moving 13.6 → 10.5 ms a frame; still 0.5 to 2 ms; Jupiter at 50 km 9.7 → 0.6 ms. `FLY_FS` cold compile unchanged, about 22 s median.

**One planet simulation (Q-385; Open, built on `fix/93-wave2-sim`, merging).** A climate step starts only if it fits the 14 ms tick budget. One simulation per world feeds the globe and the fly view, so the fly view forms 0.03 s after the globe; it runs in a Web Worker, so the longest forming task fell from 76 to 135 ms to 2 to 5 ms. `?sim=own` gives each view its own simulation and `?sim=shared` keeps the shared one on the main thread. **TODO (lead):** the final globe-forming numbers after the merge.

**Three.js viewer (Q-383).** These apply on the three.js path, so also with `?engines=0` and at + Estimated and Measured only.

- **Caches.** Generated fields, point sets and worlds are cached by params and seed (an LRU of promises: 4 fields, 4 point sets, 2 worlds), so a quality-level change reuses them. The three.js star close-up draws the still star once into a picture (`StillStarCache`) and redraws it when the drawing-buffer size, the sample count or the window shape changes; a failure falls back to the live star. Star streak buffers upload only the used range. Sunspot detail runs only inside spots.
- **Resolution.** On the TAAU levels the scene renders at 75 % (`TAAU_RENDER_SCALE`, a display choice, [verify] on the A15) and TAAU upscales. While the clock runs, dynamic resolution lowers the scale from GPU time (steps of 0.125 down to 0.5); settled frames use the base scale.
- **Close-up.** On WebGPU the close-up pane is a second `CanvasTarget` of the renderer, painted with one full-screen pass; WebGL2 keeps the read-back. Checked on WebGL2 only (R12 #60).
- **Bloom.** Half resolution on High and Medium. The bloom skip is opt-in (Q-387, [R11.3](reference/frame-time.md#r113-frame-time-checks)).

**Kill switch and fallbacks.** With `?engines=0` (Q-367) the engine items above (watchdogs, host caps, the kept-mounted fly view, which the switch unmounts, the G-buffer, `?enginefps`, `?sim`) do not apply; the three.js items do. A watchdog or a failure hands that one object to the three.js path the same way.

**Switches (query string, before any `#`).**

| Switch | Default | Effect | Build |
|---|---|---|---|
| `?gputime=1` | off | GPU timing: `renderStats()` gains `gpuP50Ms`, `gpuP95Ms`; the world engine's `gpuMs()` | dev and fixtures only |
| `?inspector=1` | off | the r187 Inspector on the viewer's renderer | dev and fixtures only |
| `?enginefps=0` / `=N` | 60 | world engine host cap off, or N fps (30 to 240) | all |
| `?fpscap=60` | off | three.js viewer clock cap (Q-66 keeps it off) | all |
| `?bloomgate=1` | off | skip bloom for plans that cannot pass its threshold | all |
| `?dynres=0` | on | dynamic resolution off | all |
| `?closeup=readback` | direct | the old read-back close-up on WebGPU | all |
| `?sim=own` / `?sim=shared` | worker | one simulation per view / shared on the main thread (merging) | all |
| `?engines=0` / `=1` | on | the kill switch (R5.9, Q-367) | all |

**Bench pages** (`frontend/scripts/engine-bench/README.md`): `star-engine.html` (compile block, pictures, frame cost against a reference copy), `tsl-star.html` (the three.js star shader and the cached close-up), `rocks.html` (compile block, frame and GPU time, re-bake, age sweep), `fly.html` (still and moving GPU time, still frame against the full pass), `relief.html` (per-picture pixel diffs; draws each camera three times so the G-buffer shows its still frame), and `sim.html` (the shared simulation, arriving with `fix/93-wave2-sim`).
