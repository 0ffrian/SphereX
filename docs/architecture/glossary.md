# Glossary

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A15 · **Implements:** [D-02, D-21, D-32](../decisions/contract-tags.md), [Q-132](../decisions/platform-hosting.md), [Q-131, Q-146](../decisions/moving-objects.md) · **Read with:** [sky-shell.md](sky-shell.md) (A21 Names table), [../rendering/README.md](../rendering/README.md)

## A15 Glossary

One meaning per term. Where a word has two meanings, both are listed and the owning section is linked. **"A15" with no article means this section; "the A15", "the A15 laptop" or "the Asus A15 (laptop)" means the laptop.**

**Sky, data and archives**

| Term | Meaning |
|---|---|
| RA / Dec | Sky coordinates, like longitude and latitude on the sky. |
| FITS | The standard astronomy file format. |
| WCS | World Coordinate System, maps pixels to sky positions. |
| Flux | How much light arrives. |
| SIA / TAP | Standard web services for image search and table queries. |
| HiPS | Hierarchical Progressive Survey: an all-sky image cut into tiles by depth. The sky background uses IRSA's 2MASS colour HiPS, with a local copy for the event ([A3.11](object-sources.md#a311-sky-background-irsa-hips), D-35). |
| QR2, QR3, DR1 | SPHEREx data releases: quick releases 2 and 3, and the first full data release (DR1). The event build is frozen on QR2 ([A3.1](data-sources.md#a31-spherex-irsa), Q-137). |
| Frame | One SPHEREx Level-2 image: one detector, one exposure, 2040 × 2040 px ([A3.1](data-sources.md#a31-spherex-irsa)). |
| Cutout | A small square cut from a frame around the target by IRSA's cutout service. The app never downloads whole frames ([A4.1](pipeline.md#a41-stage-1-find-the-object)). |
| Exposure | One SPHEREx shot, about 114 s. It gives one frame per detector, all with the same midpoint. Track's slider steps per exposure; its spectrum has one point per frame ([A20.3](moving-objects/track-ui.md#a203-time)). |
| Visit | Frames of one area or object taken less than `visit_gap_h` apart (start 1 h). Eros: 4 exposures × 2 detectors in 6.4 min, visits 24.4 h apart ([A17.1](moving-objects/area-backend.md#a171-area-and-frames-framespy)). |
| Pass | All the exposures SPHEREx takes of one sky position over consecutive days; its length is an open question (Q-148). |
| SPHEREx-centred | Positions computed as seen from SPHEREx (Horizons observer `500@-163182`), not from the Earth's centre ([A19.4](moving-objects/track.md#a194-positions), Q-138). |
| MOST | IRSA's Moving Object Search Tool. Whether it replaces the cone search for movers is open ([A19.3](moving-objects/track.md#a193-frame-list)). |
| DAMIT | Database of asteroid shape models built from brightness changes. |
| Target group | The `group` of a target in `backend/targets.toml` (test, demo, fixture); pre-fetch and warm start fill the cache per group ([A3.12](targets.md#a312-test-and-demo-targets)). |
| Demo object | Two meanings. (1) **The MVP demo object**: 433 Eros in Track (Q-137). (2) **The demo group**: the quick-pick targets of D-31 ([A3.12](targets.md#a312-test-and-demo-targets)). |

**Values, tags and honesty**

| Term | Meaning |
|---|---|
| ObjectCard | The **data record** of everything known about one object, each value with its provenance tag and source ([R3.2](../rendering/data-contract.md#r32-objectcard-produced-by-the-backend-get-v1objectsidcard)). Not the object card on screen (see below). |
| RenderParams | What the frontend renders: layers, textures, lighting, view modes, haptic profile, alt text, refused layers ([R3.4](../rendering/data-contract.md#r34-renderparams-produced-by-the-backend-get-v1objectsidrender-params)). |
| TV (tagged value) | A value with its tag, source and tier: `TV<T>` ([R3.1](../rendering/data-contract.md#r31-tagged-value)). |
| Provenance tag | One of `measured`, `derived`, `model_dependent`, `inferred_from_analog`, `artistic`, carried by every value and layer ([A5.2](data-contract.md#a52-provenance-tags-and-badges)). |
| Badge | What the UI shows for a tag: **Measured**, **Estimated** (`derived`, `model_dependent`, `inferred_from_analog`) or **Default** (`artistic`) ([A5.2](data-contract.md#a52-provenance-tags-and-badges), D-02). |
| Honesty toggle | One global control with 3 states: Measured only, + Estimated, + Artistic; it filters layers, sounds and haptics by tag ([R5.3](../rendering/display-rules.md#r53-honesty-toggle-3-states), D-21). |
| Tier | Provenance tier 1 to 5 (measured to artistic) of the fall-back chain: a missing value drops one tier and says so (D-32). Not a quality level, not a priority tier (P0 to P3, [A1.1](overview.md#a11-priority-tiers)). |
| Quality level | The viewer's battery and frame-rate level (Low, Medium, High); called a level so it is not confused with a tier ([R5.7](../rendering/display-rules.md#r57-motion-and-time-lapse)). |
| `missing` / refusal code | The list of layers or values the backend refused, each with a code such as `measuring:frames` or `dynamics:<key>` ([A4.12](refusals.md#a412-missing-and-refusal-codes)). |
| Sketch | Asset status of a new object built from SPHEREx data only; labelled "Sketch from SPHEREx only" ([A4.4](pipeline-card.md#a44-stage-4-check-for-a-saved-asset), A11). |
| Candidate | The `candidate` type: a point source with no 3D body ([R7.6](../rendering/renderers/candidate.md#r76-candidate)). |
| Asset | A saved ObjectCard for one body, plus its baked textures if it has any. |

**Backend and pipeline**

| Term | Meaning |
|---|---|
| Object job | The backend job that builds one object's answer in stages and reports progress on `/job` and `/job/events` ([A4.10](jobs.md#a410-object-job-and-fan-out), Q-111). |
| First / partial / final answer | The stages of an object job's answer: from catalogue data, from the first batch of frames, then complete ([A4.10](jobs.md#a410-object-job-and-fan-out)). |
| `measuring:` | A `missing` code prefix meaning "still being measured", sent with an intermediate answer and in `X-SX-Measuring` ([A4.10](jobs.md#a410-object-job-and-fan-out)). |
| Endpoint register | The one list of every HTTP route, built or planned, with its decision ([A4.11](endpoints.md#a411-endpoint-register)). |
| Warm start | At backend start (`SX_PREFETCH_ON_START=1`), build every demo object's card and bake its textures from the cache before visitors arrive ([A10.2](frontend-platform.md#a102-running-the-event-build)). |
| Overlays | Gaia and WISE sources drawn on a frame, with contamination marks ([A4.9](overlays.md#a49-overlays-flag-mask-and-combine)). |
| Flag mask | A PNG of a frame's bad-pixel flags ([A4.9](overlays.md#a49-overlays-flag-mask-and-combine)). |
| Combine | Adding or subtracting frames ([A4.9](overlays.md#a49-overlays-flag-mask-and-combine)). |
| Baked type / shader kind | A **baked type** gets textures from the backend baker ([R6](../rendering/surface-generation.md#r6-surface-generation-backend-cpu)); a **shader kind** (planets, gas giants, nebulae, novae) is drawn by a browser shader ([R7.7](../rendering/renderers/shader-kinds.md#r77-shader-generated-kinds-planet_rocky-planet_water-gas_giant-nebula-nova)). |
| Triplanar mapping | Texture lookup from three axes, so it does not stretch. |
| Equirectangular | A map where columns are longitude and rows are latitude, wrapped onto a sphere. The baked maps use it ([R6.1](../rendering/surface-generation.md#r61-strategy-height-first-colour-second)). |
| Rhines scale | Size at which a flow turns into zonal jets on a spinning planet. |
| Sedov-Taylor | A blast wave law for the early life of a supernova remnant. |

**App shell and views** (names fixed by the A21 [Names table](sky-shell.md#a21-app-shell-and-sky-view))

| Term | Meaning |
|---|---|
| Sky view | The default pane: the full-bleed all-sky image with markers ([A21.6](sky-shell-surfaces.md#a216-sky-interaction), [A21.7](sky-shell-surfaces.md#a217-sky-image-credit-never-blank)). |
| Shell | The frame of the app: bezel, rail, island, sky view, panels, split pane, transport, search pill ([A21](sky-shell.md#a21-app-shell-and-sky-view)). |
| Rail | The tool buttons on the left; each sets a `ToolId` ([A21.4](sky-shell.md#a214-tool-rail-and-toolid)). |
| Island | The orb at the top centre: idle circle, Thinking pill, then the box that travels into the object panel ([A21.5](sky-shell-surfaces.md#a215-overlay-surfaces-island-object-panel-object-card)). Not the mock-up's island card. |
| Object panel | The floating panel the Flipbook and Spectrum tools open ([A21.5](sky-shell-surfaces.md#a215-overlay-surfaces-island-object-panel-object-card)). |
| Object card | The **UI card** at the top centre, asked for with a right-click (See fingerprint, Build it); `SelectedCard.tsx` ([A21.5](sky-shell-surfaces.md#a215-overlay-surfaces-island-object-panel-object-card)). Not the ObjectCard data. |
| Feature card | A tool's own card in the object card's slot, such as the Area cards; proposed ([A21.5](sky-shell-surfaces.md#a215-overlay-surfaces-island-object-panel-object-card), [A18.4](moving-objects/area-ui.md#a184-cards-and-minimise)). |
| Split pane | The layout where the sky takes the left side and a pane the right; one occupant at a time ([A21.8](sky-shell-behaviour.md#a218-split-pane)). |
| Build pane | The split pane's 3D view that moulds the body ([R5.8](../rendering/build-mould.md#r58-build-split-view-and-moulding)). |
| Build it | The action that opens the build pane for the selected object ([R5.8](../rendering/build-mould.md#r58-build-split-view-and-moulding)). |
| Moulding | The build animation: the body's real render plan revealed step by step; `PlanContext.hold` holds later steps' layers ([R5.8](../rendering/build-mould.md#r58-build-split-view-and-moulding)). |
| Transport | The flipbook's play controls ([A21.9](sky-shell-behaviour.md#a219-transport-session-search-pill)). |
| Search pill | The name search box ([A21.9](sky-shell-behaviour.md#a219-transport-session-search-pill)). |
| Readout, credit | The text readout in the top bar (`Readout.tsx`, not a live region); the survey credit line on the sky ([A21.7](sky-shell-surfaces.md#a217-sky-image-credit-never-blank)). |
| Markers, brackets | Object buttons on the sky, and the corner brackets round the selected one ([A21.6](sky-shell-surfaces.md#a216-sky-interaction)). |
| Insets, safe rectangle | Insets: the space kept clear of the rail, the top bar, the bottom bar and a 16 px right margin (desktop only). Safe rectangle: the sky minus the insets, the credit and an open object panel or card ([A21.2](sky-shell.md#a212-layout-insets-safe-rectangle-z-order)). |
| Flipbook | Plays an object's cutouts in time order, with a spectrum ([A4.1](pipeline.md#a41-stage-1-find-the-object), [R4](../rendering/display-rules.md#r4-display-levels)). |
| Rainbow Trails | A flipbook view mode: dots coloured by wavelength, a `derived` false colour (D-28). |
| Wavelength tint, composite | Flipbook colour views: each frame tinted by its wavelength, or one RGB picture from three frames; both `derived` ([R4](../rendering/display-rules.md#r4-display-levels), Q-93). |
| Sky Sculptor | Milestone M2: the 3D body from the ObjectCard and RenderParams, shown in the build pane ([A1.1](overview.md#a11-priority-tiers)). |

**Sound and haptics**

| Term | Meaning |
|---|---|
| Event / after the event | The event build runs in a desktop browser on the A15 laptop with sound only; phones and vibration come after the event (Q-132). |
| Haptics | Touch and sound feedback that encodes a surface or a value. At the event, sound only (Q-132); phone vibration after it ([R8](../rendering/haptics/platform-encoding.md#r8-haptics)). |
| Texture / data haptics | Feedback from the surface under the pointer, or from a data value such as a spectrum ([R8.2](../rendering/haptics/platform-encoding.md#r82-two-kinds-of-haptics-both-labelled-in-the-ui)). |
| Feel mode | Desktop mode of the build pane: a mouse drag feels the body instead of turning it ([R5.6](../rendering/display-rules.md#r56-interaction)); proposed (Q-173), not built. |
| Touch mode | The phone mode (after the event): one finger feels, two fingers rotate ([R5.6](../rendering/display-rules.md#r56-interaction)). |
| Body tone | One continuous tone that follows the height under the pointer while feeling a body ([R8.9.1](../rendering/haptics/audio-pairing.md#r891-body-tone-from-the-height-map-q-133), Q-133). |
| Tone stream | The engine API for sustained sounds whose pitch, gain and pan change while they play; proposed ([R8.8](../rendering/haptics/engine-api.md#r88-engine-api)). |
| Listen / data sweep | Plays the spectrum as pitch, short to long wavelength ([A8](sound-voice.md#a8-sound-and-voice), [R8.6](../rendering/haptics/profiles.md#r86-spectrum-haptics-every-object-the-most-useful-for-blind-and-low-vision-users)). |
| Imagined drive | A backlog sound labelled "Imagined"; mock-up only ([A8](sound-voice.md#a8-sound-and-voice)). |
| Hear the Shift | Track's sound: one tick per exposure, a path voice and a reference click ([R8.9.2](../rendering/haptics/audio-pairing.md#r892-track-path-sound-q-134), Q-134). |
| Path voice, reference click | The soft continuous voice for the Horizons path (`model_dependent`, silent in Measured only) and the quiet tempo click of Hear the Shift ([R8.9.2](../rendering/haptics/audio-pairing.md#r892-track-path-sound-q-134)). |

**Moving objects: Track and Area search**

| Term | Meaning |
|---|---|
| Track (the Track tool) | **"Track" alone always means the tool:** one known object's path, its SPHEREx frames, zoom and spectrum hop by hop, in the split pane ([A19](moving-objects/track.md#a19-track), [A20](moving-objects/track-ui.md#a20-track-in-the-sky-view), Q-131). |
| Area search | One tool: draw a square on the sky, then Known objects or Discovery ([A16](moving-objects/area-search.md#a16-area-search), Q-146). |
| Area | A precomputed square region with time windows, in `targets.toml` as `[[area]]` ([A16.4](moving-objects/area-search.md#a164-data-flow)). |
| Known objects | Asteroids and comets on file that crossed the square while SPHEREx looked; **Track it** opens Track ([A16](moving-objects/area-search.md#a16-area-search)). |
| Discovery | The offline search of an area's frames for things that move ([A17](moving-objects/area-backend.md#a17-discovery-backend)). |
| Dot | A source found in one frame by Discovery ([A17.2](moving-objects/area-backend.md#a172-dots-dotspy)). |
| Mover-to-be | A dot that repeats in its visit, is not fixed in both visits, and is not a tracklet staying on one catalogue star ([A17.3](moving-objects/area-backend.md#a173-glitches-stars-and-fixed-dots-cleanpy)). |
| Tracklet | Movers-to-be inside one visit that fall on a straight line in time ([A17.4](moving-objects/area-backend.md#a174-join-across-visits-joinpy)). |
| Discovery track | Tracklets in different visits joined into one path (was "Track (Discovery)"). Labels per [A16.5](moving-objects/area-search.md#a165-honesty-rules): "found blind = (designation)" when the known-object check names it, "unexplained" when nothing matches (a lead, not a discovery), "not checked" when the check failed; a tracklet with no single partner is "possible". |
| Result card | The card for one Discovery track (was "Track card") ([A18.7](moving-objects/area-ui.md#a187-result-card)). |
| Completeness | The fraction of injected fake movers recovered, by magnitude. Phase 2, not in the event build ([A17.6](moving-objects/area-backend.md#a176-injection-completeness-and-control)). |
| ADES | The Minor Planet Center's format for reporting astrometry; phase 2. |
