# Decision log

Decisions that reconcile the [architecture spec](../architecture/README.md) with the [rendering & haptics spec](../rendering/README.md). Where an entry in this log states a decision, it wins over both. "Architecture spec §x" means section **Ax** and "rendering doc §x" means **Rx**; each spec index has a section map.

Format: one entry per decision. Status is **Accepted** unless marked otherwise. Recorded 4 Nov 2026.

## How to use this folder

The log is split by topic so a task loads only what it needs. **Load this index first** (it is short), then only the topic files your task touches. The routing table in [docs/README.md](../README.md#what-to-load-for-a-task) names them per task.

| File | Holds | Size |
|---|---|---|
| [scope-process.md](scope-process.md) | scope cuts, doc layout, owners, build dates, milestones, the post-event backlog, the demo object and data release, ID reservations | 6 D, 10 Q, 13 KB |
| [contract.md](contract.md) | the data contract, object types, the endpoint list (D-16), schemas and generated types, saved assets, `overrides`, card and fixture shapes, cached replies | 6 D, 17 Q, 18 KB |
| [contract-tags.md](contract-tags.md) | provenance tags and badges, the honesty toggle, tier fallback, the policy for unverified constants (Q-110, Q-119), "which tag does X get" | 3 D, 12 Q, 19 KB |
| [data-sources.md](data-sources.md) | the backend framework, external archives and adapters, name resolving, the read-through cache and offline mode, test targets, overlays and the composite backends | 4 D, 16 Q, 22 KB |
| [pipeline-stages.md](pipeline-stages.md) | stages 3 to 7 as built, measurement choices, physics in stage 6, the Sun angle for SBDB bodies, the exoplanet adapter and type rule, the confidence score and 3D gate | 0 D, 11 Q, 20 KB |
| [pipeline-jobs.md](pipeline-jobs.md) | shape models and their serving, where generated assets are saved, the live cutout budget, object jobs, fan-out and progress endpoints | 0 D, 6 Q, 14 KB |
| [rendering-bodies.md](rendering-bodies.md) | where surfaces are generated, the baker, renderers per type, physics sliders, accuracy, golden images, the honest fixtures (Q-114), stars, worlds and gas giants on the TSL path, reference objects | 4 D, 60 Q, 63 KB (over the target; split pending) |
| [rendering-engines.md](rendering-engines.md) | D-37: the prototype world, star and rock engines on raw WebGL2, the + Artistic gate (Q-287), the three.js fallback, determinism exemption, the engine port and hosting streams | 1 D, 19 Q, 23 KB |
| [rendering-engines-review.md](rendering-engines-review.md) | the PR #89 review fixes to the engines: star, world, gas giant, rock, and the verbatim convention with reviewed deviations | 0 D, 5 Q, 10 KB |
| [rendering-motion.md](rendering-motion.md) | motion, time-lapse, render-on-change, quality levels, tone mapping, golden frames, process gating and tier wording | 1 D, 5 Q, 9 KB |
| [rendering-kinds.md](rendering-kinds.md) | shapes and volumes, animated sphere bodies, flattening, and the Q-107 visual findings and fix notes, the comet emissions and tail (Q-260 to Q-263, Q-333), the flattening disagreement (Q-332) | 0 D, 10 Q, 22 KB |
| [rendering-layers.md](rendering-layers.md) | the per-layer body fixes of issue #62 (PR #63): gas giant five tiered layers, brown dwarf limb and infrared bands, asteroid sphere and displacement, the flared T Tauri disc | 0 D, 4 Q, 11 KB |
| [gemini.md](gemini.md) | the Gemini layer: scope, offline behaviour and its contract | 1 D, 2 Q, 7 KB |
| [sky-shell.md](sky-shell.md) | the sky view, sky endpoints and sky tiles, the flipbook UI | 1 D, 10 Q, 12 KB |
| [shell-surfaces.md](shell-surfaces.md) | the tool rail and the island, the object panel and card, the Build split view, the full-bleed layout | 0 D, 5 Q, 13 KB |
| [shell-proposals.md](shell-proposals.md) | open shell proposals that Track and Area search need: pane kinds, feature cards, hash keys, Escape order | 0 D, 9 Q, 15 KB |
| [haptics-design.md](haptics-design.md) | haptics design rules, creative ownership, the haptics API, the shared field on shader kinds, texture and data sources per type | 5 D, 12 Q, 20 KB |
| [haptics-sound.md](haptics-sound.md) | audio pairing (D-10), spectrum pitch and voice hints, the body tone and the Track path sound | 1 D, 10 Q, 13 KB |
| [haptics-built.md](haptics-built.md) | the haptic engine, calibration and source choices as built | 0 D, 9 Q, 20 KB |
| [platform-hosting.md](platform-hosting.md) | the three.js pin, hardware and frame budgets, hosting, the demo machine and the event platform | 3 D, 5 Q, 7 KB |
| [moving-objects.md](moving-objects.md) | Rainbow Trails, the Track tool, Area search and Discovery (agreed) | 1 D, 17 Q, 23 KB |
| [moving-objects-review.md](moving-objects-review.md) | proposed fixes to Area search and Track after the 9 Nov 2026 audit, and Moon's review list (Q-202) | 0 D, 9 Q, 16 KB |
| [moving-frames.md](moving-frames.md) | frames for moving objects: the path cone search, its tags and refusals, MOST | 0 D, 4 Q, 8 KB |
| [exoplanets.md](exoplanets.md) | the exoplanet card fields (mass, orbit, host star), radius from the archive, tidal locking, mass in the physics layer, and the two demo exoplanet fixtures | 0 D, 5 Q, 15 KB |
| [exoplanet-looks.md](exoplanet-looks.md) | the climate scenarios and locked-planet temperature map, starlight colour, scenario looks and presets, and the exoplanet mould steps | 0 D, 5 Q, 15 KB |
| [catalogue-values.md](catalogue-values.md) | name resolution for the demo exoplanets, star Teff, radius and Mira periods, the literature registry, binary brown dwarf components, the issue #68 backend fixes and the slope unit, Gaia MSC (Q-220), Procyon's radius (Q-336) | 0 D, 8 Q, 16 KB |
| [demo-pack.md](demo-pack.md) | the demo search list and aliases, the 67P and Bennu shape products, the WRL reader, and the pre-built demo pack | 0 D, 6 Q, 19 KB |

Agenda of the 11 Nov 2026 decision session: [session-2026-11-11.md](session-2026-11-11.md). It holds no entries and is removed once the outcomes are recorded.

## Rules for entries

- **IDs never change and are never reused.** A new decision is the next free `D-` number; a new question the next free `Q-` number. Before you pick one, check `origin/main` and the open PRs (they pick numbers too).
- **Next free:** D-38 and Q-337 (11 Nov 2026, checked against `origin/main` after merging issue #75, and the open PR #90; issue #71 took D-37 and Q-210 to Q-336). **Never assigned (do not reuse):** in issue #71's block, Q-213 to Q-219, Q-223 to Q-229, Q-236 to Q-239, Q-246 to Q-249, Q-264, Q-265, Q-268, Q-269, Q-277 to Q-279, Q-289 and Q-320 to Q-322; also Q-46, Q-127 to Q-129 and Q-149. **Taken by issue #75:** Q-206 (pack never hides a measured spectrum) and Q-207 (Rainbow Trails rotation in the UI). **Taken by issue #92:** Q-208 (Area contract shape choices, Proposed). **Never assigned:** Q-209. **Taken by issue #80:** Q-205 (event cut, Proposed). **Taken by issue #79:** Q-204 (PNG determinism). **Renumbered:** this PR's Q-150 to Q-183 became Q-170 to Q-203 on 10 Nov 2026, because main took Q-150 to Q-169 in PR #70; Q-203 is the four research checks, Q-170 to Q-202 are the spec-pass proposals. **From PR #53 (merged):** Q-125 (frame search tags and refusals) and Q-126 (MOST). Q-130 to Q-149 were reserved for the Track tool and Area search (Q-130).
- **D-37, Q-286 to Q-288, Q-299 to Q-306 and Q-309 to Q-316 (the engines)** are in [rendering-engines](rendering-engines.md) (moved from rendering-bodies on 11 Nov 2026); their PR #89 review fixes **Q-329 to Q-331, Q-334, Q-335** are in [rendering-engines-review](rendering-engines-review.md). **Q-294 to Q-298 (stream U, build view)** are in [shell-surfaces](shell-surfaces.md). **Q-274 to Q-276 (stream H, orbit view and close-up pane)** are in [rendering-bodies](rendering-bodies.md).
- **One entry, one file.** Put a new entry in the topic file it belongs to and add its row to the index below in the same commit. An entry that changes another one says "amends D-xx" and the amended entry gets an "Amended by" line.
- **Status words** (for new entries; older rows keep their wording): **Open**; **Open (built)** (code follows the proposal); **Proposed** (an owner must confirm); **Decided** (who and when); **Partly decided** (list what is open); **Superseded by** (the newer entry rules); **Deferred** (after the event). D- entries are **Accepted** unless marked otherwise.
- **Spec text belongs in the specs.** A decision states the rule and cites the spec section that holds the detail; when a decision changes a rule, update that section in the same PR.

## Index

Every entry, in ID order. Status is shortened; the row in the topic file is authoritative.

| ID | Title | Status (short) | File |
|---|---|---|---|
| D-01 | Where surfaces are generated | Accepted | [rendering-bodies](rendering-bodies.md#d-01-where-surfaces-are-generated) |
| D-02 | Data model and provenance tags | Accepted | [contract-tags](contract-tags.md#d-02-data-model-and-provenance-tags) |
| D-03 | three.js version r187 | Accepted; amended by D-37 (acknowledged by Atish, 11 Nov 2026) | [platform-hosting](platform-hosting.md#d-03-threejs-version) |
| D-04 | Object types union | Accepted | [contract](contract.md#d-04-object-types) |
| D-05 | Target hardware and budgets | Accepted (frame-rate row "amended by D-34") | [platform-hosting](platform-hosting.md#d-05-target-hardware-and-budgets) |
| D-06 | Scope cuts for the event | Accepted | [scope-process](scope-process.md#d-06-scope-cuts-for-the-event) |
| D-07 | Gemini artistic layer | Accepted | [gemini](gemini.md#d-07-gemini-artistic-layer) |
| D-08 | Haptics run on the web | Accepted | [haptics-design](haptics-design.md#d-08-haptics-run-on-the-web-not-in-a-native-app) |
| D-09 | Haptic strength is quantised | Accepted | [haptics-design](haptics-design.md#d-09-haptic-strength-is-quantised) |
| D-10 | Audio pairing on every platform | Accepted | [haptics-sound](haptics-sound.md#d-10-audio-pairing-on-every-platform) |
| D-11 | Repo and doc layout | Accepted | [scope-process](scope-process.md#d-11-repo-and-doc-layout) |
| D-12 | Haptics on shader-generated bodies | Accepted (Atish); Moon pending; Q-103 amendme… | [haptics-design](haptics-design.md#d-12-haptics-on-gas-giants-water-worlds-and-other-shader-generated-bodies) |
| D-13 | Creative ownership of haptics | Accepted | [haptics-design](haptics-design.md#d-13-creative-ownership-of-haptics) |
| D-14 | Build from 5 Nov | Approved Atish; Kevin, Moon pending | [scope-process](scope-process.md#d-14-build-from-5-nov-answers-q-10) |
| D-15 | Backend framework FastAPI | Accepted | [data-sources](data-sources.md#d-15-backend-framework-fastapi-answers-q-01) |
| D-16 | API endpoints | Accepted; 3 notes "not yet decided" (Q-50, Q-… | [contract](contract.md#d-16-api-endpoints-answers-q-06) |
| D-17 | Owners | Accepted (amended 9 Nov 2026, issue #68: Moon decides body rules) | [scope-process](scope-process.md#d-17-owners-answers-q-07-and-the-ownership-part-of-q-14) |
| D-18 | Contract generated from shared/schemas | Accepted | [contract](contract.md#d-18-the-contract-is-generated-from-sharedschemas-answers-q-14) |
| D-19 | Name resolver order | Accepted; amended by Q-328 (reference objects first, open) | [data-sources](data-sources.md#d-19-name-resolver-order-answers-q-05) |
| D-20 | Haptics API | Accepted; Q-103 amendment pending Atish | [haptics-design](haptics-design.md#d-20-haptics-api-answers-q-11) |
| D-21 | Honesty toggle follows three badges | Accepted | [contract-tags](contract-tags.md#d-21-honesty-toggle-follows-the-three-badges-answers-q-08) |
| D-22 | What a saved asset holds | Accepted | [contract](contract.md#d-22-what-a-saved-asset-holds-answers-q-09) |
| D-23 | VisibleMode and IRMode fields | Accepted | [contract](contract.md#d-23-fields-of-visiblemode-and-irmode-answers-q-12) |
| D-24 | Hosting local on Asus A15 | Accepted | [platform-hosting](platform-hosting.md#d-24-hosting-local-on-the-asus-a15-answers-q-02) |
| D-25 | Cache every external call; offline mode | Accepted | [data-sources](data-sources.md#d-25-cache-every-external-call-offline-demo-mode) |
| D-26 | Sliders on baked bodies | Accepted | [rendering-bodies](rendering-bodies.md#d-26-sliders-on-baked-bodies-answers-q-03) |
| D-27 | Type of overrides | Accepted (+ note) | [contract](contract.md#d-27-type-of-overrides-answers-q-13) |
| D-28 | Rainbow Trails is a flipbook mode | Accepted | [moving-objects](moving-objects.md#d-28-rainbow-trails-is-a-flipbook-view-mode-answers-q-04) |
| D-29 | Milestones are independent tracks | Accepted | [scope-process](scope-process.md#d-29-milestones-are-independent-tracks) |
| D-30 | Milestone owners and dependencies | Accepted (Atish) | [scope-process](scope-process.md#d-30-milestone-owners-and-dependencies) |
| D-31 | Saturated targets refused; demo objects added | Approved Atish; Moon pending | [data-sources](data-sources.md#d-31-saturated-test-targets-stay-as-refusals-demo-objects-added-answers-q-26) |
| D-32 | Tier fallback chain | Accepted (PR #44); Kevin, Atish (haptics) pen… | [contract-tags](contract-tags.md#d-32-tier-fallback-chain-partly-answers-q-38) |
| D-33 | Accuracy first | Pending team confirmation | [rendering-bodies](rendering-bodies.md#d-33-accuracy-first) |
| D-34 | Motion, render-on-change and battery | Pending team confirmation | [rendering-motion](rendering-motion.md#d-34-motion-render-on-change-and-battery) |
| D-35 | Local copy of sky survey tiles | Accepted (Atish) | [sky-shell](sky-shell.md#d-35-local-copy-of-sky-survey-tiles-for-the-sky-background) |
| D-36 | Physics-based realism for generated bodies | Decided (Moon); engine frames exempt from determinism (D-37) | [rendering-bodies](rendering-bodies.md#d-36-physics-based-realism-for-generated-bodies-issue-71) |
| D-37 | Prototype WebGL2 engines (world, star, rock) are the renderer for generated bodies at + Artistic; three.js TSL is the fallback | Decided (Moon); amends D-03 (acknowledged by Atish, 11 Nov 2026); amended by Q-287; built | [rendering-engines](rendering-engines.md#d-37-the-approved-prototype-engine-is-the-renderer-for-generated-bodies-decided-by-moon-11-nov-2026) |
| Q-01 | Backend framework | Answered: D-15 | [data-sources](data-sources.md) |
| Q-02 | Frontend hosting | Answered: D-24 | [platform-hosting](platform-hosting.md) |
| Q-03 | Sliders on baked bodies | Answered: D-26 | [rendering-bodies](rendering-bodies.md) |
| Q-04 | Rainbow Trails vs flipbook | Answered: D-28 | [moving-objects](moving-objects.md) |
| Q-05 | Name resolver order | Answered: D-19 | [data-sources](data-sources.md) |
| Q-06 | Search, frames, flipbook endpoints | Answered: D-16 | [contract](contract.md) |
| Q-07 | Owners for schemas, fields, stages | Answered: D-17 | [scope-process](scope-process.md) |
| Q-08 | Honesty toggle start state | Answered: D-21 (the store now starts at `deri… | [contract-tags](contract-tags.md) |
| Q-09 | What a saved asset holds | Answered: D-22 | [contract](contract.md) |
| Q-10 | Build start vs event rule | Answered: D-14 | [scope-process](scope-process.md) |
| Q-11 | Mock-up haptics vs R8.8 API | Answered: D-20 | [haptics-design](haptics-design.md) |
| Q-12 | VisibleMode and IRMode fields | Answered: D-23 | [contract](contract.md) |
| Q-13 | Type of overrides map | Answered: D-27 | [contract](contract.md) |
| Q-14 | Contract source of truth | Answered: D-17, D-18 | [contract](contract.md) |
| Q-15 | Does A15 replace Zenbook demo screen | Open (answered by Q-132, see note) | [platform-hosting](platform-hosting.md) |
| Q-16 | Munazir confirms D-17 | Answered: Munazir is Moon (`MintHerbs`); D-17… | [scope-process](scope-process.md) |
| Q-17 | Comet field pulse tag | Open | [haptics-design](haptics-design.md) |
| Q-18 | View-mode rgb type | Answered: D-23 corrected to `TV<[number, numb… | [contract](contract.md) |
| Q-19 | Where R8.8 frontend types live | Open | [haptics-design](haptics-design.md) |
| Q-20 | Cutout cache strips PSF HDU | Open (implemented as proposed) | [data-sources](data-sources.md) |
| Q-21 | Frames for moving objects | Partly answered (built; limits [verify]) | [moving-frames](moving-frames.md) |
| Q-22 | Meaning of moving in resolve | Open (implemented as proposed) | [moving-objects](moving-objects.md) |
| Q-23 | No aperture correction in stage 2 | Open | [data-sources](data-sources.md) |
| Q-24 | Light curve mixes wavelengths | Open | [data-sources](data-sources.md) |
| Q-25 | Tag of typed coordinates | Open (implemented as described) | [contract-tags](contract-tags.md) |
| Q-26 | SPHEREx saturates on three targets | Answered: D-31 (Moon's confirmation pending).… | [data-sources](data-sources.md) |
| Q-27 | Tag of false-colour encodings | Open (Rainbow Trails implemented as `derived`) | [contract-tags](contract-tags.md) |
| Q-28 | Flipbook in Measured only | Open | [contract-tags](contract-tags.md) |
| Q-29 | Cached Gemini repaint offline | Open. Interim (issue #14, Q-122): a switch, `… | [gemini](gemini.md) |
| Q-30 | Frontend synthetic fixtures location | Open (kept in `frontend/fixtures/` for M1) | [contract](contract.md) |
| Q-31 | SPHEREx FLAGS beyond QR2 | Open | [data-sources](data-sources.md) |
| Q-32 | Dev-only Fixture badge | Open (implemented as proposed, dev only) | [contract-tags](contract-tags.md) |
| Q-33 | scale_m nullable; candidate params | Open (implemented as described) | [contract](contract.md) |
| Q-34 | Binary brown dwarf components | Open | [contract](contract.md) |
| Q-35 | Seed hash and width | Open. Issue #5 implements, as an ASSUMPTION:… | [contract](contract.md) |
| Q-36 | VisibleMode.source values | Open (`class_palette` in fixtures) | [contract](contract.md) |
| Q-37 | HapticProfile vs R8.5 | Open (implemented as described) | [haptics-design](haptics-design.md) |
| Q-38 | Layer formula, ids, missing format | Partly answered by D-32: `formula`, `assumed`… | [contract-tags](contract-tags.md) |
| Q-39 | cached_at on card replies | Open. Issue #5 keeps the R3 shapes and sends… | [contract](contract.md) |
| Q-40 | Runtime schema validation of replies | Implemented in issue #5 as the first option:… | [contract](contract.md) |
| Q-41 | LightCurvePoint vs card lightcurve | Open (R3.2 shape kept). Issue #5 fills `light… | [contract](contract.md) |
| Q-42 | gas_Q per epoch | Open (R3.2 shape kept). The comet renderer (i… | [contract](contract.md) |
| Q-43 | Which diameter diameter_km holds | Open (bounding-sphere reading kept for the fa… | [rendering-bodies](rendering-bodies.md) |
| Q-44 | Backend serves shape models | Answered by Q-61 for registered shape models:… | [pipeline-jobs](pipeline-jobs.md) |
| Q-45 | Plain body in Measured only | Decided (as implemented) | [rendering-bodies](rendering-bodies.md) |
| Q-47 | Texture baker choices | Open (implemented as described) | [rendering-bodies](rendering-bodies.md) |
| Q-48 | Shared field packing for gas giants | Open (implemented as described) | [rendering-bodies](rendering-bodies.md) |
| Q-49 | Honesty start vs visible surface | Open (rule resolved with Q-45; start state op… | [rendering-bodies](rendering-bodies.md) |
| Q-50 | Overlay, flags, combine endpoints | Open (implemented; docs updated in PR #32… | [data-sources](data-sources.md) |
| Q-51 | CatWISE2020 for WISE sources | Open (CatWISE2020 only) | [data-sources](data-sources.md) |
| Q-52 | Gaia G < 20 cut | Open (G < 20) | [data-sources](data-sources.md) |
| Q-53 | Contamination 2 px self-match | Open (2 px) | [data-sources](data-sources.md) |
| Q-54 | Add/subtract across wavelengths | Open (any pair, both wavelengths shown) | [data-sources](data-sources.md) |
| Q-55 | Stage 3, 4, 5, 7 choices | Open (implemented as described) | [pipeline-stages](pipeline-stages.md) |
| Q-56 | Exoplanet type thresholds | Decided via Q-63 (on since issue #68) | [pipeline-stages](pipeline-stages.md) |
| Q-57 | Where generated assets are saved | Open (implemented as described) | [pipeline-jobs](pipeline-jobs.md) |
| Q-58 | Physics sliders and slider tags | Open (implemented as described; (b) as `artis… | [rendering-bodies](rendering-bodies.md) |
| Q-59 | Sedov radius on nova | Open (implemented as described) | [rendering-bodies](rendering-bodies.md) |
| Q-60 | Physics in backend stage 6 | Open | [pipeline-stages](pipeline-stages.md) |
| Q-61 | Shape model registry, LODs, units | Open (implemented as described; (4) is applie… | [pipeline-jobs](pipeline-jobs.md) |
| Q-62 | Sun angle for SBDB bodies | Open (implemented as described) | [pipeline-stages](pipeline-stages.md) |
| Q-63 | Exoplanet Archive adapter and rule | Decided: signed off by Moon (9 Nov 2026, issue #68); rule on | [pipeline-stages](pipeline-stages.md) |
| Q-64 | Frame-rate targets vs D-05 | Open (R5.7 written as 30 fps floor, 60 fps ta… | [platform-hosting](platform-hosting.md) |
| Q-65 | Mira pulsation tier split | Open (R5.7 uses the split) | [rendering-bodies](rendering-bodies.md) |
| Q-66 | Viewer motion and quality levels | Open (implemented as described) | [rendering-motion](rendering-motion.md) |
| Q-67 | Tone mapping (clipHighlights) | Open (implemented as described) | [rendering-motion](rendering-motion.md) |
| Q-68 | Field-worker interface at 4 Hz | Open | [haptics-design](haptics-design.md) |
| Q-69 | Golden frames on SwiftShader | Open | [rendering-motion](rendering-motion.md) |
| Q-70 | Spectrum pitch follows wavelength | Open (implemented as described) | [haptics-sound](haptics-sound.md) |
| Q-71 | Engine-owned pulse trains | Open (implemented as described) | [haptics-built](haptics-built.md) |
| Q-72 | Audio voice hint on HapticEvent | Open (implemented as described) | [haptics-sound](haptics-sound.md) |
| Q-73 | Default outputs and unlock gesture | Open (implemented as described) | [haptics-built](haptics-built.md) |
| Q-74 | Calibration choices | Open (implemented as described) | [haptics-built](haptics-built.md) |
| Q-75 | Tap-along avOffsetMs method | Open (implemented as described) | [haptics-built](haptics-built.md) |
| Q-76 | Spectrum haptics choices | Open (implemented as described) | [haptics-built](haptics-built.md) |
| Q-77 | R11 dip test at phone width | Open | [haptics-built](haptics-built.md) |
| Q-78 | Crater rims, mesh normals refused | Open (refused until a mask and a mesh raycast… | [haptics-design](haptics-design.md) |
| Q-79 | Gas giant band-boundary strength | Open (implemented as described) | [haptics-design](haptics-design.md) |
| Q-80 | T Tauri dropped beats | Open (implemented as described) | [haptics-design](haptics-design.md) |
| Q-81 | Tags of encoded data haptics | Open (implemented as described) | [haptics-design](haptics-design.md) |
| Q-82 | Brown dwarf band ticks refused | Open (refused until band data reaches the cli… | [haptics-design](haptics-design.md) |
| Q-83 | Holding still and source triggers | Open (implemented as described) | [haptics-built](haptics-built.md) |
| Q-84 | Creative haptics placeholders (#11) | Open (placeholders) | [haptics-built](haptics-built.md) |
| Q-85 | Texture/data channel hint | Open (implemented as described) | [haptics-design](haptics-design.md) |
| Q-86 | Candidate detections haptics refused | Open (refused until a detection field exists) | [haptics-design](haptics-design.md) |
| Q-87 | Sky endpoints beyond D-16 | Open (implemented as described) | [sky-shell](sky-shell.md) |
| Q-88 | Sky survey, tag and depth | Open (2MASS colour, `derived`) | [sky-shell](sky-shell.md) |
| Q-89 | Shell follows mock-up; sky default | Open (implemented as described) | [sky-shell](sky-shell.md) |
| Q-90 | Sky texture budget vs D-05 | Open (implemented as described) | [sky-shell](sky-shell.md) |
| Q-91 | Tag of picked sky position | Open (implemented as described) | [contract-tags](contract-tags.md) |
| Q-92 | Composite endpoints beyond D-16 | Open (implemented as described) | [data-sources](data-sources.md) |
| Q-93 | Tags of flipbook colour views | Open (implemented as `derived`, hidden in Mea… | [contract-tags](contract-tags.md) |
| Q-94 | Composite band and stretch constants | Open (placeholders) | [data-sources](data-sources.md) |
| Q-95 | colour= link parameter, composite UI | Open (implemented as described) | [sky-shell](sky-shell.md) |
| Q-96 | WISE 0855 short-wavelength contamination | Open | [data-sources](data-sources.md) |
| Q-97 | Progressive frames in the UI | Open (implemented as described) | [sky-shell](sky-shell.md) |
| Q-98 | GET /v1/sky/cached | Open (implemented as described) | [sky-shell](sky-shell.md) |
| Q-99 | Recommended live cutout budget | Open | [pipeline-jobs](pipeline-jobs.md) |
| Q-100 | No-data marking in flipbook | Open (implemented as described) | [sky-shell](sky-shell.md) |
| Q-101 | Flipbook display timing | Open (implemented as described) | [sky-shell](sky-shell.md) |
| Q-102 | Overlays on the frame grid | Open | [sky-shell](sky-shell.md) |
| Q-103 | Shapes and volumes | Open (implemented as described; Atish's accep… | [rendering-kinds](rendering-kinds.md) |
| Q-104 | Animated sphere bodies | Open (implemented as described) | [rendering-kinds](rendering-kinds.md) |
| Q-105 | Time-dependent storm channel (D-12) | Open (implemented as described; the amendment… | [haptics-built](haptics-built.md) |
| Q-106 | Tier wording in viewer panel | Open (implemented as described) | [rendering-motion](rendering-motion.md) |
| Q-107 | Visual findings from #42 review | Mostly fixed (see below). Open: a check on a… | [rendering-kinds](rendering-kinds.md) |
| Q-108 | Process gating and flare cap | Open (implemented as described) | [rendering-motion](rendering-motion.md) |
| Q-109 | Brown-dwarf flattening refused | Proposed (Kevin to confirm); amended by Q-115 | [rendering-kinds](rendering-kinds.md) |
| Q-110 | Policy for [verify] constants | No status cell; upheld by Atish (Q-119) | [contract-tags](contract-tags.md) |
| Q-111 | Two-stage answer and object jobs | Open (implemented as described) | [pipeline-jobs](pipeline-jobs.md) |
| Q-112 | Fan-out settings and defaults | Open (implemented as described) | [pipeline-jobs](pipeline-jobs.md) |
| Q-113 | Select, Build it, split view (main, L579) | Proposed: pending Moon's confirmation (implem… | [shell-surfaces](shell-surfaces.md) |
| Q-114 | Honest fixtures: baked textures, /data, Eros | Accepted by Atish (PR #63); implemented | [rendering-bodies](rendering-bodies.md) |
| Q-115 | Gas giant: five tiered layers | Accepted by Atish (PR #63); implemented; amends Q-109 | [rendering-layers](rendering-layers.md) |
| Q-116 | Brown dwarf limb darkening and IR bands | Accepted by Atish (PR #63); implemented | [rendering-layers](rendering-layers.md) |
| Q-117 | Asteroid: measured sphere and displacement | Accepted by Atish (PR #63), item (4) replaced; implemented | [rendering-layers](rendering-layers.md) |
| Q-118 | T Tauri disc flared and lit (R7.5) | Accepted by Atish (PR #63); implemented | [rendering-layers](rendering-layers.md) |
| Q-119 | Conflict: Q-110 vs Q-115/Q-116 tier 3 | Decided (Q-110 stands); brown-dwarf `u` open | [contract-tags](contract-tags.md) |
| Q-120 | Marker click opens object again | Decided | [shell-surfaces](shell-surfaces.md) |
| Q-121 | Rail and island follow mock-up | Proposed: pending Moon's confirmation (implem… | [shell-surfaces](shell-surfaces.md) |
| Q-122 | Gemini layer contract | Open (implemented as proposed) | [gemini](gemini.md) |
| Q-123 | No sky pan/zoom buttons; grid loader | Decided (Moon asked for both) | [shell-surfaces](shell-surfaces.md) |
| Q-124 | Sky fills bezel; edge fades | Decided (Moon asked for it) | [shell-surfaces](shell-surfaces.md) |
| Q-125 | Moving frame search tags and refusals | Open (implemented as described) | [moving-frames](moving-frames.md) |
| Q-126 | MOST as primary moving-object search | Open | [moving-frames](moving-frames.md) |
| Q-130 | Reserved Track block Q-130 to Q-149 | Answered (Atish, 9 Nov 2026) | [scope-process](scope-process.md) |
| Q-131 | Track scope: known objects only | Answered for scope (Atish, 9 Nov 2026); re-sc… | [moving-objects](moving-objects.md) |
| Q-132 | Desktop-only event; A15 demo machine | Answered (Atish, 9 Nov 2026); open: M3 rename, issue #16 | [platform-hosting](platform-hosting.md) |
| Q-133 | Body sound follows height map | Answered (Atish, 9 Nov 2026); open details Q-188 to Q-192 | [haptics-sound](haptics-sound.md) |
| Q-134 | Track path sound | Answered (Atish, 9 Nov 2026) | [haptics-sound](haptics-sound.md) |
| Q-135 | Spin slider owner, tag, wording | Answered (Atish, 9 Nov 2026) | [moving-objects](moving-objects.md) |
| Q-136 | High-res imagery only in path view | Answered for scope (Atish, 9 Nov 2026); CDS p… | [moving-objects](moving-objects.md) |
| Q-137 | Demo object and data release | Answered (Atish, 9 Nov 2026) | [scope-process](scope-process.md) |
| Q-138 | Positions are SPHEREx-centred | Answered (Atish, 9 Nov 2026) | [moving-objects](moving-objects.md) |
| Q-139 | OUTLIER flags on mover core | Answered (Moon, 9 Nov 2026): accepted for mov… | [moving-objects](moving-objects.md) |
| Q-140 | MOST or path cone search | Open | [moving-frames](moving-frames.md) |
| Q-141 | Path endpoint | Open | [moving-objects](moving-objects.md) |
| Q-142 | Marker epoch for moving objects | Answered (Moon, 9 Nov 2026): accepted; in Tra… | [moving-objects](moving-objects.md) |
| Q-143 | Star overlays for moving objects | Answered (Moon, 9 Nov 2026): accepted; Discov… | [moving-objects](moving-objects.md) |
| Q-144 | 3I/ATLAS extended-coma spectrum | Answered (Moon, 9 Nov 2026): show the apertur… | [moving-objects](moving-objects.md) |
| Q-145 | Track export format | Open | [moving-objects](moving-objects.md) |
| Q-146 | Area search: Known and Discovery | Answered (Moon, 9 Nov 2026); accepted by Atis… | [moving-objects](moving-objects.md) |
| Q-147 | Band-Hop Linker spec (first proposal) | Answered: re-scoped as Q-146 | [moving-objects](moving-objects.md) |
| Q-148 | Pass length per sky position | Open | [moving-objects](moving-objects.md) |
| Q-150 | Exoplanet card fields, ASSET_VERSION 6 | Proposed (needs a second team member) | [exoplanets](exoplanets.md) |
| Q-151 | Demo exoplanet name resolution | Proposed (needs a second team member) | [catalogue-values](catalogue-values.md) |
| Q-152 | Star Teff, radius and Mira period sources | Proposed (needs a second team member) | [catalogue-values](catalogue-values.md) |
| Q-153 | Literature registry | Proposed (needs a second team member) | [catalogue-values](catalogue-values.md) |
| Q-154 | Binary brown dwarf components | Proposed (needs a second team member) | [catalogue-values](catalogue-values.md) |
| Q-155 | Tidal locking rule and constants | Decided (Moon, 10 Nov 2026); constants [verify] | [exoplanets](exoplanets.md) |
| Q-156 | Climate scenarios, locked temperature map | Proposed (needs a second team member) | [exoplanet-looks](exoplanet-looks.md) |
| Q-157 | Starlight colour | Proposed (needs a second team member) | [exoplanet-looks](exoplanet-looks.md) |
| Q-158 | mass_mearth in the physics layer | Proposed (needs a second team member) | [exoplanets](exoplanets.md) |
| Q-159 | Scenario looks and per-planet presets | Approved (Moon, 10 Nov 2026) | [exoplanet-looks](exoplanet-looks.md) |
| Q-160 | Wiring scenario looks into the planet spec | Proposed (needs a second team member) | [exoplanet-looks](exoplanet-looks.md) |
| Q-161 | Demo search list and aliases | Proposed (needs a second team member) | [demo-pack](demo-pack.md) |
| Q-162 | 67P and Bennu shape products | Proposed (needs a second team member) | [demo-pack](demo-pack.md) |
| Q-163 | WRL reader and Bennu shape model | Proposed (needs a second team member) | [demo-pack](demo-pack.md) |
| Q-164 | Pre-built demo pack | Proposed (needs a second team member); amended by Q-204, Q-206 | [demo-pack](demo-pack.md) |
| Q-165 | The two demo exoplanet fixtures | Proposed (needs a second team member) | [exoplanets](exoplanets.md) |
| Q-166 | Exoplanet mould steps, notes, alt text | Proposed (needs a second team member) | [exoplanet-looks](exoplanet-looks.md) |
| Q-167 | Backend review fixes for issue #68 | Proposed (needs a second team member) | [catalogue-values](catalogue-values.md) |
| Q-168 | Planet radius from pl_rade | Proposed (needs a second team member) | [exoplanets](exoplanets.md) |
| Q-169 | Unit of slope_075_25 | Open | [catalogue-values](catalogue-values.md) |
| Q-170 | One Escape owner for the shell | Proposed | [shell-proposals](shell-proposals.md) |
| Q-171 | Pane kinds: Build and Track share split | Proposed | [shell-proposals](shell-proposals.md) |
| Q-172 | Feature cards and island progress pill | Proposed | [shell-proposals](shell-proposals.md) |
| Q-173 | Hash keys for tools and panes | Proposed | [shell-proposals](shell-proposals.md) |
| Q-174 | Sky extension points for tool layers | Proposed | [shell-proposals](shell-proposals.md) |
| Q-175 | Tools that own the sky; the transport | Proposed | [shell-proposals](shell-proposals.md) |
| Q-176 | One announce path | Proposed | [shell-proposals](shell-proposals.md) |
| Q-177 | Keyboard facts as built | Open (built) | [shell-proposals](shell-proposals.md) |
| Q-178 | OUTLIER kept as a flag in Discovery | Proposed | [moving-objects-review](moving-objects-review.md) |
| Q-179 | Parallax-aware pair test in Discovery | Proposed | [moving-objects-review](moving-objects-review.md) |
| Q-180 | Known-object check: SkyBoT, Horizons, unchecked | Proposed | [moving-objects-review](moving-objects-review.md) |
| Q-181 | Track is a split-pane kind, no tool | Proposed | [moving-objects-review](moving-objects-review.md) |
| Q-182 | Discovery result card named Result card | Proposed | [moving-objects-review](moving-objects-review.md) |
| Q-183 | Owners for Track and the star list | Proposed | [scope-process](scope-process.md) |
| Q-184 | Eros Track window | Proposed | [moving-objects-review](moving-objects-review.md) |
| Q-185 | Marker between exposures | Proposed | [moving-objects-review](moving-objects-review.md) |
| Q-186 | Measurable coma-fills-aperture test | Proposed | [moving-objects-review](moving-objects-review.md) |
| Q-187 | Track tickets and milestone | Proposed | [scope-process](scope-process.md) |
| Q-188 | Mesh height for the body tone | Proposed | [haptics-sound](haptics-sound.md) |
| Q-189 | Tone stream in the haptics API | Proposed | [haptics-sound](haptics-sound.md) |
| Q-190 | Sustained-tone timbre by tag; body level | Proposed | [haptics-sound](haptics-sound.md) |
| Q-191 | Body tone on bodies without height | Proposed | [haptics-sound](haptics-sound.md) |
| Q-192 | Height ticks after the event | Proposed | [haptics-sound](haptics-sound.md) |
| Q-193 | Desktop Feel mode in the build pane | Proposed | [shell-proposals](shell-proposals.md) |
| Q-194 | Track path sound details | Proposed | [haptics-sound](haptics-sound.md) |
| Q-195 | GET /v1/health beyond D-16 | Proposed | [contract](contract.md) |
| Q-196 | UI wording for every missing code | Proposed | [contract](contract.md) |
| Q-197 | MVP object in warm start and pre-fetch | Proposed | [scope-process](scope-process.md) |
| Q-198 | Interim event serving until #15 | Proposed | [platform-hosting](platform-hosting.md) |
| Q-199 | Blind test owner and object | Proposed | [scope-process](scope-process.md) |
| Q-200 | Honesty start state vs Build it raise | Open | [contract-tags](contract-tags.md) |
| Q-201 | One tag for Horizons-derived values | Open | [contract-tags](contract-tags.md) |
| Q-202 | Review of the Area search fixes (9 Nov 2026) | Proposed | [moving-objects-review](moving-objects-review.md) |
| Q-203 | Four research checks join the event build as gated extras | Decided (Moon, 10 Nov 2026); owners and thresholds Proposed | [moving-objects](moving-objects.md) |
| Q-204 | PNG determinism across machines: chunks, not deflate bytes | Proposed (needs a second team member) | [demo-pack](demo-pack.md) |
| Q-205 | Event cut: Area search and D4 to D7 hidden | Proposed | [scope-process](scope-process.md) |
| Q-206 | Pre-built pack never hides a measured spectrum | Proposed (needs a second team member) | [demo-pack](demo-pack.md) |
| Q-207 | Rainbow Trails: the UI rotates, frames stay native | Proposed (needs a second team member) | [moving-objects](moving-objects.md) |
| Q-208 | Area contract: shape choices for the spec gaps | Proposed | [moving-objects](moving-objects.md) |
| Q-210 | Asteroid and nucleus physics: strength, craters, lighting, lobed nucleus | Open (built); amended by Q-326, Q-334 | [rendering-bodies](rendering-bodies.md) |
| Q-211 | Height field layers, erosion on craters only, seam test | Open (built) | [rendering-bodies](rendering-bodies.md) |
| Q-212 | Rough by default, smooth only on data | Open (built) | [rendering-bodies](rendering-bodies.md) |
| Q-220 | Gaia teff_msc1 as a star Teff source | Proposed (re-warm the A15 cache, 11 Nov 2026) | [catalogue-values](catalogue-values.md) |
| Q-221 | Data confidence score | Proposed; amended by Q-323, Q-327 | [pipeline-stages](pipeline-stages.md) |
| Q-222 | The 3D gate and its calibration (25 pinned scores) | Proposed; amended by Q-327 | [pipeline-stages](pipeline-stages.md) |
| Q-230 | Star mass, radius and rotation fall down the tier chain | Decided in code (Mamajek table) | [rendering-bodies](rendering-bodies.md) |
| Q-231 | Star physics constants and which are [verify] | Open (to verify) | [rendering-bodies](rendering-bodies.md) |
| Q-232 | Spot coverage placeholder scaling | Open (placeholder) | [rendering-bodies](rendering-bodies.md) |
| Q-233 | Spot-group interface for stream G | Open (implemented) | [rendering-bodies](rendering-bodies.md) |
| Q-234 | Joy's law sign and butterfly latitudes (22° to 8.4°) | Open (implemented); corrected by Q-329 | [rendering-bodies](rendering-bodies.md) |
| Q-235 | Star colour views, scales and defaults | Decided (Observatory default) | [rendering-bodies](rendering-bodies.md) |
| Q-240 | Rocky and water world model (issue #71 stream D) | Open (built) | [rendering-bodies](rendering-bodies.md) |
| Q-241 | Fluid table and constants (stream D) | Open (built); amended by Q-330 | [rendering-bodies](rendering-bodies.md) |
| Q-242 | Plate tectonics terrain (stream D) | Open (built) | [rendering-bodies](rendering-bodies.md) |
| Q-243 | Sliders and worker for stream D | Open (built) | [rendering-bodies](rendering-bodies.md) |
| Q-244 | Rivers and lakes (stream D round 2) | Open (built) | [rendering-bodies](rendering-bodies.md) |
| Q-245 | Cloud tracer (stream D round 2) | Open (built, GPU unchecked) | [rendering-bodies](rendering-bodies.md) |
| Q-250 | Gas solver and stability | Open (built; Moon to confirm) | [rendering-bodies](rendering-bodies.md#q-250-to-q-259-gas-giants-as-a-solved-flow-issue-71-stream-e) |
| Q-251 | Which giants run as a solved world | Open (built; Moon to confirm) | [rendering-bodies](rendering-bodies.md#q-250-to-q-259-gas-giants-as-a-solved-flow-issue-71-stream-e) |
| Q-252 | Observed band and ring values [verify] | Open (built; Moon to confirm); amended by Q-331 | [rendering-bodies](rendering-bodies.md#q-250-to-q-259-gas-giants-as-a-solved-flow-issue-71-stream-e) |
| Q-253 | Gas world tags | Open (built; Moon to confirm) | [rendering-bodies](rendering-bodies.md#q-250-to-q-259-gas-giants-as-a-solved-flow-issue-71-stream-e) |
| Q-254 | Gas pacing and determinism | Open (built; Moon to confirm); step length corrected by Q-331 | [rendering-bodies](rendering-bodies.md#q-250-to-q-259-gas-giants-as-a-solved-flow-issue-71-stream-e) |
| Q-255 | Pre-formed gas planet | Open (built; Moon to confirm) | [rendering-bodies](rendering-bodies.md#q-250-to-q-259-gas-giants-as-a-solved-flow-issue-71-stream-e) |
| Q-256 | Gas tracer on the GPU | Open (built; Moon to confirm) | [rendering-bodies](rendering-bodies.md#q-250-to-q-259-gas-giants-as-a-solved-flow-issue-71-stream-e) |
| Q-257 | Gas haptics from the solved flow | Open (built; Moon to confirm) | [rendering-bodies](rendering-bodies.md#q-250-to-q-259-gas-giants-as-a-solved-flow-issue-71-stream-e) |
| Q-258 | Reference objects (Jupiter, Saturn) | Open (built; Moon to confirm); amended by Q-328 | [rendering-bodies](rendering-bodies.md#q-250-to-q-259-gas-giants-as-a-solved-flow-issue-71-stream-e) |
| Q-259 | Locked giants and pacing control | Open (built; Moon to confirm) | [rendering-bodies](rendering-bodies.md#q-250-to-q-259-gas-giants-as-a-solved-flow-issue-71-stream-e) |
| Q-260 | 3I/ATLAS gas rates by epoch, coma and nucleus (resolves the shape of Q-42) | Decided in code (Moon to confirm) | [rendering-kinds](rendering-kinds.md) |
| Q-261 | Comet path on the card (`orbit_track`, Horizons) | Decided in code | [rendering-kinds](rendering-kinds.md) |
| Q-262 | Emissions view and time between the epochs | Decided in code; amended by Q-333 | [rendering-kinds](rendering-kinds.md) |
| Q-263 | Modelled comet tail (amends R7.3) | Decided in code; amended by Q-333 | [rendering-kinds](rendering-kinds.md) |
| Q-266 | Confidence formula shown with KaTeX | Decided in code | [rendering-bodies](rendering-bodies.md) |
| Q-267 | Accuracy popover follows the mock-up; tag-to-part mapping | Decided in code; amended by Q-327 | [rendering-bodies](rendering-bodies.md) |
| Q-270 | Flare physics, energy cap, decay index and schedule | Decided in code ([verify] constants); citation corrected by Q-329 | [rendering-bodies](rendering-bodies.md) |
| Q-271 | Plasma as additive line streaks, budgets | Decided in code (look unchecked) | [rendering-bodies](rendering-bodies.md) |
| Q-272 | Plasma in the plan, view rules, controls, reduced motion | Decided in code | [rendering-bodies](rendering-bodies.md) |
| Q-273 | Star close-up component for the split pane | Decided in code | [rendering-bodies](rendering-bodies.md) |
| Q-274 | Surface view (orbit view): TSL port, draws into the viewer canvas, tags, performance (render on change, quarter scale while interacting, adaptive levels, pixel ratio 1.25) | Decided in code (Moon to confirm) | [rendering-bodies](rendering-bodies.md) |
| Q-275 | Close-up pane, the app's #cuPane (left 50%, mock-up captions, every kind) | Decided in code | [rendering-bodies](rendering-bodies.md) |
| Q-276 | Surface view inputs, entry and the fields asked of D and E | Decided in code | [rendering-bodies](rendering-bodies.md) |
| Q-280 to Q-284 | Search list additions: Titan reference moon, four demo-pack rows, archive outage | Decided in code; Q-280 amended by Q-330, Q-283 by Q-336 | [rendering-bodies](rendering-bodies.md) |
| Q-285 | Card fields for surface fluid and pressure (Titan) | Open (built) | [rendering-bodies](rendering-bodies.md) |
| Q-286 | TSL port of the prototype's world (`RockyWorld.ts`), kept as the fallback | Superseded by D-37; kept as the fallback (Atish, 11 Nov 2026) | [rendering-engines](rendering-engines.md#q-286-to-q-288-the-world-adapter-tsl-port-honesty-level-ocean-basin) |
| Q-287 | The engines draw only at + Artistic; + Estimated and Measured only draw the three.js path | Decided (Atish, 11 Nov 2026) | [rendering-engines](rendering-engines.md#q-286-to-q-288-the-world-adapter-tsl-port-honesty-level-ocean-basin) |
| Q-288 | Ocean basin in the world adapter (sea share per type) | Open (built; Moon to confirm) | [rendering-engines](rendering-engines.md#q-286-to-q-288-the-world-adapter-tsl-port-honesty-level-ocean-basin) |
| Q-290 to Q-293 | Gas giant and star parity: True colour default, solved gas world and star cells shown at + Estimated | Decided in code (Moon to confirm) | [rendering-bodies](rendering-bodies.md) |
| Q-294 | Build view follows the mock-up: full-view build, shift to the right half, header, one panel at a time, honesty caption | Decided (Moon: loyal to the mock-up) | [shell-surfaces](shell-surfaces.md) |
| Q-295 | Feel it (not available yet) and Hear it (the Listen sweep on the measured spectrum) in the build pane | Decided in code | [shell-surfaces](shell-surfaces.md) |
| Q-296 | Zoom bar and tool dock in the build view | Decided in code | [shell-surfaces](shell-surfaces.md) |
| Q-297 | Details: the controls and honesty lists the mock-up's build view has no place for | Decided in code | [shell-surfaces](shell-surfaces.md) |
| Q-298 | Build view follow-ups: mock-up title, island bottom right, `BuildControls` slot, Show dims rows only, phone close-up caption | Decided (coordinator) | [shell-surfaces](shell-surfaces.md) |
| Q-299 | Rock engine (prototype code, verbatim) draws asteroids and comet nuclei at + Artistic (Q-287) | Open (built; Moon to confirm) | [rendering-engines](rendering-engines.md#q-299-to-q-302-stream-v3-rock-engine-issue-71-d-37) |
| Q-300 | `cardToRock` adapter and the artifact's own bodies by id | Open (built; Moon to confirm); amended by Q-334 | [rendering-engines](rendering-engines.md#q-299-to-q-302-stream-v3-rock-engine-issue-71-d-37) |
| Q-301 | Shape models as a radial height map for the engine; jets | Open (built; Moon to confirm) | [rendering-engines](rendering-engines.md#q-299-to-q-302-stream-v3-rock-engine-issue-71-d-37) |
| Q-302 | Rock controls and notes in `BuildControls`; known differences | Open (built; Moon to confirm); amended by Q-334 | [rendering-engines](rendering-engines.md#q-299-to-q-302-stream-v3-rock-engine-issue-71-d-37) |
| Q-303 | World engine layout, verbatim blocks, one canvas | Decided (coordinator); amended by Q-335 | [rendering-engines](rendering-engines.md) |
| Q-304 | `cardToWorld`, artifact table and defaults | Decided (coordinator); amended by Q-330, Q-288 | [rendering-engines](rendering-engines.md) |
| Q-305 | Engine parity proof and `?parity=1` hook | Decided (coordinator); amended by Q-335 | [rendering-engines](rendering-engines.md) |
| Q-306 | Spin-up budget and resolution scaler stay as the prototype | Decided (coordinator) | [rendering-engines](rendering-engines.md) |
| Q-307 | The Sun as a reference star (`ref-sun`, NASA Sun Fact Sheet) | Decided in code (Moon to confirm) | [rendering-bodies](rendering-bodies.md) |
| Q-308 | D-37 engine status: prototype star and flare code sliced into engine/stars | Open (being built) | [rendering-bodies](rendering-bodies.md) |
| Q-309 to Q-312 | Star engine hosted (D-37): StarEngine, cardToStar and artifact presets, the globe pick and close-up target, mass assumption | Decided in code (Moon to confirm); Q-309, Q-310 amended by Q-329 | [rendering-engines](rendering-engines.md) |
| Q-313 to Q-316 | World engine hosted (D-37): two instances (globe and fly), hosting rule with the Forming state, controls and notes, haptics sampler, known differences | Open (built; Moon to confirm); Q-314 amended by Q-287 | [rendering-engines](rendering-engines.md) |
| Q-317 to Q-319 | Search list S2: 55 Cnc e (reviewed type override), stream S placeholders replaced, lava world in the engine | Open (built; Moon to confirm); Q-319 amended by Q-330 | [rendering-bodies](rendering-bodies.md) |
| Q-323 | Comet gas_Q in the confidence score: flat and epoch-keyed shapes, best epoch per molecule | Open (built; Moon to confirm) | [pipeline-stages](pipeline-stages.md) |
| Q-324 | Reviewed exoplanet type override limited to the water-range refusal with R and M on the card | Open (built; Moon to confirm) | [pipeline-stages](pipeline-stages.md) |
| Q-325 | Review fixes: "found" text joins with "and", lump_ratio radius floor, Gaia MSC cool-star caveat | Open (built; Moon to confirm) | [pipeline-stages](pipeline-stages.md) |
| Q-326 | Asteroid relief and crater review fixes: crater depth 0.33 r, reachable cap, rubble at the angle of repose, `p1-b4` | Open (built; Atish to confirm) | [rendering-bodies](rendering-bodies.md) |
| Q-327 | Confidence score review fixes: surface fields, key-measurement tags, 25 pinned scores, popover bar | Open (built; Atish to confirm) | [pipeline-stages](pipeline-stages.md) |
| Q-328 | Reference objects in the pipeline: looked up first, never through the catalogues, no sky position | Open (built; Kevin and Moon to confirm) | [data-sources](data-sources.md) |
| Q-329 | Star engine review fixes: presets, close-up note, limb law, spot temperature, X10 rate, citations | Open (built; Moon to confirm) | [rendering-engines-review](rendering-engines-review.md) |
| Q-330 | World engine and `cardToWorld` review fixes: clouds, CO₂ liquid, lava worlds, preset tolerance, Titan, albedo | Open (built; Moon to confirm) | [rendering-engines-review](rendering-engines-review.md) |
| Q-331 | Gas giant review fixes: Saturn's rings, measured winds and flattening, Great Red Spot, cyclones | Open (built; Moon to confirm) | [rendering-engines-review](rendering-engines-review.md) |
| Q-332 | Gas giant flattening: backend `f_J (P_J/P)^2` against the viewer's measured value or `0.7 q` | Open | [rendering-kinds](rendering-kinds.md) |
| Q-333 | 3I/ATLAS: SOHO/SWAN water point, water break-up, tail reference grain, perihelion | Open (built; Moon to confirm) | [rendering-kinds](rendering-kinds.md) |
| Q-334 | Rock engine review fixes: Bennu density, seed hash, preset badges, mesh readouts, lighting tag | Open (built; Moon to confirm) | [rendering-engines-review](rendering-engines-review.md) |
| Q-335 | Verbatim with reviewed `@deviation` fixes; extractors; parity harness not in the repo | Open (built; parity harness to commit) | [rendering-engines-review](rendering-engines-review.md) |
| Q-336 | Procyon A: interferometric radius 2.048 R☉ and the α CMi aliases | Open (built; Kevin to confirm) | [catalogue-values](catalogue-values.md) |
| B-01 to B-04 | Post-event backlog | Backlog | [scope-process](scope-process.md#post-event-backlog) |
