# 12 Sequence: texture bake and optional Gemini repaint

How the backend bakes the maps for a rendering-doc type, and the optional Gemini repaint with its alignment check. Drawn from rendering doc §1 (determinism), §6.1–6.7 and §10, and decisions D-01, D-06, D-07, D-24 (Gemini off in the offline demo) and D-25 (read-through cache, `SX_OFFLINE`), A6.2 and the open Q-87 (Gemini layer contract).

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
  participant V as Viewer (frontend)

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

  opt Gemini repaint (P3 stretch, behind admin token, issue #14, Q-87)
    A->>API: POST /v1/admin/objects/{id}/gemini-repaint[?refresh=true], header X-SX-Admin-Token
    alt SX_ADMIN_TOKEN unset or blank
      API-->>A: 404 (admin endpoints do not exist)
    else token missing or wrong (constant-time compare)
      API-->>A: 403 forbidden
    else token matches
      API->>GP: repaint(id, card, render params seed + generator_version, refresh)
      alt not a baked type, or the bake is refused
        GP-->>API: code, reason not_baked_type, bake_refused or bake_failed
      else baked type
        GP->>B: bake_to_cache (code path first, skipped if bake.json matches)
        B->>TC: Code maps on disk
        GP->>TC: Read height.bin
        GP->>GP: Hillshade of the height map (no colour)
        alt hillshade flat
          GP-->>API: code, reason flat_height
        else no SX_GEMINI_API_KEY
          GP-->>API: code, reason gemini_key_missing
        else SX_OFFLINE=1 and SX_GEMINI_OFFLINE_CACHE=0 (default, D-24, Q-29)
          GP-->>API: code, reason offline
        else ask Gemini
          GP->>DC: Look up model + aspect + paint version + prompt hash + hillshade hash (refresh=true skips a hit)
          alt cache hit (offline only if SX_GEMINI_OFFLINE_CACHE=1, Q-29)
            DC-->>GP: Cached image bytes (already checked when stored)
          else cache miss with SX_OFFLINE=1
            GP-->>API: code, reason offline (no network call)
          else cache miss, online (painter's own lock, no cache stripe held)
            GP->>GM: generateContent with hillshade PNG + prompt "Paint albedo only..." (model, aspect ratio and REST shape [verify]), total budget SX_GEMINI_TIMEOUT_S, connect timeouts retried
            alt timeout, HTTP error, refusal or no image
              GM-->>GP: No usable image
              GP-->>API: code, "Failed, using code" + reason (gemini_timeout, gemini_unreachable, gemini_http_n, gemini_refused, gemini_no_image, gemini_bad_response, gemini_unavailable)#59; a failed refresh is reported, the old entry is not served
            else image returned
              GM-->>GP: Image
            end
          end
          opt image in hand
            GP->>GP: Decode, resample to 2:1, correlate Sobel edges with the hillshade
            alt image cannot be decoded
              GP-->>API: code, reason bad_image (not cached#59; a bad cached entry is deleted)
            else correlation below 0.3
              GP-->>API: code, reason low_edge_correlation (not cached)
            else correlation 0.3 or more
              GP->>DC: Store the image (only now, Q-87 item 5)
              GP->>GP: Seam fix: roll W/2, blend 32 px band, roll back
              GP->>TC: Write albedo_ai.webp, gemini.json, then the .gemini pointer last (bake key, tag artistic, label "AI-made", model, prompt, correlation, hashes#59; path [verify])
              GP-->>API: applied
            end
          end
        end
      end
      API-->>A: 200 status body (status applied or code, reason, albedo_ai in missing on code)
    end
  end

  opt Viewer swap-in (frontend follow-up, not built in issue #14, Q-87)
    V->>API: GET /v1/objects/{id}/albedo-ai
    API->>GP: status(id): disk only, no card build, no bake, no Gemini call
    GP->>TC: Read the .gemini pointer, then bake.json, gemini.json, albedo_ai.webp
    GP-->>API: applied, or code with not_painted, stale or offline
    API-->>V: 200 status body (albedo_url when applied)
    opt status applied
      V->>API: GET /v1/objects/{id}/albedo-ai.webp
      API-->>V: image/webp, X-SX-Layer-Tag artistic (404 albedo_ai_unavailable if not applied)
    end
  end
```

## Notes

- Same card + seed must give byte-identical textures (SHA-256 test, rendering doc §11). Bump `generator_version` whenever a rule in §6.2–6.5 changes; it is part of the cache key. `bake.json` inside the directory also rebakes a changed card or size (Q-47).
- The code-colour albedo always loads first; the AI layer only swaps in on success ("never blank").
- The Gemini call is server-side only; the key never reaches the browser (D-07).
- The Gemini call goes through the backend's read-through cache like every external call (D-25). With `SX_OFFLINE=1` a miss is refused and the code colour stays (D-24). Unlike other sources, an image is stored only after it passes the checks, and a failed refresh is reported rather than served from the older entry (Q-87 item 5). Whether a cached repaint is shown under `SX_OFFLINE=1` is Q-29 (open); issue #14 makes it the switch `SX_GEMINI_OFFLINE_CACHE`, default 0 (off offline, D-24).
- As built (issue #14, Q-87): routes in `backend/app/api/gemini.py`, admin gate `require_admin` in `backend/app/api/deps.py`, logic in `backend/app/core/render/gemini_paint.py`. The repaint always answers 200; every failure keeps the code colour and puts `albedo_ai` first in `missing`. `albedo_ai.webp` and `gemini.json` live in the R6.7 size directory, so a rebake removes them. RenderParams has no slot for the AI albedo, so the viewer swap-in (last block) is a frontend follow-up. Reason codes: [A6.2](../architecture/generators.md#a62-optional-gemini-artistic-layer).
- Shader kinds are not baked here (D-01); their field is built in the browser ([10-sequence-view-3d.md](10-sequence-view-3d.md)).
- Image-first (Depth Anything V2 Small) and Marigold paths are offline options, not drawn (rendering doc §6.6).
- As built (issue #5): the seed is the first 4 bytes of SHA-256(`id` + newline + `generator_version`), and `generator_version` is `p<card_to_params version>-b<BAKER_RULES_VERSION>` (Q-35, an assumption). The render-params endpoint does not call the baker yet; `python -m app.core.render` bakes from a card file.
