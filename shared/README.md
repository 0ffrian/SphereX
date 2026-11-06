# shared

The data contract, shared by the backend and the frontend ([D-18](../docs/decisions.md#d-18-the-contract-is-generated-from-sharedschemas-answers-q-14)).

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

**Everything in `fixtures/` is synthetic.** The values are round placeholders, not results for any real object, and the texture and mesh URLs point at files that do not exist. Tests enforce the markers: a `fixture:` id, a name starting "Synthetic fixture", and a `source` starting "synthetic fixture" on every tagged value. A `measured` tag here only exercises the code path. Seeds are labelled fixture seeds (1–14) with `generator_version` `fixture-0`, not a hash, because the hash is not specified (Q-35).

- `fixtures/cards/<ObjectType>.json` and `fixtures/params/<ObjectType>.json`: one ObjectCard and one RenderParams per `ObjectType` (D-04).
- `fixtures/invalid/cases.json`: cases that must be rejected. Both sides run the same list, so `jsonschema` and `ajv` cannot disagree. Each case's `expect` names the error it must give (`path`, `keyword`, optional `detail`), and the instance must have no other defect, so a case cannot pass for an unrelated reason.

Refusals covered:

| Fixture | Refused in `missing` |
|---|---|
| `planet_rocky` | `teq_pulse`: `teq_K.value` is null (D-12) |
| `asteroid_procedural` | `spherex_ir`: too few points in a channel window (R5.2) |
| `comet` | `visible`: no colour basis |
| `candidate` | `mesh`, `visible`: no 3D body (R7.6) |

Tests: `backend/tests/test_contract_fixtures.py` and `frontend/src/contract/fixtures.test.ts`. Open contract questions: Q-33 to Q-42 in the [decision log](../docs/decisions.md#open-questions). The frontend's own M1 fixtures stay in `frontend/fixtures/` (Q-30).
