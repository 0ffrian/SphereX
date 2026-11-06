# 10 Sequence: View in 3D

Opening the Sky Sculptor view: the frontend asks for `RenderParams`, the backend looks up the asset, bakes textures if they are not cached, and the viewer picks a renderer by `type`. Drawn from architecture spec §4.4, rendering doc §3.4, §4, §5, §6.7, §7, §7.7, and decisions D-01, D-05, D-12, D-21 and D-22.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant P as Object panel
  participant V as ViewerApp
  participant API as Backend API
  participant AS as Asset lookup (stage 4)
  participant C2P as card_to_params
  participant BK as Texture baker
  participant TC as Texture cache
  participant FW as Field worker
  participant PL as planRender (pure RenderPlan)
  participant R as build.ts (three.js)

  alt type is candidate
    P-->>U: No button. "Not enough data for a 3D model: distance and albedo unknown"
  else type has a 3D view
    U->>P: View in 3D
    P->>V: Open viewer for id
    V->>API: GET /v1/objects/{id}/render-params
    API->>AS: Look up asset for id
    alt saved
      AS-->>API: Saved: card, RenderParams, texture URLs, generator_version, seed, created_at (D-22)
    else generated
      AS-->>API: Generated from catalogues + spectrum
    else sketch
      AS-->>API: Sketch from SPHEREx only
    end
    opt generated or sketch (a saved asset already holds its RenderParams)
      API->>C2P: card_to_params(ObjectCard)
      C2P-->>API: RenderParams: layers with tags, missing list
    end
    alt rendering-doc type with procedural maps (D-01)
      API->>TC: Textures for id, generator_version, seed?
      opt not cached
        API->>BK: Bake (see diagram 12)
        BK->>TC: Write albedo.webp, height.png, height.bin, normal.png
      end
      API-->>V: RenderParams with texture URLs
      V->>TC: GET textures (1024x512 mobile, 2048x1024 desktop)
      TC-->>V: Maps
    else rendering-doc type without maps (asteroid_shape, comet, stars)
      API-->>V: RenderParams (mesh from shape_source, or point clouds and self-lit spheres built in the browser)
    else shader kind (planet_rocky, planet_water, gas_giant, nebula, nova)
      API-->>V: RenderParams without textures
    end
    V->>PL: setObject: planRender(card, params, context)
    PL-->>V: RenderPlan (layers hidden by the honesty state dropped, starts at + Estimated, D-21#59; missing listed#59; shader kinds: plan.shader with surface and plain-sphere flags, Q-45)
    V->>R: showPlan(plan): buildScene (a shader kind gets a ShaderBody from plan.shader, tags from allowedTags(plan.honesty), light from planLighting)
    R->>FW: Field (planets, gas giants) or points (nebula, nova), once per body#59; the plain sphere shows until it arrives (never blank)
    R-->>V: Scene ready (onChange requests one render, D-05)
    V->>V: Lighting from planLighting (sun at phase angle, sun_dir or head-on, or self-lit)#59; the same direction goes to the scene sun and the body
    V->>V: Set canvas aria-label from the plan (altText.ts#59; size with its tag, "at most" for an upper limit#59; a shader kind adds the artist's-impression note)
    V->>V: Honesty change with the same sceneKey: BuiltScene.update(plan) sets the tags and light in place, no field is regenerated
    V-->>U: Render body, tag chips in legend, scale bar
    V-->>U: List missing layers: "Not enough data for X"
  end
```

## Notes

- Asset status labels: new objects show "Sketch from SPHEREx only" (architecture spec §10). See [16-state-asset-lookup.md](16-state-asset-lookup.md).
- How the client picks the texture size (mobile vs desktop) is not stated **[verify]**.
- The field worker uses the same seed and functions as the shader, so the picture and the haptics agree (D-12).
- RenderParams responses served from the backend cache carry `cached_at` (D-25). As built (issue #5) it is the `X-SX-Cached-At` header, and the asset status is the `X-SX-Asset-Status` header (Q-39).
- If the view is unchanged, the viewer does not render a new frame (D-05).
- As built (issue #5): the render-params endpoint names the R6.7 texture URLs (in the `2048x1024` size directory, Q-47) but does not call the baker or serve the files yet, so the bake branch above is still to build. The reply is checked with `jsonschema` before it is sent (Q-40); `candidate` still gets a RenderParams with no layers (Q-33).
