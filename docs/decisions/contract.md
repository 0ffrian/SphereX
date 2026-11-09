# Decisions: Data contract and honesty

> **Part of:** the decision log ([index](README.md)) · **Holds:** the data contract, provenance tags and badges, the honesty toggle, tier fallback, the endpoint list (D-16), schemas and fixtures, "which tag does X get" · **Authority:** highest; an entry here wins over [rendering/](../rendering/README.md) and [architecture/](../architecture/README.md) (see the index for precedence)

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
- **Status note (9 Nov 2026):** "See Q-03" means D-26, which answers Q-03.

## D-04 Object types

- **Decision:** `ObjectType` is the union of both lists:
  - From the rendering doc: `asteroid_shape`, `asteroid_procedural`, `comet`, `brown_dwarf`, `brown_dwarf_binary`, `star_mira`, `star_ttauri`, `star`, `candidate`.
  - From the architecture spec: `planet_rocky`, `planet_water`, `gas_giant`, `nebula`, `nova`. These are P2 or lower and come from the Exoplanet Archive or user sliders, not from SPHEREx detections.
- The architecture spec's old `dwarf` kind maps to `brown_dwarf`, and `asteroid` maps to `asteroid_shape` or `asteroid_procedural`.

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
- **Note (issue #12, not yet decided: Q-50).** The P1 overlays add three endpoints that this table does not list. They are built and documented in [A4.9](../architecture/overlays.md#a49-overlays-flag-mask-and-combine), but they become part of this decision only when Q-50 is answered:

  | Endpoint | Returns |
  |---|---|
  | `GET /v1/objects/{id}/overlays` | Gaia and CatWISE sources, per-frame markers, aperture/annulus contamination, footprint, cutout box, flag groups, `missing`, `provenance` |
  | `GET /v1/objects/{id}/flags/{frame_id}.png` | RGBA mask from the cutout's FLAGS extension; 404 `flags_unavailable` when the cutout has no usable mask |
  | `GET /v1/objects/{id}/combine.png?op=add\|sub&a=<frame_id>&b=<frame_id>` | A + B or A − B on frame A's grid, as PNG; its metadata (both wavelengths, unit, stretch, tag `derived`, formula) in the `X-SX-Combine` JSON response header |

- **Note (issue #14, not yet decided: Q-122).** The P3 Gemini layer (D-07) adds three endpoints that this table does not list. They are built and documented in [A6.2](../architecture/generators.md#a62-optional-gemini-artistic-layer) and [R6.6](../rendering/surface-generation.md#r66-optional-paths), but they become part of this decision only when Q-122 is answered:

  | Endpoint | Returns |
  |---|---|
  | `POST /v1/admin/objects/{id}/gemini-repaint[?refresh=true]` | Admin only (`X-SX-Admin-Token`; 404 when `SX_ADMIN_TOKEN` is unset, 403 when the token is missing or wrong). Bakes if needed, asks Gemini, checks the edge correlation. Always 200 with a status body: `status` is `applied` or `code` (code colour kept, `reason` says why) |
  | `GET /v1/objects/{id}/albedo-ai` | The same status body for the current bake, without calling Gemini |
  | `GET /v1/objects/{id}/albedo-ai.webp` | The AI albedo (tag `artistic`), or 404 `albedo_ai_unavailable` |
- **Note (issue #41, not yet decided: Q-111).** The object job adds two endpoints that this table does not list; they become part of this decision only when Q-111 is answered:

  | Endpoint | Returns |
  |---|---|
  | `GET /v1/objects/{id}/job` | The object's background job: `state`, `stage`, `frames_done`, `frames_total`, `answer` (`none`, `first`, `partial`, `final`), times, `seq`; `{id, state: "idle"}` when there is none |
  | `GET /v1/objects/{id}/job/events` | The same JSON as server-sent events, one per change, until the job ends |

- **Spec:** [A4.11](../architecture/endpoints.md#a411-endpoint-register) (every built and planned route with its deciding entry; response shapes are owned by `backend/README.md`). Beyond D-16 and not noted here: Q-87 and Q-98 (`/v1/sky/...`), Q-92 (composite), Q-141 (`/path`), Q-145 (`/track.ecsv`), Q-146 item 6 (`/v1/areas/...`), Q-175 (`/v1/health`). The spectrum row's light curve is `[(time, flux, error)]` plus `frame_id` as built ([A4.2](../architecture/pipeline.md#a42-stage-2-measure-brightness-and-spectrum)).
- **Status note (9 Nov 2026):** Area search adds `GET /v1/areas`, `/v1/areas/{area_id}`, `…/known`, `…/dots`, `…/tracks`, `…/stamps/{dot_id}.png` and `…/export.ecsv` ([A17.8](../architecture/moving-objects/area-backend.md#a178-endpoints); Q-146 item 6, decided), the only routes not keyed by one object id. Track adds `GET /v1/objects/{id}/path` ([A19.5](../architecture/moving-objects/track.md#a195-path-endpoint)) and `GET /v1/objects/{id}/track.ecsv` ([A19.9](../architecture/moving-objects/track-contract.md#a199-export)); they become part of this decision when Q-141 and Q-145 are answered.

## D-18 The contract is generated from `shared/schemas/` (answers Q-14)

- **Decision:**
  - `shared/schemas/*.json` (JSON Schema) is the single source of the data contract.
  - The backend generates its Pydantic models with `datamodel-code-generator`. The frontend generates `frontend/src/contract/` types with `json-schema-to-typescript`. Both tools are pinned exactly: `datamodel-code-generator` 0.89.0 and `json-schema-to-typescript` 16.0.0.
  - CI fails if regenerated files differ from the committed ones, so the two sides cannot drift.
  - `assertTagged()` and other hand-written helpers move next to the generated types, not into them.
- The generated types replaced the hand-written types from the 4 Nov scaffold in issue #4.

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
- **Status note (9 Nov 2026):** Q-113 item 7 (built: Build it, Replay and New seed raise the global level to + Artistic) and Q-49 (should the showcase kinds start at + Artistic?) depart from the + Estimated start; open in Q-180.

## D-22 What a saved asset holds (answers Q-09)

- **Decision:** A saved asset holds the ObjectCard, the RenderParams, the texture URLs, `generator_version`, `seed` and `created_at`. `generator_version` and `seed` keep the rendering doc §6.7 cache key reproducible.
- `overrides` stay in the browser (IndexedDB) and are never sent to the server.
- **Status note (9 Nov 2026):** not built as written: `overrides` live in memory and are cleared on load ([A5.3](../architecture/data-contract.md#a53-overrides)); generated assets are saved on the backend (Q-57, [A4.4](../architecture/pipeline-card.md#a44-stage-4-check-for-a-saved-asset)).

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

## D-27 Type of `overrides` (answers Q-13)

- **Decision:** `overrides` is `Partial<Record<SliderKey, number | boolean>>`. A slider registry lists every allowed key as `{ key, min, max, step, unit, appliesTo: ObjectType[] }`, so an unknown key fails the type check. Values use the same units as the card.
- **Note (issue #13, PR #33):** there is one registry, `frontend/src/viewer/sliders.ts`, for the viewer and the physics layer. Each entry adds two fields to the shape above: `group` (`colour`, `lighting`, `spin`, `relief` or `physics`, so D-26 can be checked) and `spec` (the section the slider feeds). One invalid-value policy: a value outside the range, not finite or not registered for the type is ignored, never clamped. This is a note, not a new decision.

## D-32 Tier fallback chain (partly answers Q-38)

> From the block "7 Nov 2026: tiers, accuracy and motion (issue #38)": Source: the team plan "Physics-backed Sky Sculptor" (6 Nov 2026). D-32 to D-34 were proposed by Moon as M2 owner (D-30). D-32 is accepted (Atish, PR #44); D-33 and D-34 are **pending team confirmation**.

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
- **Status:** Accepted, in effect from the merge of PR #44. Proposed by Moon (M2 owner, D-30) on 7 Nov 2026. Atish approved PR #44, which adopts it, as stage 7 owner (D-17) on 7 Nov 2026 and asked for this record. Kevin's confirmation (stage 6, Q-60) and Atish's sign-off of the haptics point (D-13) are pending and will be recorded here. Any teammate may reopen it.
  - **Slider values are not tier 3.** A value the visitor sets with a physics slider is their choice, not a typical class value, so what it feeds keeps the tag Q-58 (b) gives it (`artistic` today); D-32's tier 3 is only for a typical value the code states.

## Questions

Status, owner and full text as recorded. The [index](README.md) lists every ID with its file.

| ID | Question | Owner | Status |
|---|---|---|---|
| Q-06 | Endpoints for search, frames and the flipbook. Only `/v1/objects/{id}/card` and `/render-params` are specified. | Kevin | Answered: D-16 |
| Q-08 | Honesty toggle: what is the starting state? In "Measured only", do `derived` data haptics (e.g. the D-12 `teq_pulse`) stay on? The toggle table hides only `artistic` and `inferred_from_analog`, but D-12 treats the derived pulse as kept. | Atish, Moon | Answered: D-21 (the store now starts at `derived`, the + Estimated state) |
| Q-09 | With the settings file retired (D-02), what does a "saved" asset hold? Proposal: the ObjectCard, RenderParams and texture URLs. IndexedDB would cache those plus the user's `overrides`. | Atish | Answered: D-22 |
| Q-12 | `RenderParams.view_modes` uses `VisibleMode` and `IRMode` (rendering doc R3.4), but no spec defines their fields. The frontend scaffold types them as opaque `Readonly<Record<string, unknown>>` (`frontend/src/contract/renderParams.ts`, marked `ASSUMPTION`). What fields do they carry (e.g. badge text, disabled flag, channel windows from R5.2)? | Atish, Kevin | Answered: D-23 |
| Q-13 | The type of the client-side `overrides` map (D-02). The scaffold stores `Record<string, unknown>` (`frontend/src/state/store.ts`, marked `ASSUMPTION`), because the slider set and value types are not specified (see Q-03). Which keys and value types are allowed? | Atish, Moon | Answered: D-27 |
| Q-14 | The frontend scaffold added `src/contract/` (TS copies of R3 and R8.8 types), `src/state/` (Zustand store) and `src/app/` (React shell), which R10 does not list. Who owns them? Should `src/contract/` be generated from `shared/schemas/` so the backend and frontend contracts cannot drift? (Related: Q-07.) | Team | Answered: D-17, D-18 |
| Q-18 | D-23 types the view-mode `rgb` as `TV \| null`. With R3.1's default `TV<T = number>` that holds one number, while `gaia_rgb` and `spherex_rgb` in R3.2 are `TV<[number, number, number]>`. Should the schema use `TV<[number, number, number]> \| null`? | Atish, Kevin | Answered: D-23 corrected to `TV<[number, number, number]> \| null` (5 Nov 2026) |
| Q-25 | How should user-typed coordinates be tagged? They are input, not an observation, and none of the five tags fits exactly. The backend (issue #1) tags them `derived` with the formula "the coordinates typed in the query (user input, not an observation)", so they show as **Estimated** and stay visible in the starting honesty state (D-21). Frame positions of a typed-coordinate object reuse that tag. | Atish, Kevin | Open (implemented as described) |
| Q-27 | Tag of false-colour encodings. Rainbow Trails (D-28), as built in issue #3, colours each dot with hue = wavelength and tags that colour `derived` (formula "false colour: hue = wavelength", Estimated badge), so in "Measured only" (D-21) the dots are drawn in one colour. Rendering doc R5.2 calls the SPHEREx infrared mode "(measured)", although its tint is also a false-colour mapping computed from measured values, and R5.3 keeps a "flat measured tint" in "Measured only". Should both false-colour encodings carry the same tag, and which one? **Status note (9 Nov 2026):** Area search's dot colours (A16.5, A18.2) and Track's ticks and points (A20.3, A20.7) use the same hue = wavelength scale and follow this answer; built as `derived`, one colour in Measured only. Q-88 item 1 and Q-93 ask the same tag question; answer them with this row. | Atish, Moon | Open (Rainbow Trails implemented as `derived`) |
| Q-28 | The flipbook in "Measured only". D-21 shows only `measured` layers in that state, and rendering doc R4 calls the flipbook "the only fully measured view". But the cutout pixels are drawn through a display stretch tagged `derived` (A4.1; Estimated badge in the UI), and the ring on the object sits at `x`, `y`, also `derived`. A picture cannot be shown without some stretch. As built in M1 (issue #3), the picture and the ring are always shown; the M1 UI has no honesty toggle yet. In "Measured only", keep the stretched picture and the ring as a stated exception, or hide them? | Atish, Moon | Open |
| Q-30 | Issue #3 (PR #21) keeps the frontend's synthetic fixtures (fake API replies and PNGs served by a Vite plugin, `frontend/fixtures/`) next to the frontend, while D-17 gives `shared/fixtures/` to Moon. For M1 they stay in `frontend/fixtures/` (Atish, 5 Nov 2026), because they are frontend-only test data and M1–M4 build against fixtures independently (D-29). Should M5 move them, or replace them with replies recorded from the backend, into `shared/fixtures/`? | Moon | Open (kept in `frontend/fixtures/` for M1) |
| Q-32 | A fourth, dev-only badge. D-02 says the UI shows 3 badges. The M1 flipbook (issue #3, PR #21) shows a **Fixture** badge instead of Measured, a page-wide "Fixture data" banner and a SYNTHETIC label on images whenever a reply carries `X-SX-Fixture: synthetic`. Those replies come only from the dev-only fixture server; `scripts/check-dist.js` fails a production build that contains a fixture marker ([UML 08](../uml/08-sequence-search-flipbook.md#notes), [A11](../architecture/honesty-policy.md#a11-honesty-policy-user-facing)). Proposal: record it in D-02 as a dev-only exception that sits outside the 5 tags and never appears in a production build. Accept? | Atish, Moon | Open (implemented as proposed, dev only) |
| Q-33 | R3.4 types `scale_m` as `number`, but `candidate` has no size, and R11 removes `diameter_km` from an asteroid and expects a refusal with no crash. A required number would force an invented size. Issue #4 makes `scale_m` `number \| null` (R3.4, UML 05 and UML 07 updated). Related: UML 17 says RenderParams may not be used for `candidate` **[verify]**, while issue #4 asks for one params fixture per type, so `candidate` has a params fixture with `layers: []`, `scale_m: null` and `missing: ["mesh", "visible"]`. Confirm both. **Status note (9 Nov 2026):** partly answered by D-32 (`scale_m` nullable; D-32 says "Q-33 stands"); open: the `candidate` params fixture. | Atish | Open (implemented as described) |
| Q-34 | `brown_dwarf_binary` draws two bodies (R7.4) and R8.5 gives each its own pulse rate, but the card holds one `spectral_class`, `flux_45um` and `radius_rjup`, and RenderParams one `scale_m` and one `textures`. Issue #4 adds no fields: the fixture holds `spectral_class: "T1+T6"` as a placeholder. Does the card need a `components` list? | Atish, Moon | Open |
| Q-35 | Seed = hash of (object id + generator version) (R1, A5.1), but no spec names the hash, how the two strings are joined, or how the result becomes an integer. `generator_version` has no format either. R6.3 needs an integer, so the schema types `seed` as an integer ≥ 0. The shared fixtures use labelled fixture seeds (1–14), not a hash. Which hash, and what width? **Spec:** [A5.1](../architecture/data-contract.md#a51-ids-and-seeds) (the as-built seed rule). | Atish | Open. Issue #5 implements, as an ASSUMPTION: SHA-256 of `id` + newline + `generator_version` (UTF-8), first 4 bytes big-endian (32 bits, so it survives JSON in the browser and matches the field's low 32 bits, Q-48); `generator_version` = `p<card_to_params version>-b<BAKER_RULES_VERSION>` (`backend/app/core/render/card_to_params.py`). |
| Q-36 | `VisibleMode.source` (D-23) allows `gaia_rgb`, `class_palette` and `spherex_rgb`, but star colour comes from Teff (R7.5), shader-kind colour is `artistic`, and a mode that is not available still needs a `source`. The fixtures use `class_palette` for all of these; the `rgb` tag, formula and source state the real basis. No badge text is specified for artistic colours, so they use "Default (artist's choice)" from D-02. Add values such as `teff` and `artistic`, and make `source` nullable? | Atish, Kevin | Open (`class_palette` in fixtures) |
| Q-38 | `Layer` (R3.4) has one `tag` and no `formula` or `assumption`, while R3.1 requires them on values, and no spec lists the layer ids or the format of `missing` entries for RenderParams. The fixtures put the formula or assumption in `description`, take ids from the renderer docs (`mesh`, `spin`, `nucleus`, `gas_shells`, …) and list a refused layer or view mode by its bare id (`teq_pulse`, `mesh`, `spherex_ir`, `visible`). The viewer renderers (issue #7) use these ids: `mesh`, `spin`, `material`, `ellipsoid`, `albedo_map`, `relief`, `body`, `emissive`, `bands`, `orbit`, `nucleus`, `gas_shells`, `dust`, `tail`, `colour`, `limb_darkening`, `motion_trail`, `brightness_curve`, `radius_pulsation`, `disc`, `dust_screen` (comet: `dust`, `tail`; brown dwarf: `body`). Layers with two tags in the specs carry the one that claims less: gas shells `model_dependent` (R7.3), dust screen `artistic` (R7.5). R5.3 lists band patterns as `artistic` while R7.4 calls band contrast `derived`; the fixture `bands` layer is `artistic`. Should `Layer` gain `formula` and `assumption`, and should the layer ids become an enum? | Atish, Moon | Partly answered by D-32: `formula`, `assumed` and `tier` are now on `Layer` (R3.4). Open: the layer-id enum and the `missing` entry format. |
| Q-39 | D-16 and D-25 say cached replies carry `cached_at`, and cards and render params are cached, but R3.2 and R3.4 have no such field and the schemas forbid unknown fields. Issue #4 keeps the R3 shapes. When `/card` and `/render-params` are built: add an optional `cached_at` to both schemas, or wrap the reply? | Kevin, Moon | Open. Issue #5 keeps the R3 shapes and sends `cached_at` as the `X-SX-Cached-At` response header, plus the A4.4 status as `X-SX-Asset-Status` (ASSUMPTION; neither header is in D-16). `X-SX-Cached-At` is the oldest `fetched_at` among the cache entries the reply used; a saved generated asset sends the `fetched_at` of its `derived.asset` cache entry, and the header is left out for a pre-baked asset (which has `created_at` instead) and when nothing came from the cache. With `SX_CORS_ORIGINS` set, CORS exposes both headers so the browser can read them (PR #34 review). |
| Q-40 | D-15 says Pydantic validates cards and render params at the API boundary, but the generated models (D-18) are weaker than the schema. They accept `derived` without a `formula` and `model_dependent` without an `assumption`, and since D-32 a layer or dynamics tier that does not match its tag and a layer missing its `formula` or `assumed` (11 of the 33 cases in `shared/fixtures/invalid/cases.json`, counted 7 Nov 2026), coerce `"1.5"` and `true` to numbers, and accept NaN and infinity, which serialise to `null`. `jsonschema` is a dev dependency, so the running API cannot use it today. Serialising has a trap too: a plain `model_dump()` or FastAPI `response_model` adds `null` for every unset field (30 schema errors on the `planet_rocky` card), and `exclude_none` drops the required `value: null` and `scale_m: null`; only `exclude_unset` matches the schema. They also accept an explicit `null` on optional fields where the schema rejects it (`diameter_km`, `formula`, `err`). When `/card` and `/render-params` are built: move `jsonschema` to the runtime dependencies and validate each reply, or add hand-written checks beside the generated models? | Kevin, Moon | Implemented in issue #5 as the first option: `jsonschema` 4.26.0 moved to the runtime dependencies, and `/card` and `/render-params` build plain dicts and validate each reply (`backend/app/core/card/validate.py`); the generated models are used only for the OpenAPI docs. Team to confirm. |
| Q-41 | Stage 2's `LightCurvePoint` (`backend/app/api/spectrum.py`) cannot fill the card's `lightcurve` (R3.2). `time` and `error` convert to `t_mjd` and `sigma`, but `lambda_um` is required on the card and `wavelength_um` is optional in stage 2 (Q-24), and `flags` is a number on the card while stage 2 has only the `flagged` bool, with no bitmask. A point with no wavelength would need an invented value or be dropped. Options for `/card`: make `lambda_um` nullable and `flags` a bool or a list of names, or have stage 2 always emit a wavelength and a bitmask. | Kevin, Moon | Open (R3.2 shape kept). Issue #5 fills `lightcurve` for `star_mira` and `star_ttauri` from stage 2: points without a wavelength are left out, and `flags` is 1 when stage 2 marked the point `flagged`, else 0 (ASSUMPTION; not a SPHEREx bitmask). |
| Q-42 | `gas_Q` in R3.2 is commented "per epoch", and R7.3 and R11 need Aug and Dec values, but its shape `{ co2?: TV; h2o?: TV; co?: TV }` holds one value per molecule. Issue #4 keeps the R3.2 shape, so a card can carry only one epoch's Q and the Aug/Dec toggle cannot be fed from it. Proposal: key it by epoch, `{ '2025-08'?: {…}, '2025-12'?: {…} }`, before the comet renderer is built. | Atish, Moon | Open (R3.2 shape kept). The comet renderer (issue #7) reads both shapes: a `gas_Q` keyed by epoch (this proposal), and the one-epoch R3.2 shape. The R3.2 shape is used only when `epochs` has exactly one entry and it is the selected epoch; with both epochs listed, one Q cannot be assigned to either, so `gas_shells` is refused. This does not decide the question. |
| Q-91 | Tag of a picked sky position (extends Q-25). A clicked position is user input, tagged `derived` with the formula "the position under the pointer, computed from the view direction (user input, not an observation)" (Estimated badge). The start view (RA 266.4°, Dec −28.9°, FOV 60°) is a display choice and is not shown as data. | Atish, Moon | Open (implemented as described) |
| Q-93 | Tags of the flipbook colour views (extends Q-27). The Raw ↔ Colour toggle offers a wavelength tint (each grey frame multiplied by `wavelengthColor` of its own λ; "false colour: hue = wavelength" plus the stretch) and a SPHEREx composite (three aligned frames as B, G, R; the backend's `formula` names the wavelengths, dates, stretch and grid). Both are tagged `derived` (Estimated) and fall back to the grey frames with a note in Measured only (D-21); the composite is then not requested. R5.2 calls the SPHEREx infrared tint "(measured)" and R5.3 keeps a "flat measured tint" in Measured only. If Q-27 settles on `measured`, change `COLOUR_TAG` and `effectiveColour` in `frontend/src/app/flipbook/colourMode.ts`. | Atish, Moon | Open (implemented as `derived`, hidden in Measured only) |
| Q-110 | **Policy for [verify] constants (issue #42; D-32, R5.7, R7.7; PR #52 review).** Status: **proposed, for Moon (architect) to confirm.** A constant marked **[verify]** may be used only if the layer it feeds is tagged at its tier (`inferred_from_analog` or `artistic`, tier 4 or 5), shows its formula and `assumed`, and names its source or says there is none. The class-typical rung `MOTION_CONFIG.typical` (`frontend/src/viewer/motion/motion.ts`) is filled with such tier-4 analogues, each with a `// [verify]` comment and a source, never silently. Current cases: `regionCount` (star surface regions, `starModel.ts`), `JUPITER_FLATTENING` and `FLATTENING_MAX` (`shaderSpec.ts`, the analogue and the display cap), and `MOTION_CONFIG.typical`. No code change in this PR. | Moon | Proposed |
| Q-175 | **`GET /v1/health` beyond D-16.** `backend/app/main.py:149` serves `{status, offline, data_release}`; no spec or decision lists it. Proposal: accept it as a non-object meta route beside the `/v1/sky` routes (Q-87); the event check reads it ([A10.2](../architecture/frontend-platform.md#a102-running-the-event-build) step 5). Listed in [A4.11](../architecture/endpoints.md#a411-endpoint-register). Spec: [A4.11](../architecture/endpoints.md#a411-endpoint-register), [A10.2](../architecture/frontend-platform.md#a102-running-the-event-build). | Kevin | Proposed |
| Q-176 | **Every `missing` code has UI wording, checked in CI.** `backendReasons.test.ts` checks only Stage 1 and 2 frame reasons. Proposal: extend it to every code in [A4.12](../architecture/refusals.md#a412-missing-and-refusal-codes) (overlay, composite, card and params, `measuring:`, `type:*`), so a backend code without a `messages.ts` line fails CI; a code with no wording is still shown as is (A11). Spec: [A4.12](../architecture/refusals.md#a412-missing-and-refusal-codes), [A11](../architecture/honesty-policy.md#a11-honesty-policy-user-facing). | Moon | Proposed |
| Q-180 | **Conflict: the honesty start state (D-21) against Build it raising the level (Q-113 item 7) and the showcase kinds (Q-49).** D-21 (Accepted) starts the toggle at + Estimated and leaves the moves to the user ([R5.3](../rendering/display-rules.md#r53-honesty-toggle-3-states)). Q-113 item 7 (Proposed, built) makes **Build it**, **Replay** and **New seed** raise the stored, global level to + Artistic, because a generated world's surface is `artistic` and would otherwise show as a plain sphere. Q-49 (Open) asks the same for the shader showcase kinds: is + Estimated their intended first view, or should they start at + Artistic? Proposed default, as written in [R5.8](../rendering/build-mould.md#r58-build-split-view-and-moulding): a "Proposed exception (Q-113 item 7, Moon to confirm; the same question as Q-49)": the three build actions raise the level only when the plan has layers the level hides; the rail's 3D viewer and a plain level change do not; the live region says "Showing artist's impression so the whole body can be built"; every revealed layer keeps its tag chip. R5.3 does not mention the exception. To settle once, as a D-21 amendment covering Q-49 and Q-113 item 7, then state the exception in R5.3. Spec: [R5.3](../rendering/display-rules.md#r53-honesty-toggle-3-states), [R5.8](../rendering/build-mould.md#r58-build-split-view-and-moulding). | Atish, Moon | Open |
| Q-181 | **Conflict: two outputs of the same Horizons orbit solution get different tags.** Q-62 item 4 (Open, built) tags the Horizons phase angle `measured` ("rendering wins", R5.1) and the Sun vector `derived`. Q-134 (Answered, Atish) and Q-141 (Open, Kevin) tag the Horizons path `model_dependent`; [A3.4](../architecture/data-sources.md#a34-jpl-horizons) tags Horizons positions as predictions, `model_dependent`, and PR #53 tags mover RA/Dec `model_dependent` too. As written in the specs: the [A3.4](../architecture/data-sources.md#a34-jpl-horizons) Lighting row says "one rule for Horizons-derived tags is still to decide (Q-62 item 4)", and [R5.1](../rendering/display-rules.md#r51-lighting) says "Tag: `measured` (Q-62 item 4, still to confirm)". No default is proposed in either spec. To settle: one rule for every Horizons-derived quantity, recorded as a D- entry, then A3.4, R5.1 and [A19.11](../architecture/moving-objects/track-contract.md#a1911-provenance-per-value) follow it. Spec: [A3.4](../architecture/data-sources.md#a34-jpl-horizons), [R5.1](../rendering/display-rules.md#r51-lighting), [A19.11](../architecture/moving-objects/track-contract.md#a1911-provenance-per-value). | Atish (lighting), Kevin (adapter) | Open |
