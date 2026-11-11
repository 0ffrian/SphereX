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
- the star engine uses the prototype's fixed seeds, not the card seed.

The byte-identical rule still holds for the baked textures (`bake_demo_pack --check`, `bake_fixtures --check`, `bake_reference_objects --check`), the card and RenderParams, and the three.js path.

**Copied code and deviations (Q-303, Q-335).** Copied blocks sit between `// @verbatim Lstart-Lend` and `// @end-verbatim`. Reviewed fixes are marked `// @deviation (#89 review N)` with `@rename` pairs or a split block, and say why. The extractors (`frontend/scripts/extract-world-engine.py`, `extract-rock-engine.py`) take the prototype path as an argument or `SX_PREVIEW_HTML`. The world extractor refuses to overwrite a file holding `@deviation` unless `--force`; the rock extractor applies its PATCHES. **Open (Moon):** the prototype HTML and the parity harness (`parity/verbatim_check.py`, `parity/run.cjs`) are not in the repo, so the parity claims cannot be reproduced from a checkout.

**Performance (D-05, R5.5).** Each engine caps the device pixel ratio at 1.5 inside its own code and drops its render scale on slow frames. A planet runs two GL contexts and two simulations (globe and fly view). **Not measured:** the A15 check of at least 30 fps while rotating has not been run for the rock engine or for the two world-engine instances; it must be run on the A15 before the event (R11, R12 #43).

**Known limitation.** The star engine runs its slices through `new Function`, so a Content Security Policy needs `'unsafe-eval'` in `script-src`. The slices' errors and warnings reach the browser console, tagged `[star engine]` (Q-329).

Per-engine values: stars [R7.5](renderers/stars.md#r75-stars-star-star_mira-star_ttauri); worlds and gas giants [R7.7](renderers/shader-kinds.md#r77-shader-generated-kinds-planet_rocky-planet_water-gas_giant-nebula-nova); rocks [R7.2](renderers/asteroid.md#r72-asteroid_procedural) and [R7.3](renderers/comet.md#r73-comet-3iatlas).
