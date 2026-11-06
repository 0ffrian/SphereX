# 12 Sequence: texture bake and optional Gemini repaint

How the backend bakes the maps for a rendering-doc type, and the optional Gemini repaint with its alignment check. Drawn from rendering doc §1 (determinism), §6.1–6.7 and §10, and decisions D-01, D-06, D-07, D-24 (Gemini off in the offline demo) and D-25 (read-through cache, `SX_OFFLINE`).

```mermaid
sequenceDiagram
  autonumber
  participant API as Backend API
  participant C2P as card_to_params.py
  participant B as bake.py
  participant H as noise.py, craters.py, height.py
  participant N as normals.py
  participant PA as palette.py
  participant TC as /data/textures
  actor A as Team admin
  participant GP as gemini_paint.py
  participant DC as Read-through cache (D-25)
  participant GM as Gemini image API

  API->>C2P: card_to_params(ObjectCard)
  C2P-->>API: style, ellipsoid_axes, octaves, relief_amp, crater_count, boulder_density, base_rgb, brightness, hydration, redness, roughness (each tagged)
  API->>B: Bake(params, seed = hash of id + generator_version)
  B->>H: fbm of 3D value noise on the unit sphere (equirectangular)
  B->>H: Craters (power-law radii, bounding box only), boulders (density by style)
  H-->>B: height = relief_amp x fbm + craters + boulders
  B->>N: normals_from_height (Sobel, wraps in longitude)
  N-->>B: Normal map
  B->>PA: base_rgb x brightness x small variation, hydration and redness rules
  PA-->>B: Albedo map
  B->>TC: Write albedo.webp, height.png, height.bin (float16), normal.png and bake.json (params hash) under id/generator_version/seed/WxH#59; skip if bake.json matches
  B-->>API: Texture URLs

  opt Gemini repaint (P3 stretch, behind admin token)
    A->>API: Request repaint for id
    API->>GP: Repaint
    GP->>GP: Hillshade of the height map (no colour)
    GP->>DC: Look up hillshade + prompt
    alt cache hit
      DC-->>GP: Cached image (under SX_OFFLINE=1 see Q-29)
    else cache miss with SX_OFFLINE=1
      DC-->>GP: Refused, no network call
    else cache miss, online
      DC->>GM: Hillshade + prompt "Paint albedo only..." (model name [verify]), timeout and retries
      alt image returned
        GM-->>DC: Image
        DC-->>GP: Image, stored with fetched_at
      else timeout or error
        GM-->>DC: No usable image
        DC-->>GP: Refused
      end
    end
    alt refused
      GP-->>API: Keep code colour, "Failed, using code"
    else image
      GP->>GP: Resample to 2:1, correlate Sobel edges with hillshade
      alt correlation below 0.3
        GP-->>API: Reject, keep code colour
      else correlation 0.3 or more
        GP->>GP: Seam fix: roll W/2, blend 32 px band, roll back
        GP->>TC: Write AI albedo, tag artistic, label "AI-made" (path [verify])
        GP-->>API: AI albedo available
      end
    end
  end
```

## Notes

- Same card + seed must give byte-identical textures (SHA-256 test, rendering doc §11). Bump `generator_version` whenever a rule in §6.2–6.5 changes; it is part of the cache key. `bake.json` inside the directory also rebakes a changed card or size (Q-47).
- The code-colour albedo always loads first; the AI layer only swaps in on success ("never blank").
- The Gemini call is server-side only; the key never reaches the browser (D-07).
- The Gemini call goes through the backend's read-through cache like every external call (D-25). With `SX_OFFLINE=1` a miss is refused and the code colour stays (D-24). Whether a cached repaint is shown under `SX_OFFLINE=1` is Q-29.
- Shader kinds are not baked here (D-01); their field is built in the browser ([10-sequence-view-3d.md](10-sequence-view-3d.md)).
- Image-first (Depth Anything V2 Small) and Marigold paths are offline options, not drawn (rendering doc §6.6).
- As built (issue #5): the seed is the first 4 bytes of SHA-256(`id` + newline + `generator_version`), and `generator_version` is `p<card_to_params version>-b<BAKER_RULES_VERSION>` (Q-35, an assumption). The render-params endpoint does not call the baker yet; `python -m app.core.render` bakes from a card file.
