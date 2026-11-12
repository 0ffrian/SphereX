# Sound: inputs and air physics

> **Part of:** Rendering & sound spec ([index](../README.md)) · **Sections:** R13.2, R13.3 · **Implements:** [Q-432, Q-433](../../decisions/sound-ambience.md) · **Read with:** [overview.md](overview.md) (R13.1), [place-wind.md](place-wind.md) (R13.4)

## R13.2 Inputs: every value, its source, its tag

All engine values come from the fly engine instance (`useWorldStore.getState().fly`), not the globe. The fly view draws the fly engine.

#### 3.1 From the engine (read-only)

| Symbol | Source | Units | Tag |
|---|---|---|---|
| `Ps` | `engine.state().Ps` | bar | `world.tags.Ps` (card tag, or `inferred_from_analog`/`model_dependent`) |
| `fluid` | `engine.state().fluid` (`FluidKey`) | — | `world.tags.fluid`, or `model_dependent` if assumed |
| `gas` | `engine.state().gas` | — | `derived` |
| `mu` | `world.preset.mu` | g/mol | `model_dependent` (assumed in `cardToWorld`) |
| `Ts`, `Teq`, `gv`, `H`, `U`, `phiH`, `Om`, `airless`, `state`, `canLiquid`, `Tb`, `zc`, `cov`, `runaway`, `haze`, `regime`, `jets`, `gamK`, `Tpost`, `F` (fluid table: `Tt`, `Tc`, `Pc`, `q`) | `engine.readouts().model` (core `worldModel()`) | K, m/s², m, m/s, rad, … | `model_dependent` (`readouts().provenance`) |
| Terrain grid | `engine.cpuFields().terrain`: 720×360, channel 0 elevation km (sea level 0 on ocean worlds), stride 2. **Row 0 = south pole; column 0 = lon −π.** | km | `artistic` (procedural) |
| Climate grid | `cpuFields().climate`: 180×90: `T` (K), `rain` (engine units), `land` (Uint8), `elev`, `stats` {mean, max, min, ocean, ice, liquid, frost}. Row 0 = south. | | `model_dependent` |
| Hydro raster | `cpuFields().hydro`: `img` RGBA8 2048×1024, `lava` flag. Non-lava: R river/lake water, G salt flat, B delta plume, A frozen water. Lava: R liquid lava, G crust island, B cooling (0 vent → 1 crusted), A vent. Row 0 = south. | 0–255 | `artistic` |
| Weather extras (new accessor, §3.3) | `EB.h` (sea-ice thickness), `EB.s` (snow/frost), `EB.out` (4 per cell: T, smoothed ice, smoothed frost, **relative humidity** in channel 3), `EB.out2` (4 per cell: **normalised rain**, wind speed, u, v of the *ocean currents*), `EB.cyc` (cyclones: lon, lat, r rad, s), `EB.rainMax` | | `model_dependent` |
| Gas field (giants) | `core.getGS().exportField(false)`: 256×128×4 = [u, v, vorticity, storm stamp]. Row 0 = south; column 0 = lon −π. | normalised | `model_dependent` |
| Gas zonal profile | `gasProfile(m, preset).u(lat)` from `engine/worlds/gas.js` (a pure, exported function), normalised to −1..1 | — | `model_dependent`, or `measured` for Jupiter and Saturn (`tags.Umeas`) |
| Fly camera | `engine.fly`: `alt` (km above the *drawn* ground), `lon`, `lat` (rad; lon = atan2(z, x), lat = asin(y)), `head` (rad clockwise from north), `pitch`, `auto` | | — |
| Altitude range | `engine.altRange()`: rocky [0.3, 3000] km; gas [50, 80 000] km | km | — |
| Seed | `world.preset.seed` (32-bit hash of the card id) | — | `artistic` |
| Planet radius | `preset.Rj × 71 492` | km | card tag |

**Not available, and handled explicitly:**
- **No per-cell wind field on rocky worlds.** `EB.u`/`v` are ocean gyres. Wind is derived in §6.5.
- **No dust storms, hail or ice-cracking in the engine.** These are out of scope (§18).

#### 3.2 Values derived once per world (at bake time, and again when §9.6 triggers)

| Symbol | Formula | Tag |
|---|---|---|
| `T0` (surface air temperature for acoustics) | Rocky: `Ts`. Gas: `Ts`, the cloud-top value | `model_dependent` |
| `P0` (Pa at the reference level) | Rocky: `Ps × 1e5`. Gas: `1e4` (the engine's `Pref` for giants) | as `Ps` / `model_dependent` |
| `H` (scale height, km) | `m.H / 1000` | `model_dependent` |
| Composition class | `fluid==='co2' \|\| mu>=40` → `CO2`; `mu<4` → `H2`; otherwise → `N2` (includes water-rich mu 18, flagged) | `inferred_from_analog` |
| `γ` | Class table §4.2 | `inferred_from_analog` |
| `c0 = √(γ R T0 / M)` (R = 8.314, M = mu/1000) | — | `derived` from inputs |
| `ρ0 = P0 M / (R T0)` | — | `derived` |
| `Z0 = ρ0 c0` | — | `derived` |
| `airOK` | `P0 >= P_FLOOR` (rocky); `true` (gas). The engine's climate `airless` flag does not gate sound (Appendix D R6) | — |
| `liquid` | `!gas && model.canLiquid && (state==='liquid' \|\| climate stats.liquid > 0) && fluid ∈ liquids table (§4.4)`; open water on the day side of a locked world counts even when the global state is "frozen" (Appendix D R7, as amended 12 Nov). A lava world (`Ts > 700`, `hydro.lava`) uses lava | as `fluid` |

#### 3.3 New read-only accessors (wrapper only; no `@verbatim` code changes)

Add these to `engine/worlds/WorldEngine.ts`, beside `cpuFields()`:

```ts
/** Weather arrays for sound (references; do not write). */
weatherFields(): {
  NX: number; NY: number;
  iceH: Float32Array;    // EB.h, sea-ice thickness (engine units)
  snow: Float32Array;    // EB.s, frost/snow on land
  out: Float32Array;     // EB.out: [T, smoothed ice, smoothed frost, RH] per cell
  out2: Float32Array;    // EB.out2: [rain/rainMax, current speed, u, v] per cell
  cyclones: { lon: number; lat: number; r: number; s: number }[]; // EB.cyc (copy of the array)
} | null;              // null until EB.ready
gasField(): Float32Array | null; // core.getGS()?.exportField(false) ?? null
groundKm(lon: number, lat: number): number; // core.groundKm
/** Fly camera basis for the weather overlay (§8.5): core.flyCamera(m, 0, 0, [0,0,1]) → {uCam, uFwd, uRt, uUp, rkm, ex}; fov 0.62 (core). */
flyCameraBasis(): { cam: [number, number, number]; fwd: [number, number, number]; rt: [number, number, number]; up: [number, number, number]; rkm: number; ex: number; fov: number } | null;
```

**Why `exportField(false)` is safe to call.** It rewrites its own `out` buffer completely from the current simulation state: channel 3 is zeroed, then stamped. `redInit=false` stamps nothing else. A call between two simulation steps therefore yields exactly what the next GL upload would hold. Call it at most every `GAS_FIELD_MS` (500 ms).

> **Appendix D, R6 (acoustic air is not the engine's "airless"):** `airOK` is `P0 >= P_FLOOR` (1 Pa) on rocky worlds and always true on gas giants; the engine's `airless` flag (Ps < 0.02 bar) is a climate threshold and no longer gates sound. Liquids, rain and surf still follow the engine's own fields. Text in [R13.11](files-tests.md#r1311-files-tests-constants-and-the-module-contract).

> **Appendix D, R5 (Mars impedance anchor):** `Z` is tested for self-consistency (`ρ·c` from the inputs); Mars-like air (600 Pa, 210 K, mu 43.3) must give Z in [3.3, 4.8]; ground-source level against Earth −20 ± 2 dB. See [R13.11](files-tests.md#r1311-files-tests-constants-and-the-module-contract).

## R13.3 Air physics

#### 4.1 Pressure, temperature and density with height
The listener is at height `z` km above the drawn ground (`engine.fly.alt`). For acoustics, the height above the reference level is `z` (rocky) or `z` above the cloud deck (gas).
- `P(z) = P0 · exp(−z/H)`. The atmosphere is treated as isothermal for the pressure profile, which matches the engine's single scale height.
- `T(z) = max(T0 − gamK·z, 0.6·T0)`. `gamK` is in K/km and the floor stops a negative temperature.
- `ρ(z) = P(z) M / (R T(z))`; `c(z) = √(γ R T(z)/M)`; `Z(z) = ρ(z) c(z)`.
- **Silence ceiling:** if `P(z) < P_FLOOR` (1 Pa), nothing is heard at all. [PA Q7]: classical absorption alone removes 1 kHz within about 1 m below about 1.9 Pa.
  - Caption: "Too high: the air here is too thin to carry sound."
  - Examples: Earth ≈ 97 km; Mars ≈ 70 km; Jupiter (H ≈ 27 km from 0.1 bar) ≈ 250 km. The floor is a constant; the heights follow from it.

#### 4.2 γ by class [PA Q4]

| Class | γ | Note |
|---|---|---|
| `N2` (N₂ or air, mu 25–35) | 1.40 | |
| `N2` with mu < 25 (water-rich, e.g. mu 18) | 1.33 | water vapour [verify NIST] |
| `CO2` | 1.29 at T ≥ 250 K; 9/7 = 1.286 below the relaxation frequency, 7/5 above | Maurice 2022. Sound speed uses 1.29; Mars's two speeds of sound are a caption fact (§12.3) |
| `H2` (H₂/He) | 1.43 | [derived, verify ortho/para at T < 170 K] |
| Rock vapour (lava world, mu 44 assumed) | 1.4 | Its 0.005 bar (about 500 Pa) is above `P_FLOOR`, so a lava world has faint wind, lava roar and vents, labelled with the assumed atmosphere (`inferred_from_analog`; Appendix D R6) |

#### 4.3 Absorption α(f), in Np/m, by class [PA Q3, Petculescu & Lueptow 2007]

`α(f, P, T)` is evaluated at the path's mean pressure (§11.2).

**`N2` class: ISO 9613-1, as published.**
- RH is assumed 50% and tagged `inferred_from_analog`.
- `pa = P`, and `T` as given.
- Convert dB/m to Np/m by dividing by 8.686.
- **Check against Titan** (94 K, 1.5 bar, 15 kHz): the relaxation terms vanish and the formula gives 0.0136 dB/m. Petculescu & Lueptow give 0.014 dB/m. One law serves both Earth and Titan.

**`CO2` class: classical term plus one relaxation, anchored on two measured worlds.**
- **Thin end (Mars):** `α_thin(f) = a_cl · f² · (600/P) · √(T/210) + α∞ · x²/(1+x²)`, with:
  - `x = f / f_r` and `f_r = 240 Hz · (P/600)`;
  - `α∞ = 0.18 · (P/600)` Np/m;
  - `a_cl = 1.7e-9` Np m⁻¹ Hz⁻².
  - **Check:** this reproduces Maurice 2022 at 3–6, 6–11 and 11–15 kHz within its 95% intervals, and Petculescu & Lueptow at 15 kHz (3.5 dB/m).
- **Thick end (Venus):** a power law through Petculescu & Lueptow's two values, `α(100 Hz) = 4.645e-4` and `α(15 kHz) = 0.18` Np/m (1.58 dB/m): `α_thick(f) = 4.645e-4 · (f/100)^1.19`.
- **In between:** interpolate in log α against log P between the thin end at `P ≤ 600 Pa` and the thick end at `P ≥ 9.2e6 Pa`.
  - Tag: `model_dependent`.
  - **[verify]** with the Gillier et al. 2024 table (Zenodo 10992306) and Petculescu 2016 (JASA 140:1439).

**`H2` class: classical (Stokes–Kirchhoff) only.**
- `α(f) = (2π² f² / (ρ c³)) · [4/3·μ_v + (γ−1)·κ/c_p]`.
- H₂/He properties: `μ_v = 6e-6 · (T/150)^0.7` Pa·s, `κ = 0.12 · (T/150)^0.8` W m⁻¹ K⁻¹, `c_p = 1.43e4` J kg⁻¹ K⁻¹. All **[verify NIST]**.

`α` is computed with `absorption(f, P, T, cls)` in `air.ts`, a pure function with unit tests at the anchor points above.

#### 4.4 Liquids table [SS §11]

| `fluid` | ρ_l (kg/m³) | σ (N/m) | Viscosity class | Note |
|---|---|---|---|---|
| `water` | 998 | 0.0728 | low | |
| `methane` | 450 [verify] | 0.0178 | low | 94 K |
| `ammonia` | 682 | 0.032 | low | 240 K |
| `ammoniaWater` | 850 [verify] | 0.05 [verify] | low | mix; marked |
| `nitrogen` | 807 [verify] | 0.0089 [verify] | low | 77 K |
| `co2` | 1178 [verify] | 0.017 [verify] | low | at the triple point; σ → 0 at 304 K |
| lava (basalt) | 2650 [verify] | 0.36 | **high**: bubbles do not ring [SS §10] | |
