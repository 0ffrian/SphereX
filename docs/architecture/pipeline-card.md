# Pipeline: classify to RenderParams

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A4.3–A4.8 · **Implements:** [D-04](../decisions/contract.md), [D-22](../decisions/contract.md), [D-32](../decisions/contract-tags.md), [Q-55, Q-56, Q-60, Q-62, Q-63](../decisions/pipeline-stages.md), [Q-57, Q-61](../decisions/pipeline-jobs.md), [Q-58, Q-59](../decisions/rendering-bodies.md), [Q-35](../decisions/contract.md), [Q-39](../decisions/contract.md), [Q-47](../decisions/rendering-bodies.md) · **Read with:** [pipeline.md](pipeline.md) (A4 overview), [../rendering/data-contract.md](../rendering/data-contract.md) (R3), [refusals.md](refusals.md) (A4.12)

Stages 3 to 7 of the pipeline ([A4](pipeline.md#a4-pipeline)). They run inside the object job ([A4.10](jobs.md#a410-object-job-and-fan-out)). Their routes are listed in [A4.11](endpoints.md#a411-endpoint-register) and their `missing` codes in [A4.12](refusals.md#a412-missing-and-refusal-codes).

### A4.3 Stage 3: Classify and pick a type

- **Input:** spectrum, Gaia colours (if known), catalogue match (SBDB, SIMBAD, Exoplanet Archive).
- **Process:**
  1. Pick the `ObjectType` with the type-selection rules in rendering doc §3.3: SBDB comet → `comet`; SBDB asteroid → `asteroid_shape` if a DAMIT or NASA model exists, otherwise `asteroid_procedural`; SIMBAD type → `brown_dwarf`, `brown_dwarf_binary`, `star_mira`, `star_ttauri` or `star`; anything else → `candidate`.
  2. Match the spectrum against reference types for the class label: asteroid classes, brown dwarf types, comet gas features (water 2.7 micron, CO2 4.25, CO 4.67).
  3. `planet_rocky`, `planet_water`, `gas_giant`, `nebula` and `nova` do not come from SPHEREx detections. They come from the Exoplanet Archive or user sliders (D-04).
- **Output:** `type` (one of the D-04 union below), plus a class label (`spectral_class`) with a confidence.

  | Source of the type | `ObjectType` values |
  |---|---|
  | Rendering doc | `asteroid_shape`, `asteroid_procedural`, `comet`, `brown_dwarf`, `brown_dwarf_binary`, `star_mira`, `star_ttauri`, `star`, `candidate` |
  | This doc | `planet_rocky`, `planet_water`, `gas_giant`, `nebula`, `nova` |

  The old `dwarf` kind maps to `brown_dwarf`. The old `asteroid` kind maps to `asteroid_shape` or `asteroid_procedural`.
- **Status:** Built (issue #5, `backend/app/core/classify/`). The class label is taken from the catalogue only (SIMBAD `sp_type`, SBDB `spec_B` then `spec_T`); its confidence is `catalogue` or `none`, and spectrum matching against reference types (step 2) is not built ([Q-55](../decisions/pipeline-stages.md)). The SIMBAD otype mapping is Q-55 items 2 and 3.
- **Exoplanet types ([Q-63](../decisions/pipeline-stages.md), decided):** the mass-and-radius rule is built as `PROPOSED_EXOPLANET_THRESHOLDS` in `backend/app/core/classify/rules.py`, with the Zeng et al. 2019 curves in `zeng2019.py`. Exoplanet types use the Q-63 thresholds, on since issue #68 (Moon's sign-off, 9 Nov 2026; PR #69): the live `EXOPLANET_THRESHOLDS` is `dict(PROPOSED_EXOPLANET_THRESHOLDS)`, `ASSET_VERSION` 5. A threshold set to `None` makes the object fall through to `candidate` with `type:exoplanet_thresholds` in `missing` (Q-56); the other `type:exoplanet_*` codes of A4.12 apply when the rule cannot place a planet.

### A4.4 Stage 4: Check for a saved asset

```text
asset = store.get(object_id)
if asset exists            -> status = "saved"      -> load its ObjectCard
else if type is known      -> status = "generated"  -> build the ObjectCard from catalogues + spectrum
else                       -> status = "sketch"     -> build the ObjectCard from SPHEREx only
save the new card to the store (only when its inputs are final, below)
```

A sketch from SPHEREx only is often a `candidate`, which gets no 3D body (rendering doc §7.6). What a saved asset holds: [A5.4](data-contract.md#a54-asset-store) (D-22). This is the lookup flow of the Surface Lab "Lookup" card in the mock-up.

**Status:** Built (issue #5, `backend/app/core/card/assets.py`; [Q-57](../decisions/pipeline-jobs.md)).

- Pre-baked assets are read from `backend/assets/<type>/<id>.json` (`SX_ASSETS_DIR`; the id is percent-encoded).
- **Lookup order and the pack stand-in ([Q-206](../decisions/demo-pack.md), issue #75).** The generated asset is read first, then the pre-baked one. A pre-baked asset whose RenderParams list `spectrum` in `missing` (every demo-pack row, Q-164) is a stand-in: the object's job builds live and answers with that build when it has a measured spectrum and the same `type`. The pre-baked asset answers (`saved`) only when the live build has no spectrum, changes type (catalogue answer missing offline), or fails. That live build publishes no intermediate answer and is baked and saved only if it wins, so a reply never flips back and a losing build never replaces the pack. Each layer passes the contract check on its own (an invalid generated asset falls through to the pack). A reply is never a mix of the two.
- Generated assets are saved as `derived.asset` entries in the D-25 cache, keyed by id, data release, `ASSET_VERSION` and the stage 7 `GENERATOR_VERSION`, so a rule or release change never serves a stale asset.
- An asset is saved only when its inputs are final: a spectrum from a complete frame list, and a catalogue match or typed coordinates. A truncated search, an intermediate answer ([A4.10](jobs.md#a410-object-job-and-fan-out)) or a card refused on its type (`type:*`) is never saved.
- A saved asset is returned without re-running stages 3 and 7. A saved or pre-baked asset whose card id or params id is not the requested id, whose card and params disagree on `type`, or that fails the schema check is ignored with a warning, and the asset is built from the catalogues instead.
- A saved asset whose card type is `candidate` is still reported as `sketch`, so the "Sketch from SPHEREx only" label survives the save.
- The status is sent as the `X-SX-Asset-Status` response header (Q-39, [A4.11](endpoints.md#a411-endpoint-register)).
- **Version constants** (this list is the one place for their values; bump the one whose rule changed):

  | Constant | File | Value (9 Nov 2026) | Bump when |
  |---|---|---|---|
  | `ASSET_VERSION` | `core/card/assets.py` | `5` (4: the issue #62 layers, Q-115 to Q-117; 5: the Q-63 thresholds on, issue #68) | a stage 3 or 5 rule changes, or stage 7 sends other layers without changing a seed |
  | `CARD_TO_PARAMS_VERSION` | `core/render/card_to_params.py` | `1` | a stage 7 rule changes the drawn body |
  | `BAKER_RULES_VERSION` | `core/render/bake.py` | `2` | an R6.2 to R6.5 rule changes |
  | `GENERATOR_VERSION` | `core/render/card_to_params.py` | `p1-b2` | follows the two above; it also seeds every body (A5.1) |
  | `MEASURE_VERSION` | `core/measure/config.py` | `measure-1` | a stage 2 rule changes (Q-139 will bump it) |
  | `DERIVATION_VERSION` | `core/find/version.py` | `1` | a stage 1 rule changes |
  | `COMPOSITE_VERSION` | `core/composite/config.py` | `composite-1` | a composite rule changes |
  | `PAINT_VERSION` | `core/render/gemini_paint.py` | `1` | the Gemini repaint method changes (A6.2) |

### A4.5 Stage 5: ObjectCard

The backend builds the **ObjectCard**: every known value for the object, each as a tagged value with its source (rendering doc §3.1, §3.2). Missing values are `null`, never a guess.

- **Endpoint:** `GET /v1/objects/{id}/card` (D-16).
- **Schema:** [A5](data-contract.md#a5-data-contract).
- **Status:** Built (issue #5, `backend/app/core/card/build.py`). Only the fields the object's type uses (R7) are written; a field with no source is `value: null` with the reason in `source`. Every reply is validated with `jsonschema` against `shared/schemas/` (Q-40). `cached_at` (D-16) is the `X-SX-Cached-At` response header, because the R3.2 shape forbids extra fields (Q-39).
- **Lighting (Q-62):** comet and asteroid cards ask Horizons for the phase angle and the Sun vector ([A3.4](data-sources.md#a34-jpl-horizons)); when Horizons cannot answer, both are null and `lighting` goes in `missing`.
- **Not built yet:** the Gaia adapter that fills `gaia_rgb` ([A3.2](data-sources.md#a32-gaia-dr3)); the card writes `gaia_rgb: null` with "the Gaia adapter is not built" (`core/card/build.py:278`).
- **Intermediate answers:** while the spectrum is measured, `spherex_rgb` and `flux_45um` are `null` with `source` starting `measuring:` ([A4.10](jobs.md#a410-object-job-and-fan-out)).

### A4.6 Stage 6: Physics layer

Pure functions that turn measured values into `derived` values, each with its stated formula ([A7](physics.md#a7-physics-layer)). The backend fills them into the card. Only tier 2 (`derived`, every input measured) goes into the card. When an input is missing, the fallback to tiers 3–5 (D-32) happens in RenderParams `layers` and `dynamics`, never in the card, which keeps `value: null` ([rendering doc §3.4](../rendering/data-contract.md)). In the browser the same functions rerun on every slider change against the `overrides` ([A5.3](data-contract.md#a53-overrides)). The result is never written back to the card as truth.

- **Status:** Built in the browser only (`frontend/src/physics/`, issue #13). The backend half is not built; where stage 6 runs, and so where the D-32 fallback lives, is [Q-60](../decisions/pipeline-stages.md).
- **Not built yet:** D-32 tier fallback in stage 6. The browser functions still refuse a missing input (`frontend/src/physics/tagging.ts`); they fall back a tier once stage 6 adopts D-32.

### A4.7 Stage 7: RenderParams

The backend turns the ObjectCard into **RenderParams** with deterministic rules (rendering doc §3.4, §6.2). The frontend renders RenderParams only. RenderParams lists the layers (each with a tag), texture URLs, lighting, view modes, the haptic profile, the alt text and the layers refused for `missing` data.

- **Endpoint:** `GET /v1/objects/{id}/render-params` (D-16).
- **Status:** Built (issue #5, `backend/app/core/render/card_to_params.py`).
  - The seed rule is owned by [A5.1](data-contract.md#a51-ids-and-seeds).
  - Texture URLs follow R6.7 with the Q-47 size directory ([A5.4](data-contract.md#a54-asset-store)). The API queues the bake of both sizes off the request path ([A4.10](jobs.md#a410-object-job-and-fan-out)); a URL answers 404 until its bake lands.
  - `missing` holds the refused layer and haptic-source ids, the refusals of earlier stages (`catalogue`, `spectrum`, `lighting`, `exoplanet_archive`, `type:*`) and, while the spectrum is measured, `measuring:` entries. Every code is in [A4.12](refusals.md#a412-missing-and-refusal-codes).
  - `candidate` gets a RenderParams with no layers and `mesh` in `missing` (Q-33).
  - Per-type layers added in issue #62: a gas giant gets five tiered layers `bands`, `flattening`, `colour`, `storms`, `turbulence` (`app/core/render/gas_giant.py`; Q-115, tiers per Q-119); a brown dwarf gets `limb_darkening` (Q-116); `asteroid_procedural` gets `textures.relief_amp` and an `artistic` `displacement` layer (Q-117). These bumped `ASSET_VERSION` (table in A4.4); `CARD_TO_PARAMS_VERSION` stays `1`, so seeds are stable.
  - Every layer carries `tier`, and `formula` and `assumed` where D-32 requires them. A `model_dependent` layer whose rule states nothing assumed is a code bug: stage 7 raises `ValueError` and `/render-params` answers 500 rather than label a measured input as assumed.
- **Not built yet:** `dynamics` (D-32). Live RenderParams carry no `dynamics` block; only the shared fixtures do ([shared/README.md](../../shared/README.md)). It comes with stage 6 (Q-60). Until then the viewer states its own motion layers (Q-104).

### A4.8 Stages 8 to 10: Generators

| Stage | Output | Detail |
|---|---|---|
| 8 Build the look | colour, relief, clouds, storms | How each type is drawn (baked, browser shader or volume): [A6](generators.md#a6-generators). Optional Gemini layer on top ([A6.2](generators.md#a62-optional-gemini-artistic-layer)). |
| 9 Build the shape | geometry | Registered shape-model mesh for `asteroid_shape` (Q-61, served at `/data/shapes/`). Otherwise a sphere or ellipsoid, or an emission volume (nebula, remnant, comet coma; issue #43). |
| 10 Make the sound and touch | audio, haptics | Data sweep, body tone and haptics with paired audio ([A8](sound-voice.md#a8-sound-and-voice), [A9](haptics.md#a9-haptics)). At the event only sound plays ([Q-132](../decisions/platform-hosting.md)). |
