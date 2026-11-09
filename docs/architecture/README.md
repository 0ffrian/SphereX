# Architecture Spec: Shift & Spectrum

NASA Space Apps 2026, Port Louis (14 to 15 Nov 2026). Challenge: **Planet X and SPHEREx**.
Status of this document: v3, as of 9 Nov 2026. It records the direction agreed with the team, the findings from the tests run so far, and the decisions in [decisions/](../decisions/README.md). The event build runs in a desktop browser on the Asus A15 laptop (Q-132); phones come after the event. Terms: [glossary](glossary.md) (A15).

**Precedence:** [decisions/](../decisions/README.md) > [rendering/README.md](../rendering/README.md) ("the rendering doc") for its scope (display, surfaces, haptics, audio pairing) > this doc. Where the rendering doc is the authority, this doc only summarises and points to it.

**Status labels.** Every claim or table row carries one of these labels:

| Label | Meaning |
|---|---|
| **Built** | In the code on `main`. A qualifier names where: **Built (app)**, **Built (viewer)**, **Built (baker)**. |
| **Built against fixtures** | Built and tested on recorded data only; not yet run on live archive calls. |
| **Tested** | We called the service or ran the code and it worked. |
| **Documented** | Only an official page says so. We have not run it. |
| **To build** | Agreed and planned; no code yet. |
| **Not built yet** | The spec states the rule; the code still does something else (the line names the file). |
| **Mock-up only** | Shown in `mockup/` only; not a spec (D-01). |
| **Proposed** | Waits for a decision entry; do not build on it without one. |

## Fragments

Load only the fragment you need. Section numbers are prefixed with `A` ("architecture spec §7.2" = `A7.2`). The decisions each fragment implements are linked in its header line.

| File | Sections | Load this when… |
|---|---|---|
| [overview.md](overview.md) | A1–A2.1 | you need the scope (sky view, flipbook, Build it, Track, Area search), priority tiers and their status, the system diagram or the design principles |
| [data-sources.md](data-sources.md) | A3–A3.5 | you call or adapt SPHEREx/IRSA, Gaia, WISE, Horizons or SkyBoT |
| [object-sources.md](object-sources.md) | A3.6–A3.11 | you call or adapt SBDB, DAMIT, the Exoplanet Archive, SIMBAD, mission shape models or the IRSA HiPS sky background |
| [targets.md](targets.md) | A3.12 | you pick or change test, demo or fixture targets (433 Eros is the MVP, Q-137), or the warm-start groups |
| [pipeline.md](pipeline.md) | A4–A4.2 | you build stage 1 (find the object, frames, moving objects) or stage 2 (brightness and spectrum) |
| [pipeline-card.md](pipeline-card.md) | A4.3–A4.8 | you build stages 3 to 10: classify, asset lookup and version constants, ObjectCard, physics layer, RenderParams, generators |
| [overlays.md](overlays.md) | A4.9 | you work on the Gaia/WISE overlays, contamination, the flag mask or combine frames |
| [jobs.md](jobs.md) | A4.10 | you work on the object job: first, partial and final answers, `measuring:` fields, `/job` and `/job/events`, fan-out, bakes, warm start |
| [endpoints.md](endpoints.md) | A4.11 | you add, change or call any HTTP route; the error envelope, error codes and `X-SX-*` headers |
| [refusals.md](refusals.md) | A4.12 | you emit or show a `missing` / refusal code, or write its UI wording |
| [data-contract.md](data-contract.md) | A5–A5.4 | you touch generated contract code, ids and seeds, provenance tags and badges, slider overrides or the asset store |
| [generators.md](generators.md) | A6–A6.3 | you work on how each type is drawn, triplanar mapping, the Gemini layer or offline jobs |
| [physics.md](physics.md) | A7–A7.5 | you implement a physics rule or slider for planets, gas giants, brown dwarfs, asteroids or supernova remnants |
| [sound-voice.md](sound-voice.md) | A8 | you work on the data sweep (Listen), the body tone, the Track path sound, imagined drive or the (backlog) voice |
| [haptics.md](haptics.md) | A9–A9.5 | you need the summary of haptics: sound at the event, vibration after it, what is felt per type, the honesty rule |
| [frontend-platform.md](frontend-platform.md) | A10–A10.2 | you set up the build, UI stack, three.js, state, backend stack, proxy, hosting or caching; check the performance budget; or run the event build on the A15 laptop |
| [honesty-policy.md](honesty-policy.md) | A11–A11.1 | you add user-facing labels, badges, the honesty toggle, demo caveats or the blind-test demo |
| [testing.md](testing.md) | A12 | you write or plan tests for any layer, or need the CI jobs |
| [plan.md](plan.md) | A13 | you need the status board per milestone, the remaining days and the Track and Area tickets |
| [risks.md](risks.md) | A14–A14.1 | you need the risk register, or the register of open **[verify]** items with owner and deadline |
| [glossary.md](glossary.md) | A15 | you meet an unfamiliar term |
| [moving-objects/area-search.md](moving-objects/area-search.md) | A16–A16.7 | you work on Area search (Q-146): draw a square, then Known objects (hand-off to Track) or Discovery; scope, architecture, honesty rules, measured Eros facts, tickets D1 to D3 |
| [moving-objects/area-backend.md](moving-objects/area-backend.md) | A17–A17.11 | you build the Discovery backend: area frames and visits, dots, glitches/stars/fixed dots, the parallax-aware join, the known-object check, `/v1/areas`, schemas, cache |
| [moving-objects/area-ui.md](moving-objects/area-ui.md) | A18–A18.10 | you build Area search in the sky view: drawing, sky layers, visits and blink, feature cards and minimise, Result card, hand-off to Track, state, tests |
| [moving-objects/track.md](moving-objects/track.md) | A19–A19.8 | you build Track data: scope, entry points, frame list, SPHEREx-centred positions, `/path`, star list and photometry for movers, extended sources |
| [moving-objects/track-contract.md](moving-objects/track-contract.md) | A19.9–A19.15 | you build the Track export (ECSV), its refusal codes, provenance per value, cache and pre-fetch, contract, owners, tickets T1 to T4, tests |
| [moving-objects/track-ui.md](moving-objects/track-ui.md) | A20–A20.15 | you build the Track screen in the split pane: time slider, path on the sky, detail view and imagery, zoom, spectrum hop by hop, spin slider, sound controls, honesty, states, R9, files, tests |
| [sky-shell.md](sky-shell.md) | A21–A21.4 | you change the app shell: names of the surfaces, status and sources, layout, insets, z-order, phone width, the rail and `ToolId` |
| [sky-shell-surfaces.md](sky-shell-surfaces.md) | A21.5–A21.7 | you change the island, object panel or object card, sky interaction (drag, wheel, keys, clicks, picking), or the sky image and credit |
| [sky-shell-behaviour.md](sky-shell-behaviour.md) | A21.8–A21.13 | you change the split pane (Build, Track), transport, search pill, keys and Escape, URL hash and history, live regions, or add a tool or a sky layer |

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
| A3.6 | JPL Small-Body Database | [object-sources.md#a36-jpl-small-body-database](object-sources.md#a36-jpl-small-body-database) |
| A3.7 | DAMIT | [object-sources.md#a37-damit](object-sources.md#a37-damit) |
| A3.8 | NASA Exoplanet Archive | [object-sources.md#a38-nasa-exoplanet-archive](object-sources.md#a38-nasa-exoplanet-archive) |
| A3.9 | Not used for the base path | [object-sources.md#a39-not-used-for-the-base-path](object-sources.md#a39-not-used-for-the-base-path) |
| A3.10 | Added for the object view | [object-sources.md#a310-added-for-the-object-view](object-sources.md#a310-added-for-the-object-view) |
| A3.11 | Sky background (IRSA HiPS) | [object-sources.md#a311-sky-background-irsa-hips](object-sources.md#a311-sky-background-irsa-hips) |
| A3.12 | Test and demo targets | [targets.md#a312-test-and-demo-targets](targets.md#a312-test-and-demo-targets) |
| A4 | Pipeline | [pipeline.md#a4-pipeline](pipeline.md#a4-pipeline) |
| A4.1 | Stage 1: Find the object | [pipeline.md#a41-stage-1-find-the-object](pipeline.md#a41-stage-1-find-the-object) |
| A4.2 | Stage 2: Measure brightness and spectrum | [pipeline.md#a42-stage-2-measure-brightness-and-spectrum](pipeline.md#a42-stage-2-measure-brightness-and-spectrum) |
| A4.3 | Stage 3: Classify and pick a type | [pipeline-card.md#a43-stage-3-classify-and-pick-a-type](pipeline-card.md#a43-stage-3-classify-and-pick-a-type) |
| A4.4 | Stage 4: Check for a saved asset | [pipeline-card.md#a44-stage-4-check-for-a-saved-asset](pipeline-card.md#a44-stage-4-check-for-a-saved-asset) |
| A4.5 | Stage 5: ObjectCard | [pipeline-card.md#a45-stage-5-objectcard](pipeline-card.md#a45-stage-5-objectcard) |
| A4.6 | Stage 6: Physics layer | [pipeline-card.md#a46-stage-6-physics-layer](pipeline-card.md#a46-stage-6-physics-layer) |
| A4.7 | Stage 7: RenderParams | [pipeline-card.md#a47-stage-7-renderparams](pipeline-card.md#a47-stage-7-renderparams) |
| A4.8 | Stages 8 to 10: Generators | [pipeline-card.md#a48-stages-8-to-10-generators](pipeline-card.md#a48-stages-8-to-10-generators) |
| A4.9 | Overlays, flag mask and combine | [overlays.md#a49-overlays-flag-mask-and-combine](overlays.md#a49-overlays-flag-mask-and-combine) |
| A4.10 | Object job and fan-out | [jobs.md#a410-object-job-and-fan-out](jobs.md#a410-object-job-and-fan-out) |
| A4.11 | Endpoint register | [endpoints.md#a411-endpoint-register](endpoints.md#a411-endpoint-register) |
| A4.12 | `missing` and refusal codes | [refusals.md#a412-missing-and-refusal-codes](refusals.md#a412-missing-and-refusal-codes) |
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
| A10.2 | Running the event build | [frontend-platform.md#a102-running-the-event-build](frontend-platform.md#a102-running-the-event-build) |
| A11 | Honesty policy (user-facing) | [honesty-policy.md#a11-honesty-policy-user-facing](honesty-policy.md#a11-honesty-policy-user-facing) |
| A11.1 | Blind test (optional demo) | [honesty-policy.md#a111-blind-test-optional-demo](honesty-policy.md#a111-blind-test-optional-demo) |
| A12 | Testing | [testing.md#a12-testing](testing.md#a12-testing) |
| A13 | Plan to 14 Nov | [plan.md#a13-plan-to-14-nov](plan.md#a13-plan-to-14-nov) |
| A14 | Risks and open questions | [risks.md#a14-risks-and-open-questions](risks.md#a14-risks-and-open-questions) |
| A14.1 | [verify] register | [risks.md#a141-verify-register](risks.md#a141-verify-register) |
| A15 | Glossary | [glossary.md#a15-glossary](glossary.md#a15-glossary) |
| A16 | Area search | [moving-objects/area-search.md#a16-area-search](moving-objects/area-search.md#a16-area-search) |
| A16.1 | Why and who | [moving-objects/area-search.md#a161-why-and-who](moving-objects/area-search.md#a161-why-and-who) |
| A16.2 | Scope | [moving-objects/area-search.md#a162-scope](moving-objects/area-search.md#a162-scope) |
| A16.3 | Architecture | [moving-objects/area-search.md#a163-architecture](moving-objects/area-search.md#a163-architecture) |
| A16.4 | Data flow | [moving-objects/area-search.md#a164-data-flow](moving-objects/area-search.md#a164-data-flow) |
| A16.5 | Honesty rules | [moving-objects/area-search.md#a165-honesty-rules](moving-objects/area-search.md#a165-honesty-rules) |
| A16.6 | Open items and measured facts | [moving-objects/area-search.md#a166-open-items-and-measured-facts](moving-objects/area-search.md#a166-open-items-and-measured-facts) |
| A16.7 | Tickets and plan | [moving-objects/area-search.md#a167-tickets-and-plan](moving-objects/area-search.md#a167-tickets-and-plan) |
| A17 | Discovery backend | [moving-objects/area-backend.md#a17-discovery-backend](moving-objects/area-backend.md#a17-discovery-backend) |
| A17.1 | Area and frames (`frames.py`) | [moving-objects/area-backend.md#a171-area-and-frames-framespy](moving-objects/area-backend.md#a171-area-and-frames-framespy) |
| A17.2 | Dots (`dots.py`) | [moving-objects/area-backend.md#a172-dots-dotspy](moving-objects/area-backend.md#a172-dots-dotspy) |
| A17.3 | Glitches, stars and fixed dots (`clean.py`) | [moving-objects/area-backend.md#a173-glitches-stars-and-fixed-dots-cleanpy](moving-objects/area-backend.md#a173-glitches-stars-and-fixed-dots-cleanpy) |
| A17.4 | Join across visits (`join.py`) | [moving-objects/area-backend.md#a174-join-across-visits-joinpy](moving-objects/area-backend.md#a174-join-across-visits-joinpy) |
| A17.5 | Known-object check (`match.py`) | [moving-objects/area-backend.md#a175-known-object-check-matchpy](moving-objects/area-backend.md#a175-known-object-check-matchpy) |
| A17.6 | Injection, completeness and control | [moving-objects/area-backend.md#a176-injection-completeness-and-control](moving-objects/area-backend.md#a176-injection-completeness-and-control) |
| A17.7 | Export | [moving-objects/area-backend.md#a177-export](moving-objects/area-backend.md#a177-export) |
| A17.8 | Endpoints | [moving-objects/area-backend.md#a178-endpoints](moving-objects/area-backend.md#a178-endpoints) |
| A17.9 | Schemas and fixtures | [moving-objects/area-backend.md#a179-schemas-and-fixtures](moving-objects/area-backend.md#a179-schemas-and-fixtures) |
| A17.10 | Cache, offline and determinism | [moving-objects/area-backend.md#a1710-cache-offline-and-determinism](moving-objects/area-backend.md#a1710-cache-offline-and-determinism) |
| A17.11 | Compute budget | [moving-objects/area-backend.md#a1711-compute-budget](moving-objects/area-backend.md#a1711-compute-budget) |
| A18 | Area search in the sky view | [moving-objects/area-ui.md#a18-area-search-in-the-sky-view](moving-objects/area-ui.md#a18-area-search-in-the-sky-view) |
| A18.1 | Tool and drawing | [moving-objects/area-ui.md#a181-tool-and-drawing](moving-objects/area-ui.md#a181-tool-and-drawing) |
| A18.2 | Sky layers (`frontend/src/app/sky/area/AreaLayer.tsx`) | [moving-objects/area-ui.md#a182-sky-layers-frontendsrcappskyareaarealayertsx](moving-objects/area-ui.md#a182-sky-layers-frontendsrcappskyareaarealayertsx) |
| A18.3 | Visits and blink | [moving-objects/area-ui.md#a183-visits-and-blink](moving-objects/area-ui.md#a183-visits-and-blink) |
| A18.4 | Cards and minimise | [moving-objects/area-ui.md#a184-cards-and-minimise](moving-objects/area-ui.md#a184-cards-and-minimise) |
| A18.5 | Options and Known objects | [moving-objects/area-ui.md#a185-options-and-known-objects](moving-objects/area-ui.md#a185-options-and-known-objects) |
| A18.6 | Discovery card | [moving-objects/area-ui.md#a186-discovery-card](moving-objects/area-ui.md#a186-discovery-card) |
| A18.7 | Result card | [moving-objects/area-ui.md#a187-result-card](moving-objects/area-ui.md#a187-result-card) |
| A18.8 | Hand-off to Track | [moving-objects/area-ui.md#a188-hand-off-to-track](moving-objects/area-ui.md#a188-hand-off-to-track) |
| A18.9 | State, API client, accessibility, performance | [moving-objects/area-ui.md#a189-state-api-client-accessibility-performance](moving-objects/area-ui.md#a189-state-api-client-accessibility-performance) |
| A18.10 | Testing | [moving-objects/area-ui.md#a1810-testing](moving-objects/area-ui.md#a1810-testing) |
| A19 | Track | [moving-objects/track.md#a19-track](moving-objects/track.md#a19-track) |
| A19.1 | Scope | [moving-objects/track.md#a191-scope](moving-objects/track.md#a191-scope) |
| A19.2 | Entry points | [moving-objects/track.md#a192-entry-points](moving-objects/track.md#a192-entry-points) |
| A19.3 | Frame list | [moving-objects/track.md#a193-frame-list](moving-objects/track.md#a193-frame-list) |
| A19.4 | Positions | [moving-objects/track.md#a194-positions](moving-objects/track.md#a194-positions) |
| A19.5 | Path endpoint | [moving-objects/track.md#a195-path-endpoint](moving-objects/track.md#a195-path-endpoint) |
| A19.6 | Star list for movers | [moving-objects/track.md#a196-star-list-for-movers](moving-objects/track.md#a196-star-list-for-movers) |
| A19.7 | Photometry for movers | [moving-objects/track.md#a197-photometry-for-movers](moving-objects/track.md#a197-photometry-for-movers) |
| A19.8 | Extended sources | [moving-objects/track.md#a198-extended-sources](moving-objects/track.md#a198-extended-sources) |
| A19.9 | Export | [moving-objects/track-contract.md#a199-export](moving-objects/track-contract.md#a199-export) |
| A19.10 | Refusal codes | [moving-objects/track-contract.md#a1910-refusal-codes](moving-objects/track-contract.md#a1910-refusal-codes) |
| A19.11 | Provenance per value | [moving-objects/track-contract.md#a1911-provenance-per-value](moving-objects/track-contract.md#a1911-provenance-per-value) |
| A19.12 | Cache, offline and pre-fetch | [moving-objects/track-contract.md#a1912-cache-offline-and-pre-fetch](moving-objects/track-contract.md#a1912-cache-offline-and-pre-fetch) |
| A19.13 | Contract | [moving-objects/track-contract.md#a1913-contract](moving-objects/track-contract.md#a1913-contract) |
| A19.14 | Owners, tickets and tests | [moving-objects/track-contract.md#a1914-owners-tickets-and-tests](moving-objects/track-contract.md#a1914-owners-tickets-and-tests) |
| A19.15 | Open items | [moving-objects/track-contract.md#a1915-open-items](moving-objects/track-contract.md#a1915-open-items) |
| A20 | Track in the sky view | [moving-objects/track-ui.md#a20-track-in-the-sky-view](moving-objects/track-ui.md#a20-track-in-the-sky-view) |
| A20.1 | Where Track lives | [moving-objects/track-ui.md#a201-where-track-lives](moving-objects/track-ui.md#a201-where-track-lives) |
| A20.2 | Layout | [moving-objects/track-ui.md#a202-layout](moving-objects/track-ui.md#a202-layout) |
| A20.3 | Time | [moving-objects/track-ui.md#a203-time](moving-objects/track-ui.md#a203-time) |
| A20.4 | Path on the sky | [moving-objects/track-ui.md#a204-path-on-the-sky](moving-objects/track-ui.md#a204-path-on-the-sky) |
| A20.5 | Detail view and imagery | [moving-objects/track-ui.md#a205-detail-view-and-imagery](moving-objects/track-ui.md#a205-detail-view-and-imagery) |
| A20.6 | Zoom | [moving-objects/track-ui.md#a206-zoom](moving-objects/track-ui.md#a206-zoom) |
| A20.7 | Spectrum, hop by hop | [moving-objects/track-ui.md#a207-spectrum-hop-by-hop](moving-objects/track-ui.md#a207-spectrum-hop-by-hop) |
| A20.8 | Spin slider | [moving-objects/track-ui.md#a208-spin-slider](moving-objects/track-ui.md#a208-spin-slider) |
| A20.9 | Sound | [moving-objects/track-ui.md#a209-sound](moving-objects/track-ui.md#a209-sound) |
| A20.10 | Honesty toggle | [moving-objects/track-ui.md#a2010-honesty-toggle](moving-objects/track-ui.md#a2010-honesty-toggle) |
| A20.11 | States | [moving-objects/track-ui.md#a2011-states](moving-objects/track-ui.md#a2011-states) |
| A20.12 | Accessibility (R9) | [moving-objects/track-ui.md#a2012-accessibility-r9](moving-objects/track-ui.md#a2012-accessibility-r9) |
| A20.13 | State, API and files | [moving-objects/track-ui.md#a2013-state-api-and-files](moving-objects/track-ui.md#a2013-state-api-and-files) |
| A20.14 | Performance | [moving-objects/track-ui.md#a2014-performance](moving-objects/track-ui.md#a2014-performance) |
| A20.15 | Tests and tickets | [moving-objects/track-ui.md#a2015-tests-and-tickets](moving-objects/track-ui.md#a2015-tests-and-tickets) |
| A21 | App shell and sky view | [sky-shell.md#a21-app-shell-and-sky-view](sky-shell.md#a21-app-shell-and-sky-view) |
| A21.1 | Status and sources | [sky-shell.md#a211-status-and-sources](sky-shell.md#a211-status-and-sources) |
| A21.2 | Layout, insets, safe rectangle, z-order | [sky-shell.md#a212-layout-insets-safe-rectangle-z-order](sky-shell.md#a212-layout-insets-safe-rectangle-z-order) |
| A21.3 | Phone width (≤ 640 px) | [sky-shell.md#a213-phone-width--640-px](sky-shell.md#a213-phone-width--640-px) |
| A21.4 | Tool rail and ToolId | [sky-shell.md#a214-tool-rail-and-toolid](sky-shell.md#a214-tool-rail-and-toolid) |
| A21.5 | Overlay surfaces (island, object panel, object card) | [sky-shell-surfaces.md#a215-overlay-surfaces-island-object-panel-object-card](sky-shell-surfaces.md#a215-overlay-surfaces-island-object-panel-object-card) |
| A21.6 | Sky interaction | [sky-shell-surfaces.md#a216-sky-interaction](sky-shell-surfaces.md#a216-sky-interaction) |
| A21.7 | Sky image, credit, never blank | [sky-shell-surfaces.md#a217-sky-image-credit-never-blank](sky-shell-surfaces.md#a217-sky-image-credit-never-blank) |
| A21.8 | Split pane | [sky-shell-behaviour.md#a218-split-pane](sky-shell-behaviour.md#a218-split-pane) |
| A21.9 | Transport, session, search pill | [sky-shell-behaviour.md#a219-transport-session-search-pill](sky-shell-behaviour.md#a219-transport-session-search-pill) |
| A21.10 | Keyboard and Escape | [sky-shell-behaviour.md#a2110-keyboard-and-escape](sky-shell-behaviour.md#a2110-keyboard-and-escape) |
| A21.11 | URL hash and history | [sky-shell-behaviour.md#a2111-url-hash-and-history](sky-shell-behaviour.md#a2111-url-hash-and-history) |
| A21.12 | Live regions and accessibility | [sky-shell-behaviour.md#a2112-live-regions-and-accessibility](sky-shell-behaviour.md#a2112-live-regions-and-accessibility) |
| A21.13 | Adding a tool or a sky layer | [sky-shell-behaviour.md#a2113-adding-a-tool-or-a-sky-layer](sky-shell-behaviour.md#a2113-adding-a-tool-or-a-sky-layer) |
