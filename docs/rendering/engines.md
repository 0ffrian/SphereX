# Prototype engines (D-37)

> **Part of:** Rendering & haptics spec ([index](README.md)) · **Sections:** R5.9 · **Implements:** [D-37, Q-286 to Q-288, Q-299 to Q-306, Q-309 to Q-316](../decisions/rendering-engines.md), [Q-329 to Q-331, Q-334, Q-335](../decisions/rendering-engines-review.md), [D-03, D-05](../decisions/platform-hosting.md), [D-21, Q-110](../decisions/contract-tags.md), [D-36](../decisions/rendering-bodies.md) · **Read with:** [display-rules.md](display-rules.md) (R5.3 honesty, R5.5 budget), [renderers/stars.md](renderers/stars.md) (R7.5), [renderers/shader-kinds.md](renderers/shader-kinds.md) (R7.7), [renderers/asteroid.md](renderers/asteroid.md) (R7.2), [acceptance-tests.md](acceptance-tests.md) (R11)

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
- The engine also needs: the plan allows a 3D body (`threeD`, the confidence gate), the adapter accepts the card (a refusal lists the missing fields, D-32), WebGL2 (and float render targets for the world engine), and no earlier failure for this object (`engineKey`, per object).
- While an engine draws the body, the three.js viewer builds and draws nothing under it (`ViewerApp.setEngineOwned`). It takes over again when the engine stands down.

**Fallback: the three.js renderers stay (Atish, 11 Nov 2026).** `GasWorld.ts`, `RockyWorld.ts` (Q-286), `viewer/orbit/*`, `ShaderBody`, `Star`, `AsteroidProcedural`, `AsteroidMesh` and `Comet` are kept. They draw:

1. at + Estimated and Measured only;
2. when the adapter refuses the card;
3. when an engine fails to start;
4. when an engine loses its WebGL context (no black canvas);
5. when WebGL2 is missing.

Never blank: the fallback is always the path that draws first.

**Determinism (Atish, 11 Nov 2026).** Engine frames are **not** byte-identical, and R1 principle 5 does not apply to them:

- the spin-up runs under a wall-clock budget (14 ms, Q-306), so how far the clouds and gas flow have developed differs between runs and between the globe and fly instances (Q-313);
- the render scale adapts to frame time (pinned only for parity runs, `window.__sxPin`);
- the star engine's flares and plasma use the prototype's fixed seeds; its surface and spots take a seed from the card id (below).

The byte-identical rule still holds for the baked textures (`bake_demo_pack --check`, `bake_fixtures --check`, `bake_reference_objects --check`), the card and RenderParams, and the three.js path.

**Seeds and repeating patterns (issue #93 phase 2).** The same card still gives the same picture. A card object's seed is a 32-bit avalanche hash (`frontend/src/engine/seed.ts`: the card id for worlds and stars, the card seed for rocks) and `seedVec` of it, three integers in [0, 256) that the shaders add to their noise coordinates as a vec3 (`seed3` on a world or rock preset, `so` on a star preset). The prototype's presets have none and keep their integer seed along (1, 1, 1), so `?parity=1` and `?preset=` draw as before (checked pixel-identical: `scripts/engine-bench/patterns.html?what=presets`). With it:

- worlds: every seeded noise layer, the layers that had no seed (sea-ice tint, convective clouds, waves, fly-view sea ice, slope rock, river relief), and a card giant's tracer noise, now taken from the sphere direction instead of one texture tiled 4 x 3 (the three.js fallback, `GasWorld.ts`, does the same);
- stars: granulation, supergranulation and the filters (`uSO`) and the spot RNG (`rng(1729 ^ seed)`);
- rocks: the noise offset, the shape and crater RNG (the full hash), per-crater ellipticity, rim height and rim wave, and 0 to 2 boulders a cell (artistic).

The fly view lays its gullies and the gas giant's small-scale detail on planet-fixed cube faces (blended at the seams) instead of the plane under the camera, fades noise octaves over two octaves of pixel footprint, and reads the height and climate grids with a cubic B-spline in shading (the ray march and the shadows keep the bilinear read; the full cubic cost 14 % of a fly frame). The haptics and sound read the same B-spline (`engine/worlds/fieldSampler.ts`). Not changed: the CPU terrain hash and the octave lacunarity (backend change and re-bake, after the event), and Saturn's ring texture (only the Saturn preset draws rings).

**Copied code and deviations (Q-303, Q-335).** Copied blocks sit between `// @verbatim Lstart-Lend` and `// @end-verbatim`. Reviewed fixes are marked `// @deviation (#89 review N)` or `// @deviation (#93 N)` with `@rename` pairs or a split block, and say why; the world extractor carries the #93 ones. The extractors (`frontend/scripts/extract-world-engine.py`, `extract-rock-engine.py`) take the prototype path as an argument or `SX_PREVIEW_HTML`. The world extractor refuses to overwrite a file holding `@deviation` unless `--force`; the rock extractor applies its PATCHES. **Open (Moon):** the prototype HTML and the parity harness (`parity/verbatim_check.py`, `parity/run.cjs`) are not in the repo, so the parity claims cannot be reproduced from a checkout.

**Performance (D-05, R5.5).** The star and rock engines cap the device pixel ratio at 1.5 inside their own code; the world engine caps it at 1.25 for the globe and 1.0 for the fly view (issue #93; 1.5 only for the prototype's own page, `role: 'both'`, used by parity). Each engine drops its render scale on slow frames; the world engine's scaler aims at 30 fps (shrinks above 34 ms, grows below 22 ms) and passes the scale to the fly shader, so a scale change alters sharpness, not the ground pattern. A planet runs two GL contexts and two simulations (globe and fly view); they share one terrain build (`terrainCache.js`, keyed by every input of `buildTerrain`), the fly engine does not draw the globe hidden beside it, and no world is drawn while it spins up under the opaque "Forming" overlay. The gas solver runs at most 3 steps a frame, so a giant that needs more (HD 189733 b) runs slower than one day per second.

**First open (issue #93).** On ANGLE D3D11 (Chrome's default on Windows) the driver unrolls every constant-bound loop: the fly shader took about 60 s to compile on a cold cache and froze the page. The world shaders and the star shader now write each constant loop bound as `N+uZ0` (`uZ0` a uniform never set, always 0), and the world engine compiles in the background: `new WorldEngine(canvas, { role })` submits its programs without reading a status, `whenReady()` polls `KHR_parallel_shader_compile` and resolves once they are linked (rejects with the compile or link log), and the stage shows "Forming…" until then and loads the world after. A globe-only engine (`role: 'globe'`) never compiles the fly shader. Measured (RTX 4060 Ti, cold, `frontend/scripts/engine-bench`): fly shader 56 s to 20 s, globe shader 5.0 s to 1.9 s, star shader 3.2 to 4.6 s to 1.1 to 1.2 s, rock shader 1.5 s (unchanged); the longest main-thread pause while the fly engine compiled was 161 ms. The star and rock engines still compile synchronously. On the A15, open every demo object once in the demo Chrome profile after the final build, so the disk cache is warm.

**Not measured:** the A15 check of at least 30 fps while rotating has not been run for the rock engine or for the two world-engine instances; it must be run on the A15 before the event (R11, R12 #43).

**Known limitation.** The star engine runs its slices through `new Function`, so a Content Security Policy needs `'unsafe-eval'` in `script-src`. The slices' errors and warnings reach the browser console, tagged `[star engine]` (Q-329).

Per-engine values: stars [R7.5](renderers/stars.md#r75-stars-star-star_mira-star_ttauri); worlds and gas giants [R7.7](renderers/shader-kinds.md#r77-shader-generated-kinds-planet_rocky-planet_water-gas_giant-nebula-nova); rocks [R7.2](renderers/asteroid.md#r72-asteroid_procedural) and [R7.3](renderers/comet.md#r73-comet-3iatlas).
