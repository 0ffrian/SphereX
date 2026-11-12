# Sound: sources and weather

> **Part of:** Rendering & sound spec ([index](../README.md)) · **Sections:** R13.5, R13.6 · **Implements:** [Q-436, Q-437, Q-438](../../decisions/sound-ambience.md) · **Read with:** [place-wind.md](place-wind.md) (R13.4), [bake-mix.md](bake-mix.md) (R13.7, R13.8), [accessibility.md](../accessibility.md) (R9)

## R13.5 Sound sources: gates, physics and character

Each source has four parts: a **gate** (it is baked only when the gate passes), **physics** (which sets the spectrum and level), **events** and a **tag**. Unless stated, levels are given at the Earth reference and scaled per world by §11.3.

| # | Source | Gate (all must hold) | Spectrum (baked) | Live drivers | Tag |
|---|---|---|---|---|---|
| S1 | **Wind rumble** (land and sea variants) | `airOK` | Band 18 Hz to `40 + 5·U_ref` Hz, slopes per Moon's `bp(f, 18, 40+5v, 2, 7/6)`. Turbulence: f^-5/3 at the sensor, f^-7/3 in-flow [SS §1]. **Gust envelope** (corrected): Gaussian `1 + I_u·n(t)`, n from 24 sines with amplitudes ∝ k^-0.83 (−5/3 spectrum), clipped ≥ 0. Integral time 5–30 s; uses 12 s. Variants: land (I_u 0.24) and sea (0.11) | gain ∝ (U/U_ref)² (pressure ∝ ρ I_u U²) | `artistic` (relations `model_dependent`) |
| S2 | **Wind hiss** (flow around grit and pebbles) | `airOK` and `Re = U_ref·d/ν ≥ 47` for `d = 4 mm` (ν = μ_v/ρ); the hiss and each S3 size are gated by their own Re (Appendix D R4) | Band-pass centred at `St·U_ref/d`. **St = 0.212·(1 − 21.2/Re) for 47 ≤ Re ≤ 200, else 0.2** (Roshko) [SS §2] | gain ∝ (U/U_ref)³; `playbackRate = clamp(U/U_ref, 0.7, 1.4)` (the centre follows U, Strouhal) | as S1 |
| S3 | **Ridge whistle** (aeolian tones) | S2's gate at `d = 6, 3.5, 2.2 mm`, each tone separately | Narrow peaks (Q≈25) at `St·U_ref/d`, with a whistle envelope (squared gust envelope) | gain ∝ max(exposure, 0) × (U/U_ref)³; playbackRate as S2 | as S1 |
| S4 | **Surf** (waves breaking on a shore) | `airOK`, `liquid`, `U10_ref ≥ U_wave` | Crash band 45 Hz to `900·√m_f` Hz, foam band `700·m_f` to `5200·m_f` Hz (Moon), times air absorption. Waves: `H_s = 0.22·U²/g` (Pierson–Moskowitz) and period `T_p = 7.14·U/g`, both capped by fetch [SS §4] | gain from Bolin & Åbom: 60 dB at H 0.4 m to 78 dB at H 2 m, interpolated in log H, × (1 − iceCover) | `artistic` |
| S5 | **Open sea** (swell, whitecaps, bubbles) | as S4 | Swell band 25–180 Hz with an envelope at 1/T_p. Whitecap events at rate `λ = 0.35·(U/8)³`/s, which tracks whitecap fraction `W = 3.84e-6·U^3.41`; zero below 3.5 m/s. Bubble pings at Minnaert frequency × `m_f` | gain ∝ W/W_ref; × (1 − iceCover) | `artistic` |
| S6 | **Rain** | `airOK`, `liquid` (the fluid can be liquid at the surface), and the world can rain (`canLiquid`) | Drop radius `r_max = 3.25 mm · √((σ/(g·Δρ)) / (σ/(g·Δρ))_Earth)` (capillary scaling calibrated to Earth, Loftus & Wordsworth 2021; Appendix D R3; Titan between 4.75 and 6.6 mm [verify]). Fall speed `v = √(8 r (ρ_l−ρ_a) g /(3·0.8·ρ_a))`. Hiss band `900·p` to `7000·p` Hz, with `p = r_E/r` (size → pitch); patter events at a rate ∝ size^-3 (Moon). Small-drop bubble ring near 14 kHz (Earth), scaled by Minnaert [SS §8] | gain = `RAIN_GAIN_DB + 10·log10(max(rainRate, 1e-3))` (proxy: impact energy per second), only when `precipPhase==='rain'` | `artistic` |
| S7 | **River** | `airOK`, `liquid`, hydro has rivers (`hydro.n > 0`) | Bubbly babble: Minnaert bubble pings (radii 1–5 mm) at `m_f`, broadband 300–4000 Hz | dissipated power ∝ ρ_l·g·Q·S (derived [SS §9]). Q from hydro R: `Q = 50·10^((R/255 − 0.5)/0.2)` m³/s (inverts the engine's line width); S = `slope` | `artistic` |
| S8 | **Lava** | `airOK`, lava world (`hydro.lava`) | Low roar 25–200 Hz; crust crackle events (broadband 1–6 kHz clicks); no bubble ringing (lava is too viscous [SS §10]). Vent burst events: an audible thud 30–80 Hz plus spatter, standing in for the 2–9 Hz infrasound of a burst (Vergniolle & Brandeis 1996) | lava fraction near the listener; vents (hydro A ≥ 128) as point sources | `artistic`; vent events `artistic` (the infrasound is noted) |
| S9 | **Storm roar** (cyclone) | `airOK`, cyclone active (§6.5 item 3), the engine's own "Strongest hurricane possible" condition, `Ps ≥ 0.1 bar` and a finite Vmax; Vmax is clamped to ≤ 100 m/s with a note (Appendix D R9) | Wind rumble and hiss baked at `U_ref = Vmax` | gain by the §6.5 profile, so the eye is quiet [SS W4: dust-devil eye]; rain bed raised by `STORM_RAIN_DB` inside `2r` | `model_dependent` (Vmax) / `artistic` |
| S10 | **Blowing sand** (saltation) | `airOK`, land, not snow-covered, threshold reachable: `U10_max ≥ U_sand` | High hiss 2–10 kHz plus grain-click events | gain ∝ (U10 − U_sand)³ when positive, else 0; land fraction | `model_dependent` |
| S11 | **Thunder** (event) | §8.2 | §8.4 | §8.4 | §8.2 |
| S12 | **Gas giant roar** | `gas` | Deep band 15–120 Hz plus hiss 300–2000 Hz, baked at `U_ref = m.U`. Slow phaser sweep in the bed (0.05 Hz) | gain ∝ (U/U_ref)²; phaser rate × (1 + 3·stormNear); `vort` sign flips the sweep direction | `model_dependent` (Umeas `measured` on Jupiter and Saturn) |

**Constants in the gates.**
- **`U_wave`:** 0.6 m/s for methane; for water, about 1.5 m/s on Earth [SS §5, verify for water]. Others scale as `U_wave,water · (ν_l/ν_water)^(1/3)` [verify].
- **`m_f` (bubble and foam pitch factor):** `√((P0/ρ_l)/(1.013e5/1000)) · √(γ/1.4) · ((σ_E/ρ_E)/(σ/ρ_l))^(3/5)` [SS §6]; the last factor is the shift of the Deane & Stokes size break (Appendix D R2). Titan works out at 2.0 to 2.7.
- **`U_sand`:** `U10 = 23·u*_t`, with `u*_t = 0.136·√((ρ_p − ρ0)·gv·d_p/ρ0)`. `d_p = 100 µm`; `ρ_p` = 2650 (silicate) or 1000 (methane worlds: organic sand). The constant is calibrated to Earth's u*t of 0.2 m/s.
  - This gives about 0.95 m/s on Mars against 1.5–2 measured, so a cohesion factor 1.8 applies on `CO2`-class worlds [SS W4; verify].

**Refusals shown in the caption** (exact strings):

| Condition | Caption |
|---|---|
| `!airOK` (`P0 < P_FLOOR`, Appendix D R6) | "No air here, so there is no sound." |
| lava world with `P0 < P_FLOOR` (Appendix D R6) | "The magma glows, but with almost no air, it makes no sound you could hear." |
| no liquid (S4–S7; `liquid` as in R13.2, Appendix D R7) | "No liquid can exist on the surface here, so there are no waves, rain or rivers." |
| S2/S3 gate fails | "The air is too thin for small stones to whistle." |
| thunder refused (§8.2) | per §8.2 |

> **Appendix D rulings in this section:** R2 (`m_f`), R3 (`r_max`), R4 (whistle gate per size), R6 (air for sound is `P0 >= P_FLOOR`), R7 (liquid is local), R9 (hurricane sanity), R11 (lightning: only "observed" is `measured`; strike timing and placement are `artistic`). Each is folded into the rows above; the full text is in [R13.11](files-tests.md#r1311-files-tests-constants-and-the-module-contract). Text in [R13.11](files-tests.md#r1311-files-tests-constants-and-the-module-contract).

## R13.6 Weather

#### 8.1 Sources of weather (all engine state; nothing invented)

| Weather | Engine source | Heard as |
|---|---|---|
| Rain | `out2` rain at the listener, phase `rain` | S6 gain |
| Snowfall and snow cover | phase `snow`; `snowCover` | No sound of its own (snowfall is near-silent [SS W5]). Snow **muffles** every ground bed: high shelf above 1 kHz at `−SNOW_DB·max(snowCover, snowFalling)`, with `SNOW_DB = 8` (absorption ≈ 0.85 above 1 kHz) |
| Sea ice | `iceCover` | Surf and sea beds × (1 − iceCover) |
| Wind and gusts | §6.5 | S1–S3 |
| Hurricanes | `EB.cyc` + Vmax | S9, plus the rain boost and the calm eye |
| Convective storms | `cnv` (rocky), `cnvG` (gas) | Lightning and thunder (§8.3–8.4); rain gain + `CNV_RAIN_DB·cnv` (convective rain has larger drops [SS W6]) |
| Gas storms | `stormNear`, `vort` | S12 modulation; lightning on gas giants (§8.3) |
| Sand | §7 S10 | S10 |

Weather changes as the climate simulation runs (`W.playing`). If the user pauses the world, the fields freeze and the sound holds its last state.

#### 8.2 Which worlds may have lightning (and so thunder)
Thunder only where lightning has been observed, or where the analog is strong [SS W2]:

| World | Rule | Tag |
|---|---|---|
| Earth preset, `ref-jupiter`, `ref-saturn` | allowed; lightning is observed (Earth; Jupiter: Juno, Brown et al. 2018, Becker et al. 2020; Saturn: Cassini SED) | occurrence `measured`; rate and placement `artistic` |
| Rocky exoplanet | allowed only if `fluid ∈ {water, ammoniaWater}`, `state==='liquid'`, `airOK`, and `cnv > 0.3` somewhere in the ring (deep mixed-phase convection) | `inferred_from_analog` |
| Gas giant exoplanet | allowed only if `regime ∈ {'Water clouds', 'Ammonia clouds'}` (Jupiter/Saturn-like clouds) | `inferred_from_analog` |
| Methane worlds (Titan-like) | **refused**: "No lightning has ever been detected on Titan, so there is no thunder here." | — |
| `co2` worlds (Venus-, Mars-like) | **refused**: "Lightning on worlds like Venus and Mars is unconfirmed, so there is no thunder here." | — |
| any other | refused: "Lightning needs storm clouds of water or ammonia; there are none here." | — |

> **Appendix D R11:** on preset worlds lightning still needs air and convection. The `measured` tag covers only the fact that lightning is observed on that world; strike timing and placement are `artistic`.

#### 8.3 Lightning rate and placement
- **Rate:** flashes per minute within the audible radius, `λ = LIGHTNING_MAX_PER_MIN · cnv_ring`. `cnv_ring` is the area-weighted mean of `cnv` over the samples (gas: `cnvG`; Jupiter additionally × (|lat| > 40° ? 1 : 0.3) [SS W2]).
- **Schedule:** a seeded Poisson sequence.
  - `rng = rng32(seed ^ 0x5eed7)`; the next interval is `−ln(1−u)/λ`.
  - Drawn on the audio clock while λ > 0.
  - When λ changes, the pending interval is rescaled by λ_old/λ_new, so it stays memoryless.
- **Placement:** a strike at a random bearing and a ground distance `s = R_aud·√u`, uniform over the disc. `R_aud` is where the thunder peak frequency loses 30 dB: solve `α(f_m)·d = 3.45 Np` (30 dB), capped at 25 km.
- **Visual flash:**
  - A host overlay over the fly pane, not engine code: a radial white gradient at the strike bearing, opacity 0.25, 120 ms.
  - At most one flash per 2 s, so never 3 per second (WCAG 2.3.1).
  - Off under `prefers-reduced-motion` and when the "Flashes" toggle is off (default on).
  - The flash is tagged `artistic` and listed in "What is drawn".

#### 8.4 Thunder sound
- **Delay:** `t = d/c(z̄)`, using the mean c along the path. Caption: "Lightning <d> km away" when the flash shows.
- **Spectrum:** peak `f_m = 0.63·c0·√(P0/E_l)` (Few 1969). `E_l` is Earth-typical, chosen so the Earth preset peaks at 200 Hz (Few 1967 averages).
  - Same E_l on other worlds, so f_m scales with `c0·√P0` [SS W1].
  - The source spectrum shape is about 35–40 Hz at the source, rising to the averaged 200 Hz peak; it is modelled as a band-pass at f_m (Q 0.7) plus a 20–60 Hz rumble.
- **Duration:** `min(0.5 + d/(0.12·c0), 35)` s. Thunder rolls longer with distance and is capped at 30–40 s [SS W1].
- **Bake:** 4 thunder variants per world at bake time (2 near cracks, 2 far rolls), 2²⁰ samples each, inverse-FFT noise through an event envelope (Moon's `boom()` corrected). Close strikes (< 1 km) add a crack: a broadband 0.15 s transient.
- **Live:** chosen variant, gain by §11 point-source law, absorption low-pass at d, pan by bearing.

#### 8.5 Weather visuals: an overlay over the fly view (decided 12 Nov; aligns with Moon's PR #101 tickets 3 and 4)

**The surface.** A transparent `<canvas>` (2D context) stacked over the fly engine canvas in `WorldFlyStage`.
- `pointer-events: none` and `aria-hidden`, so it never catches input.
- No engine code changes (`@verbatim` untouched).
- It is drawn by the same hook as the sound (`useWeather`). The sound and the picture read one `WeatherVisualFrame` (Appendix B), so they always agree.

**Rain.** Shown when `precipPhase==='rain'`, `rainRate > 0.05`, and the listener is below the cloud base (`z < zc`, or below 5 km if `zc` is null). From above the clouds, rain is not drawn: the cloud deck hides it.
- **Streak count:** `N = RAIN_STREAKS_MAX · clamp(rainRate/1.5, 0, 1) · (1 + 0.6·cnv)`, capped at 600.
- **Three depth layers** (near, mid, far). Each sets streak size × parallax {1, 0.6, 0.35}.
- **Streak length on screen:** `v_t · (1/60 s)` projected at the layer depth.
  - `v_t` is the §7 S6 terminal velocity (Titan rain falls about 6× slower than Earth's, so it reads as slow and fat).
- **Slant:** `atan(U10/v_t)`, leaning downwind relative to `head`.
- **Tint:** the fluid's liquid colour `FLUIDS[fluid].liq` (engine data), mixed 70% towards a neutral grey so it reads as rain. Methane rain looks amber-brown.
- **Placement:** seeded positions with `rng32(seed ^ frameBucket)`, `frameBucket = floor(t·60)`.
- **Tags:** placement `artistic`; whether it rains, the rate, `v_t` and the slant `model_dependent`.

**Snow.** Shown when `precipPhase==='snow'` and snow is falling (`rainRate > 0.05`).
- Flakes drift at `v = SNOW_FALL_MS` (1 m/s Earth-scale, × √(g_E/gv)) with a seeded lateral wobble. Count rule as for rain, capped at 400.
- Tag: `artistic`.

**Lightning.** On every strike from §8.3:
- **Visible strike:** if the strike's bearing is inside the view (|bearing − head| < fov·aspect/2), draw a bolt.
  - A seeded branching polyline from the cloud base (`zc` km, or 3 km) down to the ground point, projected with `flyCameraBasis()`.
  - 2–4 return strokes 50 ms apart, each 30 ms bright then a 120 ms fade.
  - Plus a cloud glow: a radial gradient at the bolt top, opacity 0.35.
- **Out of view:** only a soft edge glow on the side of the strike.
- **Above the cloud deck:** a glow inside the deck under the listener (flicker seen from above).
- **Colour:** white with a faint blue tint. **Colour is not from data:** the card has no gas composition (PR #101). Tag `artistic`, and "What is drawn" says so.
- **Safety:**
  - At most one strike group (all its strokes) per `FLASH_MIN_GAP_S` = 2 s, so never 3 flashes per second (WCAG 2.3.1).
  - Under `prefers-reduced-motion`, or with the "Flashes" toggle off, the bolt and strokes are replaced by a slow 1 s glow at 0.15 opacity.
- **Timing:** thunder plays `d/c` after the first stroke (§8.4). The caption says "Lightning 6 km away".

**Cyclones.** No extra drawing: the engine already draws the spiral clouds. In the eye, the rain stops (the §6.5 profile drives `rainRate × 0` inside `0.4 Rm`).

**Performance.**
- Overlay draw ≤ 1.0 ms per frame on the main thread.
- No drawing (canvas cleared once) when there is no precipitation and no strike.
- At most 30 fps for the overlay (every other frame) when the fly view runs at 60.
