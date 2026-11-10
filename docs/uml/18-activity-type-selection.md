# 18 Activity: type selection

How the backend chooses the `ObjectType` that picks the renderer and haptic profile. Drawn from rendering doc §3.3 (now including the Exoplanet Archive and slider branches) and decisions D-01 and D-04. The exoplanet thresholds are on since issue #68 (Q-63, signed off by Moon); they keep their **[verify]** marks because the 1.5 and 6 R_E cuts are project cuts based on the cited papers, not published class boundaries.

```mermaid
flowchart TD
  Start(("Object to type")) --> SBDBq{"JPL SBDB match?"}
  SBDBq -->|comet| Comet["comet"]
  SBDBq -->|asteroid| Shape{"Shape model in registry.toml? (Q-61)"}
  Shape -->|yes| AstShape["asteroid_shape"]
  Shape -->|no| AstProc["asteroid_procedural"]
  SBDBq -->|no match| SIMq{"SIMBAD object type?"}

  SIMq -->|brown dwarf| BDComp{"System has known components?"}
  BDComp -->|yes| BDBin["brown_dwarf_binary"]
  BDComp -->|no| BD["brown_dwarf"]
  SIMq -->|Mira variable| Mira["star_mira"]
  SIMq -->|T Tauri| TTau["star_ttauri"]
  SIMq -->|other star| Star["star"]
  SIMq -->|"Pl (planet)"| Exoq{"Exoplanet Archive PSCompPars row? (Q-63)"}
  SIMq -->|other| Slider

  Exoq -->|no| Slider
  Exoq -->|yes| Rad{"pl_rade (R, Earth radii)"}
  Rad -->|"R >= 6 [verify]"| Giant
  Rad -->|missing| MassOnly{"True mass >= 0.414 M_J? [verify]"}
  MassOnly -->|yes| Giant
  MassOnly -->|no| RefR["candidate: type:exoplanet_radius"]
  Rad -->|"R < 1.5 [verify]"| Rocky
  Rad -->|"1.5 <= R < 6"| TrueM{"True mass? pl_bmassprov == Mass"}
  TrueM -->|no| RefM["candidate: type:exoplanet_mass"]
  TrueM -->|yes| Zeng{"R vs Zeng 2019 curves [verify]"}
  Zeng -->|"mass outside table"| RefMR["candidate: type:exoplanet_mass_range"]
  Zeng -->|"at or below Earth-like rocky curve"| Rocky
  Zeng -->|"above it: water curve nearest pl_eqt (300/500/700/1000 K)"| Teq{"pl_eqt present and <= 1000 K?"}
  Teq -->|no| RefW["candidate: type:exoplanet_water_model_range"]
  Teq -->|yes| Wat{"R vs 100% H2O curve"}
  Wat -->|"at or below"| Water
  Wat -->|above| RefE["candidate: type:exoplanet_envelope"]
  Slider{"Built from user sliders?"}
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
- As built (issue #5, `backend/app/core/classify/rules.py`, updated for issue #40): SIMBAD otypes are `BD*` (brown dwarf), `Mi*` (Mira), `TT*` (T Tauri), `Pl` (planet, not `Pl?`), and any otype ending in `*` plus `s*r`, `s*y`, `s*b`, `Y*O` (other star); "known components" means a composite spectral type with `+` (Q-55). The shape-model branch reads `backend/assets/shapes/registry.toml` (Q-61); it holds only Gaskell Eros, so every other asteroid is `asteroid_procedural`. Planets follow Q-63: the proposed thresholds live in `PROPOSED_EXOPLANET_THRESHOLDS` and the Zeng et al. 2019 tables in `zeng2019.py`, all still **[verify]**; central values only. Since issue #68 (Q-63 signed off by Moon, 9 Nov 2026) the live `EXOPLANET_THRESHOLDS` are the proposed values, so archive planets are typed; a value set back to `None` still takes the refusal path (`type:exoplanet_thresholds`). Archive values marked `CALCULATED_VALUE` count as missing. A refused planet becomes `candidate` with the reason in `missing`. The Exoplanet Archive adapter queries `pscomppars` by name through the TAP service.
