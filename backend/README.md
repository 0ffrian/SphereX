# backend

Python 3.12 API, data pipeline and texture baker. Empty until the event (14 Nov 2026).

Planned layout (from [rendering doc R10](../docs/rendering/layout-tests-open-items.md)):

```
app/api/objects.py          (Kevin)  /v1/objects/{id}/card, /render-params, texture URLs
app/core/render/            (Atish)  card_to_params, noise, craters, height, normals,
                                     palette, bake, spherex_rgb, gemini_paint (stretch)
```

Dependencies are pinned in `uv.lock`. CPU only: the AWS server has no GPU.
