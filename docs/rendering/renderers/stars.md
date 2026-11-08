# Renderer: stars

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R7.5, R7.5.1–R7.5.5

### R7.5 Stars: `star`, `star_mira`, `star_ttauri`

- **Requires:** `teff_K`. Optional: `radius_rsun`, `lightcurve`, `period_var_d`. Without `radius_rsun` the star is a unit sphere with no scale bar ("size unknown"); colour and limb darkening are kept (Q-45).
- **Colour:** Teff → sRGB through a blackbody lookup table (e.g., Mitchell Charity's CIE 1931 2° D65 table). Tag `derived`.
- **Limb darkening:** linear, I(μ) = 1 − 0.6·(1 − μ). Tag `model_dependent`.
- **`star` (Barnard's Star):** red-dwarf sphere plus a **motion trail** across the background stars, drawn from `pm_mas_yr` over the SPHEREx epochs (`measured`).
- **`star_mira` (R Dra, P ≈ 246 d):** brightness follows the measured light curve as you scrub. The radius pulsation (±10%) is `artistic`.
- **`star_ttauri` (RW Aur):** star plus a tilted disc (`RingGeometry`, inclination 45–60°). A dust screen's opacity = clamp(1 − flux/median_flux, 0, 0.9) at the scrubbed time. The timing is `measured`; the screen geometry is `artistic`.
- **Saturation:** points with SPHEREx saturation FLAGS are excluded from brightness mapping and shown hatched on the light curve.
- **Renderer:** the star renderer is three r187 TSL (`three/webgpu`, D-03). The `limb_darkening` rule above stays; the surface layers below multiply into it.

### R7.5.1 Star surface (what is drawn)

The surface layers follow the tier chain (D-32). Each layer carries its tier and, from tier 2, its formula. Motion keys are in `RenderParams.dynamics` ([R3.4](../data-contract.md#r34-renderparams-produced-by-the-backend-get-v1objectsidrender-params)); with no `dynamics` the surface is still.

| Toggle state (D-21) | What shows |
|---|---|
| Measured only | tier 1 layers only; the plain body follows Q-45 (shown only when the size is `measured`) |
| + Estimated | colour, limb darkening, granulation, spots (tier 4), faculae, flares |
| + Artistic | adds glow, cell noise and prominence strand look (tier 5) |

Barnard's Star example **[verify]** (each tier needs checking):

| Layer | Tier | Basis |
|---|---|---|
| Colour | 2 | Teff |
| Size | refused | no radius (Q-45) |
| Limb darkening | 3 | linear law with a typical coefficient |
| Granulation cell size | 3 | pressure scale height, mass assumed for an M4 dwarf |
| Starspots | 4 | typical coverage for class and activity |
| Spin | 1 | rotation period 145 ± 15 d from activity indicators (Toledo-Padrón et al. 2019, MNRAS 488, 5145, arXiv:1812.06712), verified 7 Nov 2026. Tier 1 only once the card carries it as `rot_period_h` (3,480 h, R3.4) |
| Glow, cell noise | 5 | art |

> **Implementation (issue #42, Q-103):** `bodies/starModel.ts` (CPU model of groups, flares and loops, pure in seed, rates and t), `shaders/star.ts`, `shaders/loops.ts`, `renderers/StarBody.ts`. Tiers as in Q-103: spots, faculae, prominence placement and flares tier 4; granulation, strand look and glow tier 5.

### R7.5.2 Photosphere and granulation

- **Drawn:** a convective cell pattern (cells, dark lanes, slow churn) over the colour and limb darkening.
- **Inputs:** `teff_K`, surface gravity g (from mass and radius, or assumed for the class).
- **Rule:** cell size scales with the pressure scale height, H ∝ T/g, so a dwarf has finer cells than a giant. The scaling constant and the cell lifetime: **[verify]**. Tier 3 when mass or radius is assumed (state it in `assumed`), tier 2 when both are measured.
- **Motion:** cells churn with the clock; no `dynamics` key, the rate follows cell size. Tag follows the layer.
- Differential rotation uses `diff_rotation` (k) and `spin_period_h`: Ω(φ) = Ω_eq (1 − k sin²φ), the equator turns faster. Typical k by class: **[verify]**.

### R7.5.3 Spots

- **Drawn:** sunspot groups that age over many rotations: a leader spot, a broken-up follower, small pores. Each has a near-black umbra and a filamentary penumbra.
- **Inputs:** active regions passed in as data (positions, sizes, ages, from stage 6) when they exist; `spot_lifetime_d`, `spin_period_h`, `diff_rotation`.
- **Rule:** with no region data, place groups from a fixed rule seeded by the card seed, at the typical coverage for class and activity (**[verify]** coverage and lifetime by class). Tier 4. With measured region data, tier 1.
- **Motion:** spots grow, fade and are carried by differential rotation. Driven by `spot_lifetime_d` and `speedup.spots`.

### R7.5.4 Faculae

- **Drawn:** bright patches that brighten toward the limb, around active regions.
- **Inputs:** the same region list as the spots.
- **Rule:** contrast rises as μ falls, scaled with spot area. The contrast law: **[verify]**. Tier 4 (3 when a formula is stated with assumed inputs).
- **Motion:** follows the spots; no key of its own.

### R7.5.5 Flares and prominences

- **Flares:** a flare lights two ribbons in an active region and lifts a twisted arch of plasma strands off the limb that rises and fades. Rate by `flare_rate_per_d`: typical rate by class **[verify]**. Tier 4 from a class rate, tier 1 only when measured. Times come from a seeded schedule, so the same card, seed and t give the same flare.
- **Prominences:** loops that follow dipole field lines between a region's leader and follower spots. Tier 5 for the strand look, tier 4 for the placement.
- **Motion:** flares use `speedup.flares`; loops sway slowly with the clock.
- **Mira:** pulsation uses `pulsation_period_d` (tier 1 or 2, from the light curve). The ±10% amplitude stays `artistic` (Q-65).
- In Measured only, none of R7.5.3 to R7.5.5 is drawn unless its tier is 1.
- **Open visual findings (issue #42, Q-106):** granulation contrast is too high, the limb is not crisp and the prominence loop shape is stiff.
