# Decision log

Decisions that reconcile the [architecture spec](architecture/README.md) with the [rendering & haptics spec](rendering/README.md). Where this file states a decision, it wins over both. "Architecture spec §x" means section **Ax** and "rendering doc §x" means **Rx**; each spec index has a section map.

Format: one entry per decision. Status is **Accepted** unless marked otherwise. Recorded 4 Nov 2026.

---

## D-01 Where surfaces are generated

- **Context:** The architecture spec (§6) generated every body in the browser with shaders and triplanar mapping. The rendering doc (§5.5, §6) bakes height, normal and albedo maps on the backend in Python, as equirectangular images.
- **Decision:**
  - Every type defined in the rendering doc (`asteroid_shape`, `asteroid_procedural`, `comet`, `brown_dwarf`, `brown_dwarf_binary`, `star`, `star_mira`, `star_ttauri`, `candidate`) follows the rendering doc. Procedural maps are **baked by the backend**, never computed per frame.
  - The kinds that exist only in the architecture spec (`planet_rocky`, `planet_water`, `gas_giant`, `nebula`, `nova`; see D-04) keep the **browser shader generators** with triplanar mapping. Their haptics come from a shared CPU field (D-12).
- **Why:** Rendering doc principle 6 ("one height map drives everything") needs a height field that the finger, the normals and the sound can all sample. A shader-only surface does not provide one.

## D-02 Data model and provenance tags

- **Context:** The architecture spec used a "settings file" with 3 sources (measured / estimated / default). The rendering doc uses `ObjectCard` + `RenderParams` with 5 tags.
- **Decision:**
  - `ObjectCard` and `RenderParams` (rendering doc §3) are the data contract. The settings-file schema (architecture spec §5) is retired.
  - Internally every value carries one of the 5 tags. The UI shows 3 badges:

    | Tag | Badge |
    |---|---|
    | `measured` | **Measured** |
    | `derived`, `model_dependent`, `inferred_from_analog` | **Estimated** (tooltip shows the formula, assumption or analog) |
    | `artistic` | **Default** (artist's choice) |

  - A fourth, dev-only "Fixture" badge for synthetic fixture data is proposed as an exception, not decided: see Q-32.
  - User slider edits live in a client-side `overrides` map, separate from the card, so Reset restores the data values. See Q-03 for sliders on baked bodies.

## D-03 three.js version

- **Decision:** The app uses **three r187** through `three/webgpu` (`WebGPURenderer`, WebGL2 fallback **[verify]**). The mock-up stays on r128 and is not ported in place.
- **Why:** r187 is the pinned version in the rendering doc. Generators move from the mock-up into ES modules anyway.

## D-04 Object types

- **Decision:** `ObjectType` is the union of both lists:
  - From the rendering doc: `asteroid_shape`, `asteroid_procedural`, `comet`, `brown_dwarf`, `brown_dwarf_binary`, `star_mira`, `star_ttauri`, `star`, `candidate`.
  - From the architecture spec: `planet_rocky`, `planet_water`, `gas_giant`, `nebula`, `nova`. These are P2 or lower and come from the Exoplanet Archive or user sliders, not from SPHEREx detections.
- The architecture spec's old `dwarf` kind maps to `brown_dwarf`, and `asteroid` maps to `asteroid_shape` or `asteroid_procedural`.

## D-05 Target hardware and budgets

- **Decision:** Two targets. The **demo laptop** is an Intel Iris Xe (Zenbook 14X). The **phones** are the realme 14 Pro and a Samsung, both Android 16 with Chrome. Haptics can only be shown on the phones. Where the budgets differ, take the tighter one:

  | Item | Budget |
  |---|---|
  | Frame rate | ≥ 30 fps while rotating; render only on change |
  | Pixel ratio | `min(devicePixelRatio, 1.5)` |
  | Mesh | ≤ 50k triangles (decimate NASA GLBs offline) |
  | Points | ≤ 60k |
  | Textures | 2048×1024 desktop, 1024×512 mobile |
  | Displacement | Desktop only |

## D-06 Scope cuts for the event

- **Decision:** Move these to the post-event backlog: Gemini Live voice control, ElevenLabs and other AI sound clips, image-to-3D (TRELLIS, Hunyuan3D, TripoSR), and the Tauri Android app.
- **Stays in scope:** procedural sound (the data sweep and the "imagined drive"), with the Gemini artistic paint as a P3 stretch.

## D-07 Gemini artistic layer

- **Decision:** Use the rendering doc's method (§6.6). Gemini repaints albedo using a hillshade of the baked height map as its reference. Output whose edge correlation is below 0.3 is rejected. The call is made server-side only and the result is labelled "AI-made".
- The architecture spec's seamless-tile-plus-triplanar method (§6.2) applies only to the browser-shader kinds (D-01).

## D-08 Haptics run on the web, not in a native app

- **Decision:** For the event, haptics use `navigator.vibrate` in Android Chrome. iPhone, iPad and desktop get audio only. No Tauri build.
- **Why:**
  - The challenge requires a web tool, and judges will not sideload an APK.
  - `navigator.vibrate` covers every pattern in rendering doc §8.3.
  - The `HapticDriver` interface lets `drivers/tauri.ts` be added later (B-01) without touching the event sources.

## D-09 Haptic strength is quantised

- **Context:** `navigator.vibrate` takes durations only. There is no amplitude control in Chrome as far as we know **[verify]**.
- **Decision:**
  - The web driver maps `strength` to **3–4 discrete levels** (soft, medium, firm, plus an optional pulse-width "whisper" if the phone can render it). It does not use a continuous scale.
  - Fine detail is carried by **rhythm, rate and spacing**, and by the paired audio (D-10).
  - Calibration measures both the faintest pulse each phone can render (`minMs`) and how many levels can be told apart, stored per device.

## D-10 Audio pairing on every platform

- **Decision:**
  - The audio driver is no longer only a fallback. It plays **alongside** the vibration on every platform, with its own on/off switch and volume.
  - Every `HapticEvent` goes to both drivers.
  - Audio carries continuous strength (gain), pitch, stereo pan and provenance, which is shown by timbre: clean tone for `measured`, grainy click for `artistic`.
  - Spec: rendering doc §8.9.

## D-11 Repo and doc layout

- **Decision:**
  - Docs live in `docs/`, the mock-up in `mockup/`, and the code in `backend/`, `frontend/` and `shared/`, as laid out in rendering doc §10.
  - `CLAUDE.md` at the root points to the docs and states the precedence.
  - The handover doc was renamed `initial.md` → `docs/handover.md`.

## D-12 Haptics on gas giants, water worlds and other shader-generated bodies

- **Status:** Accepted, signed off by Atish (D-13) on 5 Nov 2026. Moon's confirmation of the shader-kind architecture (the shared field and its packing) was requested in PR #18 and is pending. The jet pulse rate stays **[verify on phones]**.
- **Context:** These kinds are drawn by browser shaders (D-01), so there is no baked height map for a finger to sample. For exoplanets there is also no measured surface at all, so every texture haptic is `artistic`.
- **Decision:**
  - **One shared field per body.** When a body loads, a Web Worker generates an equirectangular field at 512×256 from the same seed and functions as the shader. It does this once, not per frame. The field has channels for height, band index, ocean mask, ice mask and storm id.
  - The shader samples the field as a `DataTexture`, and the haptic sources sample the same array. This keeps rendering doc principle 6 ("one height map drives everything") true for these kinds.
  - The shader may add finer visual noise below the field's resolution. That detail is seen but not felt.

  | Kind | Texture haptics (`artistic`) | Data haptics |
  |---|---|---|
  | `gas_giant` | No surface, so the finger feels the **flow**: a soft tick crossing each band boundary (strength = band contrast); inside a jet, a pulse train whose rate ∝ the zonal wind speed at that latitude; on a storm, a firm tick at its edge and a pulse rate that rises towards its centre (a "swirl"); dragging across rings gives a tick at each gap | Holding still gives a steady pulse, rate ∝ normalised `Teq` (`derived`, 2–12 Hz), as for brown dwarfs |
  | `planet_water` | Open ocean: near-silent slow swell (1–2 Hz, lowest level); coastline: one firm tick; land: height-map ticks as for `asteroid_procedural`; polar ice: dense, fine, soft ticks; clouds: not felt (optional "feel clouds" toggle) | As for `gas_giant` (`Teq` pulse) |
  | `planet_rocky` | Height-map ticks; lava cracks give a double tick | As for `gas_giant` |
  | `nebula`, `nova` | Field source as for the comet (§8.4): pulse rate ∝ local point density | — |

  - **Audio pairing (D-10):**
    - Gas giant bands: a tone whose pitch follows latitude.
    - Ocean: filtered noise, a "surf" sound.
    - Land: clicks, as for asteroids.
    - Every texture sound uses the `artistic` timbre.
  - **Honesty:** in "Measured only" all texture haptics on these kinds are silent, because nothing about their surfaces is measured. The data pulse remains only when `teq_K` is `measured` (Exoplanet Archive `pl_eqt`); a `derived` pulse plays from "+ Estimated" (D-21).
  - **HapticProfile:** `texture` gains `'terrain'` (height plus ocean and ice masks) and `'flow'` (bands, jets, storms). `data` gains `'teq_pulse'`.
  - **Field channels and packing.** There are six channels, packed into two RGBA `Float32` `DataTexture`s. The haptics read the same `Float32Array`s.
    - Texture A: R = height, G = band index, B = storm id, A = unused.
    - Texture B: R = ocean mask, G = ice mask, B = lava-crack mask, A = unused.
  - **Jet pulse rate:** clamp(k · |zonal wind| / max |zonal wind|, 2, 20) Hz **[verify on phones]**.
  - **New ObjectCard field:** `teq_K?: TV` (planet equilibrium temperature, from Exoplanet Archive `pl_eqt` when present, tagged `measured`, otherwise `derived` from architecture spec §7.1). `teq_pulse` is refused and listed in `missing` when it is null.
  - `nebula` and `nova` have no catalogue rule. They are slider-only showcase bodies, and every value is tagged `artistic`.
  - **Strength quantisation (D-09):** split 0–1 into equal bins as a starting point. Calibration may move the bin edges per device.

## D-13 Creative ownership of haptics

- **Decision:** The haptic feedback concept is Atish's idea, and **Atish owns its creative direction**: what each body and data type feels like, the patterns and metaphors, and how sound pairs with touch. Atish signs off haptics design decisions, including D-12 and Q-11.
- **How it applies:**
  - Teammates' prototypes, such as the mock-up's `SphereXHaptics`, and agent suggestions are input, not decisions.
  - Agents implement the design as written. Where it is open, they use a neutral placeholder marked `CREATIVE: placeholder — Atish to decide`.
  - Engineering choices stay with the implementer: drivers, timing, rate limits, buffering and testability.
- Recorded 4 Nov 2026.

---

Decisions D-14 to D-29 were recorded on 5 Nov 2026. They answer Q-01 to Q-14 and add the hosting, caching and milestone decisions.

## D-14 Build from 5 Nov (answers Q-10)

- **Decision:** The team builds from 5 Nov, following the dates in architecture spec §13. The team has chosen to set aside the event rule against building before 14 Nov; that call and its risk belong to the team.
- **How it applies:** `CLAUDE.md` no longer limits the repo to docs and scaffolding before the event.
- **Approval:** Atish, 5 Nov 2026. Kevin and Moon were asked to confirm in PR #18; their confirmations are pending and will be recorded here. Because this sets aside an event rule and could risk disqualification, any teammate may reopen it.

## D-15 Backend framework: FastAPI (answers Q-01)

- **Decision:** The backend is **FastAPI** on Python 3.12, with Pydantic v2 models. Versions are pinned exactly when installed.
- **Why:** async calls suit the slow external services (IRSA, Gaia); Pydantic validates cards and render params at the API boundary; Astropy works without glue.

## D-16 API endpoints (answers Q-06)

- **Decision:** Every endpoint is keyed by one object id, returned by `resolve`. There is no separate flipbook endpoint: the flipbook plays the frame list in order.

  | Endpoint | Returns |
  |---|---|
  | `GET /v1/resolve?q=<name or ra,dec>` | `{ id, ra, dec, moving }` |
  | `GET /v1/objects/{id}/frames` | `[{ frame_id, time, wavelength_um, x, y, cutout_url }]` |
  | `GET /v1/objects/{id}/cutouts/{frame_id}.png` | The cutout, stretched to PNG by the server. The stretch used is stated in the frames response. |
  | `GET /v1/objects/{id}/spectrum` | Spectrum `[(wavelength_um, flux, error)]` and light curve `[(time, flux)]`, tagged `measured` |
  | `GET /v1/objects/{id}/card` | ObjectCard (rendering doc §3.2) |
  | `GET /v1/objects/{id}/render-params` | RenderParams (rendering doc §3.4) |

- Responses served from the cache carry `cached_at` (D-25).

## D-17 Owners (answers Q-07 and the ownership part of Q-14)

- **Decision:**

  | Person | Owns |
  |---|---|
  | Kevin | Backend scaffold, data adapters, pipeline stages 1, 4 and 5, the API, the Gaia and WISE adapters, local hosting (D-24) |
  | Atish | Pipeline stage 3 (classify), stage 7 (`card_to_params`), the texture baker, all haptics (D-13), `frontend/src/viewer/fields/`, the Gemini layer |
  | Moon (Munazir) | `frontend/src/app/`, `frontend/src/state/`, the flipbook UI, the viewer, the shader kinds, the overlay UI; pipeline stage 2 (brightness and spectrum), `shared/schemas/` and `shared/fixtures/`, the physics layer (architecture spec §7) |

- `frontend/src/contract/` and `backend/app/contract/` are generated code (D-18) and follow the owner of `shared/schemas/`.
- Munazir and Moon are the same person (GitHub `MintHerbs`). The separate Munazir row was merged into Moon's on 5 Nov 2026 (answers Q-16).

## D-18 The contract is generated from `shared/schemas/` (answers Q-14)

- **Decision:**
  - `shared/schemas/*.json` (JSON Schema) is the single source of the data contract.
  - The backend generates its Pydantic models with `datamodel-code-generator`. The frontend generates `frontend/src/contract/` types with `json-schema-to-typescript`. Both tools are pinned exactly: `datamodel-code-generator` 0.89.0 and `json-schema-to-typescript` 16.0.0.
  - CI fails if regenerated files differ from the committed ones, so the two sides cannot drift.
  - `assertTagged()` and other hand-written helpers move next to the generated types, not into them.
- The generated types replaced the hand-written types from the 4 Nov scaffold in issue #4.

## D-19 Name resolver order (answers Q-05)

- **Decision:** Route by the shape of the name, then fall back to the other service.
  - Names that look like small bodies (numbered asteroids such as `433 Eros`, provisional designations such as `2024 AB`, comets such as `C/…`, interstellar objects such as `3I/ATLAS`) go to **SBDB** first.
  - Everything else goes to **SIMBAD** first.
  - On a miss, try the other one. RA/Dec input skips name resolution.

## D-20 Haptics API (answers Q-11)

- **Decision (Atish, D-13):** the merge proposed in Q-11.
  - Rendering doc R8.8's discrete `HapticEvent` is the core API. It carries the provenance `tag`, which the honesty rule and the audio timbre need.
  - `HapticEvent` gains an optional `sharpness`. The web driver ignores it; a future Tauri driver (B-01) uses it.
  - The mock-up's native and iOS bridges are dropped for the event (D-08). The `HapticDriver` interface keeps the door open.
  - The mock-up's `spherex:haptic` DOM event stays as a debug hook. It also drives an on-screen pulse indicator, so an audience watching the laptop can see what the phone feels.
  - Nebulae and novae get the D-12 field pulse, not a refusal.
  - Tick lengths follow R8.3: 8–25 ms with the calibrated `minMs`.

## D-21 Honesty toggle follows the three badges (answers Q-08)

- **Context:** Rendering doc R5.3's states did not line up with the D-02 badges: "Measured only" still showed `derived` layers, and "+ Derived" split the Estimated badge.
- **Decision:** The toggle has three states, one per badge:

  | State | Shows tags |
  |---|---|
  | **Measured only** | `measured` |
  | **+ Estimated** (starting state) | adds `derived`, `model_dependent`, `inferred_from_analog` |
  | **+ Artistic** | adds `artistic` |

- Haptics use the same filter. `teq_pulse` plays in "Measured only" only when Teq comes from Exoplanet Archive `pl_eqt` (`measured`); when it is `derived` it is silent there.
- **Why start at + Estimated:** everything shown on load is backed by data or a stated formula. Moving up to Artistic and down to Measured is the demo of the honesty story.

## D-22 What a saved asset holds (answers Q-09)

- **Decision:** A saved asset holds the ObjectCard, the RenderParams, the texture URLs, `generator_version`, `seed` and `created_at`. `generator_version` and `seed` keep the rendering doc §6.7 cache key reproducible.
- `overrides` stay in the browser (IndexedDB) and are never sent to the server.

## D-23 Fields of `VisibleMode` and `IRMode` (answers Q-12)

- **Decision:** Both use one shape:

  ```ts
  {
    available: boolean;
    badge: string;
    rgb: TV<[number, number, number]> | null;             // same type as gaia_rgb / spherex_rgb; TV carries the tag
    source: 'gaia_rgb' | 'class_palette' | 'spherex_rgb';
    channels_um?: [number, number, number];               // IRMode only (rendering doc §5.2)
  }
  ```

- When a mode is not available, the reason goes in `missing`, as rendering doc §5.2 already says.

## D-24 Hosting: local on the Asus A15 (answers Q-02)

- **Decision:** The event build runs locally on the team's **Asus A15** laptop. One process serves the built frontend and the API from one origin. The phones and other laptops connect over the local network.
- **How it applies:**
  - Serve over HTTPS, because WebGPU needs a secure context. Install a local root certificate on both Android phones (e.g. `mkcert`); whether a clicked-through self-signed certificate is enough is **[verify]**.
  - Bring a router or hotspot. Venue Wi-Fi may block device-to-device traffic.
  - The demo must run with no internet (D-25). The Gemini layer then stays off and the code path shows.
  - There is no public URL after the event. A static hosted copy is a later, separate decision.
- Whether the A15 also replaces the Zenbook as the demo screen is open (Q-15).

## D-25 Cache every external call; offline demo mode

- **Context:** IRSA times out (architecture spec §3.1), Gaia takes about 24 s per query, and the venue internet may fail.
- **Decision:**
  - Every external call (IRSA, Gaia, WISE, Horizons, SkyBoT, SBDB, SIMBAD, Exoplanet Archive, Gemini) goes through one read-through disk cache in the backend.
  - **Key:** source + data release (e.g. `spherex_qr2`) + the normalised query, with coordinates rounded. **Value:** the raw response, `fetched_at` and the source URL.
  - **Order:** cache → live call with a timeout and retries with backoff → an older cached entry → refuse. A refused layer goes in `missing`; nothing is invented.
  - **No expiry for the event.** Catalogue releases do not change, and ephemerides for fixed times do not change.
  - **`SX_OFFLINE=1`** never touches the network. The demo runs in this mode.
  - A **pre-fetch script** fills the cache for the 5 test targets and every demo object while the internet is good.
  - Cutouts only, never whole frames (about 72 MB each). The cache lives on the A15, outside git, with a zipped backup.
  - Derived results (spectra, cards, render params) are cached too. Textures follow rendering doc §6.7.
  - The cached responses double as the recorded test fixtures (architecture spec §12). The responses used under `SX_OFFLINE=1` are therefore test fixtures: never hand-edit them. To change one, re-record it with the pre-fetch script.
  - Responses served from cache carry `cached_at`, so the UI can show the data's date.
- **Optional:** the phones may keep the last loaded object in browser storage to survive a short Wi-Fi drop.

## D-26 Sliders on baked bodies (answers Q-03)

- **Decision:** For the event, baked types allow only **colour, lighting and spin** sliders. Relief sliders exist only on the shader kinds, which redraw live. A re-bake on every drag would be too slow.

## D-27 Type of `overrides` (answers Q-13)

- **Decision:** `overrides` is `Partial<Record<SliderKey, number | boolean>>`. A slider registry lists every allowed key as `{ key, min, max, step, unit, appliesTo: ObjectType[] }`, so an unknown key fails the type check. Values use the same units as the card.

## D-28 Rainbow Trails is a flipbook view mode (answers Q-04)

- **Decision:** Rainbow Trails (handover §5: one dot per band along a moving object's path) is a view mode of the flipbook, not a separate feature. It uses the frames and mover positions the flipbook already loads. Priority P1, built after basic playback works.

## D-29 Milestones are independent tracks

- **Decision:** Work is tracked in the GitHub project "SphereX and PlanetX - NASA COMPETITION 2026" with five milestones:

  | Milestone | Due |
  |---|---|
  | M1 SPHEREx core: flipbook + spectrum (P0) | 8 Nov |
  | M2 Sky Sculptor: 3D body (P1) | 10 Nov |
  | M3 Haptics & sound (P1/P2) | 11 Nov |
  | M4 Extras (P1–P3, cut from the bottom) | 12 Nov |
  | M5 Demo & submission | 15 Nov |

- M1 to M4 do not depend on each other. Each builds against its own fixtures (recorded responses, sample cards and spectra). Only M5 joins them. Each milestone holds as few tickets as possible.
- Open questions and **[verify]** items sit inside the ticket that needs them.

## D-30 Milestone owners and dependencies

- **Decision (Atish, 5 Nov 2026):** one owner for the milestones where one person leads; the rest are shared.

  | Milestone | Owner |
  |---|---|
  | M1 SPHEREx core | Shared (issues #1–#3, merged as PRs #19–#21) |
  | M2 Sky Sculptor | Moon (`MintHerbs`) |
  | M3 Haptics & sound | Atish (`JoottunAtish`) |
  | M4 Extras | Shared |
  | M5 Demo & submission | Kevin (`KevinYerkiah`, assigned on GitHub once he accepts the repo invite) |

- The milestone owner leads and signs off the milestone; ticket owners from D-17 still apply inside it.
- Numbering: `#1`–`#17` below and in architecture spec §13 are GitHub **issue** numbers (one per ticket); PR numbers are written as "PR #n".
- **Dependencies:** M1–M4 have no hard dependency on each other (D-29). Three soft links run across milestones: texture haptics (#11, M3) read the shared CPU field from #8 (M2); the Gemini layer (#14, M4) repaints the albedo from the baker's height map (#6, M2, D-07); physics sliders (#13, M4) need the viewer (#7, M2) to be seen. Each can be built against fixtures first. M5 depends on all of them. The map is in architecture spec §13.

## 7 Nov 2026: tiers, accuracy and motion (issue #38)

Source: the team plan "Physics-backed Sky Sculptor" (6 Nov 2026). D-31 to D-33 were accepted by Moon as M2 owner (D-30).

## D-31 Tier fallback chain (partly answers Q-38)

- **Context:** D-02 gives every value one of 5 tags, and CLAUDE.md said "refuse rather than invent". A missing input then removed a whole layer, although a typical value for the kind of body, clearly labelled, is honest and more useful. `Layer` also had no field for its formula or assumption (Q-38).
- **Decision:** the 5 tags are also 5 **tiers**, and a layer or rate that lacks its measured input falls down the chain and says which rung answered:

  | Tier | Tag | Meaning |
  |---|---|---|
  | 1 | `measured` | measured value (SBDB, SIMBAD, SPHEREx, shape model) |
  | 2 | `derived` | formula whose inputs are all measured |
  | 3 | `model_dependent` | same formula with at least one input set to a typical class value (stated) |
  | 4 | `inferred_from_analog` | typical for this kind of body, no formula |
  | 5 | `artistic` | look only |

  - **Chain, in order:** step 0 a measured whole-body model (shape model) drawn as is (R7.1); 1 measured; 2 formula of measured inputs; 3 same formula with one typical input; 4 typical for its kind; 5 art. The first rung that can answer wins. The result carries its tier, its formula and the assumed input.
  - **Never fall back upward.** A tier 4 value is never shown as tier 2.
  - "Refuse rather than invent" becomes "fall back a tier and label it" for `RenderParams` layers and dynamics rates. A refusal (`missing`) stays only when no rung can answer.
  - **Refusal stays for** physical size (`scale_m` and the scale bar; Q-33 stands) and for **ObjectCard values**: the card never guesses and `value: null` stays. The fallback lives in stage 6 and `RenderParams`, not in the card.
  - **Toggle:** unchanged (D-02, D-21). Measured only = tier 1; + Estimated adds tiers 2 to 4; + Artistic adds tier 5.
  - **Contract:** `Layer` gains `tier` (required), `formula` (required for tiers 2 and 3) and `assumed` (required for tier 3). `DynamicsValue` carries the same fields, with the tier fixed by the tag in the schema. A rate no rung can answer is omitted and listed in `missing` as `dynamics:<key>`. See R3.4.
  - **Haptics** on a fallen-back layer carry the same tag and follow D-21.
- **Why:** the viewer stays useful on a body with little data, and the badge still tells the truth.
- **Status:** Accepted by Moon (M2 owner, D-30) on 7 Nov 2026. Atish's confirmation of the haptics point is pending (D-13).

## D-32 Accuracy first

- **Context:** how close a body can be to the real thing depends on what exists for it. The page must say which row a body is in.
- **Decision:**

  | What exists | What the user sees | Limit |
  |---|---|---|
  | Spacecraft shape model (Eros, Bennu, Ryugu, Itokawa, Vesta, 67P **[verify]** list) | The real shape, including large craters | Imperfect only below the model resolution. Source: NASA PDS Small Bodies Node (for example the Gaskell Eros Shape Model Bundle V1.1 from NEAR images, DOI 10.26033/d0gq-9427, verified 7 Nov 2026; licence **[verify]**) |
  | Light-curve inversion model (DAMIT, each model graded for quality; scale **[verify]**: sources disagree) | The real overall shape, spin and pole | Convex: no craters or hollows (A3.7) |
  | Catalogue numbers only | Right size, spin and stretch | Procedural surface |
  | Unresolved star | Right colour, size and variability | Surface is physics-consistent, never imaged |
  | Exoplanet | Physically plausible | Never imaged |

  - A measured whole-body model is drawn as is (tier 1). Generation fills only detail **below its resolution** and never changes the silhouette.
  - A DAMIT convex model counts as tier 1 for the overall shape. Concavities must not be presented as measured: any crater or hollow drawn on it is tier 4 or 5.
  - The layer `source` cites the model data set and its licence.
  - Minimum DAMIT quality grade to accept: **[verify]**.
- **Related:** A3.7, R7.1, Q-43, Q-44, Q-55 (4) (`SHAPE_MODELS` is empty today).
- **Status:** Accepted by Moon on 7 Nov 2026.

## D-33 Motion, render-on-change and battery

- **Context:** D-05 and R5.5 say "render only on change". Moving bodies (spin, winds, flares, pulsation) need frames while time runs. The plan leaves open the default state and the phone battery cost.
- **Decision:** amends D-05 and R5.5.
  - **Render** when the view changes, or every frame while a simulation clock runs.
  - **One `SimClock`.** Each frame is a pure function of (card, seed, t), with no state between frames. Same card, seed and t give the same frame.
  - The **speed-up** is always shown next to the animation (like the "×1000" asteroid spin, R7.1). It is a display choice, not a claim. Nothing pretends to be real time.
  - **Default:** animate on load, calm and slow. Start **paused** when `prefers-reduced-motion` is set.
  - **Pause** on a hidden tab, when the canvas is off screen, and on the user's pause. The pause button is always visible and keyboard reachable.
  - **Phones** run the Low quality tier (R5.7), capped at 30 fps while animating, and auto-pause after 60 s without interaction (resume on touch) **[verify on phones]**.
  - **Battery budget target:** a 15-minute demo session on either phone uses at most 10% battery at demo brightness **[verify on phones]**.
  - **Haptic field** is recomputed at 4 Hz or less for the same t, so touch matches sight (D-12).
- **Why:** calm motion helps the demo, and the pauses and the cap keep the phones cool.
- **Status:** Accepted by Moon on 7 Nov 2026. The haptics parts wait for Atish (D-12, D-13).

---

## Post-event backlog

| ID | Item | From |
|---|---|---|
| B-01 | Tauri Android app with `VibrationEffect` composition and amplitude | Rendering doc §8.1, D-08 |
| B-02 | Gemini Live voice control | Architecture spec §8, D-06 |
| B-03 | AI sound clips (ElevenLabs or similar) | Architecture spec §8, D-06 |
| B-04 | Image-to-3D (TRELLIS, Hunyuan3D, TripoSR) | Architecture spec §6.3, D-06 |

## Open questions

Q-01 to Q-14 were answered on 5 Nov 2026; the Status column points to the decision. They stay here for history.

| ID | Question | Owner | Status |
|---|---|---|---|
| Q-01 | Backend framework. Both specs say "Python 3.12 API" but neither names one. | Kevin | Answered: D-15 |
| Q-02 | Frontend hosting: the same AWS server or static hosting? | Kevin | Answered: D-24 |
| Q-03 | Sliders on baked bodies. Changing relief needs a re-bake. Should the event build allow only colour, lighting and spin sliders on baked types? | Atish | Answered: D-26 |
| Q-04 | How Rainbow Trails (handover §5) relates to the flipbook. Is it a view mode of the flipbook or a separate P1 feature? | Team | Answered: D-28 |
| Q-05 | Name resolver order: SIMBAD first or SBDB first (architecture spec §4.1)? Rendering doc §3.3 uses both. | Atish | Answered: D-19 |
| Q-06 | Endpoints for search, frames and the flipbook. Only `/v1/objects/{id}/card` and `/render-params` are specified. | Kevin | Answered: D-16 |
| Q-07 | Owners for `shared/schemas`, `frontend/src/viewer/fields` and the backend pipeline stages (rendering doc §10 covers only render, API, viewer and haptics). | Team | Answered: D-17 |
| Q-08 | Honesty toggle: what is the starting state? In "Measured only", do `derived` data haptics (e.g. the D-12 `teq_pulse`) stay on? The toggle table hides only `artistic` and `inferred_from_analog`, but D-12 treats the derived pulse as kept. | Atish, Moon | Answered: D-21 (the store now starts at `derived`, the + Estimated state) |
| Q-09 | With the settings file retired (D-02), what does a "saved" asset hold? Proposal: the ObjectCard, RenderParams and texture URLs. IndexedDB would cache those plus the user's `overrides`. | Atish | Answered: D-22 |
| Q-10 | Architecture spec §13 (Plan) schedules build work from 5 Nov, but the event rules say not to build before 14 Nov. Should the plan be re-dated, or should the pre-event days be relabelled as research and prep? | Team | Answered: D-14 |
| Q-11 | The mock-up's Haptics tool (commit `4629305`, `mockup/spherex-ui.html`, `SphereXHaptics`) differs from rendering doc R8.8. See the differences listed below this table. Which one becomes the app API? Possible merge: keep R8.8's `HapticEvent`, add `sharpness` for the native path, and keep the mock-up's `spherex:haptic` event for debugging. **Atish decides (D-13)**; Moon gives input. | Atish | Answered: D-20 |
| Q-12 | `RenderParams.view_modes` uses `VisibleMode` and `IRMode` (rendering doc R3.4), but no spec defines their fields. The frontend scaffold types them as opaque `Readonly<Record<string, unknown>>` (`frontend/src/contract/renderParams.ts`, marked `ASSUMPTION`). What fields do they carry (e.g. badge text, disabled flag, channel windows from R5.2)? | Atish, Kevin | Answered: D-23 |
| Q-13 | The type of the client-side `overrides` map (D-02). The scaffold stores `Record<string, unknown>` (`frontend/src/state/store.ts`, marked `ASSUMPTION`), because the slider set and value types are not specified (see Q-03). Which keys and value types are allowed? | Atish, Moon | Answered: D-27 |
| Q-14 | The frontend scaffold added `src/contract/` (TS copies of R3 and R8.8 types), `src/state/` (Zustand store) and `src/app/` (React shell), which R10 does not list. Who owns them? Should `src/contract/` be generated from `shared/schemas/` so the backend and frontend contracts cannot drift? (Related: Q-07.) | Team | Answered: D-17, D-18 |
| Q-15 | Does the Asus A15 (D-24) also replace the Zenbook 14X as the demo screen? If so, D-05 and architecture spec §10.1 should target the A15's GPU instead of Iris Xe. | Atish | Open |
| Q-16 | Munazir to confirm the D-17 assignments (stage 2, `shared/schemas/`, physics). Munazir is not yet a repo collaborator, and `CLAUDE.md` did not list Munazir in the team. | Munazir | Answered: Munazir is Moon (`MintHerbs`); D-17 rows merged (5 Nov 2026) |
| Q-17 | Rendering doc R8.4 tags the comet field source `measured` + `model_dependent`, but a `HapticEvent` carries one `tag` (R8.8), and under D-21 "Measured only" hides `model_dependent`. Which tag does the comet field pulse carry, and does it play in "Measured only"? Blocks the haptics sources implementation. | Atish | Open |
| Q-18 | D-23 types the view-mode `rgb` as `TV \| null`. With R3.1's default `TV<T = number>` that holds one number, while `gaia_rgb` and `spherex_rgb` in R3.2 are `TV<[number, number, number]>`. Should the schema use `TV<[number, number, number]> \| null`? | Atish, Kevin | Answered: D-23 corrected to `TV<[number, number, number]> \| null` (5 Nov 2026) |
| Q-19 | Once `frontend/src/contract/` is generated from `shared/schemas/` (D-17, D-18), where do the frontend-only R8.8 types live (`HapticKind`, `HapticEvent`, `HapticDriver`)? They are not sent by the backend, and `HapticDriver` has methods that JSON Schema cannot express. Options: hand-written next to the generated types (like `assertTagged()`), or in `frontend/src/haptics/`. | Atish, Moon | Open |
| Q-20 | D-25 says the cache value is "the raw response", but A3.1 lists the SPHEREx `PSF` extension as skipped, and in an IBE cutout it is about 4.9 MB of about 5.06 MB. The backend (issue #1) caches the cutout with the `PSF` HDU cut out at its FITS byte boundaries; every other byte is kept as served, and the meta records the original SHA-256 and size. `SX_CUTOUT_KEEP_PSF=1` keeps it. Accept this as the reading of D-25 for cutouts? | Kevin | Open (implemented as proposed) |
| Q-21 | Frames for moving objects. A moving body needs an ephemeris-driven SIA search (many tiny cones along its path over the data release window); one cone does not find it. In M1, `/v1/objects/{id}/frames` for a moving object returns `frames: []` and `missing: ["frames:moving_object_search"]`. The 3I/ATLAS demo and Rainbow Trails (D-28) depend on this search. When is it built, and how many cones can IRSA take? | Kevin | Open |
| Q-22 | Meaning of `moving` in `/v1/resolve` (D-16). UML 08 drew Horizons for "asteroid, comet, high proper motion". The backend sets `moving = true` only for solar-system bodies (SBDB hits, positions from Horizons). High proper-motion stars (Barnard's Star, eps Ind B, WISE 0855) are `moving = false`; their position is propagated from the SIMBAD proper motion to each frame time (tagged `derived`), and Horizons is not used for them. Confirm. | Kevin, Moon | Open (implemented as proposed) |
| Q-23 | Stage 2 (issue #2) applies no aperture correction: the `PSF` extension is not cached (Q-20), so the fraction of a star's flux outside the 3 px aperture is unknown. SPHEREx fluxes are therefore systematically low by a wavelength-dependent fraction, which can tilt a spectrum slightly. Options: keep the `PSF` HDU, or record each cutout's enclosed-energy fraction for the aperture in the cache meta at pre-fetch time before stripping. | Moon | Open |
| Q-24 | Each SPHEREx frame samples a different wavelength, so `light_curve` (flux against time) mixes spectral shape with variability. Light-curve points carry an optional `wavelength_um`. Proposal: the UI colours light-curve points by wavelength and labels the plot "flux per visit (different bands)"; a variability claim needs same-band visits. | Moon | Open |
| Q-25 | How should user-typed coordinates be tagged? They are input, not an observation, and none of the five tags fits exactly. The backend (issue #1) tags them `derived` with the formula "the coordinates typed in the query (user input, not an observation)", so they show as **Estimated** and stay visible in the starting honesty state (D-21). Frame positions of a typed-coordinate object reuse that tag. | Atish, Kevin | Open (implemented as described) |
| Q-26 | SPHEREx saturates on Barnard's Star, RW Aur and R Dra in the recorded frames (core pixels flagged `OVERFLOW`, some cores NaN); their spectrum is refused as `saturated:<frame_id>` plus `spectrum:saturated`. A live check on 5 Nov found 0 of 30 R Dra frames unsaturated and 17 of 38 RW Aur frames at 0.74–1.12 µm unsaturated, but the first of those is row 57 of the SIA answer, beyond what the ~5 MB fixture budget can record. Options later: PSF-wing photometry (needs the PSF, reverses Q-20) or different demo targets. | Moon, Atish | Open. Refusal accepted for M1 by Atish (5 Nov 2026); Moon to confirm; PSF-wing photometry or new demo targets later. Status 6 Nov 2026, full offline cache: Barnard's Star 239 of 240 frames `saturated` (1 `aperture_flags`), R Dra 530 of 537 (6 `aperture_edge`, 1 `outside_cutout`), RW Aur 200 of 224 (15 points at 0.74–1.09 µm); `spectrum:saturated` is absent for Barnard's Star and R Dra there (it appears only in the small recorded fixtures), so the UI words the empty state from the grouped counts (issue #24, [A4.2](architecture/pipeline.md#a42-stage-2-measure-brightness-and-spectrum)) |
| Q-27 | Tag of false-colour encodings. Rainbow Trails (D-28), as built in issue #3, colours each dot with hue = wavelength and tags that colour `derived` (formula "false colour: hue = wavelength", Estimated badge), so in "Measured only" (D-21) the dots are drawn in one colour. Rendering doc R5.2 calls the SPHEREx infrared mode "(measured)", although its tint is also a false-colour mapping computed from measured values, and R5.3 keeps a "flat measured tint" in "Measured only". Should both false-colour encodings carry the same tag, and which one? | Atish, Moon | Open (Rainbow Trails implemented as `derived`) |
| Q-28 | The flipbook in "Measured only". D-21 shows only `measured` layers in that state, and rendering doc R4 calls the flipbook "the only fully measured view". But the cutout pixels are drawn through a display stretch tagged `derived` (A4.1; Estimated badge in the UI), and the ring on the object sits at `x`, `y`, also `derived`. A picture cannot be shown without some stretch. As built in M1 (issue #3), the picture and the ring are always shown; the M1 UI has no honesty toggle yet. In "Measured only", keep the stretched picture and the ring as a stated exception, or hide them? | Atish, Moon | Open |
| Q-29 | Under `SX_OFFLINE=1`, may a Gemini repaint already in the cache be shown? D-25 routes Gemini through the read-through cache, which serves hits offline, while D-24 says the Gemini layer stays off when there is no internet. | Atish | Open |
| Q-30 | Issue #3 (PR #21) keeps the frontend's synthetic fixtures (fake API replies and PNGs served by a Vite plugin, `frontend/fixtures/`) next to the frontend, while D-17 gives `shared/fixtures/` to Moon. For M1 they stay in `frontend/fixtures/` (Atish, 5 Nov 2026), because they are frontend-only test data and M1–M4 build against fixtures independently (D-29). Should M5 move them, or replace them with replies recorded from the backend, into `shared/fixtures/`? | Moon | Open (kept in `frontend/fixtures/` for M1) |
| Q-31 | SPHEREx FLAGS beyond QR2 (checked 5 Nov 2026 for PR #20). The Explanatory Supplement (SSDC-DP-017 v2.0, Table 16) drops `PHANTOM` and `REFERENCE` and adds `CROSSTALK` (20), `STREAK` (25) and `SATELLITE_HALO` (29); the L3 photometry's `CONTAINS_BAD_PIXEL` warning also counts `GHOST*`, `BLOOM`, `SNOWBALL` and `HALO`, which Stage 2 keeps. An IRSA draft (tutorials PR #401) says QR3 and DR1 (12 Nov 2026) name flags with `MSKNnnnn`/`MSKDnnnn` keywords, while `wcs.flag_names` reads only `MP_*`, so a DR1 cutout would refuse every frame as `flags_header`. The demo serves cached QR2 (D-25), so nothing breaks today. Before moving to DR1: add the three new flags to `REJECT_FLAGS`, and read `MSKN*` with `MP_*` as fallback? | Moon | Open |
| Q-32 | A fourth, dev-only badge. D-02 says the UI shows 3 badges. The M1 flipbook (issue #3, PR #21) shows a **Fixture** badge instead of Measured, a page-wide "Fixture data" banner and a SYNTHETIC label on images whenever a reply carries `X-SX-Fixture: synthetic`. Those replies come only from the dev-only fixture server; `scripts/check-dist.js` fails a production build that contains a fixture marker ([UML 08](uml/08-sequence-search-flipbook.md#notes), [A11](architecture/honesty-policy.md#a11-honesty-policy-user-facing)). Proposal: record it in D-02 as a dev-only exception that sits outside the 5 tags and never appears in a production build. Accept? | Atish, Moon | Open (implemented as proposed, dev only) |
| Q-33 | R3.4 types `scale_m` as `number`, but `candidate` has no size, and R11 removes `diameter_km` from an asteroid and expects a refusal with no crash. A required number would force an invented size. Issue #4 makes `scale_m` `number \| null` (R3.4, UML 05 and UML 07 updated). Related: UML 17 says RenderParams may not be used for `candidate` **[verify]**, while issue #4 asks for one params fixture per type, so `candidate` has a params fixture with `layers: []`, `scale_m: null` and `missing: ["mesh", "visible"]`. Confirm both. | Atish | Open (implemented as described) |
| Q-34 | `brown_dwarf_binary` draws two bodies (R7.4) and R8.5 gives each its own pulse rate, but the card holds one `spectral_class`, `flux_45um` and `radius_rjup`, and RenderParams one `scale_m` and one `textures`. Issue #4 adds no fields: the fixture holds `spectral_class: "T1+T6"` as a placeholder. Does the card need a `components` list? | Atish, Moon | Open |
| Q-35 | Seed = hash of (object id + generator version) (R1, A5.1), but no spec names the hash, how the two strings are joined, or how the result becomes an integer. `generator_version` has no format either. R6.3 needs an integer, so the schema types `seed` as an integer ≥ 0. The shared fixtures use labelled fixture seeds (1–14), not a hash. Which hash, and what width? | Atish | Open. Issue #5 implements, as an ASSUMPTION: SHA-256 of `id` + newline + `generator_version` (UTF-8), first 4 bytes big-endian (32 bits, so it survives JSON in the browser and matches the field's low 32 bits, Q-48); `generator_version` = `p<card_to_params version>-b<BAKER_RULES_VERSION>` (`backend/app/core/render/card_to_params.py`). |
| Q-36 | `VisibleMode.source` (D-23) allows `gaia_rgb`, `class_palette` and `spherex_rgb`, but star colour comes from Teff (R7.5), shader-kind colour is `artistic`, and a mode that is not available still needs a `source`. The fixtures use `class_palette` for all of these; the `rgb` tag, formula and source state the real basis. No badge text is specified for artistic colours, so they use "Default (artist's choice)" from D-02. Add values such as `teff` and `artistic`, and make `source` nullable? | Atish, Kevin | Open (`class_palette` in fixtures) |
| Q-37 | `HapticProfile` against R8.5. R8.5 and D-12 list the nebula and nova field source under texture haptics, and the comet's nucleus tick too, but R8.8 has `field` only in `data`, and `texture` has no matching value. The fixtures use `texture: "none"`, `data: "field"`. `texture_tag` and `data_tag` are required even when the channel is `none`; the fixtures use `artistic`, the tag that claims least. The comet's `data_tag` waits on Q-17; the fixture uses `model_dependent`, the safer choice. `teq_pulse` when refused gives `data: "none"`. Confirm. | Atish | Open (implemented as described) |
| Q-38 | `Layer` (R3.4) has one `tag` and no `formula` or `assumption`, while R3.1 requires them on values, and no spec lists the layer ids or the format of `missing` entries for RenderParams. The fixtures put the formula or assumption in `description`, take ids from the renderer docs (`mesh`, `spin`, `nucleus`, `gas_shells`, …) and list a refused layer or view mode by its bare id (`teq_pulse`, `mesh`, `spherex_ir`, `visible`). The viewer renderers (issue #7) use these ids: `mesh`, `spin`, `material`, `ellipsoid`, `albedo_map`, `relief`, `body`, `emissive`, `bands`, `orbit`, `nucleus`, `gas_shells`, `dust`, `tail`, `colour`, `limb_darkening`, `motion_trail`, `brightness_curve`, `radius_pulsation`, `disc`, `dust_screen` (comet: `dust`, `tail`; brown dwarf: `body`). Layers with two tags in the specs carry the one that claims less: gas shells `model_dependent` (R7.3), dust screen `artistic` (R7.5). R5.3 lists band patterns as `artistic` while R7.4 calls band contrast `derived`; the fixture `bands` layer is `artistic`. Should `Layer` gain `formula` and `assumption`, and should the layer ids become an enum? | Atish, Moon | Partly answered by D-31: `formula`, `assumed` and `tier` are now on `Layer` (R3.4). Open: the layer-id enum and the `missing` entry format. |
| Q-39 | D-16 and D-25 say cached replies carry `cached_at`, and cards and render params are cached, but R3.2 and R3.4 have no such field and the schemas forbid unknown fields. Issue #4 keeps the R3 shapes. When `/card` and `/render-params` are built: add an optional `cached_at` to both schemas, or wrap the reply? | Kevin, Moon | Open. Issue #5 keeps the R3 shapes and sends `cached_at` as the `X-SX-Cached-At` response header, plus the A4.4 status as `X-SX-Asset-Status` (ASSUMPTION; neither header is in D-16). `X-SX-Cached-At` is the oldest `fetched_at` among the cache entries the reply used; a saved generated asset sends the `fetched_at` of its `derived.asset` cache entry, and the header is left out for a pre-baked asset (which has `created_at` instead) and when nothing came from the cache. With `SX_CORS_ORIGINS` set, CORS exposes both headers so the browser can read them (PR #34 review). |
| Q-40 | D-15 says Pydantic validates cards and render params at the API boundary, but the generated models (D-18) are weaker than the schema. They accept `derived` without a `formula` and `model_dependent` without an `assumption` (7 of the 23 cases in `shared/fixtures/invalid/cases.json`), coerce `"1.5"` and `true` to numbers, and accept NaN and infinity, which serialise to `null`. `jsonschema` is a dev dependency, so the running API cannot use it today. Serialising has a trap too: a plain `model_dump()` or FastAPI `response_model` adds `null` for every unset field (30 schema errors on the `planet_rocky` card), and `exclude_none` drops the required `value: null` and `scale_m: null`; only `exclude_unset` matches the schema. They also accept an explicit `null` on optional fields where the schema rejects it (`diameter_km`, `formula`, `err`). When `/card` and `/render-params` are built: move `jsonschema` to the runtime dependencies and validate each reply, or add hand-written checks beside the generated models? | Kevin, Moon | Implemented in issue #5 as the first option: `jsonschema` 4.26.0 moved to the runtime dependencies, and `/card` and `/render-params` build plain dicts and validate each reply (`backend/app/core/card/validate.py`); the generated models are used only for the OpenAPI docs. Team to confirm. |
| Q-41 | Stage 2's `LightCurvePoint` (`backend/app/api/spectrum.py`) cannot fill the card's `lightcurve` (R3.2). `time` and `error` convert to `t_mjd` and `sigma`, but `lambda_um` is required on the card and `wavelength_um` is optional in stage 2 (Q-24), and `flags` is a number on the card while stage 2 has only the `flagged` bool, with no bitmask. A point with no wavelength would need an invented value or be dropped. Options for `/card`: make `lambda_um` nullable and `flags` a bool or a list of names, or have stage 2 always emit a wavelength and a bitmask. | Kevin, Moon | Open (R3.2 shape kept). Issue #5 fills `lightcurve` for `star_mira` and `star_ttauri` from stage 2: points without a wavelength are left out, and `flags` is 1 when stage 2 marked the point `flagged`, else 0 (ASSUMPTION; not a SPHEREx bitmask). |
| Q-42 | `gas_Q` in R3.2 is commented "per epoch", and R7.3 and R11 need Aug and Dec values, but its shape `{ co2?: TV; h2o?: TV; co?: TV }` holds one value per molecule. Issue #4 keeps the R3.2 shape, so a card can carry only one epoch's Q and the Aug/Dec toggle cannot be fed from it. Proposal: key it by epoch, `{ '2025-08'?: {…}, '2025-12'?: {…} }`, before the comet renderer is built. | Atish, Moon | Open (R3.2 shape kept). The comet renderer (issue #7) reads both shapes: a `gas_Q` keyed by epoch (this proposal), and the one-epoch R3.2 shape. The R3.2 shape is used only when `epochs` has exactly one entry and it is the selected epoch; with both epochs listed, one Q cannot be assigned to either, so `gas_shells` is refused. This does not decide the question. |
| Q-43 | R7.1 and the viewer scale the shape model so that its bounding sphere has the diameter in `diameter_km`. Catalogue diameters are usually volume-equivalent (Eros is about 34 × 11 × 11 km with a mean of about 16.8 km), so an elongated body would be drawn at about half its length next to a scale bar that says "16.8 km". **[verify]**: which diameter does `diameter_km` hold, and should the card carry the longest axis for shape-model objects? Until then the viewer keeps the bounding-sphere reading (`ASSUMPTION` in `build.ts`). | Atish, Moon | Open (bounding-sphere reading kept) |
| Q-44 | `shape_source` is "URL/DOI of mesh" (R3.2). The viewer loads a mesh only from a same-origin path (`/…` or `./…`), because a direct fetch of any `http(s)` address bypasses the backend cache (D-25) and fails offline. An `http(s)` address is refused as a layer ("not drawn", the body falls back to a plain sphere). Should the backend fetch, cache and re-serve shape models from a same-origin path, and should `shape_source` keep the original URL for the credit? | Kevin, Moon | Open (same-origin only) |
| Q-45 | R5.3 and R7.2 were edited in issue #7 to keep the plain body in Measured only only when its size is `measured`, which brings R5.3 in line with D-21 (an estimated number is not shown at that level). The effect: Measured only shows an empty canvas for the procedural asteroid and both brown dwarfs, whose sizes are `derived` or `model_dependent`, which changes the demo. Alternatives: keep the sphere and drop only the scale bar and size text, or draw an unlabelled sphere. A star whose card has no `radius_rsun` is drawn as a unit sphere with no scale bar ("size unknown"), so colour and limb darkening are kept (R7.5 makes the radius optional). Atish signed this off as implemented in the PR #29 approval (6 Nov 2026). | Atish | Decided (as implemented) |
| Q-47 | Choices the texture baker (issue #6) had to make where R6, R7.4 and R11 are silent or disagree. (1) **Scope:** only `asteroid_procedural`, `brown_dwarf` and `brown_dwarf_binary` have a texture recipe; `asteroid_shape` (no UVs, R7.1), stars, comets and shader kinds are refused with `missing: ["textures"]`. (2) **R11 seam test** compares the *mean* seam difference with the *median* neighbour difference. Heavy-tailed relief (crater rims) puts a column pair's mean above the median, so a seamless map can fail (seed 2: 1.19e-3 against 1.10e-3). Tests use mean against mean, with a negative control. Alternative that keeps R11's wording: take the median over column-pair means. (3) **Boulders:** R6.3 says "rubble only", R6.2 gives `boulder_density` for every style; the baker follows the table (count = round(300 · density)). (4) **Unspecified numbers** (artistic or placeholder): crater angular radius 0.02–0.20 rad, boulder σ 0.012 rad and height 0.006 R, `redness = clamp(slope_075_25 / 100, ±0.08)`, brown-dwarf palettes (R7.4 has no values), `normalise(fbm)` by the 99.5th percentile, neutral grey (0.5) when no colour exists. (5) **Optional inputs bake flat and are listed, not refused** (R7.2: only `diameter_km` is required): no colour source gives a neutral grey albedo and `albedo_map` in `BakeParams.missing` (a real layer id); an unusable `gaia_rgb` is listed as `gaia_rgb` so palette colour is not called derived; no `albedo` value gives brightness 1.0 and `brightness`; no `ch4_depth_33` gives no bands and `bands`. By "refuse rather than invent", `card_to_params` should refuse the `albedo_map` layer and the visible mode when `albedo_map` is listed, and the viewer then shows R7.2's flat tint; the grey `albedo.webp` exists only because R3.4 requires `textures.albedo`. `brightness` 1.0 is outside R6.2's 0.12–0.8 range and is the same kind of case. Atish to confirm. NaN and ±inf count as missing (Q-40). (6) **Binary:** one texture set from the primary class (`T1+T6` → T), because RenderParams has one `textures` (Q-34). (7) **Resolution:** R6.7's path has no size; D-05 wants 2048×1024 desktop and 1024×512 mobile. The baker writes each size to its own `{width}x{height}/` directory under the R6.7 path (default 2048×1024), so sizes never replace each other, and the viewer downsamples. (8) **Cache validity:** R6.7 keys by id, version and seed only. The baker adds `bake.json` inside the directory holding a hash of the parameters, size and `BAKER_RULES_VERSION`; a mismatch rebakes, so changed card data or a different size is never served stale. The seed is hashed (SHA-256) into the noise, so all bits of a 64-bit seed count (Q-35). (9) **Brown dwarfs have a flat height map**, so R8.5's band-boundary ticks and principle 6 have no field to sample, and R8.4 step 3 needs a crater mask the baker computes but R6.7 does not output. Atish to decide whether to bake a band-index map and a crater mask. (10) Ids that differ only in letter case share a directory on Windows and macOS. Confirm or give numbers. | Atish | Open (implemented as described) |
| Q-48 | Shared field packing for gas giants and ocean depth (issue #8, D-12 / R7.7). D-12 says Texture A R = "height", but a gas giant has no relief, and the shader needs the band profile to colour by. Implemented: for `gas_giant` R holds the band profile 0..1 (0.5 is a band edge, so the field's band edges are the drawn edges), G the band index (integer, offset to be >= 0), B the storm id (1-based, 0 = none), texture B all zero. For terrain, R is the raw height (the sea floor is kept so the shader can shade ocean depth); the ocean is flat at sea level only in the normals and in haptics, via the ocean mask. The packing is unchanged by the PR #31 review: zonal wind and ring gaps are **functions** shared by the shader and the CPU (`zonalWind`, `ringGapAt` in `fieldGenerator.ts`), not extra channels, and the felt storm edge (`STORM_EDGE_FACTOR`) is derived from the drawn ring's constants. Two further contract points, both in `viewer/fields/` (Atish, D-13). (1) The storm influence edge `STORM_EDGE_FACTOR` moved from 1.5 to 1.9 sizes (the ring centre 1.3 plus 1.5 ring widths of 0.4, so the felt edge is where the drawn ring has faded to about 10%). The felt storm footprint grows by about (1.9/1.5)^2 = 1.6x in area, storms overlap more, and the gas-giant field bytes change (texels with a storm id inside the drawn ring: 1169 before, 0 after). Atish signed off the 1.9 value as haptics owner (PR #31 re-review). (2) The field worker request shape is `{id, kind, ...}` with `kind` `field` or `points`, and the reply echoes `id`; ids are matched, an error falls back to the main thread, and `onerror` recreates the worker. The field uses the **low 32 bits** of the seed (`hash3` takes `seed | 0`), so seeds that differ only above bit 31 give the same field; this matters for Q-35 (unbounded `RenderParams.seed`). The shader-only noise uses `boundedSeed` (mod 997). Should the packing say this, or should gas giants get their own channel? | Moon, Atish | Open (implemented as described) |
| Q-49 | Honesty start state versus a visible surface (issue #8, R5.3). The starting state is + Estimated (D-21), and every surface layer of the shader kinds is `artistic` (R7.7), so a planet or gas giant opens as a plain grey sphere and a nebula or nova as nothing, with the reason in the plan's notes and its "Not drawn" list. **Resolved with Q-45 (decided): one rule for every type.** The plain body that stands in for a hidden surface follows Q-45: it is shown only while the size on the card (`radius_rjup`) is shown at the honesty level, so at Measured only it stays only when the size is `measured`; a nebula or nova has no plain body, so it draws nothing while the cloud is hidden. The shader kinds go through the same entry point as the baked kinds (`setObject`, `renderPlan`, `buildScene`), take their tags from `allowedTags(plan.honesty)` and their light from `planLighting(params, card)` (the plan's direction, head-on `[0,0,1]` without a phase angle or `sun_dir`, none when self-lit), so the gas giant is lit by the scene's DirectionalLight (terminator, ambient 0.03) and `sun_dir` and R5.1 apply to it like the planets. An honesty or light change updates the body in place and never regenerates the field. Still open: is + Estimated the intended first view for these showcase kinds, or should they start at + Artistic? D-21 is kept until someone decides. | Atish, Moon | Open (rule resolved with Q-45; start state open) |
| Q-55 | Choices made by stages 3, 4, 5 and 7 (issue #5) where the specs are silent. (1) **Class label:** taken from the catalogue only (SIMBAD `sp_type`; SBDB `spec_B`, then `spec_T`), tagged `measured`; its confidence is `catalogue` or `none`. A4.3 asks for a confidence, but the card has no field for it, and spectrum matching against reference types (A4.3 step 2) is not built because the repo has no reference spectra. Add a field, or keep the confidence internal? (2) **SIMBAD otypes:** brown dwarf = `BD*`, Mira = `Mi*`, T Tauri = `TT*`, "any other star" = any otype ending in `*` plus `s*r`, `s*y`, `s*b`, `Y*O`; candidates (`BD?`, `Mi?`) are not stars and become `candidate`. (3) **Known components** (R3.3 binary rule) = a composite SIMBAD spectral type containing `+` (`T1V+T6V`). (4) **Shape models:** no DAMIT or NASA lookup exists, so `SHAPE_MODELS` (`backend/app/core/card/catalogue.py`) is empty and 433 Eros is `asteroid_procedural`. (5) **`flux_45um`:** median unflagged SPHEREx flux within ±0.05 µm of 4.5 µm (the R5.2 window), in µJy, tagged `measured`; null with fewer than 2 points (true for the recorded fixtures). (6) **Brown dwarf radius:** the card carries R7.4's 1 Jupiter radius as `radius_rjup`, `model_dependent`. (7) **Nulls:** only fields the type uses (R7) are written; a field with no source (Teff, stellar radius, Mira period, CH₄ depth, band depths, slope, phase angle, Gaia colour, comet Q) is `value: null` with the reason in `source`, tagged with the tag a value would carry. (8) `spherex_rgb` is tagged `measured` as R5.2 says, with the window formula added (Q-27). (9) **Star colour:** Teff → linear sRGB by integrating Planck against the CIE 1931 2° functions in the Wyman, Sloan & Shirley 2013 fit, not Mitchell Charity's table **[verify]**; `VisibleMode.source` stays `class_palette` (Q-36). (10) **Shader-kind lighting:** no `sun_dir` without a `sun_vector` on the card (the fixtures hold `[1, 0, 0]`), so the viewer lights head-on (Q-49). (11) **Radius constants:** Jupiter 69,911 km (volumetric mean), Sun 695,700 km (IAU 2015 nominal); the fixtures round them. | Atish (1-3, 5, 9, 10), Kevin (4, 6-8, 11) | Open (implemented as described) |
| Q-56 | Exoplanet type thresholds (R3.3 step 4, R12 #12). The docs give no columns and no cut-offs and say not to hard-code any. Issue #5 keeps `EXOPLANET_THRESHOLDS` in `backend/app/core/classify/rules.py` with every value `None`; an Exoplanet Archive match is then refused, falls through to `candidate` and lists `type:exoplanet_thresholds` in `missing` (no Exoplanet Archive adapter exists yet, so no real object reaches this path). Fixture cards that already carry a planet type keep it. Sourced candidates for the team to choose from: rocky below 1.5 R⊕ (Weiss & Marcy 2014, arXiv:1312.0936; Fulton et al. 2017, arXiv:1703.10375); gas giant from 6 R⊕ (Kopparapu et al. 2018, arXiv:1802.09602); gas giant from 0.414 M_J by mass when the radius is missing (Chen & Kipping 2017, arXiv:1603.08614), checking `pl_bmassprov` because M·sin i is a lower limit; the 1.5–6 R⊕ sub-Neptune range has no kind (open choice); `planet_water` has no catalogue observable (density plus a model, `model_dependent`, or slider-only). Archive columns: `pl_rade`, `pl_bmasse`, `pl_bmassprov`, `pl_dens`, `pl_eqt`, `pl_insol`, using `default_flag=1` or `PSCompPars`. | Atish | Open |
| Q-57 | Where generated assets live and when they are saved (issue #5; A4.4, A5.4, D-22, D-25). A5.4 puts generated assets in browser IndexedDB and says the read-through cache (D-25) is separate from the asset store; A4.4 ends with "save the new card to the store" with no condition; A5.4 puts pre-baked assets at `assets/<type>/<id>.json` in the repo. Issue #5 (`backend/app/core/card/assets.py`, `service.py`) instead: (1) saves `generated` and `sketch` assets on the backend, as `derived.asset` entries in the D-25 cache keyed by id, data release (`SX_DATA_RELEASE` setting), `ASSET_VERSION` and the stage 7 `GENERATOR_VERSION` (D-25 does say derived cards and render params are cached; D-22 names `generator_version` as part of the asset, not of its key); (2) saves only when the inputs are final (a spectrum from a complete frame list, and a catalogue match or typed coordinates), so a truncated search or a catalogue miss is rebuilt on every request; (3) reads pre-baked assets from `backend/assets/<type>/<id>.json` (`SX_ASSETS_DIR`, id percent-encoded, any `<type>` folder); (4) returns a saved asset without re-running stages 3 and 7: a stage 7 or baker rule change or a new data release changes the generated key by itself, a stage 3 or 5 rule change needs an `ASSET_VERSION` bump, and a pre-baked file must be re-made (its `generator_version` is not compared); (5) ignores a saved or pre-baked asset whose card id or params id is not the requested id, whose card and params disagree on `type`, or that fails the `jsonschema` check (Q-40), logs a warning (a mismatched cache entry is skipped silently), and builds the asset from the catalogues instead of returning an error; (6) a saved asset whose card type is `candidate` is still reported as `sketch`, never `saved`, so the "Sketch from SPHEREx only" label survives the save (PR #34 review). Should A5.4 change to match, and does the browser still keep its own IndexedDB copy? | Kevin, Moon | Open (implemented as described) |
| Q-59 | D-05 and A15 budgets say "≥ 30 fps, render only on change"; the plan's quality tiers (R5.7) target 60 fps on High and Medium and 30 fps on Low, and a governor that drops a tier. D-33 amends "render only on change", but the 60 fps targets and the governor are not in D-05. Does R5.7 replace the D-05 frame-rate row (30 fps stays the floor)? | Moon | Open (R5.7 written as 30 fps floor, 60 fps target) |
| Q-60 | R7.5 gives the Mira radius pulsation (±10%) as `artistic`, but D-31 and R3.4 add `dynamics.pulsation_period_d` from the light curve. The period is measured; the amplitude is not. Draw the amplitude at tier 5 and the period at tier 1 or 2, or keep the whole layer `artistic`? | Moon | Open (R5.7 uses the split) |

**Q-11 differences between the mock-up and R8.8:**

1. **Event shape.** The mock-up streams continuous `sample({intensity, sharpness, speed, roughness, height, material})` plus `tick()`. R8.8 uses discrete `HapticEvent`s (`kind`, `strength`, `rateHz`, `tag`, `pitch`, `pan`). The mock-up has no provenance tag.
2. **Bridges.** The mock-up tries `window.SphereXNative.haptic` and an iOS `webkit.messageHandlers.sphereXHaptic` bridge before `navigator.vibrate`. D-08 is web only for the event.
3. **Nebulae and novae.** The mock-up refuses them ("no surface to feel"). D-12 gives them a field pulse.
4. **Tick length.** The mock-up uses 6–22 ms. R8.3 uses 8–25 ms with calibrated `minMs`.
