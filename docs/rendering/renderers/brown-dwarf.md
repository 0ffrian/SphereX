# Renderer: brown dwarfs

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R7.4

### R7.4 `brown_dwarf` and `brown_dwarf_binary`

- **Requires:** `spectral_class`, `flux_45um`. Optional: `ch4_depth_33`.
- **Body:** sphere of radius ≈ 1 Jupiter radius (tag `model_dependent`, assumption: "brown dwarf radii ≈ 1 Jupiter radius").
- **Default view mode:** SPHEREx IR, because these objects are almost black in visible light.
- **Bands:** a latitude-stretched fbm texture. Band contrast = clamp(2·`ch4_depth_33`, 0.1, 0.8) (derived). Palette by class: T is warmer, Y is cooler with a water-cloud haze (`inferred_from_analog`). The baked bands are in the visible palette, so they are shown in colour in the visible view (white tint). In the SPHEREx IR view, which shows the whole-body average colour (R5.2), the map is drawn as **brightness only** on that colour (issue #62, Q-116: `albedoLuma`, the map's luma divided by its mean), so the default view is not a flat disc. The pattern is an `artistic` look.
- **Cloud type by temperature (tier 4, D-32):** iron and silicate clouds clear at the L/T transition; cool T dwarfs (model grid Teff 400–1300 K) have Cr, MnS, Na₂S, ZnS and KCl clouds (Morley et al. 2012, ApJ 756, 172, arXiv:1206.4313; verified 7 Nov 2026 from the abstract). Iron/silicate clouds for L and water-ice clouds for Y, and the Teff boundaries: **[verify]**.
- **Spin (`dynamics.spin_period_h`, R5.7):** measured when a period exists (tier 1); otherwise a typical field-dwarf period (tier 4, range **[verify]**). Never below the observed floor of about 1 h (shortest known 1.08 h, Tannock et al. 2021, arXiv:2103.01990; verified 7 Nov 2026). No measured period is known to us for eps Indi Ba/Bb **[verify]**.
- **Limb darkening (issue #62, Q-116):** layer `limb_darkening`, `model_dependent`: linear `I(μ) = 1 − u (1 − μ)` with the star's `u = 0.6` (R7.5), because no T-dwarf coefficient is confirmed **[verify]** (`BROWN_DWARF_LIMB_U`; `null` refuses the layer as `unverified`). Applied to the browser jets, the baked-map body and the plain self-lit disc, for both bodies of the binary; shown from "+ Estimated".
- **Emissive intensity:** normalised `flux_45um` (`measured`). The layer is still refused as `unverified` while the reference `flux45Reference` is null ([verify]); the body glows at a fixed level, not the measured flux.
- **Binary (Eps Indi Ba T1 + Bb T6):** two bodies on an illustrative mutual orbit, tagged `artistic`. Relative brightness from class (derived). Orbital period ~11 yr and separation **[verify before showing numbers]**.
- **Moving jets (issue #42, Q-104):** with a stated `winds` speed-up the bands are drawn by the browser as counter-flowing jets with storms and spin flattening (`renderers/jetSurface.ts`), instead of the baked texture. Cloud cover follows the scrubbed light curve (tier 3). **Flattening is refused** (listed in `missing`; Q-109): the rule `f = f_J (P_J / P)^2` assumes Jupiter's density, which does not hold for a brown dwarf, and the card has no mass, so the body is drawn round.
- **Haptics:** band source plus brightness pulse ([§8.5](../haptics/profiles.md#r85-per-type-haptic-profile)).
- **IR view shows no motion, by design (issue #42, Q-107, Q-108):** the moving jets are drawn in the visible view only (refused with reason `mode` in IR), so in the default SPHEREx IR view no process is registered and no speed-up note is shown. The UI hint pointing to the visible view is built (issue #56); since issue #62 the IR view shows the still band pattern instead of a flat disc.
