# Physics layer

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A7–A7.5

## A7 Physics layer

This is **reduced, physically inspired physics**, not simulation. Each rule is a short formula or table, shown next to its slider so reviewers can check it. Rules marked "built" already exist in the Surface Lab; "Built (app)" means the rule is in `frontend/src/physics/` (issue #13).

**In the app:** `derivePhysics(card, overrides)` returns tagged values, the ids it refused in `missing` (with the inputs each lacked in `needs`) and the overrides it ignored. A slider value wins over the card value of the same name. Outputs are `derived` with their formula, weakened to the weakest input tag (a `model_dependent` input or rule gives `model_dependent` with the assumption). A slider value is the visitor's choice, not a measurement (R1.2), so it enters as `artistic` with the assumption "`<value>` (your setting)", and every output it feeds is `artistic` with its formula kept (Q-58 b). The Teq the rules used is echoed in `teq_used_K` with the tag of its source (card, `teq_K` slider or star sliders). Slider keys come from the one registry in `frontend/src/viewer/sliders.ts` (D-27). Nothing is written back to the card (D-02). The backend half of stage 6 (A4.6) is not built yet (Q-60).

### A7.1 Planets

| Quantity | Rule | Status |
|---|---|---|
| Equilibrium temperature | `Teq = T_star * sqrt(R_star / (2a)) * (1 - A)^(1/4)` | Built (app); from the star sliders, else the card's `teq_K` |
| Bulk density | `rho = 5.51 * M / R^3` g/cm3 with M, R in Earth units | Built (app); mass from a slider only (the card has no mass) |
| Surface gravity | `g = G M / R^2` | Built (app) |
| Escape speed | `v_esc = sqrt(2 G M / R)` | Built (app) |
| Atmosphere kept | Keep if `v_esc` is well above the gas thermal speed `sqrt(2 k T / m)` (rule of thumb: about 6 times) | Built (app) for H2, He, H2O, N2, CO2 with T = Teq, tagged `model_dependent` |
| Ice, ocean, steam | Cold below about 330 K gets polar ice, growing as temperature falls. Oceans are removed above about 450 K. Lava glow starts near 700 K. | Built (as simple thresholds); the app gives on/off flags only. The lava threshold `LAVA_START_K` (`physics/constants.ts`) is shared with the viewer, and both use `Teq > 700 K` |
| Ocean share to sea level | Sea level from the inverse normal curve of the terrain height distribution | Built |

### A7.2 Gas giants (storms that respond)

| Quantity | Rule | Status |
|---|---|---|
| Spin to band count | Rhines scale `L = pi * sqrt(U / beta)`, `beta = 2 Omega / R`. Number of bands about `sqrt(2 Omega R / U)`. For Jupiter (`Omega = 1.76e-4 /s`, `R = 7e7 m`, `U = 50 m/s`) this gives about 22. Order of magnitude only. | Built (app), with the Rhines length. Drives the shader (issue #42, Q-104) when the artistic `bands` slider is unset; the slider wins. Since issue #62 (Q-115) a missing spin or wind speed is the typical value of a giant planet (Jupiter's 9.925 h, verified: 9.92492 h System III, NASA Jupiter Fact Sheet and IAU WGCCRE 2015; A7.2's 50 m/s, still **[verify]**: no source uses 50 m/s in the Rhines estimate, Showman, Lewis & Fortney 2015 use U ≈ 30 m/s with another form of the length), stated in `assumed`, instead of the default 12. Because the wind is unverified, `bands` is `inferred_from_analog` (tier 4) even with a measured spin (Q-119, Q-110). The legend shows the weaker of the backend layer's tag and this rule's tag, with this rule's text, so it never quotes a count other than the drawn one; a `bands` slider shows `artistic` (rendering doc R7.7, Q-115). The `zonal_wind_ms` slider feeds only this rule; the drawn wind comes from the band phase (`zonalWind`, `viewer/fields`) |
| Flattening | `f = 0.7 * q`, `q = Omega^2 R^3 / (G M)`. Rule of thumb calibrated on Jupiter and Saturn. | Built (app); drives the drawn silhouette (issue #42, Q-104): mass slider, else Jupiter-density scaling from the spin (the typical spin when the card has none, which is Jupiter's own period: tier 4, `inferred_from_analog`, Q-119 b; tier 3 with a measured spin, since `JUPITER_SPIN_H` and `JUPITER_FLATTENING` 0.06487 = 1 − 66854/71492 are verified against the NASA Jupiter Fact Sheet and IAU WGCCRE 2015, Q-119). The Jupiter-density rule is **not valid for brown dwarfs** (13 to 80 Jupiter masses at about one Jupiter radius, so `f` is far smaller) and no mass source exists, so their flattening is refused (Q-109). The legend shows the weaker of the backend `flattening` tag and this rule's tag (a `mass_mearth` slider: `artistic`), with this rule's formula and assumption (Q-115) |
| Colour family | Chosen by temperature: pale cyan (about 60 K), blue (100), cream (130), gold (200), cobalt (600), dark (1,100), glowing (1,800). | Built |
| Storm placement | Place storms where wind shear between neighbouring jets is anticyclonic, so spots sit between counter-flowing jets. | To build |
| Storm drift | A storm moves at the zonal wind speed of its latitude. | Built (issue #42): `fields/flowModel.ts`, the same storms for the shader and the haptic sampler |
| Storm size | About the Rossby deformation radius `L_d = N H / f`. Larger storms live longer. | To build |
| Storm count | Rises with internal heat and temperature. | To build |

**Stretch: real fluid solver.** A 2D barotropic vorticity solver on a latitude-longitude grid, with the equation `d(zeta)/dt + J(psi, zeta + f) = nu * del2(zeta) + forcing`. Storms then form, merge, shear and die on their own. Needs a GPU pass. A 256 x 128 grid should be possible on an Iris Xe, but this is **untested**. Build it only after the rules layer works.

### A7.3 Brown dwarfs

| Quantity | Rule | Status |
|---|---|---|
| Spectral type | From temperature, roughly L above about 1,400 K, T from about 1,400 K to 500 K, Y below about 500 K. Approximate. | Built (app), from the card's `teff_K` |
| Radius | About 1 Jupiter radius, almost independent of mass (degeneracy pressure) | Built (app), only when the card has no radius; `model_dependent` |
| Absorption features | Water near 1.4, 1.9 and 2.7 micron, methane near 1.6, 2.2 and 3.3 micron. These fall inside SPHEREx's range. | Used in Brown Dwarf Match |
| Colour | Orange-brown when hotter, darker and more purple when cooler. Cold ones glow mostly in infrared, so visible colour is a guess. | Built |

### A7.4 Asteroids

| Quantity | Rule | Status |
|---|---|---|
| Elongation from brightness swing | `delta_m = 2.5 * log10(a / b)` (side-on, a lower limit) | Used as the estimate for elongation |
| Spin limit | Rubble piles cannot spin faster than `P = sqrt(3 pi / (G rho))`. For `rho = 2000 kg/m3` this is about 2.3 hours. | Built (app); density from a slider, refused when unset (no default) |
| Crater density | More craters on older surfaces. Sizes follow a power law. | Built (crater count slider) |
| Reflectance | Lommel-Seeliger law for dark airless rock | Built |

### A7.5 Supernova remnants

| Quantity | Rule | Status |
|---|---|---|
| Radius | Sedov-Taylor: `R = 1.15 * (E t^2 / rho)^(1/5)`. Typical form: `R ~ 12.4 pc * (E51 / n)^(1/5) * (t / 10^4 yr)^(2/5)`. | Built (age to the power 0.4 only); built (app) for `nova` bodies (Q-59), typical form, tagged `artistic` (D-12) |
| Phases | Free expansion, Sedov, then radiative. Look and colour differ. | To build |
| Colour | Hydrogen red, oxygen teal, hot gas blue. | Built, estimated |
