# Renderer: brown dwarfs

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R7.4

### R7.4 `brown_dwarf` and `brown_dwarf_binary`

- **Requires:** `spectral_class`, `flux_45um`. Optional: `ch4_depth_33`.
- **Body:** sphere of radius ≈ 1 Jupiter radius (tag `model_dependent`, assumption: "brown dwarf radii ≈ 1 Jupiter radius").
- **Default view mode:** SPHEREx IR, because these objects are almost black in visible light.
- **Bands:** a latitude-stretched fbm texture. Band contrast = clamp(2·`ch4_depth_33`, 0.1, 0.8) (derived). Palette by class: T is warmer, Y is cooler with a water-cloud haze (`inferred_from_analog`). The baked bands are in the visible palette, so they are shown in the visible view only (white tint) and left out of the SPHEREx IR view, which shows the whole-body average colour (R5.2).
- **Cloud type by temperature (tier 4, D-32):** iron and silicate clouds clear at the L/T transition; cool T dwarfs (model grid Teff 400–1300 K) have Cr, MnS, Na₂S, ZnS and KCl clouds (Morley et al. 2012, ApJ 756, 172, arXiv:1206.4313; verified 7 Nov 2026 from the abstract). Iron/silicate clouds for L and water-ice clouds for Y, and the Teff boundaries: **[verify]**.
- **Spin (`dynamics.spin_period_h`, R5.7):** measured when a period exists (tier 1); otherwise a typical field-dwarf period (tier 4, range **[verify]**). Never below the observed floor of about 1 h (shortest known 1.08 h, Tannock et al. 2021, arXiv:2103.01990; verified 7 Nov 2026). No measured period is known to us for eps Indi Ba/Bb **[verify]**.
- **Emissive intensity:** normalised `flux_45um` (`measured`).
- **Binary (Eps Indi Ba T1 + Bb T6):** two bodies on an illustrative mutual orbit, tagged `artistic`. Relative brightness from class (derived). Orbital period ~11 yr and separation **[verify before showing numbers]**.
- **Moving jets (issue #42, Q-103):** with a stated `winds` speed-up the bands are drawn by the browser as counter-flowing jets with storms and spin flattening (`renderers/jetSurface.ts`), instead of the baked texture. Cloud cover follows the scrubbed light curve (tier 3).
- **Haptics:** band source plus brightness pulse ([§8.5](../haptics/profiles.md#r85-per-type-haptic-profile)).
- **Open visual finding (issue #42, Q-106):** the default SPHEREx IR view shows no motion, because the moving jets are drawn in the visible view only.
