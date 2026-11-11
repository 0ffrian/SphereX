# Decisions: Data contract

> **Part of:** the decision log ([index](README.md)) · **Holds:** the data contract, object types, the endpoint list (D-16), schemas and generated types, saved assets, `overrides`, card and fixture shapes, cached replies (provenance tags, the honesty toggle and tier fallback are in [contract-tags.md](contract-tags.md)) · **Authority:** highest; an entry here wins over [rendering/](../rendering/README.md) and [architecture/](../architecture/README.md) (see the index for precedence)

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

- **Spec:** [A4.11](../architecture/endpoints.md#a411-endpoint-register) (every built and planned route with its deciding entry; response shapes are owned by `backend/README.md`). Beyond D-16 and not noted here: Q-87 and Q-98 (`/v1/sky/...`), Q-92 (composite), Q-141 (`/path`), Q-145 (`/track.ecsv`), Q-146 item 6 (`/v1/areas/...`), Q-195 (`/v1/health`). The spectrum row's light curve is `[(time, flux, error)]` plus `frame_id` as built ([A4.2](../architecture/pipeline.md#a42-stage-2-measure-brightness-and-spectrum)).
- **Status note (9 Nov 2026):** Area search adds `GET /v1/areas`, `/v1/areas/{area_id}`, `…/known`, `…/dots`, `…/tracks`, `…/stamps/{dot_id}.png` and `…/export.ecsv` ([A17.8](../architecture/moving-objects/area-contract.md#a178-endpoints); Q-146 item 6, decided), the only routes not keyed by one object id. Track adds `GET /v1/objects/{id}/path` ([A19.5](../architecture/moving-objects/track.md#a195-path-endpoint)) and `GET /v1/objects/{id}/track.ecsv` ([A19.9](../architecture/moving-objects/track-contract.md#a199-export)); they become part of this decision when Q-141 and Q-145 are answered.
- **Status note (9 Nov 2026, correction):** the area routes are not the only routes without an object id: `GET /v1/resolve`, the `/v1/sky/…` routes (Q-87) and `GET /v1/health` (Q-195) have none either ([A4.11](../architecture/endpoints.md#a411-endpoint-register)).

## D-18 The contract is generated from `shared/schemas/` (answers Q-14)

- **Decision:**
  - `shared/schemas/*.json` (JSON Schema) is the single source of the data contract.
  - The backend generates its Pydantic models with `datamodel-code-generator`. The frontend generates `frontend/src/contract/` types with `json-schema-to-typescript`. Both tools are pinned exactly: `datamodel-code-generator` 0.89.0 and `json-schema-to-typescript` 16.0.0.
  - CI fails if regenerated files differ from the committed ones, so the two sides cannot drift.
  - `assertTagged()` and other hand-written helpers move next to the generated types, not into them.
- The generated types replaced the hand-written types from the 4 Nov scaffold in issue #4.

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

## Questions

Status, owner and full text as recorded. The [index](README.md) lists every ID with its file.

| ID | Question | Owner | Status |
|---|---|---|---|
| Q-06 | Endpoints for search, frames and the flipbook. Only `/v1/objects/{id}/card` and `/render-params` are specified. | Kevin | Answered: D-16 |
| Q-09 | With the settings file retired (D-02), what does a "saved" asset hold? Proposal: the ObjectCard, RenderParams and texture URLs. IndexedDB would cache those plus the user's `overrides`. | Atish | Answered: D-22 |
| Q-12 | `RenderParams.view_modes` uses `VisibleMode` and `IRMode` (rendering doc R3.4), but no spec defines their fields. The frontend scaffold types them as opaque `Readonly<Record<string, unknown>>` (`frontend/src/contract/renderParams.ts`, marked `ASSUMPTION`). What fields do they carry (e.g. badge text, disabled flag, channel windows from R5.2)? | Atish, Kevin | Answered: D-23 |
| Q-13 | The type of the client-side `overrides` map (D-02). The scaffold stores `Record<string, unknown>` (`frontend/src/state/store.ts`, marked `ASSUMPTION`), because the slider set and value types are not specified (see Q-03). Which keys and value types are allowed? | Atish, Moon | Answered: D-27 |
| Q-14 | The frontend scaffold added `src/contract/` (TS copies of R3 and R8.8 types), `src/state/` (Zustand store) and `src/app/` (React shell), which R10 does not list. Who owns them? Should `src/contract/` be generated from `shared/schemas/` so the backend and frontend contracts cannot drift? (Related: Q-07.) | Team | Answered: D-17, D-18 |
| Q-18 | D-23 types the view-mode `rgb` as `TV \| null`. With R3.1's default `TV<T = number>` that holds one number, while `gaia_rgb` and `spherex_rgb` in R3.2 are `TV<[number, number, number]>`. Should the schema use `TV<[number, number, number]> \| null`? | Atish, Kevin | Answered: D-23 corrected to `TV<[number, number, number]> \| null` (5 Nov 2026) |
| Q-30 | Issue #3 (PR #21) keeps the frontend's synthetic fixtures (fake API replies and PNGs served by a Vite plugin, `frontend/fixtures/`) next to the frontend, while D-17 gives `shared/fixtures/` to Moon. For M1 they stay in `frontend/fixtures/` (Atish, 5 Nov 2026), because they are frontend-only test data and M1–M4 build against fixtures independently (D-29). Should M5 move them, or replace them with replies recorded from the backend, into `shared/fixtures/`? | Moon | Open (kept in `frontend/fixtures/` for M1) |
| Q-33 | R3.4 types `scale_m` as `number`, but `candidate` has no size, and R11 removes `diameter_km` from an asteroid and expects a refusal with no crash. A required number would force an invented size. Issue #4 makes `scale_m` `number \| null` (R3.4, UML 05 and UML 07 updated). Related: UML 17 says RenderParams may not be used for `candidate` **[verify]**, while issue #4 asks for one params fixture per type, so `candidate` has a params fixture with `layers: []`, `scale_m: null` and `missing: ["mesh", "visible"]`. Confirm both. **Status note (9 Nov 2026):** partly answered by D-32 (`scale_m` nullable; D-32 says "Q-33 stands"); open: the `candidate` params fixture. | Atish | Open (implemented as described) |
| Q-34 | `brown_dwarf_binary` draws two bodies (R7.4) and R8.5 gives each its own pulse rate, but the card holds one `spectral_class`, `flux_45um` and `radius_rjup`, and RenderParams one `scale_m` and one `textures`. Issue #4 adds no fields: the fixture holds `spectral_class: "T1+T6"` as a placeholder. Does the card need a `components` list? | Atish, Moon | Open |
| Q-35 | Seed = hash of (object id + generator version) (R1, A5.1), but no spec names the hash, how the two strings are joined, or how the result becomes an integer. `generator_version` has no format either. R6.3 needs an integer, so the schema types `seed` as an integer ≥ 0. The shared fixtures use labelled fixture seeds (1–14), not a hash. Which hash, and what width? **Spec:** [A5.1](../architecture/data-contract.md#a51-ids-and-seeds) (the as-built seed rule). | Atish | Open. Issue #5 implements, as an ASSUMPTION: SHA-256 of `id` + newline + `generator_version` (UTF-8), first 4 bytes big-endian (32 bits, so it survives JSON in the browser and matches the field's low 32 bits, Q-48); `generator_version` = `p<card_to_params version>-b<BAKER_RULES_VERSION>` (`backend/app/core/render/card_to_params.py`). |
| Q-36 | `VisibleMode.source` (D-23) allows `gaia_rgb`, `class_palette` and `spherex_rgb`, but star colour comes from Teff (R7.5), shader-kind colour is `artistic`, and a mode that is not available still needs a `source`. The fixtures use `class_palette` for all of these; the `rgb` tag, formula and source state the real basis. No badge text is specified for artistic colours, so they use "Default (artist's choice)" from D-02. Add values such as `teff` and `artistic`, and make `source` nullable? | Atish, Kevin | Open (`class_palette` in fixtures) |
| Q-39 | D-16 and D-25 say cached replies carry `cached_at`, and cards and render params are cached, but R3.2 and R3.4 have no such field and the schemas forbid unknown fields. Issue #4 keeps the R3 shapes. When `/card` and `/render-params` are built: add an optional `cached_at` to both schemas, or wrap the reply? | Kevin, Moon | Open. Issue #5 keeps the R3 shapes and sends `cached_at` as the `X-SX-Cached-At` response header, plus the A4.4 status as `X-SX-Asset-Status` (ASSUMPTION; neither header is in D-16). `X-SX-Cached-At` is the oldest `fetched_at` among the cache entries the reply used; a saved generated asset sends the `fetched_at` of its `derived.asset` cache entry, and the header is left out for a pre-baked asset (which has `created_at` instead) and when nothing came from the cache. With `SX_CORS_ORIGINS` set, CORS exposes both headers so the browser can read them (PR #34 review). |
| Q-40 | D-15 says Pydantic validates cards and render params at the API boundary, but the generated models (D-18) are weaker than the schema. They accept `derived` without a `formula` and `model_dependent` without an `assumption`, and since D-32 a layer or dynamics tier that does not match its tag and a layer missing its `formula` or `assumed` (11 of the 33 cases in `shared/fixtures/invalid/cases.json`, counted 7 Nov 2026), coerce `"1.5"` and `true` to numbers, and accept NaN and infinity, which serialise to `null`. `jsonschema` is a dev dependency, so the running API cannot use it today. Serialising has a trap too: a plain `model_dump()` or FastAPI `response_model` adds `null` for every unset field (30 schema errors on the `planet_rocky` card), and `exclude_none` drops the required `value: null` and `scale_m: null`; only `exclude_unset` matches the schema. They also accept an explicit `null` on optional fields where the schema rejects it (`diameter_km`, `formula`, `err`). When `/card` and `/render-params` are built: move `jsonschema` to the runtime dependencies and validate each reply, or add hand-written checks beside the generated models? | Kevin, Moon | Implemented in issue #5 as the first option: `jsonschema` 4.26.0 moved to the runtime dependencies, and `/card` and `/render-params` build plain dicts and validate each reply (`backend/app/core/card/validate.py`); the generated models are used only for the OpenAPI docs. Team to confirm. |
| Q-41 | Stage 2's `LightCurvePoint` (`backend/app/api/spectrum.py`) cannot fill the card's `lightcurve` (R3.2). `time` and `error` convert to `t_mjd` and `sigma`, but `lambda_um` is required on the card and `wavelength_um` is optional in stage 2 (Q-24), and `flags` is a number on the card while stage 2 has only the `flagged` bool, with no bitmask. A point with no wavelength would need an invented value or be dropped. Options for `/card`: make `lambda_um` nullable and `flags` a bool or a list of names, or have stage 2 always emit a wavelength and a bitmask. | Kevin, Moon | Open (R3.2 shape kept). Issue #5 fills `lightcurve` for `star_mira` and `star_ttauri` from stage 2: points without a wavelength are left out, and `flags` is 1 when stage 2 marked the point `flagged`, else 0 (ASSUMPTION; not a SPHEREx bitmask). |
| Q-42 | `gas_Q` in R3.2 is commented "per epoch", and R7.3 and R11 need Aug and Dec values, but its shape `{ co2?: TV; h2o?: TV; co?: TV }` holds one value per molecule. Issue #4 keeps the R3.2 shape, so a card can carry only one epoch's Q and the Aug/Dec toggle cannot be fed from it. Proposal: key it by epoch, `{ '2025-08'?: {…}, '2025-12'?: {…} }`, before the comet renderer is built. | Atish, Moon | Answered for 3I/ATLAS by Q-260: the epoch-keyed shape is in the schema and loaded. Earlier note: open (R3.2 shape kept). The comet renderer (issue #7) reads both shapes: a `gas_Q` keyed by epoch (this proposal), and the one-epoch R3.2 shape. The R3.2 shape is used only when `epochs` has exactly one entry and it is the selected epoch; with both epochs listed, one Q cannot be assigned to either, so `gas_shells` is refused. This does not decide the question. |
| Q-195 | **`GET /v1/health` beyond D-16.** `backend/app/main.py:149` serves `{status, offline, data_release}`; no spec or decision lists it. Proposal: accept it as a non-object meta route beside the `/v1/sky` routes (Q-87); the event check reads it ([A10.2](../architecture/frontend-platform.md#a102-running-the-event-build) step 5). Listed in [A4.11](../architecture/endpoints.md#a411-endpoint-register). Spec: [A4.11](../architecture/endpoints.md#a411-endpoint-register), [A10.2](../architecture/frontend-platform.md#a102-running-the-event-build). | Kevin | Proposed |
| Q-196 | **Every `missing` code has UI wording, checked in CI.** `backendReasons.test.ts` checks only Stage 1 and 2 frame reasons. Proposal: extend it to every code in [A4.12](../architecture/refusals.md#a412-missing-and-refusal-codes) (overlay, composite, card and params, `measuring:`, `type:*`), so a backend code without a `messages.ts` line fails CI; a code with no wording is still shown as is (A11). Spec: [A4.12](../architecture/refusals.md#a412-missing-and-refusal-codes), [A11](../architecture/honesty-policy.md#a11-honesty-policy-user-facing). | Moon | Proposed |
| Q-363 | **New optional card fields for the engines (issue #93 phase 4, D-38; amends Q-312; R3.2, A3.8, A3.2).** Planets: `orbit_ecc` (archive `pl_orbeccen`, `measured`; an exact 0 with no error is a fit fixed to a circle, so `model_dependent` with that assumption; an archive-calculated value `model_dependent`), `insolation_searth` (`pl_insol`, `derived`: the reference computed it from L and a), `host_lum_lsun` (10^`st_lum`, `measured`), `dayside_temp_K`, `nightside_temp_K` and `hotspot_offset_deg` (eclipse and phase-curve values, literature registry only, Q-364). Stars: `lum_lsun` and `mass_msun` (Gaia DR3 FLAME `lum_flame`, `mass_flame`, `model_dependent` like `radius_flame`), `flare_rate_per_d` (literature registry; band and threshold in `source`), and `rot_period_h` on `star` and `star_ttauri` cards (literature registry, else null). All optional, null with the reason when absent. Use: `cardToWorld` takes the eccentricity (Q-357) and the host luminosity for the starlight; `cardToStar` takes the FLAME mass and luminosity (Q-358), so Q-312's "mass is never on a star card" no longer holds where FLAME has one (not for Barnard's Star or Procyon). The phase-curve values are readouts, not engine inputs yet; the viewer's motion chain reads `flare_rate_per_d` from the card as its first rung (R5.7), and it is not yet carried into `RenderParams.dynamics`. Schemas: `shared/schemas/object-card.schema.json` and the generated code. | Atish | Decided (Atish, 11 Nov 2026) |
