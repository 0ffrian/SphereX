# Open items [verify]

> **Part of:** Rendering & haptics spec ([index](README.md)) · **Sections:** R12 · **Implements:** [D-17](../decisions/scope-process.md), [Q-110, Q-119](../decisions/contract-tags.md), [Q-63](../decisions/pipeline-stages.md), [Q-132](../decisions/platform-hosting.md), [D-37](../decisions/rendering-engines.md), [Q-326](../decisions/rendering-bodies.md), [Q-329 to Q-331](../decisions/rendering-engines-review.md), [Q-333](../decisions/rendering-kinds.md), [Q-336](../decisions/catalogue-values.md) · **Read with:** [../decisions/README.md](../decisions/README.md), the fragment named in each row

## R12. Open items [verify]

Every **[verify]** marker in the rendering spec has one row here. Numbers 1–18 never change, because code cites "R12 #n"; new items are appended. **When:** "event" items are checked on the A15 before 14 Nov; "after" items wait for phones and vibration (Q-132). Owners follow D-17: Moon for the viewer, Kevin for card values, Atish for the baker, classify and sound (haptics cut, D-39). Rows 7, 8 and 9 are moot after D-39. A constant still marked [verify] may be used only under the Q-110 policy (proposed; upheld by Atish in Q-119): at tier 4 or 5, or at tier 3 once checked against a cited source.

| # | Item | Fragment | Owner | When | Resolved by |
|---|---|---|---|---|---|
| 1 | `WebGPURenderer` fallback to WebGL2 (r187), and which GPU Chrome uses for WebGPU on the A15 (`chrome://gpu`; RTX 3050 or integrated) | R2, R5.5 | Atish (A15), Moon | event; phones after | a `chrome://gpu` report from the A15 and the `gpu-probe.html` report ([R11.4](reference/a15-checks.md)) |
| 2 | Normal map green channel in the viewer: north-facing slopes brighten with light from the north (baker side checked 6 Nov 2026) | R6.5 | Moon | event | a viewer screenshot with a north light (issue #7) |
| 3 | Gemini image model name, aspect ratios, and the REST shape `gemini_paint.py` assumes: base URL `SX_GEMINI_API_URL`, `models/{model}:generateContent` with `x-goog-api-key`, `generationConfig.responseModalities`, `imageConfig.aspectRatio` (only when `SX_GEMINI_ASPECT_RATIO` is set), an `inlineData` part, refusal `finishReason`s. Docs check 9 Nov 2026: `gemini-nano-banana-2.1` exists; 2:1 is not a named ratio; the docs show the newer `/v1beta/interactions` endpoint | R6.6 | Atish, Kevin | event (stretch) | one live call with a key |
| 4 | 3I/ATLAS nucleus size limit and coma radius, with exact citations | R7.3 | Kevin | after (3I/ATLAS is stretch, Q-137) | cited values in the card |
| 5 | Eps Indi Ba/Bb orbit period (~11 yr) and separation; WISE 0855 class details | R7.4 | Moon | event | cited values; no numbers are shown until then |
| 6 | Barnard's Star Teff and radius; RW Aur disc inclination source | R7.5 | Kevin | event | cited values in the card |
| 7 | realme 14 Pro minimum perceptible pulse | R8.7 | Atish | after | calibration on the phone |
| 8 | Any amplitude control for `navigator.vibrate` in Android Chrome (D-09) | R8.1, R8.3 | Atish | after | a test on both phones |
| 9 | Chrome's pattern-length cap, believed about 99 entries | R8.3, R8.8 | Atish | after | a test on both phones |
| 10 | `AudioContext.outputLatency` and the "high latency" threshold (`HIGH_OUTPUT_LATENCY_S` 0.1 s) | R8.9 | Atish | threshold: event (desktop Chrome on the A15); Android support: after | a reading with wired and Bluetooth output |
| 11 | Whether battery saver suppresses vibration on both phones | R8.7 | Atish | after | a test on both phones |
| 12 | **Decided (Q-63, issue #68); the 1.5 and 6 R_E project cuts stay noted as such.** Exoplanet type thresholds for `planet_rocky` / `planet_water` / `gas_giant`: the Q-63 thresholds are in `rules.py` and **on** since issue #68 (Moon signed off on 9 Nov 2026, values checked against their sources) | R3.3 | Moon (decides, D-17 amended), Atish (code) | done (9 Nov) | Moon's sign-off of Q-63 (PR #69) |
| 13 | Whether the pulse-width whisper (`[4, 4, 4, 4, 4]`) is felt as distinct on each phone | R8.3, R8.7 | Atish | after | calibration step 2 on both phones |
| 14 | Gas giant jet pulse rate, clamp(k · \|zonal wind\| / max \|zonal wind\|, 2, 20) Hz (D-12). The channel packing is settled by D-12 | R8.4, R7.7 | Atish | by ear: event; by touch: after | Atish signs off the rate (D-13) |
| 15 | Brown dwarf `flux_45um` normalisation reference (`BROWN_DWARF_CONFIG.flux45Reference`, null): without it `emissive` and `flux_pulse` are refused | R7.4, R8.5 | Moon | event | a cited reference flux |
| 16 | SPHEREx time span for the star proper-motion trail (`STAR_CONFIG.spherexBaselineYears`, null): without it `motion_trail` and the `motion` ticks are refused | R7.5, R8.5 | Moon | event | the span of the object's frames |
| 17 | Which `FLAGS` bit means saturation in the SPHEREx light curve; until known, the viewer excludes any point with non-zero `flags` | R7.5 | Moon | event | the SPHEREx Explanatory Supplement |
| 18 | Mauritius length in the scale bar (~65 km); not offered while `COMPARISONS` holds `null` | R5.4 | Moon | event | a cited length |
| 19 | Shape model scaled so its bounding sphere equals `diameter_km` (Q-43; catalogue diameters are often volume-equivalent). Partly superseded: a loaded model's own size wins (Q-61) | R7.1 | Moon, Kevin | event | one rule on what `diameter_km` means (Q-43) |
| 20 | The comet field pulse's single tag, and whether it plays in Measured only (Q-17) | R7.3, R8.4 | Atish | after (3I/ATLAS is stretch) | Atish answers Q-17 |
| 21 | Brown dwarf cloud types for L (iron, silicate) and Y (water ice), and the Teff boundaries | R7.4 | Moon | event | a cited source |
| 22 | Typical field brown dwarf spin period range (tier 4), and whether eps Indi Ba/Bb have a measured period | R7.4 | Moon | event | a cited range |
| 23 | A `click` is the user activation that unlocks both audio and vibration on the phones (`pointerdown` and `touchstart` are not reliable for audio; Q-73) | R8.9 | Atish | after | a test on both phones |
| 24 | Supernova remnant phase transition times (names on the age slider) | R7.7 | Moon (Q-103) | event | a cited source |
| 25 | Lava glow ramp to full strength at 1500 K (artistic) | R7.7 | Moon | event | Moon signs off the look |
| 26 | Barnard's Star example tiers (each row) | R7.5.1 | Moon (Q-104) | event | Moon decides Q-104 |
| 27 | Granulation cell-size scaling constant and cell lifetime | R7.5.2 | Moon (Q-104) | event | a cited source |
| 28 | Typical differential rotation k by class | R7.5.2 | Moon | event | a cited source |
| 29 | Spot coverage and lifetime by class and activity | R7.5.3 | Moon | event | a cited source |
| 30 | Faculae contrast law | R7.5.4 | Moon | event | a cited source |
| 31 | Typical flare rate by class | R7.5.5 | Moon | event | a cited source |
| 32 | Whether New seed should ask the backend for a new bake (Q-113 item 4) | R5.8 | Moon | event | Moon decides |
| 33 | Audio–vibration offset threshold after calibration | R11 | Atish | after | measured offsets on both phones |
| 34 | Calibration tap-along method (Q-75) | R8.7 | Atish | after | a test on both phones |
| 35 | Audio lookahead (`AUDIO_LOOKAHEAD_S` 0.03 s) | R8.9 | Atish | event | tuned by ear on the A15 |
| 36 | Every `tuning.ts` value marked [verify on phones] | R10 | Atish | after | tuning on both phones |
| 37 | Field recompute at 4 Hz (D-34, Q-68) or storms sampled at t (Q-105, built) | R5.7 | Atish, Moon | event | Atish and Moon answer Q-105 |
| 38 | Star colour method: Planck × CIE 1931 2° in the Wyman, Sloan & Shirley 2013 fit (Q-55 item 9) | R7.5 | Atish | event | a check against a published Teff colour table |
| 39 | Phone auto-pause after 60 s, and the 10% battery target in 15 minutes (D-34) | R5.7 | Moon | after | a test on both phones |
| 40 | Visual findings and frame times on a real GPU (Q-107; Q-104 item 10) | R7.5, R7.7, R11.3 | Moon | event (the A15) | R11.3 results on the A15 |
| 41 | Brown dwarf limb-darkening coefficient `BROWN_DWARF_LIMB_U` 0.6, the visible-band solar value used as an analogue (layer `limb_darkening` at tier 4; near-IR models give about 0.25–0.29 at 3.6 and 4.5 µm, Q-119) | R7.4 | Atish | event | Atish decides whether to adopt a near-IR value (Q-119) |
| 42 | Gas giant typical zonal wind 50 m/s (`TYPICAL_ZONAL_WIND_MS`) in the Rhines band count; `bands` stays tier 4 until it is checked (Q-115, Q-119). Same item as A14.1 | R7.7 (A7.2) | Moon | after | a cited wind speed used in a Rhines estimate |
| 43 | Frame rate of the D-37 engines on the A15: the rock engine, and a planet with both world-engine instances (globe and fly view), against ≥30 fps while rotating at + Artistic (D-05) | R5.9, R5.5, R11 | Atish (A15), Moon | event (before 14 Nov) | R11.3 results on the A15 |
| 44 | Rubble-pile relief: the 35° angle of repose at asteroid gravity, and the 40 km rubble cut (`RUBBLE_BELOW_KM`, the prototype's, no source) (Q-326) | R6.2 | Atish | event | a cited low-gravity repose angle and a source for the cut, or the cut labelled as a choice |
| 45 | Star engine spot temperature fit dT = clamp(350 + 0.6 (Teff − 3300), 200, 2000) K against Berdyugina 2005, fig. 7 (Q-329) | R7.5 | Moon | event | a check against the review's figure |
| 46 | CO₂ enthalpy of vaporisation near the triple point, about 15.3 kJ/mol (NIST Chemistry WebBook) (Q-330) | R7.7 | Moon | event | the NIST page |
| 47 | Saturn's F ring (140,180 to 140,240 km) and Encke Gap (centre 133,584 km) from the PDS Ring-Moon Systems Node table; the measured peak jets of Jupiter (about 150 m/s) and Saturn (about 450 m/s) (Q-331) | R7.7 | Moon | event | the PDS table and the cited wind papers |
| 48 | Millibar rock-vapour atmospheres of lava worlds (Schaefer and Fegley 2009; Ito et al. 2015), the ground for the lava-world rule (Q-330) | R7.7 | Moon | event | the two papers |
| 49 | Procyon A's radius 2.048 ± 0.025 R☉: the exact table in Kervella et al. 2004, A&A 413, 251 (Q-336) | R7.5 | Kevin | event | the paper's table |
| 50 | Haser constants for water: v = 0.85 r_h^−0.5 km/s (Cochran and Schleicher 1993) and τ = 8.3 × 10⁴ s × r_h² (Huebner, Keady and Lyon 1992) (Q-333) | R7.3 | Moon | event | the two papers |
| 51 | Liquids table: methane, N₂, CO₂ and ammonia-water densities and surface tensions (NIST); basalt density | R13.3 | Atish | event | NIST tables |
| 52 | γ for water vapour and H₂/He at 100–170 K; H₂/He transport properties | R13.3 | Atish | event | cited tables |
| 53 | CO₂ absorption between Mars and Venus (Gillier et al. 2024 table; Petculescu 2016) | R13.3 | Atish | event | the two papers |
| 54 | Wave threshold over water; viscosity scaling of `U_wave` | R13.5 | Atish | event | a cited source |
| 55 | Gust factors and integral time; hill speed-up (Jackson & Hunt 1975) | R13.4 | Atish | event | the papers |
| 56 | Bolin & Åbom surf spectrum shape (paywalled) | R13.5 | Atish | event | the paper |
| 57 | Mars saltation cohesion factor | R13.5 | Atish | event | a cited source |
| 58 | Nystuen rain-rate coefficients (if used for finer rain levels); Titan raindrop size spread 4.75 to 6.6 mm (Appendix D R3) | R13.5 | Atish | event | the papers |
| 59 | Whether `hM` (lava sea height) is reachable from the `WorldEngine` wrapper | R13.4 | Atish | event | reading the engine |
| 60 | Bake time and memory on the A15 (measured) | R13.7 | Atish | event | a timing log on the A15 |
| 61 | Harmonic branch (+18 dB drive, tanh(3x), −12 dB mix) heard through the A15 speakers and the venue PA; the 35 Hz ambience high-pass and the −3 dB limiter by ear | R13.9 | Atish | event | a listening check with `sound-check.html` (#116) |
| 62 | Spectrum chord ISO 226:2003 table (`sound/iso226.ts`, rows 200–1250 Hz, copied from Tackett's `iso226.m`) against the standard | R13.12 | Atish | event | ISO 226:2003 Table 1 |
| 63 | Spectrum chord by ear on the A15 (and the venue PA): −18 dBFS RMS level against the sweep (no jump on Sweep ↔ Chord), the +6 dB ISO cap and roughness of the two lowest notes, no click on start, stop or A/B, the lowest notes present, the limiter quiet; render time of one chord (two 6 s loops) on the A15 under 100 ms | R13.12 | Atish | event | a listening check and a timing log |

**Removed (resolved):** the "name [verify]" markers on `viewer/renderers/ShaderBody.ts` and `viewer/fields/fieldWorker.ts` (both files exist), and the self-signed certificate step for phones (moot for the event, Q-132; R11.3 keeps the phone procedure for after the event).
