# Architecture Spec: Shift & Spectrum

NASA Space Apps 2026, Port Louis (14 to 15 Nov 2026). Challenge: **Planet X and SPHEREx**.
Status of this document: draft v2, 4 Nov 2026. It records the direction agreed with Atish, the findings from the tests run so far, and the decisions in [decisions/](../decisions/README.md).

**Precedence:** [decisions/](../decisions/README.md) > [rendering/README.md](../rendering/README.md) ("the rendering doc") for its scope (display, surfaces, haptics, audio pairing) > this doc. Where the rendering doc is the authority, this doc only summarises and points to it.

Every claim below carries one of three labels:

| Label | Meaning |
|---|---|
| **Tested** | We called the service or ran the code and it worked. |
| **Documented** | Only an official page says so. We have not run it. |
| **To build / Not confirmed** | A plan, or something we could not check. |

## Fragments

Load only the fragment you need. Section numbers are prefixed with `A` ("architecture spec §7.2" = `A7.2`).

| File | Sections | Load this when… |
|---|---|---|
| [overview.md](overview.md) | A1–A2.1 | you need the scope, priority tiers (P0–P3, backlog), the system diagram or the design principles |
| [data-sources.md](data-sources.md) | A3–A3.11 | you call or adapt SPHEREx/IRSA, Gaia, WISE, Horizons, SkyBoT, SBDB, DAMIT, Exoplanet Archive, SIMBAD, mission shape models or the IRSA HiPS sky background |
| [pipeline.md](pipeline.md) | A4–A4.9 | you build a backend stage: find the object, measure flux/spectrum, classify, asset lookup, ObjectCard, RenderParams; or the overlays, flag mask and combine endpoints |
| [data-contract.md](data-contract.md) | A5–A5.4 | you touch generated contract code, ids/seeds, provenance tags and badges, slider overrides or the asset store |
| [generators.md](generators.md) | A6–A6.3 | you work on baked or browser-shader generators, triplanar mapping, the Gemini layer or offline jobs |
| [physics.md](physics.md) | A7–A7.5 | you implement a physics rule or slider for planets, gas giants, brown dwarfs, asteroids or supernova remnants |
| [sound-voice.md](sound-voice.md) | A8 | you work on the data sweep, imagined drive, audio pairing or the (backlog) voice and AI sound |
| [haptics.md](haptics.md) | A9–A9.5 | you work on haptic platforms, strength levels, audio pairing, what is felt per type, or the honesty rule for haptics |
| [frontend-platform.md](frontend-platform.md) | A10–A10.1 | you set up the build, UI stack, three.js, state, backend stack, proxy, hosting, caching, or check the performance budget |
| [honesty-policy.md](honesty-policy.md) | A11–A11.1 | you add user-facing labels, badges, the honesty toggle or the blind-test demo |
| [testing.md](testing.md) | A12 | you write or plan tests for any layer |
| [plan.md](plan.md) | A13 | you need the day-by-day schedule |
| [risks.md](risks.md) | A14 | you need the risk register and mitigations |
| [glossary.md](glossary.md) | A15 | you meet an unfamiliar term |
| [linker.md](linker.md) | A16–A16.7 | you work on Area search (agreed plan, Q-146): draw a square, then Known objects (hand-off to Track, Q-131) or Discovery; scope, architecture, honesty rules, open items, tickets |
| [linker-backend.md](linker-backend.md) | A17–A17.11 | you build the Discovery backend: area frames and visits, dots, glitches and stars, joining across visits, SkyBoT check, `/v1/areas` endpoints, schemas, cache |
| [linker-ui.md](linker-ui.md) | A18–A18.10 | you build Area search in the sky view: drawing the square, Dots and Tracks layers, blink, island cards and minimise, hand-off to Track, state, tests |

## Section map

| Section | Title | Location |
|---|---|---|
| A1 | What we are building | [overview.md#a1-what-we-are-building](overview.md#a1-what-we-are-building) |
| A1.1 | Priority tiers | [overview.md#a11-priority-tiers](overview.md#a11-priority-tiers) |
| A2 | System overview | [overview.md#a2-system-overview](overview.md#a2-system-overview) |
| A2.1 | Design principles | [overview.md#a21-design-principles](overview.md#a21-design-principles) |
| A3 | Data sources | [data-sources.md#a3-data-sources](data-sources.md#a3-data-sources) |
| A3.1 | SPHEREx (IRSA) | [data-sources.md#a31-spherex-irsa](data-sources.md#a31-spherex-irsa) |
| A3.2 | Gaia DR3 | [data-sources.md#a32-gaia-dr3](data-sources.md#a32-gaia-dr3) |
| A3.3 | WISE / NEOWISE | [data-sources.md#a33-wise--neowise](data-sources.md#a33-wise--neowise) |
| A3.4 | JPL Horizons | [data-sources.md#a34-jpl-horizons](data-sources.md#a34-jpl-horizons) |
| A3.5 | IMCCE SkyBoT | [data-sources.md#a35-imcce-skybot](data-sources.md#a35-imcce-skybot) |
| A3.6 | JPL Small-Body Database | [data-sources.md#a36-jpl-small-body-database](data-sources.md#a36-jpl-small-body-database) |
| A3.7 | DAMIT | [data-sources.md#a37-damit](data-sources.md#a37-damit) |
| A3.8 | NASA Exoplanet Archive | [data-sources.md#a38-nasa-exoplanet-archive](data-sources.md#a38-nasa-exoplanet-archive) |
| A3.9 | Not used for the base path | [data-sources.md#a39-not-used-for-the-base-path](data-sources.md#a39-not-used-for-the-base-path) |
| A3.10 | Added for the object view | [data-sources.md#a310-added-for-the-object-view](data-sources.md#a310-added-for-the-object-view) |
| A3.11 | Sky background (IRSA HiPS) | [data-sources.md#a311-sky-background-irsa-hips](data-sources.md#a311-sky-background-irsa-hips) |
| A4 | Pipeline | [pipeline.md#a4-pipeline](pipeline.md#a4-pipeline) |
| A4.1 | Stage 1: Find the object | [pipeline.md#a41-stage-1-find-the-object](pipeline.md#a41-stage-1-find-the-object) |
| A4.2 | Stage 2: Measure brightness and spectrum | [pipeline.md#a42-stage-2-measure-brightness-and-spectrum](pipeline.md#a42-stage-2-measure-brightness-and-spectrum) |
| A4.3 | Stage 3: Classify and pick a type | [pipeline.md#a43-stage-3-classify-and-pick-a-type](pipeline.md#a43-stage-3-classify-and-pick-a-type) |
| A4.4 | Stage 4: Check for a saved asset | [pipeline.md#a44-stage-4-check-for-a-saved-asset](pipeline.md#a44-stage-4-check-for-a-saved-asset) |
| A4.5 | Stage 5: ObjectCard | [pipeline.md#a45-stage-5-objectcard](pipeline.md#a45-stage-5-objectcard) |
| A4.6 | Stage 6: Physics layer | [pipeline.md#a46-stage-6-physics-layer](pipeline.md#a46-stage-6-physics-layer) |
| A4.7 | Stage 7: RenderParams | [pipeline.md#a47-stage-7-renderparams](pipeline.md#a47-stage-7-renderparams) |
| A4.8 | Stages 8 to 10: Generators | [pipeline.md#a48-stages-8-to-10-generators](pipeline.md#a48-stages-8-to-10-generators) |
| A4.9 | Overlays, flag mask and combine | [pipeline.md#a49-overlays-flag-mask-and-combine](pipeline.md#a49-overlays-flag-mask-and-combine) |
| A5 | Data contract | [data-contract.md#a5-data-contract](data-contract.md#a5-data-contract) |
| A5.1 | Ids and seeds | [data-contract.md#a51-ids-and-seeds](data-contract.md#a51-ids-and-seeds) |
| A5.2 | Provenance tags and badges | [data-contract.md#a52-provenance-tags-and-badges](data-contract.md#a52-provenance-tags-and-badges) |
| A5.3 | Overrides | [data-contract.md#a53-overrides](data-contract.md#a53-overrides) |
| A5.4 | Asset store | [data-contract.md#a54-asset-store](data-contract.md#a54-asset-store) |
| A6 | Generators | [generators.md#a6-generators](generators.md#a6-generators) |
| A6.1 | Why triplanar mapping (browser shaders only) | [generators.md#a61-why-triplanar-mapping-browser-shaders-only](generators.md#a61-why-triplanar-mapping-browser-shaders-only) |
| A6.2 | Optional Gemini artistic layer | [generators.md#a62-optional-gemini-artistic-layer](generators.md#a62-optional-gemini-artistic-layer) |
| A6.3 | Offline jobs (not on the demo laptop) | [generators.md#a63-offline-jobs-not-on-the-demo-laptop](generators.md#a63-offline-jobs-not-on-the-demo-laptop) |
| A7 | Physics layer | [physics.md#a7-physics-layer](physics.md#a7-physics-layer) |
| A7.1 | Planets | [physics.md#a71-planets](physics.md#a71-planets) |
| A7.2 | Gas giants (storms that respond) | [physics.md#a72-gas-giants-storms-that-respond](physics.md#a72-gas-giants-storms-that-respond) |
| A7.3 | Brown dwarfs | [physics.md#a73-brown-dwarfs](physics.md#a73-brown-dwarfs) |
| A7.4 | Asteroids | [physics.md#a74-asteroids](physics.md#a74-asteroids) |
| A7.5 | Supernova remnants | [physics.md#a75-supernova-remnants](physics.md#a75-supernova-remnants) |
| A8 | Sound and voice | [sound-voice.md#a8-sound-and-voice](sound-voice.md#a8-sound-and-voice) |
| A9 | Haptics | [haptics.md#a9-haptics](haptics.md#a9-haptics) |
| A9.1 | Platform (D-08) | [haptics.md#a91-platform-d-08](haptics.md#a91-platform-d-08) |
| A9.2 | Strength and detail (D-09) | [haptics.md#a92-strength-and-detail-d-09](haptics.md#a92-strength-and-detail-d-09) |
| A9.3 | Audio pairing (D-10) | [haptics.md#a93-audio-pairing-d-10](haptics.md#a93-audio-pairing-d-10) |
| A9.4 | What is felt | [haptics.md#a94-what-is-felt](haptics.md#a94-what-is-felt) |
| A9.5 | Honesty rule | [haptics.md#a95-honesty-rule](haptics.md#a95-honesty-rule) |
| A10 | Frontend and platform | [frontend-platform.md#a10-frontend-and-platform](frontend-platform.md#a10-frontend-and-platform) |
| A10.1 | Performance budget (D-05) | [frontend-platform.md#a101-performance-budget-d-05](frontend-platform.md#a101-performance-budget-d-05) |
| A11 | Honesty policy (user-facing) | [honesty-policy.md#a11-honesty-policy-user-facing](honesty-policy.md#a11-honesty-policy-user-facing) |
| A11.1 | Blind test (optional demo) | [honesty-policy.md#a111-blind-test-optional-demo](honesty-policy.md#a111-blind-test-optional-demo) |
| A12 | Testing | [testing.md#a12-testing](testing.md#a12-testing) |
| A13 | Plan to 14 Nov | [plan.md#a13-plan-to-14-nov](plan.md#a13-plan-to-14-nov) |
| A14 | Risks and open questions | [risks.md#a14-risks-and-open-questions](risks.md#a14-risks-and-open-questions) |
| A15 | Glossary | [glossary.md#a15-glossary](glossary.md#a15-glossary) |
| A16 | Area search | [linker.md#a16-area-search](linker.md#a16-area-search) |
| A16.1 | Why and who | [linker.md#a161-why-and-who](linker.md#a161-why-and-who) |
| A16.2 | Scope | [linker.md#a162-scope](linker.md#a162-scope) |
| A16.3 | Architecture | [linker.md#a163-architecture](linker.md#a163-architecture) |
| A16.4 | Data flow | [linker.md#a164-data-flow](linker.md#a164-data-flow) |
| A16.5 | Honesty rules | [linker.md#a165-honesty-rules](linker.md#a165-honesty-rules) |
| A16.6 | Open items | [linker.md#a166-open-items](linker.md#a166-open-items) |
| A16.7 | Tickets and plan | [linker.md#a167-tickets-and-plan](linker.md#a167-tickets-and-plan) |
| A17 | Discovery backend | [linker-backend.md#a17-discovery-backend](linker-backend.md#a17-discovery-backend) |
| A17.1 | Area and frames (`frames.py`) | [linker-backend.md#a171-area-and-frames-framespy](linker-backend.md#a171-area-and-frames-framespy) |
| A17.2 | Dots (`dots.py`) | [linker-backend.md#a172-dots-dotspy](linker-backend.md#a172-dots-dotspy) |
| A17.3 | Glitches and stars (`clean.py`) | [linker-backend.md#a173-glitches-and-stars-cleanpy](linker-backend.md#a173-glitches-and-stars-cleanpy) |
| A17.4 | Join across visits (`join.py`) | [linker-backend.md#a174-join-across-visits-joinpy](linker-backend.md#a174-join-across-visits-joinpy) |
| A17.5 | SkyBoT check (`match.py`) | [linker-backend.md#a175-skybot-check-matchpy](linker-backend.md#a175-skybot-check-matchpy) |
| A17.6 | Injection, completeness and control | [linker-backend.md#a176-injection-completeness-and-control](linker-backend.md#a176-injection-completeness-and-control) |
| A17.7 | Export (`export.py`) | [linker-backend.md#a177-export-exportpy](linker-backend.md#a177-export-exportpy) |
| A17.8 | Endpoints (beyond D-16) | [linker-backend.md#a178-endpoints-beyond-d-16](linker-backend.md#a178-endpoints-beyond-d-16) |
| A17.9 | Schemas and fixtures | [linker-backend.md#a179-schemas-and-fixtures](linker-backend.md#a179-schemas-and-fixtures) |
| A17.10 | Cache, offline and determinism | [linker-backend.md#a1710-cache-offline-and-determinism](linker-backend.md#a1710-cache-offline-and-determinism) |
| A17.11 | Compute budget | [linker-backend.md#a1711-compute-budget](linker-backend.md#a1711-compute-budget) |
| A18 | Area search in the sky view | [linker-ui.md#a18-area-search-in-the-sky-view](linker-ui.md#a18-area-search-in-the-sky-view) |
| A18.1 | Tool and drawing | [linker-ui.md#a181-tool-and-drawing](linker-ui.md#a181-tool-and-drawing) |
| A18.2 | Sky layers (`frontend/src/app/sky/area/AreaLayer.tsx`) | [linker-ui.md#a182-sky-layers-frontendsrcappskyareaarealayertsx](linker-ui.md#a182-sky-layers-frontendsrcappskyareaarealayertsx) |
| A18.3 | Visits and blink | [linker-ui.md#a183-visits-and-blink](linker-ui.md#a183-visits-and-blink) |
| A18.4 | Island cards and minimise | [linker-ui.md#a184-island-cards-and-minimise](linker-ui.md#a184-island-cards-and-minimise) |
| A18.5 | Options and Known objects | [linker-ui.md#a185-options-and-known-objects](linker-ui.md#a185-options-and-known-objects) |
| A18.6 | Discovery card | [linker-ui.md#a186-discovery-card](linker-ui.md#a186-discovery-card) |
| A18.7 | Track card | [linker-ui.md#a187-track-card](linker-ui.md#a187-track-card) |
| A18.8 | Hand-off to Track | [linker-ui.md#a188-hand-off-to-track](linker-ui.md#a188-hand-off-to-track) |
| A18.9 | State, API client, accessibility, performance | [linker-ui.md#a189-state-api-client-accessibility-performance](linker-ui.md#a189-state-api-client-accessibility-performance) |
| A18.10 | Testing | [linker-ui.md#a1810-testing](linker-ui.md#a1810-testing) |
