# Decision log

Decisions that reconcile the [architecture spec](../architecture/README.md) with the [rendering & haptics spec](../rendering/README.md). Where an entry in this log states a decision, it wins over both. "Architecture spec §x" means section **Ax** and "rendering doc §x" means **Rx**; each spec index has a section map.

Format: one entry per decision. Status is **Accepted** unless marked otherwise. Recorded 4 Nov 2026.

## How to use this folder

The log is split by topic so a task loads only what it needs. **Load this index first** (it is short), then only the topic files your task touches. The routing table in [docs/README.md](../README.md#what-to-load-for-a-task) names them per task.

| File | Holds | Size |
|---|---|---|
| [scope-process.md](scope-process.md) | scope cuts, doc layout, owners, build dates, milestones, the post-event backlog, the demo object and data release, ID reservations | 6 D, 10 Q, 13 KB |
| [contract.md](contract.md) | the data contract, object types, the endpoint list (D-16), schemas and generated types, saved assets, `overrides`, card and fixture shapes, cached replies, the issue #93 card fields (Q-363), warm-start health and the demo preflight (Q-454) | 6 D, 19 Q, 22 KB |
| [contract-tags.md](contract-tags.md) | provenance tags and badges, the honesty toggle, tier fallback, the policy for unverified constants (Q-110, Q-119), "which tag does X get" | 3 D, 12 Q, 19 KB |
| [data-sources.md](data-sources.md) | the backend framework, external archives and adapters, name resolving, the read-through cache and offline mode, test targets, overlays and the composite backends | 4 D, 16 Q, 22 KB |
| [pipeline-stages.md](pipeline-stages.md) | stages 3 to 7 as built, measurement choices, physics in stage 6, the Sun angle for SBDB bodies, the exoplanet adapter and type rule, the confidence score and 3D gate | 0 D, 11 Q, 20 KB |
| [pipeline-jobs.md](pipeline-jobs.md) | shape models and their serving, where generated assets are saved, the live cutout budget, object jobs, fan-out and progress endpoints | 0 D, 6 Q, 14 KB |
| [rendering-bodies.md](rendering-bodies.md) | where surfaces are generated, the baker, renderers per type, physics sliders, accuracy, golden images, the honest fixtures (Q-114), stars, worlds and gas giants on the TSL path, reference objects | 4 D, 60 Q, 63 KB (over the target; split pending) |
| [rendering-engines.md](rendering-engines.md) | D-37: the prototype world, star and rock engines on raw WebGL2, the + Artistic gate (Q-287), the three.js fallback, determinism exemption, the engine port and hosting streams | 1 D, 19 Q, 25 KB (over the target; amended-by lines from issue #93) |
| [rendering-engines-review.md](rendering-engines-review.md) | the PR #89 review fixes to the engines: star, world, gas giant, rock, and the verbatim convention with reviewed deviations | 0 D, 5 Q, 10 KB |
| [rendering-engines-tuning.md](rendering-engines-tuning.md) | D-40 (issue #93) and its engine fixes: shader compile time, background compile, roles, frame rate, globe controls, bench scripts (phase 1); seeds and repeating patterns (phase 2); the #93 deviations; the regression and operations fixes: the engines kill switch (Q-367), Chrome's shader cache and the demo warm-up (Q-368); amended-by lines to the performance waves | 1 D, 20 Q, 20 KB |
| [rendering-engines-perf.md](rendering-engines-perf.md) | the issue #93 performance waves from PR #101 (Q-381 to Q-387): the star engine and three.js star, the rock engine, the three.js viewer and the world host, the fly view, one planet simulation in a worker, the 60 Hz engine host cap, the bloom finding | 0 D, 7 Q, 15 KB |
| [physics-fixes.md](physics-fixes.md) | the issue #93 phase 3 physics: critical points, saturation pressure, tides, the turnover time, the Teq tag, the runaway greenhouse, the climate budget (open), confidence corrections; the #93 physics and data follow-up (Q-373 to Q-380): post-runaway range, turnover inputs, starlight order, eccentricity limits, phase-curve rows, Gaia FLAME precision and cache keys, card readouts at every level, gas caption rate | 0 D, 16 Q, 18 KB |
| [rendering-motion.md](rendering-motion.md) | motion, time-lapse, render-on-change, quality levels, tone mapping, golden frames, process gating and tier wording | 1 D, 5 Q, 9 KB |
| [rendering-kinds.md](rendering-kinds.md) | shapes and volumes, animated sphere bodies, flattening, and the Q-107 visual findings and fix notes, the comet emissions and tail (Q-260 to Q-263, Q-333), the flattening disagreement (Q-332) | 0 D, 10 Q, 22 KB |
| [rendering-layers.md](rendering-layers.md) | the per-layer body fixes of issue #62 (PR #63): gas giant five tiered layers, brown dwarf limb and infrared bands, asteroid sphere and displacement, the flared T Tauri disc | 0 D, 4 Q, 11 KB |
| [gemini.md](gemini.md) | the Gemini layer: scope, offline behaviour and its contract | 1 D, 2 Q, 7 KB |
| [sky-shell.md](sky-shell.md) | the sky view, sky endpoints and sky tiles, the flipbook UI | 1 D, 10 Q, 12 KB |
| [shell-surfaces.md](shell-surfaces.md) | the tool rail and the island, the object panel and card, the Build split view, the full-bleed layout | 1 D, 28 Q, 49 KB |
| [shell-proposals.md](shell-proposals.md) | open shell proposals that Track and Area search need: pane kinds, feature cards, hash keys, Escape order | 0 D, 9 Q, 15 KB |
| [haptics-design.md](haptics-design.md) | haptics design rules, creative ownership, the haptics API, the shared field on shader kinds, texture and data sources per type | 5 D, 12 Q, 20 KB |
| [haptics-sound.md](haptics-sound.md) | audio pairing (D-10), spectrum pitch and voice hints, the body tone and the Track path sound | 1 D, 10 Q, 13 KB |
| [haptics-built.md](haptics-built.md) | the haptic engine, calibration and source choices as built | 0 D, 9 Q, 20 KB |
| [platform-hosting.md](platform-hosting.md) | the three.js pin, hardware and frame budgets, hosting, the demo machine and the event platform | 3 D, 5 Q, 7 KB |
| [moving-objects.md](moving-objects.md) | Rainbow Trails, the Track tool, Area search and Discovery (agreed), the P3 frames and dots choices (Q-400 to Q-402), the P8 integration into the sky dock (Q-406 to Q-408), the P4 to P7 choices (Q-420), the Stage 2 OUTLIER rule as built (Q-460), known objects' `track_available` and Track pre-fetch (Q-461) | 1 D, 27 Q, ~60 KB |
| [moving-objects-review.md](moving-objects-review.md) | proposed fixes to Area search and Track after the 9 Nov 2026 audit, and Moon's review list (Q-202) | 0 D, 9 Q, 16 KB |
| [moving-frames.md](moving-frames.md) | frames for moving objects: the path cone search, its tags and refusals, MOST | 0 D, 4 Q, 8 KB |
| [exoplanets.md](exoplanets.md) | the exoplanet card fields (mass, orbit, host star), radius from the archive, tidal locking, mass in the physics layer, and the two demo exoplanet fixtures | 0 D, 5 Q, 15 KB |
| [exoplanet-looks.md](exoplanet-looks.md) | the climate scenarios and locked-planet temperature map, starlight colour, scenario looks and presets, and the exoplanet mould steps | 0 D, 5 Q, 15 KB |
| [catalogue-values.md](catalogue-values.md) | name resolution for the demo exoplanets, star Teff, radius and Mira periods, the literature registry, binary brown dwarf components, the issue #68 backend fixes and the slope unit, Gaia MSC (Q-220), Procyon's radius (Q-336), the issue #93 literature rows, SOHO/SWAN reference and cache keys (Q-364 to Q-366) | 0 D, 11 Q, 19 KB |
| [demo-pack.md](demo-pack.md) | the demo search list and aliases, the 67P and Bennu shape products, the WRL reader, and the pre-built demo pack, with the catalogue-gap rule (Q-369) | 0 D, 7 Q, 21 KB (over the target) |
| [sound-ambience.md](sound-ambience.md) | the haptics cut and the move to `frontend/src/sound/` (D-39), pitch polarity (Q-430), the flyover soundscape, weather, buses and stage audibility, the spectrum chord and the weather overlay (Q-431 to Q-449), the tone stream as built and the grouped exposure tick (Q-458), the Track path sound as built (Q-459) | 1 D, 22 Q, 25.5 KB (over the target) |

Agenda of the 11 Nov 2026 decision session: [session-2026-11-11.md](session-2026-11-11.md). It holds no entries and is removed once the outcomes are recorded.

## Rules for entries

- **IDs never change and are never reused.** A new decision is the next free `D-` number; a new question the next free `Q-` number. Before you pick one, check `origin/main` and the open PRs (they pick numbers too).
- **Next free:** D-41 and Q-462 (13 Nov 2026: issue #129 takes Q-461; its Q-455 collided with main's, checked against `origin/main` and the open PRs). Before that, D-41 and Q-461 (13 Nov 2026: issue #72 (PR #133) takes Q-460 (Stage 2 OUTLIER on a mover's core; its Q-456 then Q-459 collided with main's). Before that, D-41 and Q-460: issue #78 (feat/78-path-sound) takes Q-459 (Track path sound as built). Before that it was D-41 and Q-459: issue #77 (feat/77-tone-stream) takes Q-458 (tone stream as built, the grouped exposure tick); open PR #133 also writes Q-456, which collides with main's Q-456. Before that it was D-41 and Q-458: the follow-up to PR #107 (feat/build-view-ambience-minimise) takes Q-456 (Ambience dropdown with the sound settings) and Q-457 (build view: no dock, Minimise, Read paper, no island); issue #130 (PR #131) takes Q-455. Before that it was D-41 and Q-455, 12 Nov 2026, agreed on PR #105 and PR #107: #106 keeps Q-451, #107 takes Q-418, Q-419, Q-450, Q-452 and Q-453 (its build-strip entry, first Q-421, then Q-451, moved to Q-453), issue #103 (PR #105) takes Q-454, #110 took Q-420; Q-421 to Q-429 were never assigned. Before that: D-41 and Q-450, checked against `origin/main` after merging it into issue #93's branch, and the open PRs #107, #110 and #121: issue #93 took D-40 (D-38 on its branch before main's PR #104 took D-38) and Q-337 to Q-387; Q-388 to Q-399 never assigned; PR #121 (#111) takes D-39 and Q-430 to Q-444, #113 took Q-445 (PR #119), Q-446 by #115 (spectrum chord as built, PR #123), Q-447 and Q-448 by #116 (PR #124) and Q-449 by #117 (PR #125); #107 takes Q-418 and Q-419; #110 takes Q-420; Q-421 to Q-429 were never assigned. Q-370 to Q-372 are free but kept for the lead. Within issue #93: the performance waves took Q-381 to Q-387, the physics and data follow-up Q-373 to Q-380, and the regression and operations fixes Q-367 to Q-369. Before that on main: D-39 and Q-418 (12 Nov 2026, checked against `origin/main` and the open PRs #90, #100 and #101; PR #100 takes Q-406 to Q-408), and before that D-38 and Q-337, checked against `origin/main` after merging issue #75, and the open PR #90; issue #71 took D-37 and Q-210 to Q-336). **Taken by feat/matte-glass (PR #107):** Q-418, Q-419, Q-450, Q-452 and Q-453 (matte glass and minimise, build view opens without the split, build view header and Explore, frame-rate menu and sky info popover, one clock for the build strip). **Never assigned (do not reuse):** in issue #71's block, Q-213 to Q-219, Q-223 to Q-229, Q-236 to Q-239, Q-246 to Q-249, Q-264, Q-265, Q-268, Q-269, Q-277 to Q-279, Q-289 and Q-320 to Q-322; also Q-46, Q-127 to Q-129 and Q-149. **Taken by issue #75:** Q-206 (pack never hides a measured spectrum) and Q-207 (Rainbow Trails rotation in the UI). **Taken by feat/ui (PR #104):** D-38 (design language) and Q-409 to Q-417 (light theme, the artist's impression line, Pause, the Show row in Details, the island's pulse, the demo area flows, the mould, Hear it, the tab title; first drafted as Q-326 to Q-330, then Q-403 to Q-407, renumbered after main and PR #100 took those). **Taken by issue #97:** Q-400 to Q-402 (Area frames and dots). **Taken by issue #95:** Q-403 (star list choices) and Q-404 (star list owner), both Proposed; Q-405 reserved with them and never assigned. **Taken by issue #92:** Q-208 (Area contract shape choices, Proposed). **Never assigned:** Q-209. **Taken by issue #80:** Q-205 (event cut, Proposed). **Taken by issue #79:** Q-204 (PNG determinism). **Renumbered:** this PR's Q-150 to Q-183 became Q-170 to Q-203 on 10 Nov 2026, because main took Q-150 to Q-169 in PR #70; Q-203 is the four research checks, Q-170 to Q-202 are the spec-pass proposals. **From PR #53 (merged):** Q-125 (frame search tags and refusals) and Q-126 (MOST). Q-130 to Q-149 were reserved for the Track tool and Area search (Q-130).
- **D-37, Q-286 to Q-288, Q-299 to Q-306 and Q-309 to Q-316 (the engines)** are in [rendering-engines](rendering-engines.md) (moved from rendering-bodies on 11 Nov 2026); their PR #89 review fixes **Q-329 to Q-331, Q-334, Q-335** are in [rendering-engines-review](rendering-engines-review.md). **D-40 and Q-337 to Q-354 (issue #93 engine fixes) and Q-367, Q-368 (#93 regression and operations fixes)** are in [rendering-engines-tuning](rendering-engines-tuning.md), **Q-369 (#93 pack catalogue gap)** in [demo-pack](demo-pack.md), **Q-355 to Q-362 (#93 physics) and Q-373 to Q-380 (#93 physics and data follow-up)** in [physics-fixes](physics-fixes.md), **Q-363 (#93 card fields)** in [contract](contract.md) and **Q-364 to Q-366 (#93 literature and cache)** in [catalogue-values](catalogue-values.md). **D-39, Q-430 to Q-449, Q-458 and Q-459 (sound)** are in [sound-ambience](sound-ambience.md). **Q-294 to Q-298 (stream U, build view)** are in [shell-surfaces](shell-surfaces.md). **Q-274 to Q-276 (stream H, orbit view and close-up pane)** are in [rendering-bodies](rendering-bodies.md).
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
| D-08 | Haptics run on the web | Superseded by D-39 | [haptics-design](haptics-design.md#d-08-haptics-run-on-the-web-not-in-a-native-app) |
| D-09 | Haptic strength is quantised | Superseded by D-39 | [haptics-design](haptics-design.md#d-09-haptic-strength-is-quantised) |
| D-10 | Audio pairing on every platform | Accepted; amended by D-39 (no vibration; the timbre rules stay) | [haptics-sound](haptics-sound.md#d-10-audio-pairing-on-every-platform) |
| D-11 | Repo and doc layout | Accepted | [scope-process](scope-process.md#d-11-repo-and-doc-layout) |
| D-12 | Haptics on shader-generated bodies | Accepted (Atish); Moon pending; Q-103 amendme…; teq_K tag amended by Q-359; haptic part superseded by D-39 | [haptics-design](haptics-design.md#d-12-haptics-on-gas-giants-water-worlds-and-other-shader-generated-bodies) |
| D-13 | Creative ownership of haptics | Accepted; haptic part superseded by D-39 | [haptics-design](haptics-design.md#d-13-creative-ownership-of-haptics) |
| D-14 | Build from 5 Nov | Approved Atish; Kevin, Moon pending | [scope-process](scope-process.md#d-14-build-from-5-nov-answers-q-10) |
| D-15 | Backend framework FastAPI | Accepted | [data-sources](data-sources.md#d-15-backend-framework-fastapi-answers-q-01) |
| D-16 | API endpoints | Accepted; 3 notes "not yet decided" (Q-50, Q-… | [contract](contract.md#d-16-api-endpoints-answers-q-06) |
| D-17 | Owners | Accepted (amended 9 Nov 2026, issue #68: Moon decides body rules) | [scope-process](scope-process.md#d-17-owners-answers-q-07-and-the-ownership-part-of-q-14) |
| D-18 | Contract generated from shared/schemas | Accepted | [contract](contract.md#d-18-the-contract-is-generated-from-sharedschemas-answers-q-14) |
| D-19 | Name resolver order | Accepted; amended by Q-328 (reference objects first, open) | [data-sources](data-sources.md#d-19-name-resolver-order-answers-q-05) |
| D-20 | Haptics API | Accepted; Q-103 amendment pending Atish; amended by D-39 (vibration parts cut; the event API stays for sound) | [haptics-design](haptics-design.md#d-20-haptics-api-answers-q-11) |
| D-21 | Honesty toggle follows three badges | Accepted; haptics bullet amended by Q-359 (haptics cut by D-39); card readouts Q-379 | [contract-tags](contract-tags.md#d-21-honesty-toggle-follows-the-three-badges-answers-q-08) |
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
| D-37 | Prototype WebGL2 engines (world, star, rock) are the renderer for generated bodies at + Artistic; three.js TSL is the fallback | Decided (Moon); amends D-03 (acknowledged by Atish, 11 Nov 2026); amended by Q-287; built; determinism bullet amended by Q-349 (D-40) | [rendering-engines](rendering-engines.md#d-37-the-approved-prototype-engine-is-the-renderer-for-generated-bodies-decided-by-moon-11-nov-2026) |
| D-38 | Design language: Graphite, Inter, tight radii, Animate UI | Accepted (Moon); amended by Q-418 (matte glass on floating surfaces) | [shell-surfaces](shell-surfaces.md#d-38-design-language-graphite-inter-tight-radii-animate-ui) |
| D-39 | Haptics cut; the audio moves to frontend/src/sound | Accepted (Atish, 12 Nov 2026) | [sound-ambience](sound-ambience.md#d-39-haptics-cut-the-audio-moves-to-frontendsrcsound) |
| D-40 | Issue #93: engine speed, seeded patterns, physics corrections and new card fields | Decided (Atish, 11 Nov 2026); built except Q-361; Q-346 built by Q-385; performance waves Q-381 to Q-387 | [rendering-engines-tuning](rendering-engines-tuning.md#d-40-issue-93-engine-speed-seeded-patterns-physics-corrections-and-new-card-fields-decided-by-atish-11-nov-2026) |
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
| Q-64 | Frame-rate targets vs D-05 | Open (R5.7 written as 30 fps floor, 60 fps ta…); engine hosts capped at 60 Hz by Q-386 | [platform-hosting](platform-hosting.md) |
| Q-65 | Mira pulsation tier split | Open (R5.7 uses the split) | [rendering-bodies](rendering-bodies.md) |
| Q-66 | Viewer motion and quality levels | Open (implemented as described); three.js cap opt-in, Q-383, Q-386 | [rendering-motion](rendering-motion.md) |
| Q-67 | Tone mapping (clipHighlights) | Open (implemented as described); premise questioned by Q-387 | [rendering-motion](rendering-motion.md) |
| Q-68 | Field-worker interface at 4 Hz | Open | [haptics-design](haptics-design.md) |
| Q-69 | Golden frames on SwiftShader | Open | [rendering-motion](rendering-motion.md) |
| Q-70 | Spectrum pitch follows wavelength | Open (implemented as described); amended by Q-430 (long wavelength = low pitch) | [haptics-sound](haptics-sound.md) |
| Q-71 | Engine-owned pulse trains | Open (implemented as described); amended by D-39 (audio trains only) | [haptics-built](haptics-built.md) |
| Q-72 | Audio voice hint on HapticEvent | Open (implemented as described) | [haptics-sound](haptics-sound.md) |
| Q-73 | Default outputs and unlock gesture | Open (implemented as described); amended by D-39 (the unlock stays; no vibrate default) | [haptics-built](haptics-built.md) |
| Q-74 | Calibration choices | Superseded by D-39 | [haptics-built](haptics-built.md) |
| Q-75 | Tap-along avOffsetMs method | Superseded by D-39 | [haptics-built](haptics-built.md) |
| Q-76 | Spectrum haptics choices | Open (implemented as described); amended by D-39 (the pad is cut; the spectrum mapping stays) | [haptics-built](haptics-built.md) |
| Q-77 | R11 dip test at phone width | Superseded by D-39 | [haptics-built](haptics-built.md) |
| Q-78 | Crater rims, mesh normals refused | Superseded by D-39 | [haptics-design](haptics-design.md) |
| Q-79 | Gas giant band-boundary strength | Superseded by D-39 | [haptics-design](haptics-design.md) |
| Q-80 | T Tauri dropped beats | Superseded by D-39 | [haptics-design](haptics-design.md) |
| Q-81 | Tags of encoded data haptics | Superseded by D-39 | [haptics-design](haptics-design.md) |
| Q-82 | Brown dwarf band ticks refused | Superseded by D-39 | [haptics-design](haptics-design.md) |
| Q-83 | Holding still and source triggers | Superseded by D-39 | [haptics-built](haptics-built.md) |
| Q-84 | Creative haptics placeholders (#11) | Open (placeholders); amended by D-39 (the audio placeholders stay) | [haptics-built](haptics-built.md) |
| Q-85 | Texture/data channel hint | Superseded by D-39 | [haptics-design](haptics-design.md) |
| Q-86 | Candidate detections haptics refused | Superseded by D-39 | [haptics-design](haptics-design.md) |
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
| Q-105 | Time-dependent storm channel (D-12) | Superseded by D-39 | [haptics-built](haptics-built.md) |
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
| Q-132 | Desktop-only event; A15 demo machine | Answered (Atish, 9 Nov 2026); M3 rename done (#111, D-39); open: issue #16 | [platform-hosting](platform-hosting.md) |
| Q-133 | Body sound follows height map | Deferred (D-39) | [haptics-sound](haptics-sound.md) |
| Q-134 | Track path sound | Answered (Atish, 9 Nov 2026); amended by Q-430 (pitch polarity) | [haptics-sound](haptics-sound.md) |
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
| Q-150 | Exoplanet card fields, ASSET_VERSION 6 | Proposed (needs a second team member); amended by Q-359, Q-363 | [exoplanets](exoplanets.md) |
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
| Q-165 | The two demo exoplanet fixtures | Proposed (needs a second team member); amended by Q-359 | [exoplanets](exoplanets.md) |
| Q-166 | Exoplanet mould steps, notes, alt text | Proposed (needs a second team member) | [exoplanet-looks](exoplanet-looks.md) |
| Q-167 | Backend review fixes for issue #68 | Proposed (needs a second team member) | [catalogue-values](catalogue-values.md) |
| Q-168 | Planet radius from pl_rade | Proposed (needs a second team member) | [exoplanets](exoplanets.md) |
| Q-169 | Unit of slope_075_25 | Open | [catalogue-values](catalogue-values.md) |
| Q-170 | One Escape owner for the shell | Proposed | [shell-proposals](shell-proposals.md) |
| Q-171 | Pane kinds: Build and Track share split | Proposed | [shell-proposals](shell-proposals.md) |
| Q-172 | Feature cards and island progress pill | Built in part by Q-418 (minimise); progress pill not built | [shell-proposals](shell-proposals.md) |
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
| Q-183 | Owners for Track and the star list | Proposed; amended by Q-404 | [scope-process](scope-process.md) |
| Q-184 | Eros Track window | Proposed | [moving-objects-review](moving-objects-review.md) |
| Q-185 | Marker between exposures | Proposed | [moving-objects-review](moving-objects-review.md) |
| Q-186 | Measurable coma-fills-aperture test | Proposed | [moving-objects-review](moving-objects-review.md) |
| Q-187 | Track tickets and milestone | Proposed | [scope-process](scope-process.md) |
| Q-188 | Mesh height for the body tone | Deferred (D-39) | [haptics-sound](haptics-sound.md) |
| Q-189 | Tone stream in the haptics API | Proposed (stays live for sound: Track path voice, D-39) | [haptics-sound](haptics-sound.md) |
| Q-190 | Sustained-tone timbre by tag; body level | Proposed (timbre part stays live for sound, D-39) | [haptics-sound](haptics-sound.md) |
| Q-191 | Body tone on bodies without height | Deferred (D-39) | [haptics-sound](haptics-sound.md) |
| Q-192 | Height ticks after the event | Deferred (D-39) | [haptics-sound](haptics-sound.md) |
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
| Q-205 | Area search at the event: shown, precomputed (condition 4, the kill switch, amended by Q-406); D4 to D7 stay gated by Q-203 | Decided (Moon, 11 Nov 2026) | [scope-process](scope-process.md) |
| Q-206 | Pre-built pack never hides a measured spectrum | Proposed (needs a second team member); amended by Q-369 | [demo-pack](demo-pack.md) |
| Q-207 | Rainbow Trails: the UI rotates, frames stay native | Proposed (needs a second team member) | [moving-objects](moving-objects.md) |
| Q-208 | Area contract: shape choices for the spec gaps | Proposed | [moving-objects](moving-objects.md) |
| Q-210 | Asteroid and nucleus physics: strength, craters, lighting, lobed nucleus | Open (built); amended by Q-326, Q-334 | [rendering-bodies](rendering-bodies.md) |
| Q-211 | Height field layers, erosion on craters only, seam test | Open (built) | [rendering-bodies](rendering-bodies.md) |
| Q-212 | Rough by default, smooth only on data | Open (built) | [rendering-bodies](rendering-bodies.md) |
| Q-220 | Gaia teff_msc1 as a star Teff source | Proposed (re-warm the A15 cache, 11 Nov 2026) | [catalogue-values](catalogue-values.md) |
| Q-221 | Data confidence score | Proposed; amended by Q-323, Q-327; Q-362 | [pipeline-stages](pipeline-stages.md) |
| Q-222 | The 3D gate and its calibration (25 pinned scores) | Proposed; amended by Q-327; Q-362 | [pipeline-stages](pipeline-stages.md) |
| Q-230 | Star mass, radius and rotation fall down the tier chain | Decided in code (Mamajek table) | [rendering-bodies](rendering-bodies.md) |
| Q-231 | Star physics constants and which are [verify] | Open (to verify); turnover time amended by Q-358, Q-374 | [rendering-bodies](rendering-bodies.md) |
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
| Q-275 | Close-up pane, the app's #cuPane (left 50%, mock-up captions, every kind) (amended by Q-419) | Decided in code | [rendering-bodies](rendering-bodies.md) |
| Q-276 | Surface view inputs, entry and the fields asked of D and E | Decided in code | [rendering-bodies](rendering-bodies.md) |
| Q-280 to Q-284 | Search list additions: Titan reference moon, four demo-pack rows, archive outage | Decided in code; Q-280 amended by Q-330, Q-283 by Q-336 | [rendering-bodies](rendering-bodies.md) |
| Q-285 | Card fields for surface fluid and pressure (Titan) | Open (built) | [rendering-bodies](rendering-bodies.md) |
| Q-286 | TSL port of the prototype's world (`RockyWorld.ts`), kept as the fallback | Superseded by D-37; kept as the fallback (Atish, 11 Nov 2026) | [rendering-engines](rendering-engines.md#q-286-to-q-288-the-world-adapter-tsl-port-honesty-level-ocean-basin) |
| Q-287 | The engines draw only at + Artistic; + Estimated and Measured only draw the three.js path | Decided (Atish, 11 Nov 2026); amended by Q-367 | [rendering-engines](rendering-engines.md#q-286-to-q-288-the-world-adapter-tsl-port-honesty-level-ocean-basin) |
| Q-288 | Ocean basin in the world adapter (sea share per type) | Open (built; Moon to confirm) | [rendering-engines](rendering-engines.md#q-286-to-q-288-the-world-adapter-tsl-port-honesty-level-ocean-basin) |
| Q-290 to Q-293 | Gas giant and star parity: True colour default, solved gas world and star cells shown at + Estimated | Decided in code (Moon to confirm) | [rendering-bodies](rendering-bodies.md) |
| Q-294 | Build view follows the mock-up: full-view build, shift to the right half, header, one panel at a time, honesty caption (amended by PR #104 and Q-419) | Decided (Moon: loyal to the mock-up) | [shell-surfaces](shell-surfaces.md) |
| Q-295 | Feel it (not available yet) and Hear it (the Listen sweep on the measured spectrum) in the build pane (amended by PR #104) | Decided in code | [shell-surfaces](shell-surfaces.md) |
| Q-296 | Zoom bar and tool dock in the build view (amended by PR #104) | Decided in code | [shell-surfaces](shell-surfaces.md) |
| Q-297 | Details: the controls and honesty lists the mock-up's build view has no place for (amended by PR #104) | Decided in code | [shell-surfaces](shell-surfaces.md) |
| Q-298 | Build view follow-ups: mock-up title, island bottom right, `BuildControls` slot, Show dims rows only, phone close-up caption (amended by PR #104) | Decided (coordinator) | [shell-surfaces](shell-surfaces.md) |
| Q-299 | Rock engine (prototype code, verbatim) draws asteroids and comet nuclei at + Artistic (Q-287) | Open (built; Moon to confirm); amended by Q-382 | [rendering-engines](rendering-engines.md#q-299-to-q-302-stream-v3-rock-engine-issue-71-d-37) |
| Q-300 | `cardToRock` adapter and the artifact's own bodies by id | Open (built; Moon to confirm); amended by Q-334; Q-353 | [rendering-engines](rendering-engines.md#q-299-to-q-302-stream-v3-rock-engine-issue-71-d-37) |
| Q-301 | Shape models as a radial height map for the engine; jets | Open (built; Moon to confirm) | [rendering-engines](rendering-engines.md#q-299-to-q-302-stream-v3-rock-engine-issue-71-d-37) |
| Q-302 | Rock controls and notes in `BuildControls`; known differences | Open (built; Moon to confirm); amended by Q-334 | [rendering-engines](rendering-engines.md#q-299-to-q-302-stream-v3-rock-engine-issue-71-d-37) |
| Q-303 | World engine layout, verbatim blocks, one canvas | Decided (coordinator); amended by Q-335 | [rendering-engines](rendering-engines.md) |
| Q-304 | `cardToWorld`, artifact table and defaults | Decided (coordinator); amended by Q-330, Q-288; Q-347 | [rendering-engines](rendering-engines.md) |
| Q-305 | Engine parity proof and `?parity=1` hook | Decided (coordinator); amended by Q-335 | [rendering-engines](rendering-engines.md) |
| Q-306 | Spin-up budget and resolution scaler stay as the prototype | Decided (coordinator); amended by Q-342; Q-385 | [rendering-engines](rendering-engines.md) |
| Q-307 | The Sun as a reference star (`ref-sun`, NASA Sun Fact Sheet) | Decided in code (Moon to confirm) | [rendering-bodies](rendering-bodies.md) |
| Q-308 | D-37 engine status: prototype star and flare code sliced into engine/stars | Open (being built) | [rendering-bodies](rendering-bodies.md) |
| Q-309 to Q-312 | Star engine hosted (D-37): StarEngine, cardToStar and artifact presets, the globe pick and close-up target, mass assumption | Decided in code (Moon to confirm); Q-309, Q-310 amended by Q-329; Q-310 amended by Q-358, Q-374, Q-312 by Q-363, Q-374; Q-309 amended by Q-381 | [rendering-engines](rendering-engines.md) |
| Q-313 to Q-316 | World engine hosted (D-37): two instances (globe and fly), hosting rule with the Forming state, controls and notes, haptics sampler, known differences | Open (built; Moon to confirm); Q-314 amended by Q-287; Q-316 amended by Q-342, Q-344; Q-313 amended by Q-383, Q-385 | [rendering-engines](rendering-engines.md) |
| Q-317 to Q-319 | Search list S2: 55 Cnc e (reviewed type override), stream S placeholders replaced, lava world in the engine | Open (built; Moon to confirm); Q-319 amended by Q-330 | [rendering-bodies](rendering-bodies.md) |
| Q-323 | Comet gas_Q in the confidence score: flat and epoch-keyed shapes, best epoch per molecule | Open (built; Moon to confirm) | [pipeline-stages](pipeline-stages.md) |
| Q-324 | Reviewed exoplanet type override limited to the water-range refusal with R and M on the card | Open (built; Moon to confirm) | [pipeline-stages](pipeline-stages.md) |
| Q-325 | Review fixes: "found" text joins with "and", lump_ratio radius floor, Gaia MSC cool-star caveat | Open (built; Moon to confirm) | [pipeline-stages](pipeline-stages.md) |
| Q-326 | Asteroid relief and crater review fixes: crater depth 0.33 r, reachable cap, rubble at the angle of repose, `p1-b4` | Open (built; Atish to confirm) | [rendering-bodies](rendering-bodies.md) |
| Q-327 | Confidence score review fixes: surface fields, key-measurement tags, 25 pinned scores, popover bar | Open (built; Atish to confirm); amended by Q-362 | [pipeline-stages](pipeline-stages.md) |
| Q-328 | Reference objects in the pipeline: looked up first, never through the catalogues, no sky position | Open (built; Kevin and Moon to confirm) | [data-sources](data-sources.md) |
| Q-329 | Star engine review fixes: presets, close-up note, limb law, spot temperature, X10 rate, citations | Open (built; Moon to confirm); item 1 amended by Q-358 | [rendering-engines-review](rendering-engines-review.md) |
| Q-330 | World engine and `cardToWorld` review fixes: clouds, CO₂ liquid, lava worlds, preset tolerance, Titan, albedo | Open (built; Moon to confirm); items 2 and 7 amended by Q-355, Q-359 | [rendering-engines-review](rendering-engines-review.md) |
| Q-331 | Gas giant review fixes: Saturn's rings, measured winds and flattening, Great Red Spot, cyclones | Open (built; Moon to confirm) | [rendering-engines-review](rendering-engines-review.md) |
| Q-332 | Gas giant flattening: backend `f_J (P_J/P)^2` against the viewer's measured value or `0.7 q` | Open | [rendering-kinds](rendering-kinds.md) |
| Q-333 | 3I/ATLAS: SOHO/SWAN water point, water break-up, tail reference grain, perihelion | Open (built; Moon to confirm); reference follow-up Q-365 | [rendering-kinds](rendering-kinds.md) |
| Q-334 | Rock engine review fixes: Bennu density, seed hash, preset badges, mesh readouts, lighting tag | Open (built; Moon to confirm); item 2 amended by Q-353 | [rendering-engines-review](rendering-engines-review.md) |
| Q-335 | Verbatim with reviewed `@deviation` fixes; extractors; parity harness not in the repo | Open (built; parity harness to commit); amended by Q-354 | [rendering-engines-review](rendering-engines-review.md) |
| Q-336 | Procyon A: interferometric radius 2.048 R☉ and the α CMi aliases | Open (built; Kevin to confirm) | [catalogue-values](catalogue-values.md) |
| Q-337 | Shader loop bounds `N+uZ0`: cold fly compile 22 to 43 s (corrected 12 Nov), warm cache per session (Q-368) | Decided (Atish, 11 Nov 2026); amended by Q-384 | [rendering-engines-tuning](rendering-engines-tuning.md#q-337-to-q-346-phase-1-first-open-freeze-frame-rate-controls-issue-93) |
| Q-338 | Background compile and `whenReady()`; ready and form timeouts, three.js fallback, Forming loader; star and rock engines still synchronous | Decided (Atish); star and rock compile built by Q-381, Q-382 | [rendering-engines-tuning](rendering-engines-tuning.md#q-337-to-q-346-phase-1-first-open-freeze-frame-rate-controls-issue-93) |
| Q-339 | World engine roles globe, fly, both; skipped hidden globe and Forming draws; build steps wait in `'forming'` | Decided (Atish, 11 Nov 2026); amended by Q-384 | [rendering-engines-tuning](rendering-engines-tuning.md#q-337-to-q-346-phase-1-first-open-freeze-frame-rate-controls-issue-93) |
| Q-340 | Fly pixel footprint at full resolution (`uScale`) | Decided (Atish, 11 Nov 2026); amended by Q-384 | [rendering-engines-tuning](rendering-engines-tuning.md#q-337-to-q-346-phase-1-first-open-freeze-frame-rate-controls-issue-93) |
| Q-341 | One terrain build per input set (`terrainCache.js`) | Decided (Atish, 11 Nov 2026) | [rendering-engines-tuning](rendering-engines-tuning.md#q-337-to-q-346-phase-1-first-open-freeze-frame-rate-controls-issue-93) |
| Q-342 | Resolution scaler at 30 fps; pixel-ratio caps 1.0 fly, 1.25 globe | Decided (Atish, 11 Nov 2026); amended by Q-384 | [rendering-engines-tuning](rendering-engines-tuning.md#q-337-to-q-346-phase-1-first-open-freeze-frame-rate-controls-issue-93) |
| Q-343 | Gas solver at most 3 steps a frame; caption states the real rate | Decided (Atish, 11 Nov 2026); amended by Q-380 | [rendering-engines-tuning](rendering-engines-tuning.md#q-337-to-q-346-phase-1-first-open-freeze-frame-rate-controls-issue-93) |
| Q-344 | Globe click, drag and arrow keys with the close-up open; drags follow the hand, arrows match | Decided (Atish, 11 Nov 2026) | [rendering-engines-tuning](rendering-engines-tuning.md#q-337-to-q-346-phase-1-first-open-freeze-frame-rate-controls-issue-93) |
| Q-345 | Engine bench scripts (`frontend/scripts/engine-bench/`) | Decided (Atish, 11 Nov 2026) | [rendering-engines-tuning](rendering-engines-tuning.md#q-337-to-q-346-phase-1-first-open-freeze-frame-rate-controls-issue-93) |
| Q-346 | Phase 1b: the fly engine adopts the globe's climate state | Deferred (Atish, 11 Nov 2026); built by Q-385 | [rendering-engines-tuning](rendering-engines-tuning.md#q-337-to-q-346-phase-1-first-open-freeze-frame-rate-controls-issue-93) |
| Q-347 | Seeds: 32-bit hash and `seedVec`; world seed is the full hash of the card id | Decided (Atish, 11 Nov 2026) | [rendering-engines-tuning](rendering-engines-tuning.md#q-347-to-q-354-phase-2-repeating-patterns-issue-93) |
| Q-348 | Card gas giants: tracer noise from the sphere direction; TSL `GasWorld` too | Decided (Atish); Moon to confirm the look | [rendering-engines-tuning](rendering-engines-tuning.md#q-347-to-q-354-phase-2-repeating-patterns-issue-93) |
| Q-349 | Card stars seeded: surface `uSO` and spot RNG | Decided (Atish); Moon to confirm the look | [rendering-engines-tuning](rendering-engines-tuning.md#q-347-to-q-354-phase-2-repeating-patterns-issue-93) |
| Q-350 | Seeds for the layers that had none, river relief; rings not seeded | Decided (Atish, 11 Nov 2026) | [rendering-engines-tuning](rendering-engines-tuning.md#q-347-to-q-354-phase-2-repeating-patterns-issue-93) |
| Q-351 | Planet-fixed cube faces for gullies and gas detail; octave fade | Decided (Atish); Moon to confirm the look | [rendering-engines-tuning](rendering-engines-tuning.md#q-347-to-q-354-phase-2-repeating-patterns-issue-93) |
| Q-352 | Catmull-Rom height reads, B-spline climate reads, for shading and haptics; low-frequency warp dropped | Decided (Atish); Moon to confirm the look | [rendering-engines-tuning](rendering-engines-tuning.md#q-347-to-q-354-phase-2-repeating-patterns-issue-93) |
| Q-353 | Rock variety: vec3 seed, full crater hash, crater shapes, boulders | Decided (Atish); Moon to confirm the look | [rendering-engines-tuning](rendering-engines-tuning.md#q-347-to-q-354-phase-2-repeating-patterns-issue-93) |
| Q-354 | #93 deviations in the copied code and the extractors | Decided (Atish, 11 Nov 2026) | [rendering-engines-tuning](rendering-engines-tuning.md#q-347-to-q-354-phase-2-repeating-patterns-issue-93) |
| Q-355 | Critical points for every fluid and a supercritical state | Decided (Atish); NH3-H2O [verify] | [physics-fixes](physics-fixes.md#q-355-to-q-362-phase-3-physics-issue-93) |
| Q-356 | Saturation pressure: Murphy and Koop for water, Lv for CO2 | Decided (Atish, 11 Nov 2026) | [physics-fixes](physics-fixes.md#q-355-to-q-362-phase-3-physics-issue-93) |
| Q-357 | Tides read the preset orbit `p.ob` before the ORB table | Decided (Atish, 11 Nov 2026) | [physics-fixes](physics-fixes.md#q-355-to-q-362-phase-3-physics-issue-93) |
| Q-358 | Turnover time from Reiners et al. 2022, 12.3 d (L/Lsun)^-1/2 | Decided (Atish); coefficient [verify]; inputs corrected by Q-374 | [physics-fixes](physics-fixes.md#q-355-to-q-362-phase-3-physics-issue-93) |
| Q-359 | Catalogue Teq is `derived`; no albedo inverted from it | Decided (Atish, 11 Nov 2026) | [physics-fixes](physics-fixes.md#q-355-to-q-362-phase-3-physics-issue-93) |
| Q-360 | Runaway greenhouse: Kopparapu 2014 inner edge, 282 W/m2, post-runaway surface | Decided (Atish); post-runaway values [verify]; amended by Q-373 | [physics-fixes](physics-fixes.md#q-355-to-q-362-phase-3-physics-issue-93) |
| Q-361 | Climate heat transport and sea ice (#93 3.7, not merged) | Open | [physics-fixes](physics-fixes.md#q-355-to-q-362-phase-3-physics-issue-93) |
| Q-362 | Confidence: conversion tags, no proper motion for stars, giant colour model_dependent | Decided (Atish, 11 Nov 2026) | [physics-fixes](physics-fixes.md#q-355-to-q-362-phase-3-physics-issue-93) |
| Q-363 | New optional card fields: eccentricity, insolation, luminosities, FLAME mass, flare rate, phase curves | Decided (Atish, 11 Nov 2026); amended by Q-374 to Q-376, Q-379 | [contract](contract.md) |
| Q-364 | Literature rows: star rotation periods, TRAPPIST-1 flare rate, phase-curve values | Decided (Atish); Kevin to confirm the readings; amended by Q-377 | [catalogue-values](catalogue-values.md) |
| Q-365 | 3I/ATLAS SOHO/SWAN point: published reference and date | Open | [catalogue-values](catalogue-values.md) |
| Q-366 | #93 cache keys, `ASSET_VERSION` 12 and the A15 re-warm | Decided (Atish, 11 Nov 2026); amended by Q-376, Q-378 | [catalogue-values](catalogue-values.md) |
| Q-367 | Engines kill switch `?engines=0`, kept in `localStorage['sx.engines']` | Open (built); Atish to confirm | [rendering-engines-tuning](rendering-engines-tuning.md#q-367-and-q-368-regression-and-operations-fixes-issue-93) |
| Q-368 | Chrome's GPU cache drops KHR-linked programs; the ANGLEPerContextBlobCache flag and the demo warm-up | Proposed (Atish to confirm on the A15) | [rendering-engines-tuning](rendering-engines-tuning.md#q-367-and-q-368-regression-and-operations-fixes-issue-93) |
| Q-369 | A live card with a catalogue gap never beats the pack; smoke_offline checks data gaps | Open (built); Kevin to confirm with Q-206 | [demo-pack](demo-pack.md) |
| Q-373 | Post-runaway temperature only between 50 and 260 bar; K2-18 b keeps 401 K, no lava | Decided (Atish, 12 Nov 2026); post-runaway values [verify] | [physics-fixes](physics-fixes.md#q-373-to-q-380-physics-and-data-follow-up-issue-93) |
| Q-374 | Turnover time from the card's R and T, not `lum_lsun`; Barnard's Star about 193 d | Open (built); Atish to confirm | [physics-fixes](physics-fixes.md#q-373-to-q-380-physics-and-data-follow-up-issue-93) |
| Q-375 | World-engine starlight from `insolation_searth` first; a 5 % mismatch line | Open (built); Atish to confirm | [physics-fixes](physics-fixes.md#q-373-to-q-380-physics-and-data-follow-up-issue-93) |
| Q-376 | Eccentricity limit flag `pl_orbeccenlim`, archive columns version 4 | Open (built); Atish to confirm | [physics-fixes](physics-fixes.md#q-373-to-q-380-physics-and-data-follow-up-issue-93) |
| Q-377 | Phase-curve rows: 55 Cnc e offset refused, HD 189733 b offset from Knutson 2012 | Decided (Atish, 12 Nov 2026); Kevin to confirm the readings | [physics-fixes](physics-fixes.md#q-373-to-q-380-physics-and-data-follow-up-issue-93) |
| Q-378 | Gaia FLAME luminosity ×1e6, `msc1-flame3`, `ASSET_VERSION` 13 | Open (built); Atish to confirm | [physics-fixes](physics-fixes.md#q-373-to-q-380-physics-and-data-follow-up-issue-93) |
| Q-379 | Eclipse and phase-curve readouts at every honesty level, band-named labels (D-21); they follow the toggle (a derived value hidden at Measured only) | Decided (Atish, 12 Nov 2026) | [physics-fixes](physics-fixes.md#q-373-to-q-380-physics-and-data-follow-up-issue-93) |
| Q-380 | Gas caption rate at the measured frame rate | Open (built); Atish to confirm | [physics-fixes](physics-fixes.md#q-373-to-q-380-physics-and-data-follow-up-issue-93) |
| Q-381 | Star engine background compile, one surface canvas, black plasma pass skipped, 60 Hz; three.js streak range, sunspot branch, `StillStarCache` | Open (built); Atish to confirm | [rendering-engines-perf](rendering-engines-perf.md#q-381-to-q-387-performance-waves-issue-93) |
| Q-382 | Rock engine background compile, baked cube maps, jets in the vertex shader, off-screen pause, culling, `Mirror`, worker build, debounced age | Open (built); Atish to confirm; Moon to confirm the baked look | [rendering-engines-perf](rendering-engines-perf.md#q-381-to-q-387-performance-waves-issue-93) |
| Q-383 | Viewer and world host: GPU timing, fly view kept mounted and paused, field caches, 75 % TAAU scene, dynamic resolution, direct close-up paint | Open (built); Atish to confirm | [rendering-engines-perf](rendering-engines-perf.md#q-381-to-q-387-performance-waves-issue-93) |
| Q-384 | Fly view: max-height pyramid, shadow skip, B9 scaler, no `WORLD_FS`, static G-buffer, `textureLod` reads | Open (built); Atish to confirm | [rendering-engines-perf](rendering-engines-perf.md#q-381-to-q-387-performance-waves-issue-93) |
| Q-385 | One planet simulation for the globe and fly view, in a Web Worker (default `?sim=worker`); climate loop within its budget | Decided (Atish, 12 Nov 2026) for the worker default; built; globe forming time [verify] on the A15 | [rendering-engines-perf](rendering-engines-perf.md#q-381-to-q-387-performance-waves-issue-93) |
| Q-386 | 60 Hz cap on the star and world engine hosts; the three.js cap stays opt-in (Q-64, Q-66) | Open (built); Atish to confirm with Q-64 | [rendering-engines-perf](rendering-engines-perf.md#q-381-to-q-387-performance-waves-issue-93) |
| Q-387 | Water glint blooms, so Q-67's premise is false; the bloom skip is opt-in (`?bloomgate=1`) | Open; Moon to decide | [rendering-engines-perf](rendering-engines-perf.md#q-381-to-q-387-performance-waves-issue-93) |
| Q-400 | Area frames and dots: P3's choices for the spec gaps | Proposed | [moving-objects](moving-objects.md) |
| Q-401 | Area starting values against the Day 0 count | Open (offline numbers; live Day 0 pending) | [moving-objects](moving-objects.md) |
| Q-402 | Conflicts P3 met in the Area spec (incl. A17.3 star or fixed) | Open; (5) decided by Moon | [moving-objects](moving-objects.md) |
| Q-403 | Star list for movers: choices for the spec gaps | Proposed | [moving-objects-review](moving-objects-review.md) |
| Q-404 | Owner of the star list for movers (amends Q-183, D-17) | Proposed | [scope-process](scope-process.md) |
| Q-406 | Area search P8 joins the sky dock: main's UI, PR #100's data layer (real areas first, demo fallback) | Decided (Moon, 13 Nov 2026) | [moving-objects](moving-objects.md) |
| Q-407 | Honesty switch on the sky for Area search | Withdrawn | [moving-objects](moving-objects.md) |
| Q-408 | Blink for n visits and reduced motion | Withdrawn | [moving-objects](moving-objects.md) |
| Q-409 | Light theme for the panels | Open | [shell-surfaces](shell-surfaces.md) |
| Q-410 | The "artist's impression" line removed from Details | Open | [shell-surfaces](shell-surfaces.md) |
| Q-411 | Pause removed from the Details pane (P key instead) | Open | [shell-surfaces](shell-surfaces.md) |
| Q-412 | Show (honesty level) moves into Details in the build pane | Proposed (Moon to confirm) | [shell-surfaces](shell-surfaces.md) |
| Q-413 | The island's loader pulses at rest | Open | [shell-surfaces](shell-surfaces.md) |
| Q-414 | Known objects and Discovery demo answers only inside the Eros area (real areas first: Q-406; Known rows and Track it: Q-455) | Answered by Q-406 | [shell-surfaces](shell-surfaces.md) |
| Q-415 | Moulding animation is the mock-up's generic body (amends Q-113 item 3) | Open | [shell-surfaces](shell-surfaces.md) |
| Q-416 | Hear it: Atmosphere and the spectrum sweep (amends Q-295); amended by Q-446 (sweep on `pitch.ts`) and Q-450 (opens from Details) | Open (Atish to wire after merge) | [shell-surfaces](shell-surfaces.md) |
| Q-417 | The browser tab reads "Odysseus" | Decided (Moon, tab title only) | [shell-surfaces](shell-surfaces.md) |
| Q-418 | Matte glass on the floating surfaces; island cards minimise into the pill | Decided (Moon); contrast on the brightest sky open (unmeasured) | [shell-surfaces](shell-surfaces.md) |
| Q-419 | Build view opens without the split; Split view and Atmosphere toggles in its header (amended by Q-450) | Decided (Moon) | [shell-surfaces](shell-surfaces.md) |
| Q-420 | Discovery from labels to the API: P4 to P7's choices (pair test, known check, entries, pack) | Proposed | [moving-objects](moving-objects.md) |
| Q-430 | Pitch polarity: long wavelength = low pitch (amends Q-70, Q-134) | Decided (built #111) | [sound-ambience](sound-ambience.md) |
| Q-431 | Listener model: quasi-static, no Doppler | Decided | [sound-ambience](sound-ambience.md) |
| Q-432 | Air physics for sound | Decided | [sound-ambience](sound-ambience.md) |
| Q-433 | Sound inputs and WorldEngine accessors | Decided | [sound-ambience](sound-ambience.md) |
| Q-434 | `hKm` CPU port with a parity test | Decided | [sound-ambience](sound-ambience.md) |
| Q-435 | Planetary wind model | Decided | [sound-ambience](sound-ambience.md) |
| Q-436 | Sound source catalogue and gates | Decided | [sound-ambience](sound-ambience.md) |
| Q-437 | Weather: lightning and thunder | Decided | [sound-ambience](sound-ambience.md) |
| Q-438 | Weather visuals overlay and flash safety | Decided | [sound-ambience](sound-ambience.md) |
| Q-439 | Ambience bake method (Moon's DSP, corrected) | Decided | [sound-ambience](sound-ambience.md) |
| Q-440 | Ambience level model and presentation offset | Decided | [sound-ambience](sound-ambience.md) |
| Q-441 | Stage audibility, buses and ducking | Decided (buses built #111) | [sound-ambience](sound-ambience.md) |
| Q-442 | Sound UI, captions, "What you hear" | Decided (Sound popover built #111) | [sound-ambience](sound-ambience.md) |
| Q-443 | Spectrum chord; amended by Q-446 | Decided | [sound-ambience](sound-ambience.md) |
| Q-444 | Determinism for sound: one JavaScript engine | Decided | [sound-ambience](sound-ambience.md) |
| Q-445 | Bake engine deviations from R13 (PR #119, #113) | Decided (as built) | [sound-ambience](sound-ambience.md) |
| Q-446 | Spectrum chord as built (amends Q-443, Q-416): the Hear it sweep on `pitch.ts`, Smooth = running median, empty bins silent, tutorial cut, one normalisation (#115) | Decided (as built) | [sound-ambience](sound-ambience.md) |
| Q-447 | Ceiling caption gains the height to fly below, N = H ln(P0 / P_FLOOR) (#116 code review) | Decided | [sound-ambience](sound-ambience.md) |
| Q-448 | Ambience integration as built (#116): fades, groups, weatherBus, chip, sound-check | Decided (as built; contract amendment 4 proposed) | [sound-ambience](sound-ambience.md) |
| Q-449 | Weather overlay as built: strokes, glow spacing, small area, drawn deck (#117) | Decided (as built); parts open | [sound-ambience](sound-ambience.md) |
| Q-450 | Build header: Accuracy, Ambience, Explore, Details; Hear it opens from Details; Explore springs | Proposed (Atish to confirm the Hear it part) | [shell-surfaces](shell-surfaces.md) |
| Q-451 | Client timeouts (25 s for resolve only) and error boundaries for the demo (issue #102) | Decided | [shell-surfaces](shell-surfaces.md) |
| Q-452 | Frame-rate menu after the player; simpler sky info popover | Decided (Moon) | [shell-surfaces](shell-surfaces.md) |
| Q-453 | One clock for the build strip; chips leave with a staggered spring | Decided (Moon) | [shell-surfaces](shell-surfaces.md) |
| Q-454 | Warm-start progress on `/v1/health` and the demo preflight (amends Q-195) | Proposed (Kevin to confirm with Q-195) | [contract](contract.md) |
| Q-455 | Known objects on the real `/v1/areas`; the Eros card is the event's Track-lite (issue #130; builds on Q-406) | Decided (Moon) | [shell-surfaces](shell-surfaces.md) |
| Q-456 | Sound settings move from the sky's top bar into the build view's Ambience dropdown | Decided (Moon) | [shell-surfaces](shell-surfaces.md) |
| Q-457 | Build view: no dock, Minimise into the island, "Read paper" beside the zoom | Decided (Moon) | [shell-surfaces](shell-surfaces.md) |
| Q-458 | Tone stream as built (Q-189) and the two-note exposure tick as one event through the 25 ms gap (`emitTogether`, #77) | Decided (as built) | [sound-ambience](sound-ambience.md) |
| Q-459 | Track path sound "Hear the Shift" as built on the Eros card (#78): ticks per exposure, voice while playing, no reference click yet | Decided (as built); creative values open | [sound-ambience](sound-ambience.md) |
| Q-460 | How Stage 2 records OUTLIER on a mover's core (config field, pixels kept, `outlier_core`, `measure-2`) | Decided (issue #72) | [moving-objects](moving-objects.md) |
| Q-461 | Known objects: `track_available` from the cache, Track pre-fetch per Known object (amends Q-420 (8)) | Proposed | [moving-objects](moving-objects.md) |
| B-01 to B-04 | Post-event backlog | Backlog | [scope-process](scope-process.md#post-event-backlog) |
