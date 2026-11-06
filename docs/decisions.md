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

- `frontend/src/contract/` is generated code (D-18) and follows the owner of `shared/schemas/`.
- Munazir and Moon are the same person (GitHub `MintHerbs`). The separate Munazir row was merged into Moon's on 5 Nov 2026 (answers Q-16).

## D-18 The contract is generated from `shared/schemas/` (answers Q-14)

- **Decision:**
  - `shared/schemas/*.json` (JSON Schema) is the single source of the data contract.
  - The backend generates its Pydantic models with `datamodel-code-generator`. The frontend generates `frontend/src/contract/` types with `json-schema-to-typescript`. Both tools are pinned exactly when installed **[verify versions]**.
  - CI fails if regenerated files differ from the committed ones, so the two sides cannot drift.
  - `assertTagged()` and other hand-written helpers move next to the generated types, not into them.
- The hand-written types from the 4 Nov scaffold stay until the schemas exist, then get replaced.

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

## D-31 Saturated test targets stay as refusals; demo objects added (answers Q-26)

- **Context:** SPHEREx saturates on Barnard's Star, RW Aur and R Dra (Q-26). On the full pre-fetched cache, Barnard's Star and R Dra have no measured point and RW Aur only 15 points at 0.74–1.09 µm, so only Epsilon Indi B and WISE 0855 showed a full measured spectrum (A1.1 P0).
- **Decision (Atish, 6 Nov 2026):**
  - The 5 test targets stay. The saturated frames of Barnard's Star, RW Aur and R Dra stay honest refusals (`saturated:<frame_id>`). `spectrum:saturated` appears only when every frame is refused as saturated, which holds on the recorded fixtures but not on the full cache (A4.2). Their flipbook still works.
  - PSF-wing photometry is not built for the event. Q-20 (the PSF is not cached) stands.
  - Two or three demo objects that SPHEREx measures cleanly are added. Three were picked from a screen (below) and added to `backend/targets.toml` with `group = "demo"`, then pre-fetched (D-25):

    | Demo object | Query | Why |
    |---|---|---|
    | SIMP 0136 | `SIMP J013656.5+093347.3` | A free-floating planetary-mass T dwarf (12.7 ± 1.0 MJup) with methane and CO bands. Published type T2.5 (Gagné et al. 2017, ApJL 841, L1); the SIMBAD reply in the cache says T2.0, so a card built from SIMBAD shows T2.0. No refusal other than flagged apertures. |
    | TWA 27 (2M1207 A) | `TWA 27` | Host of 2M1207 b, the first directly imaged planetary-mass companion (Chauvin et al. 2004, A&A 425, L29). Every point has S/N above 11. |
    | IRAS 04302+2247 | `IRAS 04302+2247` | A young star with an edge-on protoplanetary disk; water and CO₂ ice bands at 3.05 and 4.27 µm (Aikawa et al. 2012, A&A 538, A57). |

  - Picked from a live screen of 8 candidates on QR2 (6 Nov 2026, the first ~32 frames of each object, 78 for SIMP 0136); the screen table is in PR #28. PSO J318.5−22 was picked first and dropped: at the SPHEREx epoch (2025.8) a 2MASS star 1.3 mag brighter in J lies 17.3″ (2.8 px) away, inside the 3 px aperture near its edge. The measured flux is 2.5× the 2MASS value at J and 1.8× at K, so its spectrum below about 2 µm is mostly the neighbour's.
- **Full pre-fetched cache** (`SX_OFFLINE=1 python -m app.core.measure --group demo`, 6 Nov 2026):

  | Object | Frames | Points (flagged) | Refusals | Wavelength |
  |---|---|---|---|---|
  | SIMP 0136 | 249 of 250 | 236 (55) | 13 `aperture_flags` | 0.742–4.980 µm |
  | TWA 27 | 421 of 425 | 377 (92) | 43 `aperture_flags`, 1 `saturated` | 0.749–5.007 µm |
  | IRAS 04302+2247 | 212 of 214 | 197 (197) | 13 `aperture_flags`, 1 `aperture_edge`, 1 `saturated` | 0.743–4.989 µm |

  Frames are the frame list out of the SIA rows; Stage 1 drops the rest as `outside_cutout`. The one `saturated` refusal on TWA 27 and on IRAS 04302+2247 is a dead pixel at the core (NaN, flagged `NONFUNC` as well as `OVERFLOW`), not a saturated source: Stage 2 refuses a NaN core with `OVERFLOW` or `SUR_ERROR` in the aperture as `saturated` (A4.2).
- **Honesty (what the UI and the pitch must say):**
  - **TWA 27:** SPHEREx measures 2M1207 A and b **blended**: they are 0.8″ apart, inside one 6.15″ pixel. The spectrum is dominated by A; b is not resolved, and its share grows towards 5 µm. It is not "the planet's spectrum". A neighbour inside the aperture adds roughly 7–11 % to the flux (see Neighbours). The median fluxes agree with 2MASS and WISE photometry to about 10 %, so no bias is visible at that level.
  - **IRAS 04302+2247** is extended (a disk seen edge-on): its 3 px aperture flux is neither a point-source flux nor the total flux; it exceeds the 2MASS point-source flux by 1.7–1.9× at J, H and K (2MASS `ph_qual` AEE: the H and K magnitudes are E quality). SIMBAD has no proper motion for it, so every point is flagged `no_proper_motion`.
  - **Neighbours** at the median frame time (2026.0 for all three), with proper motions from SIMBAD for the targets and Gaia DR3 for the neighbours (IRSA TAP, 6 Nov 2026), at 6.15″ per pixel. The aperture is 3 px (18.5″) and the background annulus 6–9 px (36.9–55.4″). The table is in PR #28.
    - SIMP 0136 has moved about 31″ since 2MASS (1.24″/yr). No 2MASS or Gaia source is inside its aperture. Two AllWISE sources at 9.9″ and 12.7″ (1.6 and 2.1 px), W1 16.9 and 16.8, are inside it; they are about 5 mag fainter than SIMP 0136 in W1 (roughly 1 % each) and are in neither 2MASS nor Gaia. The J 14.81 star (1.35 mag fainter in J) is at 27.5″ (4.5 px), between the aperture and the annulus. The annulus holds only sources at least 3.7 mag fainter in W1.
    - TWA 27: a 2MASS source at 8.6″ (1.4 px), 2.4 mag fainter in J and 2.9 mag in K, is inside the aperture and adds roughly 7–11 %. A star as bright as TWA 27 in J (J 12.94) is at 37.3″ (6.07 px), on the inner edge of the annulus, and a J 15.5 star at 36.0″ (5.86 px) is just inside it. A Gaia source (G 20.6) at 17.3″ (2.8 px) is in neither 2MASS nor AllWISE.
    - IRAS 04302+2247: a 2MASS source (J 15.0, W1 13.3) at 54.0″ (8.8 px) is in the annulus; nothing else brighter than W1 15.3 lies within 9 px.
    - The sigma-clipped background is expected to reject most of an annulus source.
  - **Variability:** each point comes from a different visit, so the spectrum mixes spectral shape with time variation (Q-24). SIMP 0136 is a known rotational variable: about 5 % peak-to-peak in J with a period of about 2.4 h (Artigau et al. 2009, ApJ 701, 1534) **[verify]**, comparable to its median per-point error of about 3 %.
  - Fluxes carry no aperture correction (Q-23).
- **Saturation limit:** about 11.7 to 9.7 AB mag depending on the band, as quoted by Clark et al. 2026; the range and the per-band values are **[verify]** ([A3.1](architecture/data-sources.md#a31-spherex-irsa), Saturation row). SIMP 0136 and TWA 27 are at least 2 mag fainter than 11.7 AB in 2MASS J and K and WISE W1 and W2. IRAS 04302+2247 is closer: 1.9 mag in K (13.56 AB; an E-quality 2MASS magnitude), 1.4 mag in W1 (13.06 AB, brighter than Epsilon Indi B's 13.42 AB) and 1.1 mag in W2 (12.81 AB). Its margin rests on its own full-cache result (no saturated source in any frame), not on an object measured before. AB = Vega + 0.894 (J), 1.840 (K) from the 2MASS zero points (Cohen et al. 2003, AJ 126, 1090) and + 2.699 (W1), 3.339 (W2) from the WISE All-Sky Explanatory Supplement Sect. 4.4.h **[verify]**. Epsilon Indi B and WISE 0855 measured cleanly in this tool (2 objects, not a limit).
- **Out of scope:** demo quick picks in the UI go to M5 (issue #15).
- **Approval:** Atish, 6 Nov 2026. Moon was asked to confirm in PR #28; pending, will be recorded here.

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
| Q-08 | Honesty toggle: what is the starting state? In "Measured only", do `derived` data haptics (e.g. the D-12 `teq_pulse`) stay on? The toggle table hides only `artistic` and `inferred_from_analog`, but D-12 treats the derived pulse as kept. | Atish, Moon | Answered: D-21 |
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
| Q-26 | SPHEREx saturates on Barnard's Star, RW Aur and R Dra in the recorded frames (core pixels flagged `OVERFLOW`, some cores NaN); their spectrum is refused as `saturated:<frame_id>` plus `spectrum:saturated`. A live check on 5 Nov found 0 of 30 R Dra frames unsaturated and 17 of 38 RW Aur frames at 0.74–1.12 µm unsaturated, but the first of those is row 57 of the SIA answer, beyond what the ~5 MB fixture budget can record. Options later: PSF-wing photometry (needs the PSF, reverses Q-20) or different demo targets. | Moon, Atish | Answered: D-31 (Moon's confirmation pending) |
| Q-27 | Tag of false-colour encodings. Rainbow Trails (D-28), as built in issue #3, colours each dot with hue = wavelength and tags that colour `derived` (formula "false colour: hue = wavelength", Estimated badge), so in "Measured only" (D-21) the dots are drawn in one colour. Rendering doc R5.2 calls the SPHEREx infrared mode "(measured)", although its tint is also a false-colour mapping computed from measured values, and R5.3 keeps a "flat measured tint" in "Measured only". Should both false-colour encodings carry the same tag, and which one? | Atish, Moon | Open (Rainbow Trails implemented as `derived`) |
| Q-28 | The flipbook in "Measured only". D-21 shows only `measured` layers in that state, and rendering doc R4 calls the flipbook "the only fully measured view". But the cutout pixels are drawn through a display stretch tagged `derived` (A4.1; Estimated badge in the UI), and the ring on the object sits at `x`, `y`, also `derived`. A picture cannot be shown without some stretch. As built in M1 (issue #3), the picture and the ring are always shown; the M1 UI has no honesty toggle yet. In "Measured only", keep the stretched picture and the ring as a stated exception, or hide them? | Atish, Moon | Open |
| Q-29 | Under `SX_OFFLINE=1`, may a Gemini repaint already in the cache be shown? D-25 routes Gemini through the read-through cache, which serves hits offline, while D-24 says the Gemini layer stays off when there is no internet. | Atish | Open |
| Q-30 | Issue #3 (PR #21) keeps the frontend's synthetic fixtures (fake API replies and PNGs served by a Vite plugin, `frontend/fixtures/`) next to the frontend, while D-17 gives `shared/fixtures/` to Moon. For M1 they stay in `frontend/fixtures/` (Atish, 5 Nov 2026), because they are frontend-only test data and M1–M4 build against fixtures independently (D-29). Should M5 move them, or replace them with replies recorded from the backend, into `shared/fixtures/`? | Moon | Open (kept in `frontend/fixtures/` for M1) |
| Q-31 | SPHEREx FLAGS beyond QR2 (checked 5 Nov 2026 for PR #20). The Explanatory Supplement (SSDC-DP-017 v2.0, Table 16) drops `PHANTOM` and `REFERENCE` and adds `CROSSTALK` (20), `STREAK` (25) and `SATELLITE_HALO` (29); the L3 photometry's `CONTAINS_BAD_PIXEL` warning also counts `GHOST*`, `BLOOM`, `SNOWBALL` and `HALO`, which Stage 2 keeps. An IRSA draft (tutorials PR #401) says QR3 and DR1 (12 Nov 2026) name flags with `MSKNnnnn`/`MSKDnnnn` keywords, while `wcs.flag_names` reads only `MP_*`, so a DR1 cutout would refuse every frame as `flags_header`. The demo serves cached QR2 (D-25), so nothing breaks today. Before moving to DR1: add the three new flags to `REJECT_FLAGS`, and read `MSKN*` with `MP_*` as fallback? | Moon | Open |
| Q-32 | A fourth, dev-only badge. D-02 says the UI shows 3 badges. The M1 flipbook (issue #3, PR #21) shows a **Fixture** badge instead of Measured, a page-wide "Fixture data" banner and a SYNTHETIC label on images whenever a reply carries `X-SX-Fixture: synthetic`. Those replies come only from the dev-only fixture server; `scripts/check-dist.js` fails a production build that contains a fixture marker ([UML 08](uml/08-sequence-search-flipbook.md#notes), [A11](architecture/honesty-policy.md#a11-honesty-policy-user-facing)). Proposal: record it in D-02 as a dev-only exception that sits outside the 5 tags and never appears in a production build. Accept? | Atish, Moon | Open (implemented as proposed, dev only) |

**Q-11 differences between the mock-up and R8.8:**

1. **Event shape.** The mock-up streams continuous `sample({intensity, sharpness, speed, roughness, height, material})` plus `tick()`. R8.8 uses discrete `HapticEvent`s (`kind`, `strength`, `rateHz`, `tag`, `pitch`, `pan`). The mock-up has no provenance tag.
2. **Bridges.** The mock-up tries `window.SphereXNative.haptic` and an iOS `webkit.messageHandlers.sphereXHaptic` bridge before `navigator.vibrate`. D-08 is web only for the event.
3. **Nebulae and novae.** The mock-up refuses them ("no surface to feel"). D-12 gives them a field pulse.
4. **Tick length.** The mock-up uses 6–22 ms. R8.3 uses 8–25 ms with calibrated `minMs`.
