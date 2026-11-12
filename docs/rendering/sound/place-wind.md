# Sound: listener, place sampling and wind

> **Part of:** Rendering & sound spec ([index](../README.md)) · **Sections:** R13.4 · **Implements:** [Q-431, Q-434, Q-435](../../decisions/sound-ambience.md) · **Read with:** [inputs-air.md](inputs-air.md) (R13.2, R13.3), [sources-weather.md](sources-weather.md) (R13.5)

## R13.4 Listener, place sampling and wind

### The listener

1. **Quasi-static time-lapse listener.** The fly camera moves at `max(0.4·alt, 4)` km/s on auto (`tickNow`) and 0.8·alt per key press. That is supersonic everywhere: at 5 km/s, sources ahead would shift by about 4 octaves, and sources behind would never be heard [SP §4]. So:
   - **No Doppler shift.**
   - **No flight noise:** no airframe, no rush of air from the camera's own motion.
   - **Hovering:** the listener hears the place as if hovering there. The scene changes at the speed the camera crosses it.
   - **Label:** the "How this works" text says this (§12.4).
2. **Height above ground.** The listener height is `alt` km above the drawn ground. The fly view draws relief 3× exaggerated (`flyCamera` `ex = 3`), and `alt` is measured from that drawn surface, so the ear stays where the eye is.
3. **Facing.** The listener faces `head`; pitch is ignored for sound.
4. **Wind at the listener.** Local wind noise is the wind blowing past a stationary listener at height `z` (§6.5).

### Sampling the place around the listener

#### 6.1 Height that matches the picture: port `hKm`
- **The problem.** The fly view's surface height is not the raw 720×360 grid. `FLY_FS hKm(d)` reads it through a fine noise warp and Catmull-Rom filtering, then adds ridge, slope-damped fBm and fBm detail, clamped at sea level on ocean worlds (`shaders.js` L259-266).
- **The port.** `engine/worlds/flyHeight.ts` holds a line-by-line TypeScript port of:
  - `h33`, `vn`, `fbm`, `ridge` and `vnd`/`efbm`;
  - the warp, using `uSeed3 = seedVec(seed)` for card worlds (`(seed, seed, seed)` for presets);
  - `hKm`.
- **Precision.** It uses `Math.fround` after every arithmetic step inside `h33` and `vn`, so it follows GLSL `highp` float32.
- **The raw grid** is sampled with the existing `fieldSampler.ts` Catmull-Rom helper, the same filter the fly view uses (#93 2.7).
- **Lava worlds:** the `uLava`/`uHM` branch is ported too. It needs `hM` from the lava raster [verify the field is reachable; if not, treat lava-sea cells by hydro R > 0.5].
- **Parity test.** Render `hKm` for 64 fixed directions to a float target (headless GL harness, `glStub`/`coreHarness`). The CPU value must match within 0.02 km RMS and 0.1 km at most. If WebGL2 is unavailable in CI, the test skips with a logged reason and runs locally.

#### 6.2 Sample pattern
- **Reach.** `R = clamp(4·z + 2, 2, 400)` km.
- **Points.** One centre sample, plus 3 rings × 12 bearings at radii `{0.25, 0.5, 1}·R`. That is 37 samples. Bearings start at `head` and step by 30°.
- **Area weight.** Each sample carries the area of its annular sector:
  - centre disc radius `0.125R`;
  - ring k from midpoint to midpoint (`0.125–0.375R`, `0.375–0.75R`, `0.75–1.25R`), divided by 12.
- **Position on the sphere.** A sample at ground distance s, bearing b is the destination of the great circle from (lon, lat) with angular distance `s/R_planet`.
- **Slant distance.** `d = √(z² + s²)` in metres. The centre sample uses `d = max(z, D_MIN)`.

#### 6.3 Class of each sample (rocky worlds)
Rules in priority order:
1. **`lava` / `crust`:** lava world and hydro R ≥ 128 → `lava`; hydro G ≥ 128 → `crust`.
2. **`ice`:** sea cell with `iceH > 0.02` (the engine's ice threshold in `ebStats`).
3. **`sea`:** ocean world (`OCEANF > 0`) and `hKm ≤ 0.001`, or `hydro A < 128 && R ≥ 128` on a basin cell → `lake`.
4. **`river`:** hydro R ≥ 128 on land (and A < 128); frozen if A ≥ 128 → `land`.
5. **`land`:** otherwise.
- **Coast zone.** A sample is in the coast zone when its class is `sea` and any neighbouring sample is `land`/`ice`, or the reverse. The neighbours are the adjacent bearing on the same ring and the same bearing on the adjacent ring.

#### 6.4 Features (pure function `placeFeatures(samples, weather, model)`, run at 10 Hz)

| Feature | Formula |
|---|---|
| `relief` | standard deviation of `hKm` over samples (km) |
| `exposure` | `clamp((h_centre − mean_ring1)/max(relief, 0.05), −1, 1)` |
| `slope` | centre gradient magnitude by central differences of `hKm` at ±0.5 km (dimensionless) |
| `snowCover` | B-spline of `snow` at centre: `1 − exp(−s/0.05)` (the engine's `fs`) |
| `iceCover` | B-spline of `iceH` at centre: `1 − exp(−h/0.15)` (the engine's `ic`) |
| `rainRate` | B-spline of `out2[·*4]` at centre, clamped 0..3 (normalised rain) |
| `RH` | B-spline of `out[·*4+3]` at centre |
| `Tloc` | B-spline climate `T` at centre, minus `gamK·hKm_centre` |
| `cnv` (convective storm) | `smoothstep(Tt+12, Tt+28, Tloc) · smoothstep(0.6, 1.0, RH)`: the fly shader's rule (`shaders.js` L193) without its sub-cell noise |
| `precipPhase` | `snow` if `Tloc < Tf` (`Tf = Tt − 1.9` for water, else `Tt`), else `rain`. The engine's own rule in `ebStep` |
| `cyclone` | nearest `EB.cyc` entry: angular distance δ, storm radius `r` (rad), sign `s` |

#### 6.5 Wind at the listener (rocky worlds): a planetary wind model (decided 12 Nov: "the user should experience the different worlds")
The engine gives a global wind scale `m.U` (thermal wind, jet-scale), the Hadley-cell edge `phiH`, the rotation rate `Om`, the locked and 3:2 flags, and climate temperature per cell. It has no wind field. The model below is built only from those. It gives each world its own wind map, and the listener hears where they are in it. Function `windAt(air, lon, lat, place)` in `wind.ts` returns `{U10, dirDeg, parts}` (pure).

1. **Surface scale:** `U_s = K_SURF · m.U`.
   - `K_SURF = 0.105`, calibrated so the `earth` preset gives about 7 m/s at 10 m (m.U ≈ 66.8 m/s).
   - Tag: `inferred_from_analog`.
2. **Planetary circulation pattern** (`pat`, 0..1, with a direction).
   - **Rotating worlds** (`!locked || res32`): three cells with the engine's Hadley edge `φH = phiH` (Held & Hou 1980 scaling, core.js L163; the same edge `ebStep` uses for its wind sign). With `φ = |lat|`:
     - **Trades**, `φ < φH`: `pat = A_T·sin(π φ/φH)`. Direction from the east and towards the equator (from the NE in the north, from the SE in the south). Calm "doldrums" at the equator; calm "horse latitudes" at φH.
     - **Westerlies**, `φH ≤ φ < min(2φH, 1.45)`: `pat = A_W·sin(π (φ−φH)/φH)`. Direction from the west and towards the pole. The strongest band: the "roaring forties" analog.
     - **Polar easterlies**, beyond: `pat = A_P·sin(π·clamp((φ − 2φH)/(π/2 − 2φH), 0, 1))`.
     - Constants: `A_T = 0.7`, `A_W = 1.0`, `A_P = 0.4`.
     - **What this gives:** a slow rotator has a wide φH (the engine clamps it to 1.3 rad), so gentle trades cover almost the whole world. A fast rotator has a narrow φH, so the bands are tight and the westerlies strong.
   - **Tidally locked worlds** (`locked && !res32`): surface flow converges on the substellar point (Joshi et al. 1997; Merlis & Schneider 2010 [verify]).
     - `θ` = angle between the listener's up vector and the substellar direction.
     - The substellar direction is computed exactly as `ebStep` does: `L = normalize([-0.74, 0.34, 0.58])` rotated about x by 0.12 rad, giving `(sx, sy, sz)`.
     - `pat = A_L·sin θ`, with `A_L = 1.2`. Strongest at the terminator, calm at the substellar point, near-calm deep on the night side.
     - Direction: along the great circle towards the substellar point.
   - Tag: `model_dependent`.
3. **Sea and land breeze** (any world with a coast in the ring).
   - `ΔT = |mean T(land samples) − mean T(sea samples)|` from the climate grid (B-spline).
   - `U_br = K_BR·√(gv · H_BL · ΔT / Tloc)`: the gravity-current speed of a sea breeze front (Simpson 1994 [verify]).
   - `K_BR = 0.4`, `H_BL = 500` m. Faded by `exp(−s_coast/20 km)`, where `s_coast` is the ground distance to the nearest coast-zone sample.
   - Direction: towards the warmer side.
   - Tag: `model_dependent`.
4. **Combine:** `U10 = |U_s·pat·d̂_pat + U_br·d̂_br|` (vector sum), at least `U_MIN = 0.3` m/s where `airOK`.
5. **Terrain speed-up and shelter:** `U10 *= 1 + SPEEDUP·max(exposure, 0)·min(relief/1.0, 1) − SHELTER·max(−exposure, 0)`.
   - `SPEEDUP = 0.8`, `SHELTER = 0.4`: hill speed-up ΔS ≈ 2h/L (Jackson & Hunt 1975 [verify]), capped.
   - Tag: `model_dependent`.
6. **What each world sounds like through this model** (an emergent result, not hard-coded; a test checks the order):
   - Earth-like: calm doldrums, steady trades, gusty westerlies.
   - Locked worlds (TRAPPIST-1 e, K2-18 b): gales at the terminator, calm under the star.
   - Mars-like: strong wind by speed but thin and quiet (§11.3).
   - Titan-like: m.U is small, so gentle wind, but the dense air makes it loud and the surf high-pitched.
   - Ocean worlds: no breeze term; sea wind only.
   - Hurricane worlds: the item 7 storms.
7. **Cyclone.** If `δ < 3r`:
   - Modified Rankine profile with `Rm = 0.15 r`.
   - Inside (`δ < Rm`): `V = Vmax·δ/Rm`. Outside: `V = Vmax·(Rm/δ)^0.5`.
   - The eye is the region `δ < 0.4 Rm`, where V is near zero (calm).
   - Combine: `U10 = max(U10, V)`.
   - `Vmax` is the engine's own formula (core.js `worldUi`): `√(0.9·(T_max − 200)/200 · 2.5e6 · q_st · 0.2)`, with `q_st = 0.622·psat(T_max)/(Ps·1e5)`.
   - It applies only when the engine itself would show "Strongest hurricane possible": water fluid, `stats.max > 299.65`, and cyclones present.
   - Tag: `model_dependent`.
8. **Height:** `U(z) = U10 · ln(z_m/z0)/ln(10/z0)` for `z_m ≤ 1000` m.
   - `z0` = 2e-4 m over sea, 0.03 m over land (log law).
   - Above 1 km: `U(z) = U(1 km) + (m.U − U(1 km))·clamp((z − 1)/Z_JET, 0, 1)`, with `Z_JET = 10·(H/8.5)` km.
9. **Turbulence intensity:** `I_u = 1/ln(z_m/z0)`, at least 0.05 [SS §3].
10. **Caption direction:** the 8-point compass direction the wind comes from (`dirDeg`), e.g. "steady trade wind from the north-east". The parts with the largest share name the wind: trade, westerly, polar, terminator gale, sea breeze, land breeze, hurricane.

#### 6.6 Gas giants
- **No surface classes.**
- **Wind:** `U = |m.U · prof.u(lat)|` (jet at the listener's latitude).
- **Storms:**
  - `storm = gasField[(j·256+i)·4+3]` at the listener cell;
  - `vort = gasField[...+2]`;
  - `stormNear` is the maximum of the storm stamp over the 37 samples, each weighted by `exp(−(s/R)²)`.
- **Convection** for lightning (§8.3): `cnvG = clamp(stormNear, 0, 1)`.

> **Appendix D, contract amendment 3 (the local frame):** every ticket uses the engine's own basis, as `core.js` `flyCamera`: `up = [cos lat · cos lon, sin lat, cos lat · sin lon]`, `east = normalize(cross([0, 1, 0], up))`, `north = cross(up, east)`. Bearings are clockwise from `north` towards `east`, matching `fly.head`; pan is `+` to the right of `head`. Any other basis is a bug.
