# Renderer: brown dwarfs

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R7.4

### R7.4 `brown_dwarf` and `brown_dwarf_binary`

- **Requires:** `spectral_class`, `flux_45um`. Optional: `ch4_depth_33`.
- **Body:** sphere of radius ≈ 1 Jupiter radius (tag `model_dependent`, assumption: "brown dwarf radii ≈ 1 Jupiter radius").
- **Default view mode:** SPHEREx IR, because these objects are almost black in visible light.
- **Bands:** a latitude-stretched fbm texture. Band contrast = clamp(2·`ch4_depth_33`, 0.1, 0.8) (derived). Palette by class: T is warmer, Y is cooler with a water-cloud haze (`inferred_from_analog`).
- **Emissive intensity:** normalised `flux_45um` (`measured`).
- **Binary (Eps Indi Ba T1 + Bb T6):** two bodies on an illustrative mutual orbit, tagged `artistic`. Relative brightness from class (derived). Orbital period ~11 yr and separation **[verify before showing numbers]**.
- **Haptics:** band source plus brightness pulse ([§8.5](../haptics/profiles.md#r85-per-type-haptic-profile)).
