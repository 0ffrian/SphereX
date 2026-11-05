# backend

FastAPI on Python 3.12 ([decisions D-15](../docs/decisions.md#d-15-backend-framework-fastapi-answers-q-01)): API, data pipeline and texture baker. Not built yet; the team builds from 5 Nov 2026 (D-14).

Planned layout (from [rendering doc R10](../docs/rendering/layout-tests-open-items.md)):

```
app/api/                    (Kevin)  D-16 endpoints; objects.py: /v1/objects/{id}/card, /render-params, texture URLs
app/core/render/            (Atish)  card_to_params, noise, craters, height, normals,
                                     palette, bake, spherex_rgb, gemini_paint (stretch)
```

Dependencies are pinned in `uv.lock`. CPU only; no GPU is needed. The event build runs locally on the team's Asus A15 (D-24).
