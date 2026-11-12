# Prototype engines (D-37)

> **Part of:** Rendering & haptics spec ([index](README.md)) · **Sections:** R5.9 · **Implements:** [D-37, Q-286 to Q-288, Q-299 to Q-306, Q-309 to Q-316](../decisions/rendering-engines.md), [Q-329 to Q-331, Q-334, Q-335](../decisions/rendering-engines-review.md), [D-40, Q-337 to Q-354, Q-367, Q-368](../decisions/rendering-engines-tuning.md), [Q-381 to Q-386](../decisions/rendering-engines-perf.md), [D-03, D-05](../decisions/platform-hosting.md), [D-21, Q-110](../decisions/contract-tags.md), [D-36](../decisions/rendering-bodies.md) · **Read with:** [engines-performance.md](engines-performance.md) (R5.9.1 compile, caches, switches), [display-rules.md](display-rules.md) (R5.3 honesty, R5.5 budget), [renderers/stars.md](renderers/stars.md) (R7.5), [renderers/shader-kinds.md](renderers/shader-kinds.md) (R7.7), [renderers/asteroid.md](renderers/asteroid.md) (R7.2), [acceptance-tests.md](acceptance-tests.md) (R11)

### R5.9 Prototype engines (D-37)

For generated bodies the approved prototype's own code (`sculptor-preview-next.html`) draws the body, fed by a card adapter. It is raw WebGL2 on its own canvas, beside three.js r187, which stays the viewer and the fallback (D-37 amends D-03, acknowledged by Atish, 11 Nov 2026).

| Engine | Code | Adapter | Draws | Hosted by |
|---|---|---|---|---|
| World | `frontend/src/engine/worlds/` (`WorldEngine`, `core.js`, `gas.js`, `shaders.js`, ...) | `cardToWorld` | `planet_rocky`, `planet_water`, `gas_giant` | `WorldGlobeStage` (build pane) and `WorldFlyStage` (left close-up pane), `app/WorldEngineStage.tsx`: two instances per planet (Q-313) |
| Star | `engine/stars/` (`StarEngine`, `protoStar1-4.js`) | `cardToStar` | `star` with a Teff (not brown dwarfs or Miras) | `app/StarEngineStage.tsx`: globe, flare close-up, surface close-up |
| Rock | `engine/rocks/` (`RockView`, `source.ts`) | `cardToRock` | `asteroid_procedural`, `asteroid_shape`, `comet` (nucleus and jets) | `app/build/RockStage.tsx`, `RockCloseUp` |

**When an engine draws (Q-287, decided by Atish, 11 Nov 2026).**

- Only at honesty **+ Artistic** (`artistic`). A generated surface is not measured, and several engine constants are **[verify]** (Q-110).
- At **+ Estimated** (the start state, D-21) and **Measured only**, the three.js TSL path draws, each layer at its own tag (R5.3).
- The engine also needs: the plan allows a 3D body (`threeD`, the confidence gate), the adapter accepts the card (a refusal lists the missing fields, D-32), WebGL2 (and float render targets for the world engine), no earlier failure for this object (`engineKey`, per object), and the engines switched on (`enginesEnabled()`, below).
- **Kill switch (Q-367).** `?engines=0` in the query string (before any `#`; the hash belongs to `useHashSync`) turns every engine off, so the three.js path draws at every level, also at + Artistic; `?engines=1` turns them back on. The choice is kept in `localStorage['sx.engines']` and the default is on (`app/enginesSwitch.ts`). `ViewerPanel` gates the world, star and rock stages and the close-up pane on it.
- While an engine draws the body, the three.js viewer builds and draws nothing under it (`ViewerApp.setEngineOwned`). It takes over again when the engine stands down.

**Fallback: the three.js renderers stay (Atish, 11 Nov 2026).** `GasWorld.ts`, `RockyWorld.ts` (Q-286), `viewer/orbit/*`, `ShaderBody`, `Star`, `AsteroidProcedural`, `AsteroidMesh` and `Comet` are kept. They draw:

1. at + Estimated and Measured only;
2. when the adapter refuses the card;
3. when an engine fails to start;
4. when an engine loses its WebGL context (no black canvas);
5. when WebGL2 is missing;
6. when an engine times out or throws while it compiles or forms (below; star and rock: R5.9.1);
7. when the engines are switched off (`?engines=0`).

Never blank: the fallback is always the path that draws first.

**Determinism (Atish, 11 Nov 2026).** Engine frames are **not** byte-identical, and R1 principle 5 does not apply to them:

- the spin-up runs under a wall-clock budget (14 ms, Q-306), so how far the clouds and gas flow have developed differs between runs and between the globe and fly instances (Q-313);
- the render scale adapts to frame time (pinned only for parity runs, `window.__sxPin`);
- the star engine's flares and plasma use the prototype's fixed seeds; its surface and spots take a seed from the card id (below).

The byte-identical rule still holds for the baked textures (`bake_demo_pack --check`, `bake_fixtures --check`, `bake_reference_objects --check`), the card and RenderParams, and the three.js path.

**Seeds and repeating patterns (issue #93 phase 2, Q-347 to Q-353).** The same card still gives the same picture. A card object's seed is a 32-bit avalanche hash (`frontend/src/engine/seed.ts`: the card id for worlds and stars, the card seed for rocks) and `seedVec` of it, three integers in [0, 256) that the shaders add to their noise coordinates as a vec3 (`seed3` on a world or rock preset, `so` on a star preset). The prototype's presets have none and keep their integer seed along (1, 1, 1), so `?parity=1` and `?preset=` draw as before (the world presets on the globe, the star rows and the rock bodies checked pixel-identical: `scripts/engine-bench/patterns.html?what=presets`; the fly-view changes below apply to presets too). With it:

- worlds: every seeded noise layer, the layers that had no seed (sea-ice tint, convective clouds, waves, fly-view sea ice, slope rock, river relief), and a card giant's tracer noise, now taken from the sphere direction instead of one texture tiled 4 x 3 (the three.js fallback, `GasWorld.ts`, does the same);
- stars: granulation, supergranulation and the filters (`uSO`) and the spot RNG (`rng(1729 ^ seed)`);
- rocks: the noise offset, the shape and crater RNG (the full hash), per-crater ellipticity, rim height and rim wave, and 0 to 2 boulders a cell (artistic).

The phase 2 constants are `artistic` choices, not cited values; Moon signs off the look (R12 #54).

The fly view lays its gullies and the gas giant's small-scale detail on planet-fixed cube faces (blended at the seams) instead of the plane under the camera, fades noise octaves over two octaves of pixel footprint, and reads the grids with cubic filters for shading: a Catmull-Rom cubic for the height grid (it passes through every texel, so narrow peaks keep their height) and the B-spline for the climate grids (Q-352). The ray march and the shadows keep the bilinear read. The haptics and sound read the same filters through `engine/worlds/fieldSampler.ts` (Catmull-Rom heights from 16 texels, B-spline climate), so sound and touch match the picture. The phase 2 low-frequency coastline warp is dropped: the warp is the prototype's two fine octaves. Fly frame time (RTX 4060 Ti, phase 1 / phase 2 / now): TRAPPIST-1 f 14.9 / 16.6 / 14.3 ms, Earth 15.0 / 15.9 / 13.8 ms (`scripts/engine-bench/relief.html`). Not changed: the CPU terrain hash and the octave lacunarity (backend change and re-bake, after the event), and Saturn's ring texture (only the Saturn preset draws rings).

**Copied code and deviations (Q-303, Q-335).** Copied blocks sit between `// @verbatim Lstart-Lend` and `// @end-verbatim`. Reviewed fixes are marked `// @deviation (#89 review N)` or `// @deviation (#93 N)` with `@rename` pairs or a split block, and say why; the world extractor carries the #93 ones (Q-354). The #93 deviations:

| Where | Items | Carried by |
|---|---|---|
| world `shaders.js`, `helpers.js`, `core.js` | 1.1 loop bounds `N+uZ0`; 1.2 background compile (`compileStart`, `compileDone`, `compileEnd`, `WorldGL.poll`, `link`); 1.3 roles; 1.4 `uScale` in the pixel footprint; 1.5 shared terrain; 1.6 fly engine skips the hidden globe; 1.7 scaler and pixel-ratio caps; 1.8 gas solver cap and its caption | `DEV93_SHADERS`, `DEV93_HELPERS`, `DEV93_COMPILE`, `DEV93_ROLE`, `DEV93_LINK_FIRST`, `DEV93_SCALER`, `DEV93_SKIP_GLOBE`, `DEV93_GAS_CAP`, `DEV93_TERRAIN` in `extract-world-engine.py`; `CORE_L2425_93_1_8` in `world_engine_deviations.py` |
| world shaders and `terrain.js` | 2.1, 2.9 `uSeed3`; 2.2 gas noise from the sphere direction; 2.4 `uSeedN`; 2.5 cube faces; 2.6 octave fade; 2.7 grid reads; river relief seed | `DEV93_SEED`, `DEV93_PATTERNS`, `DEV93_RIVER` (labelled with the phase 2 plan's numbers, `#93 3`, `3.1`, `3.2`, `3.4`, `3.9`) |
| world `presets.js`, `core.js` | 3.1 critical points and the supercritical state; 3.2 saturation pressure; 3.3 tides from `p.ob`; 3.6 runaway | `PRESETS_93_3_1`, `CORE_L*_93_3_*` in `world_engine_deviations.py` |
| star `protoStar1.js` | 1.9 loop bounds; 2.3 seeded surface and spots; 3.4 turnover time | deviations 4 to 6, `@rename` pairs 7 to 22 |
| rock `source.ts` | 2.8 vec3 seed, crater hash, crater shapes, boulders | the extractor's PATCHES |
| world `shaders.js`, `core.js`, `heightPyramid.js` (performance waves, Q-384) | F1 max-height pyramid, shadow skip, one shaded height, no `WORLD_FS` on the fly engine; B9 scaler; F3 static G-buffer and `textureLod` reads; F4 climate loop within its budget (merging, Q-385) | `DEV93_FLY`, `DEV93_PYRAMID`, `DEV93_FLY_HOOKS`, `DEV93_SCALER`, `DEV93_COMPILE`, `DEV93_SKIP_GLOBE`, `DEV93_GBUF`, `DEV93_GBUF_DRAW`, `DEV93_FLY3`, `DEV93_FLY_LOD`; `DEV93_BUDGET` on `fix/93-wave2-sim` |
| star `protoStar1.js`, `protoStar3.js` (wave 1, Q-381) | B7 background compile; 1.2 no black plasma pass | deviations 7 and 8, `@rename` pairs 23 to 29 |
| rock `source.ts` (wave 1, Q-382) | B7 background compile, loops kept; 1.7 jets in the vertex shader; 2.1 baked cube maps | `PATCHES_93W1`, `DEV93W1_TAIL` in `extract-rock-engine.py` |

The extractors (`frontend/scripts/extract-world-engine.py`, `extract-rock-engine.py`) take the prototype path as an argument or `SX_PREVIEW_HTML`. The world extractor refuses to overwrite a file holding `@deviation` unless `--force`; the rock extractor applies its PATCHES. **Open (Moon):** the prototype HTML and the parity harness (`parity/verbatim_check.py`, `parity/run.cjs`) are not in the repo, so the parity claims cannot be reproduced from a checkout.

**Performance (D-05, R5.5).** The star and rock engines cap the device pixel ratio at 1.5 inside their own code; the world engine caps it at 1.25 for the globe and 1.0 for the fly view (issue #93; 1.5 only for the prototype's own page, `role: 'both'`, used by parity). Each engine drops its render scale on slow frames; the world engine's scaler aims at 30 fps (shrinks above 34 ms, grows below 20 ms, with the steps limited in time since Q-384) and passes the eased scale to the fly shader, so a scale change alters sharpness, not the ground pattern. The star and world engine hosts draw at most 60 frames a second (Q-386). A planet runs two GL contexts and two simulations (globe and fly view); they share one terrain build (`terrainCache.js`, keyed by every input of `buildTerrain`), the fly engine does not draw the globe hidden beside it, and no world is drawn while it spins up under the opaque "Forming" overlay. The gas solver runs at most 3 steps a frame, so a giant that needs more (HD 189733 b) runs slower than one day per second, and its caption states the real rate (about 15 h per second for HD 189733 b; Q-343). Decisions: Q-339 to Q-343. Since the #93 performance waves (Q-381 to Q-386) each engine compiles in the background, the fly view has a static G-buffer and stays mounted while its close-up is closed, and one simulation per world is merging (Q-385); the detail, the caches and the dev switches are in [R5.9.1](engines-performance.md#r591-engine-and-viewer-performance-issue-93-waves).

**First open (issue #93).** On ANGLE D3D11 (Chrome's default on Windows) the driver unrolls every constant-bound loop, so the fly shader froze the page on a cold cache. The world shaders and the star shader now write each constant loop bound as `N+uZ0` (`uZ0` a uniform never set, always 0; pixels within rounding), and the world engine compiles in the background: `new WorldEngine(canvas, { role })` submits its programs without reading a status, and `whenReady()` polls `KHR_parallel_shader_compile` and resolves once they are linked (rejects with the compile or link log). A globe-only engine (`role: 'globe'`) never compiles the fly shader and ignores `setFly(true)`. The star and rock engines also compile in the background since the #93 wave 1 (Q-381, Q-382; R12 #56), each with a 60 s watchdog ([R5.9.1](engines-performance.md#r591-engine-and-viewer-performance-issue-93-waves)).

Measured cold (RTX 4060 Ti desktop, `frontend/scripts/engine-bench`, corrected 12 Nov 2026, Q-337):

| Program | Cold compile |
|---|---|
| Fly shader (`FLY_FS`) | 22 to 43 s under load; 40 to 55 s in the app while the globe forms. The earlier 56 s and 78 s baselines were taken under uncontrolled load. Unchanged by the wave 2 fly work: about 22 s median (Q-384). |
| Globe programs | 2.3 to 4.6 s |
| Star shader | 1.2 to 1.7 s in the driver; the page is blocked 0.12 to 0.19 s (was 1.5 to 1.8 s; background compile, Q-381) |
| Rock shader | 1.9 to 2.1 s cold (Q-337); the page was blocked 1.3 to 2.5 s in the wave 1 bench; now compiled in the background with the loops kept: 0 s blocked (Q-382) |

The A15 is not measured yet (R12 #55). The longest main-thread pause during a cold fly compile was 113 to 185 ms (blue team; the first measurement was 161 ms). Over a whole cold TRAPPIST-1 f build the longest pause was 2.7 s, while the world formed (it was 35.9 s before the regression fix).

**Shader cache (Q-368).** Chrome's GPU disk cache does not keep programs linked through `KHR_parallel_shader_compile` (measured on Chrome 157; synchronous links are kept; `FLY_FS`'s entry is only 74 KB, so the size limit is not the cause). With `--enable-features=ANGLEPerContextBlobCache` they are kept: the second launch was ready in about 52 ms instead of 22 s. So a warm cache gives milliseconds only within one Chrome session, or across launches with that flag. The demo launch and the warm-up are in [A10.2](../architecture/frontend-platform.md#a102-running-the-event-build).

**Engine lifecycle (Q-338, Q-339).** A world stage (`app/WorldEngineStage.tsx`) never hangs on "Forming":

- **Create.** The stage creates its engine one tick after it mounts, so React's development double mount builds one engine, not two.
- **Wait for the shaders.** If they are not ready after 60 s (globe) or 180 s (fly), the stage fails and the three.js path draws (`readyOrTimeout`, `app/engineWatchdog.ts`).
- **Form.** If the world has not formed after 90 s counted while it is on screen (`FormClock`; a frame counts at most 250 ms), the stage fails the same way. An exception while starting or stepping, or a lost context, fails it too. These limits are UI pacing, not physics.
- **Loader.** The opaque "Forming" overlay shows the build loader (static under reduced motion), "Preparing the graphics. The first time can take a minute." while the shaders compile, then a progress bar of the spin-up.
- **Closed close-up.** The fly view stays mounted and paused while its close-up is closed, and reopens in 0.3 s (Q-383).
- **Formed.** The stage reports `onFormed`; the build steps wait for it (`useMould` phase `'forming'`, R5.8).
- **Dispose.** `dispose()` never blocks: `loseContext()` waits for every compile still running in the driver, so the context is released only once the driver reports every program done (polled every 100 ms). If a compile is still pending after 180 s, the engine stops polling and leaves the context to the browser without calling `loseContext()`.

**Globe controls (issue #93, Q-344).** On the world globe a press that moves less than 4 px is a click: with the close-up open it picks the place the close-up goes to. A longer press drags and turns the globe, and the drag follows the hand on both axes. The arrow keys and the Details rotate arrows move the surface the way the arrow points, also with the close-up open (`globeTurn`, `globeTurnBy` in `worldStore.ts`); the light turns with the view, so the terminator stays put. In the close-up the drag follows the hand.

**Not measured:** the A15 check of at least 30 fps while rotating has not been run for the rock engine or for the two world-engine instances; it must be run on the A15 before the event (R11, R12 #43); the performance waves are not measured there either (R12 #59).

**Known limitation.** The star engine runs its slices through `new Function`, so a Content Security Policy needs `'unsafe-eval'` in `script-src`. The slices' errors and warnings reach the browser console, tagged `[star engine]` (Q-329).

Per-engine values: stars [R7.5](renderers/stars.md#r75-stars-star-star_mira-star_ttauri); worlds and gas giants [R7.7.1](renderers/world-engine.md#r771-world-engine-values) (the three.js path: [R7.7](renderers/shader-kinds.md#r77-shader-generated-kinds-planet_rocky-planet_water-gas_giant-nebula-nova)); rocks [R7.2](renderers/asteroid.md#r72-asteroid_procedural) and [R7.3](renderers/comet.md#r73-comet-3iatlas).
