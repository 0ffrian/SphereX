# shared

The data contract, shared by the backend and the frontend ([D-18](../docs/decisions/contract.md#d-18-the-contract-is-generated-from-sharedschemas-answers-q-14)).

## Schemas

- `schemas/object-card.schema.json`: ObjectCard and the types it uses: `Tag`, `ObjectType`, the tagged values ([rendering doc R3.1, R3.2](../docs/rendering/data-contract.md))
- `schemas/render-params.schema.json`: RenderParams (R3.4), `VisibleMode` (D-23) and `HapticProfile` (R8.8). It refers to the card schema for the shared types

They are JSON Schema **draft-07**, the draft that both generators and both validators handle fully. `schemas/` is the single source: never edit the generated code. After changing a schema, run one command per side and commit the result:

```sh
cd frontend && npm run contract:gen                     # writes src/contract/generated.ts
cd backend && uv run python -m scripts.generate_contract  # writes app/contract/
```

`npm run contract:gen` at the repo root does both, and `npm run contract:check` there compares both. CI runs `npm run contract:check` in `frontend/` and `uv run python -m scripts.generate_contract --check` in `backend/`, and fails if the committed files differ.

Schema rules:

- Every contract object has `additionalProperties: false`, so an unknown field fails validation.
- JSON Schema has no generics, so the tagged value is written out once per payload (`TVNumber`, `TVString`, `TVRgb`, `TVVec3`, `TVPair`). A backend test fails if their bodies stop matching.
- The rules "`derived` needs a `formula`" and "`model_dependent` needs an `assumption`" are `if`/`then` in the schema. They match `assertTagged()`. The generated types cannot express them, so validate with a real validator (`jsonschema`, `ajv`), not only the Pydantic models.
- Do not put a `description` next to a `$ref`: draft-07 ignores it, and `json-schema-to-typescript` then emits a duplicate type.

## Fixtures

**Everything in `fixtures/` is synthetic**, with one labelled exception below. The values are round placeholders, not results for any real object. Tests enforce the markers: a `fixture:` id, a name starting "Synthetic fixture", and a `source` starting "synthetic fixture" on every tagged value. A `measured` tag here only exercises the code path. Seeds are labelled fixture seeds (1–14) with `generator_version` `fixture-0`, not a hash, because the hash is not specified (Q-35).

- `fixtures/cards/<ObjectType>.json` and `fixtures/params/<ObjectType>.json`: one ObjectCard and one RenderParams per `ObjectType` (D-04).
- `fixtures/textures/{id}/{generator_version}/{seed}/{albedo.webp,height.png,normal.png,height.bin}`: the maps the textured params fixtures (`asteroid_procedural`, `brown_dwarf`, `brown_dwarf_binary`) point at, baked by the real backend baker (`params_from_card` → `bake` → `encode`) from the fixture card and seed, at 512×256 to keep the repo small. The directories are the baker's names (R6.7, `texture_dir`: the id `fixture:brown_dwarf` is the directory `fixture%3Abrown_dwarf`); unlike the live backend there is no Q-47 `{width}x{height}/` size directory, because the fixture URLs have none. Regenerate with `cd backend && uv run python -m scripts.bake_fixtures` after a baker change; `--check` (and `tests/test_bake_fixtures.py`) fails if the committed bytes differ. The frontend fixtures server serves them at `/data/textures/...` (`frontend/fixtures/handler.ts`).
- **Eros (`asteroid_shape`)**: the card keeps the `fixture:` id and the synthetic markers, but its `shape_source` is the real Gaskell Eros model, `/data/shapes/eros-gaskell.glb` (`backend/assets/shapes/`, served in place by the fixtures server; the viewer takes `eros-gaskell.lod1.glb` on the low quality tier), and its `diameter_km` (16.84 ± 0.06 km, Yeomans et al. 2000), `rot_period_h` (5.27 h, LCDB, Warner et al. 2009), `albedo` (0.25 ± 0.06, Veverka et al. 2000) and `spectral_class` (S, SMASS) are the JPL SBDB values in the backend's recorded SBDB reply (`backend/tests/fixtures/cache/v1/sbdb/`, checked in `tests/test_api_card.py`). Each such `source` says "real 433 Eros value" and cites it. `gaia_rgb`, `spherex_rgb`, `phase_angle_deg` and `sun_vector` stay synthetic. `scale_m` is 16.84 km × 500 = 8420 m, as the backend computes it.
- **Bennu (`asteroid_shape_bennu`, issue #68 Part 8a)**: an extra `asteroid_shape` fixture beside Eros with real values only (SBDB diameter, spin, albedo and class, the registered SPOv54 mesh `/data/shapes/bennu-spo-v54.glb`; each `source` starts "synthetic fixture: real 101955 Bennu value, "). Its params are `card_to_params` of the card, written by `backend/scripts/bake_fixtures.py`. It is not an object type, so it has its own golden frames.
- **Backend-equal layers (issue #62):** the `layers` of the params fixtures are what `card_to_params` gives for the fixture card (`tests/test_card_to_params.py` compares them): the gas giant's five layers (`bands`, `flattening`, `colour`, `storms`, `turbulence`, Q-115), the procedural asteroid's `displacement` with `textures.relief_amp` 0.03 (Q-117), `limb_darkening` on the brown dwarfs (Q-116). The procedural asteroid's `diameter_km` is `measured` (as an SBDB value is), so Measured only draws a plain sphere of it. The gas giant's `dynamics` stay synthetic and are not the source of its layer tags.
- **Issue #68 additions (Q-150, Q-154):** the `planet_water` card carries synthetic `mass_mearth`, `orbit_au`, `orbital_period_d` and the four `host_*` fields; the `brown_dwarf_binary` card carries a synthetic `component_teff_K` pair, and its params carry `components` and the `components` / `component_brightness` layers exactly as `card_to_params` gives them. The `ellipsoid` layer of `asteroid_procedural` gains `assumed.c_axis`.
- `fixtures/invalid/cases.json`: cases that must be rejected. Both sides run the same list, so `jsonschema` and `ajv` cannot disagree. Each case's `expect` names the error it must give (`path`, `keyword`, optional `detail`), and the instance must have no other defect, so a case cannot pass for an unrelated reason.

Refusals covered:

| Fixture | Refused in `missing` |
|---|---|
| `planet_rocky` | `teq_pulse`: `teq_K.value` is null (D-12) |
| `asteroid_procedural` | `spherex_ir`: too few points in a channel window (R5.2) |
| `comet` | `visible`: no colour basis |
| `candidate` | `mesh`, `visible`: no 3D body (R7.6) |
| `candidate` | `dynamics:spin_period_h`: no body and no class, so no rung can answer (D-32) |

Tier and dynamics (D-32):

- Every `Layer` has a required `tier` (1 measured, 2 derived, 3 model_dependent, 4 inferred_from_analog, 5 artistic). The schema forces tier to agree with `tag`. A `derived` or `model_dependent` layer also needs a non-blank `formula`, and a `model_dependent` layer an `assumed` object (at least one key, number or string values) naming the inputs that were not measured. Layers have no `value`, so `assertTagged` does not apply to them.
- Every params fixture has a `dynamics` block. `speedup` is required (`{}` when nothing moves), keys are one of `spin`, `spots`, `flares`, `winds`, `clouds`, `pulsation`, values are above 0. Each rate is a `DynamicsValue` (`value`, `tag`, `tier`, `source`, and `formula` / `assumed` under the same rules as a layer). Its `source` starts "synthetic fixture". A rate with no rung is left out and listed as `dynamics:<key>` in `missing`. Tests assert that every `speedup` key has an animated rate present. The fixtures cover tiers 1 to 5.
- Periods and lifetimes (`spin_period_h`, `spot_lifetime_d`, `pulsation_period_d`) are above 0 and `flare_rate_per_d` is 0 or more (`PositiveDynamicsValue`, `NonNegativeDynamicsValue`); `diff_rotation` and `jet_speed_ms` may be negative.
- A measured card value behind a rate wins at tier 1 with the same value (`rot_period_h` → `spin_period_h`, `period_var_d` → `pulsation_period_d`), and only those card fields can make a rate tier 1 (tested in both suites).
- Rate formulas in the fixtures start with "placeholder, not a spec rule": they only exercise tiers 2 and 3 and are not physics for stage 6 to copy.
- `assertTagged` checks card values only: a `DynamicsValue` is skipped, because its model_dependent rule is `assumed`, not `assumption`.
- The live backend (stage 7) emits `tier`, `formula` and `assumed` on layers but no `dynamics` yet (stage 6, a later ticket); the field is optional.

Tests: `backend/tests/test_contract_fixtures.py` and `frontend/src/contract/fixtures.test.ts`. Open contract questions: Q-33 to Q-42 in [decisions/contract.md](../docs/decisions/contract.md), Q-64 in [platform-hosting.md](../docs/decisions/platform-hosting.md) and Q-65 in [rendering-bodies.md](../docs/decisions/rendering-bodies.md) (index: [decisions/README.md](../docs/decisions/README.md)). The frontend's own M1 fixtures stay in `frontend/fixtures/` (Q-30).
