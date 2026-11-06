# CONTEXT: Celestial Object Display, Surface Generation and Haptics

**Project:** Shift & Spectrum, NASA Space Apps 2026, challenge "Planet X and SPHEREx"
**Audience:** the team (Atish, Kevin and Moon, who is also called Munazir) and Claude Code. This spec lives in `docs/rendering/` (this index plus the fragments below) and is referenced from `CLAUDE.md`.
**Status:** v2, 4 Nov 2026. Items marked **[verify]** must be checked against real output before relying on them.
**Precedence:** decisions in [decisions.md](../decisions.md) override this doc. Decision IDs (D-xx), backlog IDs (B-xx) and question IDs (Q-xx) refer to that file.

The original single file (`docs/CONTEXT-rendering-haptics.md`) was split into the fragments below. Section numbers are kept with an `R` prefix: "rendering doc §8.4" elsewhere means **R8.4** here. Load only the fragment a task needs.

## Fragments

| File | Sections | Load this when… |
|---|---|---|
| [principles-stack.md](principles-stack.md) | R0, R1, R2 | starting any rendering/haptics task: scope, non-goals, the 6 principles, pinned package versions |
| [data-contract.md](data-contract.md) | R3, R3.1–R3.4 | touching the card/render-params schema, provenance tags, view-mode fields or backend type selection (canonical TV / ObjectCard / RenderParams) |
| [display-rules.md](display-rules.md) | R4, R5, R5.1–R5.6 | working on the viewer: lighting, view modes, honesty toggle, scale bar, performance budget, interaction |
| [surface-generation.md](surface-generation.md) | R6, R6.1–R6.7 | baking height/normal/albedo maps: card→params rules, noise, craters, Sobel normals, Gemini/depth paths, caching |
| [renderers/asteroid.md](renderers/asteroid.md) | R7 (intro), R7.1, R7.2 | rendering `asteroid_shape` or `asteroid_procedural` (also holds the R7 intro rule on refused layers) |
| [renderers/comet.md](renderers/comet.md) | R7.3 | rendering 3I/ATLAS: nucleus, gas shells, dust, epoch toggle |
| [renderers/brown-dwarf.md](renderers/brown-dwarf.md) | R7.4 | rendering `brown_dwarf` / `brown_dwarf_binary` |
| [renderers/stars.md](renderers/stars.md) | R7.5 | rendering `star`, `star_mira`, `star_ttauri` |
| [renderers/candidate.md](renderers/candidate.md) | R7.6 | handling unknown moving sources (no 3D) |
| [renderers/shader-kinds.md](renderers/shader-kinds.md) | R7.7 | planets, gas giants, nebulae, novae: the shared CPU field for haptics |
| [haptics/platform-encoding.md](haptics/platform-encoding.md) | R8, R8.1–R8.3 | deciding what each platform can do, texture vs data haptics, vibration patterns and quantisation |
| [haptics/sources.md](haptics/sources.md) | R8.4 | implementing a source: height-map, mesh-normal, field, terrain, flow |
| [haptics/profiles.md](haptics/profiles.md) | R8.5, R8.6 | mapping an object type to its texture/data haptics, or doing spectrum haptics |
| [haptics/calibration.md](haptics/calibration.md) | R8.7 | building first-use calibration, stored per-device values, haptics/sound settings |
| [haptics/engine-api.md](haptics/engine-api.md) | R8.8 | writing `HapticEngine`, drivers or `HapticProfile` (TS reference code) |
| [haptics/audio-pairing.md](haptics/audio-pairing.md) | R8.9 | writing the audio driver: timing, mapping, timbre by tag, Bluetooth latency |
| [accessibility.md](accessibility.md) | R9 | alt text, aria-live, control sizes, reduced motion |
| [layout-tests-open-items.md](layout-tests-open-items.md) | R10, R11, R12 | finding where code lives / who owns it, writing tests, or checking unverified items |

## Section map

| Section | Title | Location |
|---|---|---|
| R0 | How to use this document | [principles-stack.md#r0-how-to-use-this-document](principles-stack.md#r0-how-to-use-this-document) |
| R1 | Principles (non-negotiable) | [principles-stack.md#r1-principles-non-negotiable](principles-stack.md#r1-principles-non-negotiable) |
| R2 | Pinned stack | [principles-stack.md#r2-pinned-stack](principles-stack.md#r2-pinned-stack) |
| R3 | Data contract | [data-contract.md#r3-data-contract](data-contract.md#r3-data-contract) |
| R3.1 | Tagged value | [data-contract.md#r31-tagged-value](data-contract.md#r31-tagged-value) |
| R3.2 | ObjectCard (produced by the backend: `GET /v1/objects/{id}/card`) | [data-contract.md#r32-objectcard-produced-by-the-backend-get-v1objectsidcard](data-contract.md#r32-objectcard-produced-by-the-backend-get-v1objectsidcard) |
| R3.3 | Type selection (backend) | [data-contract.md#r33-type-selection-backend](data-contract.md#r33-type-selection-backend) |
| R3.4 | RenderParams (produced by the backend: `GET /v1/objects/{id}/render-params`) | [data-contract.md#r34-renderparams-produced-by-the-backend-get-v1objectsidrender-params](data-contract.md#r34-renderparams-produced-by-the-backend-get-v1objectsidrender-params) |
| R4 | Display levels | [display-rules.md#r4-display-levels](display-rules.md#r4-display-levels) |
| R5 | Rules shared by every 3D view | [display-rules.md#r5-rules-shared-by-every-3d-view](display-rules.md#r5-rules-shared-by-every-3d-view) |
| R5.1 | Lighting | [display-rules.md#r51-lighting](display-rules.md#r51-lighting) |
| R5.2 | View modes | [display-rules.md#r52-view-modes](display-rules.md#r52-view-modes) |
| R5.3 | Honesty toggle (3 states) | [display-rules.md#r53-honesty-toggle-3-states](display-rules.md#r53-honesty-toggle-3-states) |
| R5.4 | Scale bar | [display-rules.md#r54-scale-bar](display-rules.md#r54-scale-bar) |
| R5.5 | Performance budget (D-05) | [display-rules.md#r55-performance-budget-d-05](display-rules.md#r55-performance-budget-d-05) |
| R5.6 | Interaction | [display-rules.md#r56-interaction](display-rules.md#r56-interaction) |
| R6 | Surface generation (backend, CPU) | [surface-generation.md#r6-surface-generation-backend-cpu](surface-generation.md#r6-surface-generation-backend-cpu) |
| R6.1 | Strategy: height first, colour second | [surface-generation.md#r61-strategy-height-first-colour-second](surface-generation.md#r61-strategy-height-first-colour-second) |
| R6.2 | Card → generator parameters (deterministic rules) | [surface-generation.md#r62-card--generator-parameters-deterministic-rules](surface-generation.md#r62-card--generator-parameters-deterministic-rules) |
| R6.3 | Height field | [surface-generation.md#r63-height-field](surface-generation.md#r63-height-field) |
| R6.4 | Colour (no AI, default) | [surface-generation.md#r64-colour-no-ai-default](surface-generation.md#r64-colour-no-ai-default) |
| R6.5 | Normals from height (Sobel, equirectangular-aware) | [surface-generation.md#r65-normals-from-height-sobel-equirectangular-aware](surface-generation.md#r65-normals-from-height-sobel-equirectangular-aware) |
| R6.6 | Optional paths | [surface-generation.md#r66-optional-paths](surface-generation.md#r66-optional-paths) |
| R6.7 | Output and caching | [surface-generation.md#r67-output-and-caching](surface-generation.md#r67-output-and-caching) |
| R7 | Per-type rendering specs | [renderers/asteroid.md#r7-per-type-rendering-specs](renderers/asteroid.md#r7-per-type-rendering-specs) |
| R7.1 | `asteroid_shape` (Bennu, Eros, Vesta, DAMIT objects) | [renderers/asteroid.md#r71-asteroid_shape-bennu-eros-vesta-damit-objects](renderers/asteroid.md#r71-asteroid_shape-bennu-eros-vesta-damit-objects) |
| R7.2 | `asteroid_procedural` | [renderers/asteroid.md#r72-asteroid_procedural](renderers/asteroid.md#r72-asteroid_procedural) |
| R7.3 | `comet` (3I/ATLAS) | [renderers/comet.md#r73-comet-3iatlas](renderers/comet.md#r73-comet-3iatlas) |
| R7.4 | `brown_dwarf` and `brown_dwarf_binary` | [renderers/brown-dwarf.md#r74-brown_dwarf-and-brown_dwarf_binary](renderers/brown-dwarf.md#r74-brown_dwarf-and-brown_dwarf_binary) |
| R7.5 | Stars: `star`, `star_mira`, `star_ttauri` | [renderers/stars.md#r75-stars-star-star_mira-star_ttauri](renderers/stars.md#r75-stars-star-star_mira-star_ttauri) |
| R7.6 | `candidate` | [renderers/candidate.md#r76-candidate](renderers/candidate.md#r76-candidate) |
| R7.7 | Shader-generated kinds: `planet_rocky`, `planet_water`, `gas_giant`, `nebula`, `nova` | [renderers/shader-kinds.md#r77-shader-generated-kinds-planet_rocky-planet_water-gas_giant-nebula-nova](renderers/shader-kinds.md#r77-shader-generated-kinds-planet_rocky-planet_water-gas_giant-nebula-nova) |
| R8 | Haptics | [haptics/platform-encoding.md#r8-haptics](haptics/platform-encoding.md#r8-haptics) |
| R8.1 | Platform reality | [haptics/platform-encoding.md#r81-platform-reality](haptics/platform-encoding.md#r81-platform-reality) |
| R8.2 | Two kinds of haptics (both labelled in the UI) | [haptics/platform-encoding.md#r82-two-kinds-of-haptics-both-labelled-in-the-ui](haptics/platform-encoding.md#r82-two-kinds-of-haptics-both-labelled-in-the-ui) |
| R8.3 | Encoding (web driver, D-09) | [haptics/platform-encoding.md#r83-encoding-web-driver-d-09](haptics/platform-encoding.md#r83-encoding-web-driver-d-09) |
| R8.4 | Event sources | [haptics/sources.md#r84-event-sources](haptics/sources.md#r84-event-sources) |
| R8.5 | Per-type haptic profile | [haptics/profiles.md#r85-per-type-haptic-profile](haptics/profiles.md#r85-per-type-haptic-profile) |
| R8.6 | Spectrum haptics (every object; the most useful for blind and low-vision users) | [haptics/profiles.md#r86-spectrum-haptics-every-object-the-most-useful-for-blind-and-low-vision-users](haptics/profiles.md#r86-spectrum-haptics-every-object-the-most-useful-for-blind-and-low-vision-users) |
| R8.7 | Calibration and settings | [haptics/calibration.md#r87-calibration-and-settings](haptics/calibration.md#r87-calibration-and-settings) |
| R8.8 | Engine API | [haptics/engine-api.md#r88-engine-api](haptics/engine-api.md#r88-engine-api) |
| R8.9 | Audio pairing (D-10) | [haptics/audio-pairing.md#r89-audio-pairing-d-10](haptics/audio-pairing.md#r89-audio-pairing-d-10) |
| R9 | Accessibility tie-ins | [accessibility.md#r9-accessibility-tie-ins](accessibility.md#r9-accessibility-tie-ins) |
| R10 | File layout and ownership | [layout-tests-open-items.md#r10-file-layout-and-ownership](layout-tests-open-items.md#r10-file-layout-and-ownership) |
| R11 | Acceptance tests | [layout-tests-open-items.md#r11-acceptance-tests](layout-tests-open-items.md#r11-acceptance-tests) |
| R12 | Open items [verify] | [layout-tests-open-items.md#r12-open-items-verify](layout-tests-open-items.md#r12-open-items-verify) |
