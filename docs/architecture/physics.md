# Physics layer

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A7–A7.5

## A7 Physics layer

This is **reduced, physically inspired physics**, not simulation. Each rule is a short formula or table, shown next to its slider so reviewers can check it. Rules marked "built" already exist in the Surface Lab.

### A7.1 Planets

| Quantity | Rule | Status |
|---|---|---|
| Equilibrium temperature | `Teq = T_star * sqrt(R_star / (2a)) * (1 - A)^(1/4)` | To build |
| Bulk density | `rho = 5.51 * M / R^3` g/cm3 with M, R in Earth units | To build |
| Surface gravity | `g = G M / R^2` | To build |
| Escape speed | `v_esc = sqrt(2 G M / R)` | To build |
| Atmosphere kept | Keep if `v_esc` is well above the gas thermal speed `sqrt(2 k T / m)` (rule of thumb: about 6 times) | To build |
| Ice, ocean, steam | Cold below about 330 K gets polar ice, growing as temperature falls. Oceans are removed above about 450 K. Lava glow starts near 700 K. | Built (as simple thresholds) |
| Ocean share to sea level | Sea level from the inverse normal curve of the terrain height distribution | Built |

### A7.2 Gas giants (storms that respond)

| Quantity | Rule | Status |
|---|---|---|
| Spin to band count | Rhines scale `L = pi * sqrt(U / beta)`, `beta = 2 Omega / R`. Number of bands about `sqrt(2 Omega R / U)`. For Jupiter (`Omega = 1.76e-4 /s`, `R = 7e7 m`, `U = 50 m/s`) this gives about 22. Order of magnitude only. | To build |
| Flattening | `f = 0.7 * q`, `q = Omega^2 R^3 / (G M)`. Rule of thumb calibrated on Jupiter and Saturn. | To build (slider exists, not linked) |
| Colour family | Chosen by temperature: pale cyan (about 60 K), blue (100), cream (130), gold (200), cobalt (600), dark (1,100), glowing (1,800). | Built |
| Storm placement | Place storms where wind shear between neighbouring jets is anticyclonic, so spots sit between counter-flowing jets. | To build |
| Storm drift | A storm moves at the zonal wind speed of its latitude. | Built in a basic form (bands shear) |
| Storm size | About the Rossby deformation radius `L_d = N H / f`. Larger storms live longer. | To build |
| Storm count | Rises with internal heat and temperature. | To build |

**Stretch: real fluid solver.** A 2D barotropic vorticity solver on a latitude-longitude grid, with the equation `d(zeta)/dt + J(psi, zeta + f) = nu * del2(zeta) + forcing`. Storms then form, merge, shear and die on their own. Needs a GPU pass. A 256 x 128 grid should be possible on an Iris Xe, but this is **untested**. Build it only after the rules layer works.

### A7.3 Brown dwarfs

| Quantity | Rule | Status |
|---|---|---|
| Spectral type | From temperature, roughly L above about 1,400 K, T from about 1,400 K to 500 K, Y below about 500 K. Approximate. | To build |
| Radius | About 1 Jupiter radius, almost independent of mass (degeneracy pressure) | To build |
| Absorption features | Water near 1.4, 1.9 and 2.7 micron, methane near 1.6, 2.2 and 3.3 micron. These fall inside SPHEREx's range. | Used in Brown Dwarf Match |
| Colour | Orange-brown when hotter, darker and more purple when cooler. Cold ones glow mostly in infrared, so visible colour is a guess. | Built |

### A7.4 Asteroids

| Quantity | Rule | Status |
|---|---|---|
| Elongation from brightness swing | `delta_m = 2.5 * log10(a / b)` (side-on, a lower limit) | Used as the estimate for elongation |
| Spin limit | Rubble piles cannot spin faster than `P = sqrt(3 pi / (G rho))`. For `rho = 2000 kg/m3` this is about 2.3 hours. | To build |
| Crater density | More craters on older surfaces. Sizes follow a power law. | Built (crater count slider) |
| Reflectance | Lommel-Seeliger law for dark airless rock | Built |

### A7.5 Supernova remnants

| Quantity | Rule | Status |
|---|---|---|
| Radius | Sedov-Taylor: `R = 1.15 * (E t^2 / rho)^(1/5)`. Typical form: `R ~ 12.4 pc * (E51 / n)^(1/5) * (t / 10^4 yr)^(2/5)`. | Built (age to the power 0.4 only) |
| Phases | Free expansion, Sedov, then radiative. Look and colour differ. | To build |
| Colour | Hydrogen red, oxygen teal, hot gas blue. | Built, estimated |
