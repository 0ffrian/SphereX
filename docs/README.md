# Documentation

The docs are split into small fragments, so you only need to load the parts a task needs. Each spec folder has an index with a **section map**:
- "architecture spec §7.2" means section **A7.2** in [architecture/](architecture/README.md)
- "rendering doc §8.4" means section **R8.4** in [rendering/](rendering/README.md)

| Doc | Read it for | Authority |
|---|---|---|
| [decisions.md](decisions.md) | Decisions that reconcile the two specs, backlog, open questions | Highest |
| [rendering/](rendering/README.md) | Object display, surface generation, haptics, audio pairing | Display, surfaces, haptics, audio pairing |
| [architecture/](architecture/README.md) | What we build, data sources, pipeline, tiers, plan, risks | Everything not covered above |
| [uml/](uml/README.md) | All architecture diagrams (use case, component, deployment, package, class, sequence, state, activity) | Illustrates the specs; the specs win if they differ |
| [handover.md](handover.md) | The competition, the data, early concepts (Rainbow Trails) | Background only |

## Precedence

1. `decisions.md`
2. `rendering/` for its scope (R0)
3. `architecture/`
4. `uml/` and `handover.md`

If two docs disagree and `decisions.md` is silent, raise it with the team and record the answer in `decisions.md`.

## What to load for a task

Always load `decisions.md` first. It is short, and it overrides everything else.

| Task | Load |
|---|---|
| Get oriented | [architecture/overview.md](architecture/overview.md), [rendering/principles-stack.md](rendering/principles-stack.md) |
| Add or fix a data adapter (IRSA, Gaia, Horizons, SBDB…) | [architecture/data-sources.md](architecture/data-sources.md), [architecture/pipeline.md](architecture/pipeline.md), decisions D-19 (resolver order) and D-25 (cache) |
| API endpoints (resolve, frames, cutouts, spectrum, card, render-params; composite, `/v1/sky/…` and `/v1/sky/cached` proposed) | [architecture/pipeline.md](architecture/pipeline.md), [rendering/data-contract.md](rendering/data-contract.md), [../backend/README.md](../backend/README.md#endpoints-d-16) ([composite](../backend/README.md#composite)), [uml/20-sequence-composite.md](uml/20-sequence-composite.md), decisions D-16 (and Q-39 for the card and render-params headers; open: Q-87 for the `/v1/sky` endpoints, Q-92 and Q-94 for the composite, Q-98 for `/v1/sky/cached`, Q-99 for the live budget) |
| Pipeline: find, measure, classify, build the card | [architecture/pipeline.md](architecture/pipeline.md), [rendering/data-contract.md](rendering/data-contract.md), decisions Q-55 to Q-57 (stages 3 to 7 as built) |
| Schemas: ObjectCard, RenderParams, tags, generated contract code, shared fixtures | [rendering/data-contract.md](rendering/data-contract.md), [architecture/data-contract.md](architecture/data-contract.md) (D-18), [../shared/README.md](../shared/README.md), [uml/05-class-data-contract.md](uml/05-class-data-contract.md), decisions D-32 (tiers, `formula`, `assumed`, `dynamics`) |
| Motion, time-lapse, star surface, quality levels | [rendering/display-rules.md](rendering/display-rules.md) (R5.7), [rendering/renderers/stars.md](rendering/renderers/stars.md) (R7.5.1–R7.5.5), [rendering/data-contract.md](rendering/data-contract.md) (R3.4), decisions D-32 and D-34 |
| Backend texture baker | [rendering/surface-generation.md](rendering/surface-generation.md), [rendering/data-contract.md](rendering/data-contract.md) |
| 3D viewer shell: lighting, modes, honesty, interaction | [rendering/display-rules.md](rendering/display-rules.md), [rendering/accessibility.md](rendering/accessibility.md) |
| A renderer for one type | the matching file in [rendering/renderers/](rendering/README.md), plus [rendering/display-rules.md](rendering/display-rules.md) |
| Planets, gas giants, nebulae, novae (browser shaders) | [architecture/generators.md](architecture/generators.md), [architecture/physics.md](architecture/physics.md), [rendering/renderers/shader-kinds.md](rendering/renderers/shader-kinds.md) |
| Haptic engine and drivers | [rendering/haptics/engine-api.md](rendering/haptics/engine-api.md), [rendering/haptics/platform-encoding.md](rendering/haptics/platform-encoding.md) |
| A haptic source for one type | [rendering/haptics/sources.md](rendering/haptics/sources.md), [rendering/haptics/profiles.md](rendering/haptics/profiles.md), [rendering/haptics/engine-api.md](rendering/haptics/engine-api.md) |
| Spectrum haptics and the Listen sweep | [rendering/haptics/profiles.md](rendering/haptics/profiles.md), [rendering/haptics/audio-pairing.md](rendering/haptics/audio-pairing.md), [architecture/sound-voice.md](architecture/sound-voice.md) |
| Audio driver | [rendering/haptics/audio-pairing.md](rendering/haptics/audio-pairing.md), [rendering/haptics/engine-api.md](rendering/haptics/engine-api.md) |
| Calibration and settings | [rendering/haptics/calibration.md](rendering/haptics/calibration.md) |
| Frontend setup, scripts, phone testing | [../frontend/README.md](../frontend/README.md), [architecture/frontend-platform.md](architecture/frontend-platform.md) |
| Frontend setup, performance | [architecture/frontend-platform.md](architecture/frontend-platform.md), [rendering/display-rules.md](rendering/display-rules.md) (R5.5) |
| Hosting on the A15, HTTPS, cache and offline demo mode | [architecture/frontend-platform.md](architecture/frontend-platform.md) (A10), [architecture/risks.md](architecture/risks.md), decisions D-24 and D-25 |
| Sky view (all-sky background, picking) | [architecture/data-sources.md](architecture/data-sources.md) (A3.11), [architecture/pipeline.md](architecture/pipeline.md) (A4, sky endpoints), [architecture/frontend-platform.md](architecture/frontend-platform.md) (A10.1), [rendering/layout-tests-open-items.md](rendering/layout-tests-open-items.md) (R10), [../frontend/README.md](../frontend/README.md#shell-and-sky-view-prototype-7-nov-2026), [../backend/README.md](../backend/README.md#sky-background-prototype), [uml/08-sequence-search-flipbook.md](uml/08-sequence-search-flipbook.md), decisions D-35, Q-87 to Q-91 and Q-97 to Q-99 (progressive frames, cached markers, live budget) |
| Moving-object frame search (asteroids, comets: Horizons path, SIA cones, footprint filter) | [architecture/pipeline.md](architecture/pipeline.md) (A4.1, A4.2), [architecture/data-sources.md](architecture/data-sources.md) (A3.1, A3.4), [uml/08-sequence-search-flipbook.md](uml/08-sequence-search-flipbook.md), decisions Q-21, Q-111, Q-124 and Q-125 |
| Flipbook and Rainbow Trails view mode | [architecture/overview.md](architecture/overview.md) (A1.1), [architecture/pipeline.md](architecture/pipeline.md) (A4.1), decisions D-28 |
| Select a body, Build it, the split view and the moulding animation (issue #60) | [rendering/display-rules.md](rendering/display-rules.md) (R4, R5.3, R5.7), [rendering/accessibility.md](rendering/accessibility.md) (R9), [../frontend/README.md](../frontend/README.md#select-and-build-it-issue-60-q-113), [uml/21-sequence-build-mould.md](uml/21-sequence-build-mould.md), decisions D-21, D-34 and Q-113 |
| Flipbook colour views (Raw ↔ Colour, wavelength tint, SPHEREx composite, `colour=` link) | [rendering/display-rules.md](rendering/display-rules.md) (R4), [architecture/honesty-policy.md](architecture/honesty-policy.md) (A11), [architecture/pipeline.md](architecture/pipeline.md) (A4.1), [../backend/README.md](../backend/README.md#composite), [../frontend/README.md](../frontend/README.md#flipbook-and-spectrum-m1-issue-3), [uml/08-sequence-search-flipbook.md](uml/08-sequence-search-flipbook.md), [uml/20-sequence-composite.md](uml/20-sequence-composite.md), decisions Q-27 and Q-93 to Q-95 |
| Overlays (Gaia, WISE, contamination, flag mask, field of view) and combine frames | [architecture/pipeline.md](architecture/pipeline.md) (A4.9), [architecture/data-sources.md](architecture/data-sources.md) (A3.2, A3.3), [uml/08-sequence-search-flipbook.md](uml/08-sequence-search-flipbook.md), decisions D-16, Q-50 to Q-54 and Q-102 (overlays on the frame grid) |
| Labels and honesty in the UI | [architecture/honesty-policy.md](architecture/honesty-policy.md), [rendering/display-rules.md](rendering/display-rules.md) (R5.3, D-21) |
| Tests | [architecture/testing.md](architecture/testing.md), [rendering/layout-tests-open-items.md](rendering/layout-tests-open-items.md), [rendering/reference/](rendering/reference/README.md) (reference frames, visual checklist, frame-time checks) |
| Where code lives and who owns it | [rendering/layout-tests-open-items.md](rendering/layout-tests-open-items.md) (R10), [uml/04-package.md](uml/04-package.md), decisions D-17 |
| Plan, milestones, risks | [architecture/plan.md](architecture/plan.md), [architecture/risks.md](architecture/risks.md), decisions D-14, D-29 and D-30 |

## Editing rules

- Keep each fragment to one topic and about 150 lines or fewer. Keep the `A`/`R` section numbers in the headings; other docs cite them.
- When you add, move or rename a section, update the section map in that spec's `README.md`.
- When you change a spec, update the matching diagram in `uml/` in the same commit.
- Record any new cross-cutting decision in `decisions.md` with the next `D-` number.
- Keep the **[verify]** markers until someone has checked the item against real output.
