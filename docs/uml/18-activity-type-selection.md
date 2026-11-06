# 18 Activity: type selection

How the backend chooses the `ObjectType` that picks the renderer and haptic profile. Drawn from rendering doc §3.3 (now including the Exoplanet Archive and slider branches) and decisions D-01 and D-04. Thresholds that are not yet agreed are marked **[verify]**.

```mermaid
flowchart TD
  Start(("Object to type")) --> SBDBq{"JPL SBDB match?"}
  SBDBq -->|comet| Comet["comet"]
  SBDBq -->|asteroid| Shape{"DAMIT or NASA shape model exists?"}
  Shape -->|yes| AstShape["asteroid_shape"]
  Shape -->|no| AstProc["asteroid_procedural"]
  SBDBq -->|no match| SIMq{"SIMBAD object type?"}

  SIMq -->|brown dwarf| BDComp{"System has known components?"}
  BDComp -->|yes| BDBin["brown_dwarf_binary"]
  BDComp -->|no| BD["brown_dwarf"]
  SIMq -->|Mira variable| Mira["star_mira"]
  SIMq -->|T Tauri| TTau["star_ttauri"]
  SIMq -->|other star| Star["star"]
  SIMq -->|no match| Exoq{"NASA Exoplanet Archive match? (D-04, P2, service untested)"}

  Exoq -->|yes| PlanetCut{"Planet class by radius, mass, Teq: cut-offs [verify], to decide"}
  PlanetCut --> Rocky["planet_rocky"]
  PlanetCut --> Water["planet_water"]
  PlanetCut --> Giant["gas_giant"]
  PlanetCut -->|"cut-offs not agreed (Q-56): refused, type:exoplanet_thresholds in missing"| Slider
  Exoq -->|no| Slider{"Built from user sliders?"}
  Slider -->|nebula| Neb["nebula"]
  Slider -->|nova| Nova["nova"]
  Slider -->|no| Cand["candidate (no 3D)"]

  subgraph Baked["Rendering-doc renderers (D-01): procedural maps baked on the backend"]
    Comet
    AstShape
    AstProc
    BDBin
    BD
    Mira
    TTau
    Star
  end
  subgraph Shader["Browser shader + shared field (D-01, D-12)"]
    Rocky
    Water
    Giant
    Neb
    Nova
  end
```

## Notes

- Name resolution order is D-19: SBDB first for names that look like small bodies, SIMBAD first otherwise. The type rules above check SBDB, then SIMBAD.
- No catalogue rule exists for `nebula` and `nova`; they come from user sliders only (rendering doc §3.3).
- For orientation only, not a type rule: brown dwarf spectral types are roughly L above ~1,400 K, T from ~1,400 K to 500 K, Y below ~500 K (architecture spec §7.3, approximate).
- The old architecture-spec kinds map as `dwarf` → `brown_dwarf` and `asteroid` → `asteroid_shape` or `asteroid_procedural` (D-04).
- Stars are self-lit and drawn from their own data (blackbody colour, limb darkening), not from the shader generators; they are grouped with the rendering-doc renderers because they follow the rendering doc, not the browser-shader path. Only types that need procedural maps (for example `asteroid_procedural`, brown dwarf bands) are baked.
- As built (issue #5, `backend/app/core/classify/rules.py`): SIMBAD otypes are `BD*` (brown dwarf), `Mi*` (Mira), `TT*` (T Tauri), and any otype ending in `*` plus `s*r`, `s*y`, `s*b`, `Y*O` (other star); "known components" means a composite spectral type with `+` (Q-55). The shape-model list is empty, so every asteroid is `asteroid_procedural` (Q-55). Every exoplanet threshold is `None`, so a planet match is refused and falls through to sliders, then `candidate` (Q-56); no Exoplanet Archive adapter exists yet.
