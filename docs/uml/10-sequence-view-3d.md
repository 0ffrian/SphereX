# 10 Sequence: View in 3D

Opening the Sky Sculptor view: the frontend asks for `RenderParams`, the backend looks up the asset, bakes textures if they are not cached, and the viewer picks a renderer by `type`. Drawn from architecture spec §4.4, rendering doc §3.4, §4, §5, §6.7, §7, §7.7, and decisions D-01, D-05 and D-12.

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
  participant R as Renderer

  alt type is candidate
    P-->>U: No button. "Not enough data for a 3D model: distance and albedo unknown"
  else type has a 3D view
    U->>P: View in 3D
    P->>V: Open viewer for id
    V->>API: GET /v1/objects/{id}/render-params
    API->>AS: Look up asset for id
    alt saved
      AS-->>API: Saved (pre-baked demo asset)
    else generated
      AS-->>API: Generated from catalogues + spectrum
    else sketch
      AS-->>API: Sketch from SPHEREx only
    end
    API->>C2P: card_to_params(ObjectCard)
    C2P-->>API: RenderParams: layers with tags, missing list
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
      V->>FW: Generate field from seed (once per body)
      FW-->>V: 512x256 field array
    end
    V->>R: Create renderer for type
    R->>R: Build body, drop layers hidden by honesty state
    R-->>V: Scene ready
    V->>V: Lighting (sun at phase angle, or self-lit)
    V->>V: Set canvas aria-label from alt_text
    V-->>U: Render body, tag chips in legend, scale bar
    V-->>U: List missing layers: "Not enough data for X"
  end
```

## Notes

- Asset status labels: new objects show "Sketch from SPHEREx only" (architecture spec §10). See [16-state-asset-lookup.md](16-state-asset-lookup.md).
- How the client picks the texture size (mobile vs desktop) is not stated **[verify]**.
- The field worker uses the same seed and functions as the shader, so the picture and the haptics agree (D-12, Proposed).
- If the view is unchanged, the viewer does not render a new frame (D-05).
