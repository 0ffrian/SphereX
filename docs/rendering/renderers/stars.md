# Renderer: stars

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R7.5, R7.5.1–R7.5.5 · **Implements:** [D-03](../../decisions/platform-hosting.md), [D-21, D-32, Q-110](../../decisions/contract-tags.md), [Q-36](../../decisions/contract.md), [D-34, Q-108](../../decisions/rendering-motion.md), [Q-104, Q-107](../../decisions/rendering-kinds.md), [Q-118](../../decisions/rendering-layers.md), [Q-45, Q-65](../../decisions/rendering-bodies.md), [Q-55](../../decisions/pipeline-stages.md), [Q-152](../../decisions/catalogue-values.md) · **Read with:** [data-contract.md](../data-contract.md) (R3.4 `dynamics`), [display-rules.md](../display-rules.md) (R5.7)

### R7.5 Stars: `star`, `star_mira`, `star_ttauri`

- **Requires:** `teff_K`. Optional: `radius_rsun`, `lightcurve`, `period_var_d`. Without `radius_rsun` the star is a unit sphere with no scale bar ("size unknown"); colour and limb darkening are kept (Q-45).
- **Colour:** Teff → sRGB of a blackbody. As built (Q-55 item 9): Planck integrated against the CIE 1931 2° functions in the Wyman, Sloan & Shirley 2013 fit, not a lookup table such as Mitchell Charity's; the method is **[verify]** (R12 #38). Tag: the weaker of `teff_K`'s tag and `derived` (R5.2).
- **Where `teff_K`, `radius_rsun` and `period_var_d` come from (issue #68 Part 8c, Q-152).** First source that answers wins; a source that cannot be used is skipped with its reason in the null value's `source`, never replaced by a guess.
  1. **`teff_K`:** SIMBAD `mesFe_h`, the median of the non-null published Teff rows (of two middle values, the one from the more recent bibcode), tag `derived`. Barnard's Star: 3243 K from 55 values (3083 to 3530 K); RW Aur: 3885 K.
  2. Gaia DR3 GSP-Phot `teff_gspphot`, `model_dependent`, **skipped at or below 4000 K** (cool-star molecular absorption, Gaia DR3 docs Sec 11.4.4; [A3.2](../../architecture/data-sources.md#a32-gaia-dr3)).
  3. Pecaut & Mamajek 2013 Table 5 mean dwarf Teff for the SIMBAD type (`backend/assets/pm13_dwarf_teff.toml`, [A3.13](../../architecture/object-sources.md#a313-literature-registry-literaturetoml)), `inferred_from_analog`, with the class in the `colour` layer's `assumed`. **Main-sequence (V) types of `star` only.** No Teff table is verified for M giants, Miras or pre-main-sequence stars, so **R Dra's Teff is refused** (and `colour`, `visible` with it).
  4. **`radius_rsun`:** a literature-registry interferometric radius (none yet), else Gaia FLAME `radius_flame` (`model_dependent`; Barnard's Star 0.2022 R☉), else refused. A class table never gives a radius. R Dra and RW Aur have no Gaia values, so their radius is refused (unit sphere, no scale bar).
  5. **`period_var_d`** (Mira): SIMBAD `mesVar` median over rows typed `LPV` or `M` only, `measured` (R Dra: 247 d from 3 rows). Rows of other types (Barnard's `ROT`) are ignored.
  Barnard's Star and R Dra saturate in SPHEREx (D-31), which affects their spectrum, not this colour: it comes from Teff.
- **Limb darkening:** linear, I(μ) = 1 − 0.6·(1 − μ). Tag `model_dependent`.
- **`star` (Barnard's Star):** red-dwarf sphere plus a **motion trail** across the background stars, drawn from `pm_mas_yr` over the SPHEREx epochs (`measured`).
- **`star_mira` (R Dra, P ≈ 246 d):** brightness follows the measured light curve as you scrub. The radius pulsation (±10%) is `artistic`.
- **`star_ttauri` (RW Aur):** star plus a **flared, lit disc** tilted 45–60° (issue #62, Q-118; see below). A dust screen's opacity = clamp(1 − flux/median_flux, 0, 0.9) at the scrubbed time. The timing is `measured`; the screen geometry is `artistic`.
- **Saturation:** points with SPHEREx saturation FLAGS are excluded from brightness mapping and shown hatched on the light curve.
- **Renderer:** the star renderer is three r187 TSL (`three/webgpu`, D-03). The `limb_darkening` rule above stays; the surface layers below multiply into it.
- **Haptics and sound:** data haptics only ([§8.5](../haptics/profiles.md#r85-per-type-haptic-profile)): the Mira heartbeat and the T Tauri dimming pulse follow the light-curve scrubber; the `star` motion-trail ticks are refused (R12 #16). A star has no height, so it has no body tone (R8.9.1).

**T Tauri disc (issue #62, Q-118; amends the earlier "tilted `RingGeometry`").** `renderers/ttauriDisc.ts` draws it with TSL nodes only (three r187): a closed, flared mesh (top and bottom surfaces whose half-thickness is `H_in (r / r_in)^p`, an inner wall that faces the star, an outer wall), radii 1.3 to 2.7 star radii, inclination 58° (the 45–60° range is kept), `H_in` 0.14, `p` 1.25. Look: radial brightness falloff `(r_in / r)^1.8` with a faded outer edge; a bright, warm inner rim; light from the star at the origin (wrap lighting, so the grazing top surface is not black); a darker midplane lane (the walls darken toward the midplane, and surfaces seen at a graze darken like a thick dust column). It is depth-tested against the opaque star and writes no depth, so the near half passes in front of the star's upper part and the far half goes behind its lower part. **Draw order (PR #63 review):** the disc is two passes over one geometry, not one `DoubleSide` mesh (a blended mesh with no depth write has unsorted internal overlap): the back faces first (`BackSide`, `renderOrder` 1), then the front faces (`FrontSide`, `renderOrder` 2) at `FRONT_OPACITY_SCALE` 0.55 of the far pass, so the star stays visible through the thin near rim. A fixed order, the same for every view, `artistic`. **Every number and colour is `artistic`** (layer `disc`, tier 5): no physical size, temperature or dust mass is claimed. The dust screen is unchanged: its timing is `measured`, its geometry `artistic`.

### R7.5.1 Star surface (what is drawn)

The surface layers follow the tier chain (D-32). Each layer carries its tier and, from tier 2, its formula. Motion keys are in `RenderParams.dynamics` ([R3.4](../data-contract.md#r34-renderparams-produced-by-the-backend-get-v1objectsidrender-params)); with no `dynamics` the surface is still.

| Toggle state (D-21) | What shows |
|---|---|
| Measured only | tier 1 layers only; the plain body follows Q-45 (shown only when the size is `measured`) |
| + Estimated | colour, limb darkening, granulation (spec; the code draws it at tier 5, see the box below), spots (tier 4), faculae, flares |
| + Artistic | adds glow, cell noise and prominence strand look (tier 5) |

Barnard's Star example **[verify]** (each tier needs checking, R12 #26):

| Layer | Tier | Basis |
|---|---|---|
| Colour | 2 | Teff |
| Size | refused | no radius (Q-45) |
| Limb darkening | 3 | linear law with a typical coefficient |
| Granulation cell size | 3 (spec; code: 5, see the box below) | pressure scale height, mass assumed for an M4 dwarf |
| Starspots | 4 | typical coverage for class and activity |
| Spin | 1 | rotation period 145 ± 15 d from activity indicators (Toledo-Padrón et al. 2019, MNRAS 488, 5145, arXiv:1812.06712), verified 7 Nov 2026. Tier 1 only once the card carries it as `rot_period_h` (3,480 h, R3.4) |
| Glow, cell noise | 5 | art |

> **Implementation (issue #42, Q-104):** `bodies/starModel.ts` (CPU model of groups, flares and loops, pure in seed, rates and t), `shaders/star.ts`, `shaders/loops.ts`, `renderers/StarBody.ts`. Tiers as in Q-104: spots, faculae, prominence placement and flares tier 4; granulation, strand look and glow tier 5.
>
> **Deliberate deviations from this spec (Q-104, Q-108):** (1) R7.5.1 lists granulation under "+ Estimated" and the Barnard's Star example gives its cell size tier 3. The code draws granulation at **tier 5** (artistic), because the cell-size rule needs a mass and its constants are **[verify]** (R7.5.2, Q-104 item 1). (2) R7.5.5 allows flares at tier 1 when the rate is measured. The code caps the flare layer at **tier 4** even then (the weaker of the rate's tier and 4), because the drawn schedule and shape are seeded, not observed (Q-104 item 1). Flare onsets are also capped at 0.5 per real second, with the lowered speed-up shown (Q-108 item 3). Q-104 is open (Moon): either the spec follows the code or the code follows the spec once Moon decides. Until then the table rows above marked "spec" are the target, and the code differs as described here.

### R7.5.2 Photosphere and granulation

- **Drawn:** a convective cell pattern (cells, dark lanes, slow churn) over the colour and limb darkening.
- **Inputs:** `teff_K`, surface gravity g (from mass and radius, or assumed for the class).
- **Rule:** cell size scales with the pressure scale height, H ∝ T/g, so a dwarf has finer cells than a giant. The scaling constant and the cell lifetime: **[verify]** (R12 #27). Tier 3 when mass or radius is assumed (state it in `assumed`), tier 2 when both are measured.
- **Motion:** cells churn with the clock; no `dynamics` key, the rate follows cell size. Tag follows the layer.
- Differential rotation uses `diff_rotation` (k) and `spin_period_h`: Ω(φ) = Ω_eq (1 − k sin²φ), the equator turns faster. Typical k by class: **[verify]** (R12 #28).
- **Physics (issue #71 stream C, D-36, Q-230 to Q-235):** `physics/stellar.ts` computes g = GM/R², H = kT/(μ m_H g) with μ = 1.3, cell size L = 8H and cells per radius R/L (`model_dependent`). Convection fades out between 6500 and 8200 K (placeholder, **[verify]**): a hot star is smooth, a giant shows a few huge cells. It needs the stellar mass, which the card does not carry yet (Q-230): without it the pattern is the artistic look. Scale choices: `enlarged` (cells capped at 30 per radius, `artistic`), `true` (`model_dependent`; cells under a few pixels average out) and `close`. Colour views: `true`, `enhanced` (hue deepened) and `observatory` (false-colour EUV, `artistic`).

### R7.5.3 Spots

- **Drawn:** sunspot groups that age over many rotations: a leader spot, a broken-up follower, small pores. Each has a near-black umbra and a filamentary penumbra.
- **Inputs:** active regions passed in as data (positions, sizes, ages, from stage 6) when they exist; `spot_lifetime_d`, `spin_period_h`, `diff_rotation`.
- **Rule:** with no region data, place groups from a fixed rule seeded by the card seed, at the typical coverage for class and activity (**[verify]** coverage and lifetime by class, R12 #29). Tier 4. With measured region data, tier 1.
- **Motion:** spots grow, fade and are carried by differential rotation. Driven by `spot_lifetime_d` and `speedup.spots`.
- **Physics (issue #71 stream C):** with mass and rotation period, Ro = P_rot/τ_c (Wright et al. 2011 fit, **[verify]**), ⟨B⟩ from Reiners et al. 2022 (199 G Ro^-1.26 for Ro ≥ 0.13, 2050 G Ro^-0.11 below), coverage from a Sun-anchored placeholder scaling (`inferred_from_analog`, **[verify]**), lognormal group areas, a butterfly latitude belt and Joy's-law tilt (follower poleward). The number of groups drawn is set by the coverage (at most 12, 4 on the `low` tier) and replaces the fixed four. `SpotGroup` (centre, polarity axis, separation, area) on `RenderPlan.star.physics` is the interface for the flare stream (Q-233). A giant or a hot star has no spots.

### R7.5.4 Faculae

- **Drawn:** bright patches that brighten toward the limb, around active regions.
- **Inputs:** the same region list as the spots.
- **Rule:** contrast rises as μ falls, scaled with spot area. The contrast law: **[verify]** (R12 #30). Tier 4 (3 when a formula is stated with assumed inputs).
- **Motion:** follows the spots; no key of its own.

### R7.5.5 Flares and prominences

> **Issue #71 stream G (D-36, Q-270 to Q-273):** when the star has physics and spot groups, flares and loops are drawn by `StarPlasma` from `physics/flares.ts` along the physical spot groups (energy cap, decay-index open or closed, plasma streaks, Field lines toggle, Latest flare card, close-up flare view) and replace the region loops and shader flares described below.

- **Flares:** a flare lights two ribbons in an active region and lifts a twisted arch of plasma strands off the limb that rises and fades. Rate by `flare_rate_per_d`: typical rate by class **[verify]** (R12 #31). Constants marked [verify] are used only under the Q-110 policy (proposed). Tier 4 from a class rate, tier 1 only when measured. Times come from a seeded schedule, so the same card, seed and t give the same flare.
- **Prominences:** loops that follow dipole field lines between a region's leader and follower spots. Tier 5 for the strand look, tier 4 for the placement.
- **Motion:** flares use `speedup.flares`; loops sway slowly with the clock.
- **Mira:** pulsation uses `pulsation_period_d` (tier 1 or 2, from the light curve). The ±10% amplitude stays `artistic` (Q-65).
- In Measured only, none of R7.5.3 to R7.5.5 is drawn unless its tier is 1.
- **Visual findings (issue #42, Q-107):** granulation contrast, the limb, the prominence strands (now tapered, uneven in height and phase) and the star colour (converted from sRGB once) were fixed after the review; whether they look right on a real GPU is still open (R12 #40; testable on the A15).
