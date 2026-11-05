# shared

JSON schemas shared by the backend and the frontend:

- `schemas/object-card.schema.json`: ObjectCard ([rendering doc R3.2](../docs/rendering/data-contract.md))
- `schemas/render-params.schema.json`: RenderParams (R3.4)

`schemas/` is the single source of the data contract. The backend's Pydantic models and `frontend/src/contract/` are generated from it ([decisions D-18](../docs/decisions.md#d-18-the-contract-is-generated-from-sharedschemas-answers-q-14)). `schemas/` is empty until the schemas are written. `fixtures/` (not created yet) will hold the shared fixtures (D-17).
