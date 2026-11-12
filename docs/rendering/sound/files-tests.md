# Sound: files, tests, constants and the module contract

> **Part of:** Rendering & sound spec ([index](../README.md)) · **Sections:** R13.11 · **Implements:** [Q-433 to Q-444](../../decisions/sound-ambience.md) · **Read with:** [overview.md](overview.md) (R13.1), [layout.md](../layout.md) (R10)

## R13.11 Files, tests, constants and the module contract

### Files

Decided 12 Nov: `frontend/src/haptics/` is deleted in the restructure PR. The audio code moves to `frontend/src/sound/` (audioContext, audioGraph, drivers/audio → `sound/voices.ts`, pitch, spectrumMapping, listenSweep, settings → sound settings, tuning → sound tuning), keeping git history with `git mv`.

```
frontend/src/sound/ambience/
  types.ts          Appendix B contract, exactly as written there (shared by every ticket)
  tuning.ts         every §17 constant for the ambience (keeps it apart from sound/tuning.ts)
  wind.ts           §6.5 planetary wind model
  air.ts            §4: class, γ, c, ρ, Z, P(z), T(z), absorption(f,P,T,cls)
  liquids.ts        §4.4 table
  airModel.ts       §3 inputs → AirModel (+ tags, refusals)
  flyHeight.ts      §6.1 hKm port (fround)            [engine/worlds/ if preferred]
  place.ts          §6.2–6.6 samples, classes, features, wind
  sources.ts        §7 gates + bake parameters per bed
  weather.ts        §8 lightning rules, rate, schedule, thunder parameters
  bake.worker.ts    §9 DSP (Moon's, corrected)
  palette.ts        worker client, cache, priority, budgets
  levels.ts         §11 area integral, filters, world scaling, presentation
  mixer.ts          §10 graph and per-tick application
  captions.ts       §12 phrases
  useAmbience.ts    §10/13 hook (mounted in WorldFlyStage)
  (useWeather.ts)   not built: the overlay subscribes to weatherBus directly (#117)
  weatherBus.ts     §8.5 the 10 Hz weather snapshot and the strike events (#116 publishes, #117 reads; Q-449)
  flashGate.ts      §8.5 flash safety: the strike gate and the stroke, group and safe envelopes (#117)
  weatherDraw.ts    §8.5 overlay geometry: particles, lean, the drawn deck, near-plane clipping, bolt (#117)
  ui/SoundChip.tsx, ui/WhatYouHear.tsx, ui/WeatherOverlay.tsx (rain, snow, bolts, glow, the weather caption),
  ui/WeatherDrawnRows.tsx ("What is drawn" weather rows from weatherRows)
frontend/sound-check.html + src/soundCheck/   §11.7 dev page (excluded from dist by scripts/check-dist.js)
engine/worlds/WorldEngine.ts   + weatherFields(), gasField(), groundKm(), flyCameraBasis()   (§3.3)
engine/worlds/flyHeight.ts     §6.1 hKm port
sound/audioGraph.ts            + getBus('ambience'|'events'|'spectrum'), ducking, 35 Hz HPF and harmonic branch on ambience (§11.7)
sound/settings.ts              + ambienceOn, ambienceVolume, flashesOn, readCaptions (hapticsOn removed)
```

**As built in #116** ([Q-448](../../decisions/sound-ambience.md)), in `frontend/src/sound/ambience/` unless a path is given:

| File | What it holds |
|---|---|
| `mixer.ts` | the §10 graph |
| `ambienceState.ts` | the §13 reducer |
| `ambienceLoop.ts` | the per-tick pipeline |
| `ambienceHolder.ts` | the palette and mixer, kept for 2 minutes |
| `ambienceStore.ts` | the UI model |
| `useAmbience.ts` | the hook |
| `weatherBus.ts` | the WeatherVisualFrame shared with #117, which replaces the planned `useWeather` sharing |
| `ui/SoundChip.tsx`, `ui/WhatYouHear.tsx` | the chip and the panel |
| `frontend/sound-check.html`, `frontend/src/soundCheck/` | the sound-check page |

### Tests (Vitest; FakeAudioContext; no network)

1. **`air.ts`:**
   - Earth `c` within 1% of 340 m/s, `ρ` 1.2.
   - Mars `Z` self-consistent (`ρ·c` from the inputs): Mars-like air (600 Pa, 210 K, mu 43.3) gives Z in [3.3, 4.8]; ground-source level −20 ± 2 dB against Earth (Appendix D R5).
   - Titan α(15 kHz) within 10% of 0.014 dB/m.
   - Mars α at 4.5, 8.5 and 13 kHz inside Maurice's 95% intervals.
   - Venus α(100 Hz) and α(15 kHz) match the anchors.
   - P(z) ceiling heights (Earth about 97 km).
2. **`airModel.ts`:**
   - Refusals: `P0 < P_FLOOR` (1 Pa) → no air; `Ps = 0.005` bar (Mars-like, lava rock vapour) has air for sound (Appendix D R6).
   - `fluid` with no liquid state → no S4–S7.
   - Each tag passes through.
3. **`flyHeight.ts`:**
   - GLSL parity (§6.1).
   - Determinism.
   - Ocean clamp.
4. **`place.ts`:**
   - Row/column conventions: a grid with a single hot cell at the south-pole row maps to lat −π/2.
   - Classes on synthetic grids.
   - Exposure sign (ridge +, valley −).
   - The cyclone profile has a calm eye and peaks at Rm.
   - The wind log law is monotone in z.
5. **`sources.ts`:**
   - The Re gate per size on Mars-like air at 8 m/s: the 4 mm hiss is removed, the 6 mm tone survives with St ≈ 0.15; the refusal caption appears only when every size is gated out (Appendix D R4).
   - Roshko St at Re 100.
   - Titan `m_f` between 2.0 and 2.7 (Appendix D R2).
   - Titan rain: `r_max` between 4.75 mm (Lorenz 1993) and 6.6 mm (the scaling) [verify]; the fall speed is tested only for consistency with the drop size (Appendix D R3).
   - Earth rain 3.25 mm, 9.2 m/s ±10%.
6. **`weather.ts`:**
   - The lightning rule table (every row).
   - Poisson schedule determinism.
   - Rate rescaling.
   - Thunder f_m scales with `c0√P0`.
   - R_aud cap.
   - Flash limiter: no 2 flashes within 2 s.
7. **`bake.worker.ts`:**
   - The same seed and inputs give the same SHA-256 of the Float32 output.
   - The loop is seamless: the RMS of a 256-sample window across the wrap equals the windows either side ±1 dB.
   - Gust spectrum slope −5/3 ± 0.2 (log-log fit).
8. **`levels.ts`:**
   - Monotone: nearer coast → louder surf; higher z → quieter ground beds.
   - Infinite-sea level is flat ±1 dB from 2 m to 300 m on Earth at low frequency.
   - The presentation offset round-trips into the caption text.
9. **`mixer.ts` (FakeAudioContext):**
   - The node graph per bed.
   - Fades on every Fading trigger.
   - Ducking.
   - No node is created per tick.
10. **UI:**
    - Chip, panel, captions and a11y attributes.
    - The live-region throttle.
    - Reduced motion → no flash.
11. **Guards:**
    - `layout.test.ts` paths updated.
    - The `@verbatim` parity check still passes (no engine core edits).

### Constants (all in `tuning.ts`)

**Kinds:**
- **P:** physics, cited.
- **C:** CREATIVE placeholder (D-13; tune by ear on the A15).
- **V:** [verify].

| Constant | Value | Kind |
|---|---|---|
| `P_FLOOR` | 1 Pa | P [PA Q7] |
| `K_SURF` | 0.105 | C, Earth-calibrated |
| `SPEEDUP`, `SHELTER` | 0.8, 0.4 | C (Jackson–Hunt V) |
| `Z0_SEA`, `Z0_LAND` | 2e-4, 0.03 m | P |
| `Z_JET_EARTH` | 10 km | C |
| `RANKINE_RM` | 0.15 r | C |
| `I_U_MIN` | 0.05 | C |
| `GUST_SINES`, `GUST_SLOPE`, `GUST_TIME_S` | 24, −0.83, 12 | P/C [SS §3] |
| `ST_HIGH`, `RE_MIN`, `ROSHKO_A`, `ROSHKO_B` | 0.2, 47, 0.212, 21.2 | P |
| `HISS_D_M`, `WHISTLE_D_M` | 0.004; 0.006/0.0035/0.0022 | C (Moon) |
| `PM_H`, `PM_T` | 0.22, 7.14 | P |
| `U_WAVE_WATER`, `U_WAVE_METHANE` | 1.5 (V), 0.6 m/s | P/V |
| `WHITECAP_A`, `WHITECAP_B`, `WHITECAP_MIN_U` | 3.84e-6, 3.41, 3.5 m/s | P |
| `SURF_DB_H04`, `SURF_DB_H2` | 60, 78 dB | P (Bolin & Åbom, V spectrum) |
| `DROP_CD` | 0.8 | P |
| `RAIN_GAIN_DB`, `CNV_RAIN_DB`, `STORM_RAIN_DB` | 58, +4, +8 dB | C |
| `SNOW_DB` | 8 dB above 1 kHz | P/C |
| `SAND_DP`, `SAND_A`, `SAND_U10_PER_USTAR`, `SAND_CO2_COHESION` | 1e-4 m, 0.136, 23, 1.8 | P/C/V |
| `LIGHTNING_MAX_PER_MIN` | 6 | C |
| `THUNDER_FM_EARTH` | 200 Hz | P (Few 1967) |
| `THUNDER_MAX_S`, `THUNDER_RANGE_CAP_KM`, `THUNDER_LOSS_NP` | 35 s, 25 km, 3.45 | P/C |
| `FLASH_MS`, `FLASH_OPACITY`, `FLASH_MIN_GAP_S` | 120, 0.25, 2 | C / WCAG |
| `BED_N`, bed sample rates | 2²⁰; 32k/30k/31k/29k | C |
| `BED_MEMORY_MB`, `BAKE_BUDGET_S`, `CACHE_WORLDS` | 96, 1.5, 2 | C |
| `AMBIENCE_UPDATE_HZ`, `GAS_FIELD_MS` | 10, 500 | C |
| `GAIN_TAU_S`, `FILTER_TAU_S`, `FADE_S`, `REBAKE_XFADE_S`, `REBAKE_DEBOUNCE_MS` | 0.15, 0.1, 0.6, 1.0, 800 | C |
| `L_TARGET`, `G_PRESENT_MAX`, `BED_LUFS` | 70 dB, 30 dB, −24 LUFS (stage, §11.7) | C |
| `STAGE_WINDOW_DB`, harmonic branch mix | 24 dB, −12 dB | C |
| `A_T`, `A_W`, `A_P`, `A_L`, `K_BR`, `H_BL`, `U_MIN` | 0.7, 1.0, 0.4, 1.2, 0.4, 500 m, 0.3 m/s | C / P (Simpson V) |
| `RAIN_STREAKS_MAX`, snow cap, `SNOW_FALL_MS`, overlay fps | 600, 400, 1 m/s, 30 | C |
| Overlay look (#117, all `artistic`): `RAIN_NEAR_M`, `RAIN_LAYER_SHARE`, `RAIN_WIDTH_PX`, `RAIN_ALPHA`, `SNOW_SIZE_PX`, `BOLT_RGB`, `BOLT_CORE_PX`/`BOLT_GLOW_PX`, `CLOUD_GLOW_R`, `DECK_GLOW_R`, `EDGE_GLOW_W`, `OVERLAY_DPR_CAP` | 2 m; 0.25/0.35/0.40; 2/1.5/1 px; 0.55/0.40/0.28; 3/2/1.5 px; (0.86, 0.91, 1); 2.5/8 px; 0.25 H; 0.3 H; 0.15 W; 1 | C [verify on the A15 + projector] |
| Overlay safety (#117, Q-449): `BOLT_STROKES_MIN/MAX`, stroke gap, bright, fade, `BOLT_LATE_S`, glow attack/fade, `SAFE_GLOW_*`, `WCAG_SMALL_AREA_PX2`, `NEAR_KM` | 2/3, 50 ms, 30 ms, 120 ms, 50 ms, 30/150 ms, 0.15 for 1 s, 21 824 px² at 1024×768, 0.1 km | C / WCAG |
| `AMBIENCE_DUCK_DB`, duck attack/release | −9 dB, 0.05/0.6 s | C |
| `PAN_MAX` | 0.8 | C |
| `CAPTION_MIN_S` | 3 | C |
| Earth reference levels (§11.3) | as listed | C |
| Absorption anchors (§4.3) | as listed | P/V |
| γ table (§4.2), liquids table (§4.4) | as listed | P/V |

### Out of scope (explicit)

**Not simulated by the engine:**
- dust storms and dust devils (no engine field);
- Mars dust sparks (Chide et al. 2025);
- hail;
- ice cracking or booming;
- waterfalls (no slope-break data);
- meteors;
- aurorae;
- volcanic infrasound (only its audible stand-in, S8).

**Not physical for this listener:**
- Doppler;
- airframe or flight noise;
- sound through the ground or liquid (hearing underwater).

**Never:**
- life, animal or human sounds;
- Earth recordings presented as another world.

**Post-event:**
- HRTF/binaural;
- the Perseverance Mars wind clip as a `measured` reference (Mars only);
- the three.js fallback path (`OrbitView`; below "+ Artistic" there is no fly view);
- a Gillier-table lookup for Mars absorption, replacing the fit.

### To verify before shipping (route to `/sx-verify`)

1. Liquids table: methane, N₂, CO₂ and ammonia-water densities and surface tensions (NIST). Basalt density.
2. γ for water vapour and H₂/He at 100–170 K; H₂/He transport properties.
3. CO₂ absorption between Mars and Venus (Gillier et al. 2024 table; Petculescu 2016).
4. Wave threshold over water; viscosity scaling of `U_wave`.
5. Gust factors and integral time; hill speed-up (Jackson & Hunt 1975).
6. Bolin & Åbom surf spectrum shape (paywalled).
7. Mars saltation cohesion factor.
8. Nystuen rain-rate coefficients (if used for finer rain levels).
9. Whether `hM` (lava sea height) is reachable from the wrapper.
10. Bake time and memory on the A15 (measured).

The §19 items are rows 59 to 68 of [R12](../open-items.md); the harmonic branch by-ear check is row 69.

### Module contract (spec Appendix B)

```ts
// Shared contract for the flyover soundscape and weather (spec R13, Q-431 to Q-444). Copy verbatim; change only by
// amending the spec, so parallel tickets stay compatible. Pure data types: no imports beyond Tag and FluidKey.
import type { Tag } from '@/contract';
import type { FluidKey } from '@/engine/worlds/types';

export type CompClass = 'N2' | 'CO2' | 'H2';
export type SourceId =
  | 'S1_land' | 'S1_sea' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8' | 'S9' | 'S10' | 'S12' | 'thunder';
export type SampleClass = 'land' | 'sea' | 'ice' | 'river' | 'lake' | 'lava' | 'crust';

export interface LiquidProps { name: string; rho: number; sigma: number; viscous: boolean; tag: Tag }
export interface Refusal { source: SourceId | 'all' | 'lightning'; reason: string }
export interface TaggedInput { label: string; value: number | string; unit: string; tag: Tag; source: string }

/** §3, §4: everything about a world's air and surface that sound needs; built once per world (and on §9.6 triggers). */
export interface AirModel {
  gas: boolean; cls: CompClass; fluid: FluidKey; state: string;
  T0: number; P0: number; H_km: number; mu: number; gamma: number; gv: number; gamK: number;
  c0: number; rho0: number; Z0: number;
  airOK: boolean; liquid: LiquidProps | null; lavaWorld: boolean;
  Uscale: number; Us: number; phiH: number; Om: number; locked: boolean; res32: boolean;
  R_km: number; zc_km: number | null; regime: string; seed: number; Vmax: number | null;
  /** Contract amendment 1 (12 Nov): the fly shader's noise seed: preset.seed3 for card worlds, else [seed, seed, seed]. */
  seed3: [number, number, number];
  /** Contract amendment 1: ocean share of the surface (preset.oceanF, i.e. core OCEANF[id]); 0 = no sea. */
  oceanF: number;
  /** Contract amendment 1: preset id (lightning rule table, §8.2). */
  presetId: string;
  inputs: TaggedInput[]; refusals: Refusal[];
}

/** §4.1 air at height z above the reference level. */
export interface AirAt { P: number; T: number; rho: number; c: number; Z: number; silent: boolean }

/** §6.2/6.3 one place sample. */
export interface PlaceSample {
  lon: number; lat: number; s_km: number; bearing: number; d_m: number; area_m2: number;
  h_km: number; cls: SampleClass; coast: boolean; rain: number; T: number; riverQ: number; vent: boolean;
}

/** §6.5 wind result. */
export interface WindResult {
  U10: number; Uz: number; Iu: number; dirDeg: number;
  parts: { kind: 'trade' | 'westerly' | 'polar' | 'terminator' | 'breeze' | 'hurricane' | 'jet'; U: number }[];
  tag: Tag;
}

/** §6.4 + §6.6 features at the listener. */
export interface PlaceFeatures {
  z_km: number; relief: number; exposure: number; slope: number;
  snowCover: number; iceCover: number; rainRate: number; RH: number; Tloc: number;
  cnv: number; cnvRing: number; precipPhase: 'rain' | 'snow' | 'none';
  cyclone: { delta: number; r: number; Rm: number; inEye: boolean } | null;
  stormNear: number; vort: number; wind: WindResult;
}

export interface Place { lon: number; lat: number; head: number; samples: PlaceSample[]; features: PlaceFeatures }

/** §9 what to bake. */
export interface BedSpec {
  id: SourceId; variant: number; sampleRate: number; N: number; seed: number;
  Uref: number; bandCenterHz: number; LrefEarth_dB: number; params: Record<string, number>;
}
export interface BakeResult { id: SourceId; variant: number; L: Float32Array; R: Float32Array; sampleRate: number; ms: number; lufs: number }

/** §11 one bed's live settings for this tick. */
export interface BedLevel {
  id: SourceId; variant: number; trueDb: number; gainDb: number; lowpassHz: number; shelfDb: number;
  pan: number; playbackRate: number; harmonic: boolean;
}

export interface CaptionModel { line: string; heard: { id: SourceId; phrase: string; relDb: number }[]; levelNote: string | null; silentReason: string | null }

/** §10 one mixer tick. */
export interface MixFrame { beds: BedLevel[]; presentOffsetDb: number; silent: boolean; caption: CaptionModel }

/** §8.3/8.4 a scheduled strike. */
export interface Strike { t0: number; d_m: number; bearing: number; seed: number; variant: number; flash: boolean }

/** §8.5 what the overlay draws this frame (shared with the mixer). */
export interface WeatherVisualFrame {
  rain: { density: number; vt: number; slantRad: number; tint: [number, number, number]; snow: boolean } | null;
  strikes: Strike[]; aboveClouds: boolean; zc_km: number | null;
}

/** The engine surface the ambience reads (WorldEngine implements it; tests fake it). */
export interface WorldEngineLike {
  readonly fly: { alt: number; lon: number; lat: number; head: number; pitch: number; auto: boolean };
  readouts(): { model: any };
  state(): { Ps: number; fluid: FluidKey; gas: boolean; locked: boolean };
  cpuFields(): { terrain: any; climate: any; hydro: any };
  weatherFields(): {
    NX: number; NY: number; iceH: Float32Array; snow: Float32Array; out: Float32Array; out2: Float32Array;
    cyclones: { lon: number; lat: number; r: number; s: number }[];
  } | null;
  gasField(): Float32Array | null;
  groundKm(lon: number, lat: number): number;
  flyCameraBasis(): { cam: [number, number, number]; fwd: [number, number, number]; rt: [number, number, number]; up: [number, number, number]; rkm: number; ex: number; fov: number } | null;
  altRange(): [number, number];
}
```

**Function signatures (owners in Appendix C):**

| Module | Exports |
|---|---|
| `air.ts` | `classify(mu, fluid, gas): CompClass`; `gammaFor(cls, mu, T): number`; `absorption(fHz, P, T, cls): number` (Np/m); `airAt(air, z_km): AirAt` |
| `airModel.ts` | `buildAirModel(world: CardToWorldOk, e: WorldEngineLike): AirModel` |
| `liquids.ts` | `liquidFor(fluid, lavaWorld): LiquidProps \| null` |
| `wind.ts` | `windAt(air, lon, lat, ctx): WindResult`, where `ctx = {exposure, relief, z_km, cyclone, landT, seaT, sCoast_km, overSea, jetU}`. `jetU` (m/s, or null) is filled by `place.ts` on gas giants as `m.U · gasProfile(m, preset).u(lat)` (§6.6); `windAt` uses it instead of the rocky model when `air.gas` (contract amendment 1). |
| `hash.ts` | `hash32(...parts: (string \| number)[]): number`: FNV-1a over `parts.join('|')`, owned by #113 (`seed.ts` `hashString32` exists only on `fix/93-engines`) |
| `place.ts` | `samplePlace(e, air, windAt): Place` (uses `flyHeight.hKm` with `air.seed3`; ocean from `air.oceanF`; `windAt` injected) |
| `flyHeight.ts` (engine/worlds) | `hKm(dir: [number, number, number], ctx: FlyHeightCtx): number`; `makeFlyHeightCtx(e: WorldEngineLike, seed): FlyHeightCtx` |
| `sources.ts` | `selectBeds(air, place): { beds: BedSpec[]; refusals: Refusal[] }`; `gates(air, Uref)` |
| `weather.ts` | `lightningRule(air, presetId): { allowed: boolean; tag: Tag \| null; reason: string \| null }`; `class StrikeScheduler { constructor(seed); next(now, rate, air, place): Strike[] }`; `thunderParams(air, d_m)`; `weatherVisualFrame(air, place, strikes): WeatherVisualFrame` |
| `levels.ts` | `mixFrame(air, place, baked: ReadonlySet<string>, prev?: MixFrame): MixFrame` |
| `dsp.ts` / `bake.worker.ts` | `bakeBed(spec: BedSpec, air: AirModel): BakeResult` (pure, in `dsp.ts`; the worker wraps it) |
| `palette.ts` | `class Palette { request(beds: BedSpec[], air): void; get(id, variant): AudioBuffer \| null; onReady(cb): () => void; dispose() }` |
| `mixer.ts` | `class AmbienceMixer { constructor(ctx, bus); apply(frame: MixFrame, palette); fire(strike: Strike, air, palette); fadeOut(s); dispose() }` |
| `captions.ts` | `caption(air, place, frame): CaptionModel` |
| `useAmbience.ts` | the hook (§10, §13) |
| `weatherBus.ts` | the §8.5 weather snapshot, strikes and `weatherRows` (#116); `ui/WeatherOverlay.tsx` subscribes to it directly (#117) |

### Rulings R1 to R12 and contract amendments 1 to 3 (spec Appendix D; amendment 1 is in the module contract above)

**R1. Area-source integral (§11.1).**
- Integrate each sample's sector exactly, with a cos² surface directivity factor (cos of the angle from the vertical at the source). This replaces the plain `A_i/(4π d²)` sum.
- An infinite plane is then flat with height (under 0.1 dB) until absorption acts.
- The §16.8 "flat ±1 dB" test stands.

**R2. Bubble pitch factor (§7).**
- `m_f = √((P0/ρ_l)/(1.013e5/1000)) · √(γ/1.4) · ((σ_E/ρ_E)/(σ/ρ_l))^(3/5)`.
- The last factor is the shift in the Deane & Stokes size break [SS §6]. A bubble's pitch goes as 1/R.
- Test anchor: Titan `m_f` between 2.0 and 2.7.

**R3. Raindrop size (§7 S6).**
- Keep capillary scaling calibrated to Earth: `r_max = 3.25 mm · √((σ/(g Δρ)) / (σ/(g Δρ))_Earth)` (Loftus & Wordsworth 2021).
- Test anchor: Titan `r_max` between 4.75 mm (Lorenz 1993) and 6.6 mm (the scaling). The fall speed is tested only for consistency with the drop size.
- Earth anchor: 3.25 mm, 9.2 m/s ±10%.
- Note the spread as [verify].

**R4. Whistle gate (§7 S2/S3).**
- The physics decides: each obstacle size is gated by its own Re.
- Test on Mars-like air at 8 m/s: the 4 mm hiss is removed, and the 6 mm tone survives with St ≈ 0.15.
- The refusal caption appears only when every size is gated out.

**R5. Mars impedance anchor (§16.1).**
- `Z` is tested for self-consistency (`ρ·c` from the inputs). Mars-like air (600 Pa, 210 K, mu 43.3) must give a Z in [3.3, 4.8] (Petculescu & Lueptow 4.44; Maurice 4.76 at their own conditions [verify]).
- Ground-source level against Earth: −20 ± 2 dB.

**Contract amendment 2 (types.ts comments only; the types do not change):**
- `PlaceSample.bearing`: absolute bearing in **radians, clockwise from north**, the same convention as `fly.head`.
- `PlaceSample.s_km`: ground distance in km. `d_m`: slant distance in m. `area_m2`: m².
- `PlaceFeatures`:
  - `z_km` in km;
  - `slope` dimensionless (rise/run);
  - `rainRate` is the engine-normalised rain (`out2` channel 0, clamped 0..3);
  - `RH` 0..1.2;
  - `Tloc` in K;
  - `cnv`, `cnvRing`, `snowCover`, `iceCover`, `stormNear` in 0..1;
  - `vort` is the signed, normalised gas vorticity.
- `BedSpec.params`: **the keys are exactly the per-source table in `plans/113-plan-v1.md`** (#113 owns the keys; #112 fills them). Any change is agreed by editing that table and noting it in both PRs.
- `WindResult.dirDeg`: the direction the wind blows **from**, in degrees clockwise from north.

**Contract amendment 3 (12 Nov): the local frame.** Every ticket uses the engine's own basis, as in `core.js` `flyCamera`:
- `up = [cos lat · cos lon, sin lat, cos lat · sin lon]`;
- `east = normalize(cross([0, 1, 0], up))`;
- `north = cross(up, east)`.

Bearings are measured clockwise from `north` towards `east`, matching `fly.head`. Pan is `+` to the right of `head`. Any other basis is a bug.

**Ruling R6 (12 Nov): acoustic air is not the engine's "airless".**

**The change.** `airOK` is `P0 >= P_FLOOR` (1 Pa) for rocky worlds, and always true for gas giants. The engine's `airless` flag (Ps < 0.02 bar) is a climate threshold: no greenhouse effect, no rain. It says nothing about whether air carries sound, and it no longer gates sound.

**What it means:**
- **Mars-like worlds (≈ 0.006 bar)** have wind sound: quiet, dull, and raised for the stage with the true level captioned. Perseverance recorded exactly this (Maurice et al. 2022).
- **Lava worlds (0.005 bar rock vapour, `inferred_from_analog`)** have faint wind, lava roar and vent sounds, labelled with the assumed atmosphere.
- **Liquids, rain and surf** still follow the engine's own `state`, `canLiquid` and rain fields, so an airless-by-climate world still gets no rain or surf.

**What it replaces.** The §7 captions "No air here" and "The magma glows, but with almost no air…" now apply only when `P0 < P_FLOOR`.

**Rulings R7–R12 (12 Nov, from the #112 code review):**
- **R7. Liquid is local (as amended 12 Nov).** `liquid = model.canLiquid && (state==='liquid' || climate stats.liquid > 0)`. On a locked world, open water on the day side counts even when the global state is "frozen".
- **R8. Presence before presentation.**
  - A bed is present only if all hold: its class fraction > 0, its driver > 0, and its true level is within 40 dB of the loudest present bed.
  - A bed that is not present is silent and never captioned.
  - The stage window lifts present beds only.
- **R9. Hurricane sanity.**
  - S9 needs the engine's own "Strongest hurricane possible" condition, Ps ≥ 0.1 bar, and a finite Vmax.
  - Vmax is clamped to ≤ 100 m/s, with a note.
- **R10. Flow-noise presentation uses the listener's impedance.** For S1–S3, S9 and S12, the offset is computed from `Z(z)` at the listener, not the ground's.
- **R11. Lightning on preset worlds still needs air and convection.**
  - The `measured` tag covers only the fact that lightning is observed on that world.
  - Strike timing and placement are `artistic`.
- **R12. Fields not yet ready mean "waiting", not a refusal.** The state is re-evaluated every tick.
