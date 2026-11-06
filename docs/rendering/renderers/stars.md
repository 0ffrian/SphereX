# Renderer: stars

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R7.5

### R7.5 Stars: `star`, `star_mira`, `star_ttauri`

- **Requires:** `teff_K`. Optional: `radius_rsun`, `lightcurve`, `period_var_d`. Without `radius_rsun` the star is a unit sphere with no scale bar ("size unknown"); colour and limb darkening are kept (Q-45).
- **Colour:** Teff → sRGB through a blackbody lookup table (e.g., Mitchell Charity's CIE 1931 2° D65 table). Tag `derived`.
- **Limb darkening:** linear, I(μ) = 1 − 0.6·(1 − μ). Tag `model_dependent`.
- **`star` (Barnard's Star):** red-dwarf sphere plus a **motion trail** across the background stars, drawn from `pm_mas_yr` over the SPHEREx epochs (`measured`).
- **`star_mira` (R Dra, P ≈ 246 d):** brightness follows the measured light curve as you scrub. The radius pulsation (±10%) is `artistic`.
- **`star_ttauri` (RW Aur):** star plus a tilted disc (`RingGeometry`, inclination 45–60°). A dust screen's opacity = clamp(1 − flux/median_flux, 0, 0.9) at the scrubbed time. The timing is `measured`; the screen geometry is `artistic`.
- **Saturation:** points with SPHEREx saturation FLAGS are excluded from brightness mapping and shown hatched on the light curve.
