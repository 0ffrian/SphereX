# Sound: baking, live mixing and levels

> **Part of:** Rendering & sound spec ([index](../README.md)) · **Sections:** R13.7, R13.8 · **Implements:** [Q-439, Q-440, Q-444, Q-445](../../decisions/sound-ambience.md) · **Read with:** [buses-stage.md](buses-stage.md) (R13.9), [sources-weather.md](sources-weather.md) (R13.5)

## R13.7 Baking (worker)

#### 9.1 Method
Port Moon's `DSP()` into `haptics/sound/ambience/bake.worker.ts`, typed and split into pure functions:
- `noiseMulti`, `gustEnv` (corrected per S1), `eventEnv`, `applyIR`, `finish`, `fft`, `rng32`, `derive` (replaced by §4).

**The method:**
- A random-phase spectrum per layer, then an inverse FFT, gives a periodic, seamless loop [SP §5].
- Events are scheduled at seeded times that wrap around the loop end.
- Echo taps are applied by multiplying spectra.

#### 9.2 Loop lengths (no audible repetition)
- Every bed is `N = 2²⁰` samples.
- Beds that may play together get different sample rates, so their lengths are not in integer ratio:

| Group | Rate | Length |
|---|---|---|
| wind | 32 000 Hz | 32.77 s |
| sea and surf | 30 000 Hz | 34.95 s |
| rain and river | 31 000 Hz | 33.83 s |
| lava, sand and gas | 29 000 Hz | 36.16 s |

- Each rate is above twice the bed's top frequency.
- Web Audio resamples `createBuffer` buffers on playback [SP §6].
- Repetition of a loop of 30 s or more is hard to learn [SP §5, Agus et al. 2010].

#### 9.3 Seeds
`seed_bed = hash32(preset.seed, BED_ID, variant)`, using `hashString32` over `"<seed>|<bed>|<variant>"`.

#### 9.4 Which beds are baked, and in what order
- **Selection:** every source whose gate passes (§7) at `U_ref`:
  - `U_ref = U10` at the place the close-up opened (rocky), at least 2 m/s;
  - gas: `m.U`;
  - S9: `Vmax`.
- **Priority:**
  1. S1 land and sea
  2. S4 and S5
  3. S6
  4. S12
  5. S2 and S3
  6. S7
  7. S8
  8. S10
  9. S9
  10. thunder variants

#### 9.5 Budgets
- **Memory:** a bed is 2²⁰ × 2 ch × 4 B = 8.4 MB, capped at `BED_MEMORY_MB = 96` per world (about 11 beds). Beyond the cap the lowest-priority beds are not baked and are listed.
- **Time:** each bed must bake in ≤ 1.5 s on the A15 in the worker [verify by measurement: Moon's page prints its build time]. The worker bakes one bed at a time and posts each as it finishes, using transferable buffers.
- **Cache:** `Map<key, AudioBuffer>`, key = `(preset.id, airModelHash, bed, variant)`, keeping 2 worlds (LRU).

#### 9.6 Re-bake triggers
Changing these engine controls (build-pane sliders) changes the physics, so the affected beds are rebaked, debounced by 800 ms:
- `Ps`, `fluid`, `Tstar`, `orbit`, `co2` (which change Ts and state).

Wind changes do not trigger a bake; they are live (§7).

#### As built: deviations (issue #113, PR #119; [Q-445](../../decisions/sound-ambience.md))

The bake engine in `frontend/src/sound/ambience/` differs from the text above in these points. Q-445 records them; where they disagree, this list wins.

- **One-shots are linear, not loops.** Thunder and vent bursts are baked as zero-padded one-shots that do not loop.
- **Separate budgets.** One-shots have their own 36 MB memory budget, apart from the 96 MB bed budget (§9.5).
- **One-shot level.** One-shots peak at −16 dBFS.
- **No thunder echo pass at bake.** `d_m` and `absK2` are not used when baking thunder.
- **Air absorption is live.** The mixer applies it ([R13.8](#r138-live-mixing-and-levels)); it is not baked into the loops.
- **Loudness.** It uses the sample peak with gain reduction and no soft clip.
- **Gust timescale.** `GUST_TIME_S` is unused; the gust timescale comes from the envelope spectrum.
- **High pings dropped.** Bubble and patter pings above 0.47 × the sample rate are dropped.
- **S12 phaser.** The gas-roar phaser is baked into the loop.
- **Lava vent burst.** It is S8 variant 1.
- **Cache key.** It includes a hash of the spec.
- **Bake failure.** The palette falls back to one bed.
- **Seam test.** "Seamless" is tested as an exact continuity bound across the wrap.

## R13.8 Live mixing and levels

### Live mixing (10 Hz, on the main thread)

**Loop.** The `useAmbience()` hook is mounted inside `WorldFlyStage`. It runs its own `requestAnimationFrame` loop, throttled to `AMBIENCE_UPDATE_HZ = 10`. It pauses when:
- the stage is hidden (`flyPaused`, the IntersectionObserver), or
- `document.hidden`.

**Each tick:**
1. Read `engine.fly`, the weather fields (§3.3) and the gas field (≤ 2 Hz).
2. Sample the 37 points (§6.2). Class (§6.3), features (§6.4) and wind (§6.5/6.6).
3. For each baked bed, compute the true level and filter (§11). Gain changes use `setTargetAtTime(target, now, 0.15)`; filters use 0.1 s.
4. Advance the thunder and vent event schedulers (§8.3, S8).
5. Update the caption model (§12.2) at most every 3 s.

**Graph per bed:**
`AudioBufferSourceNode (loop, playbackRate) → BiquadFilter lowpass (absorption) → BiquadFilter highshelf (snow) → Gain → StereoPanner → ambience bus`

**Graph per event:**
`source → lowpass → gain → panner → ambience bus`, disposed on end.

**Node budget:** 12 beds × 5 nodes + 4 events × 4 nodes ≈ 76 nodes [SP §6].

### Area sources (beds S1–S10, S12)
- **Source per sample.** A bed's source on the ground is the set of samples whose class it belongs to:

| Bed | Samples that count |
|---|---|
| S1, S2, S3, S10, S12 | all (wind is everywhere) |
| S4 | coast zone |
| S5 | sea |
| S6 | all, scaled by local rain |
| S7 | river |
| S8 | lava and crust |

- **Incoherent area-source integral (Rayleigh, Appendix D R1):** `I = Σ_i c_i · e^{−2·α(f_b)·d_i} · ∫_sector_i cos²θ / (4π d²) dA`: each sample's sector is integrated exactly with a cos² surface directivity factor (θ from the vertical at the source), where `c_i` is the sample's class membership (0/1, or rain weight) and `f_b` the bed's band centre. An infinite plane is then flat with height (under 0.1 dB) until absorption acts.
- **Relative level:** `L_rel = 10·log10(I / I_ref)`, where `I_ref` is the same integral for an infinite plane of that class with the listener at 2 m on Earth air.
- **What this gives:**
  - Directly over a sea the level is nearly flat with height until absorption cuts in.
  - From high up, everything fades.
  - A distant coast is quieter.
- **Exception: wind (S1–S3)** is local flow noise at the listener, not a ground source. Its level uses `U(z)` at the listener and no area integral.

### Absorption filter and path pressure
- **Path pressure:** `P̄ = P0·H/z·(1 − e^{−z/H})`, the mean along a vertical path; for z → 0 it is `P0`. Absorption is evaluated at P̄ and the mean T.
- **Effective distance:** `d_eff` = the intensity-weighted mean of `d_i` over the bed's samples.
- **Low-pass cutoff:** the frequency where `α(f)·d_eff = 0.3466 Np` (−3 dB), found by bisection over 20 Hz–16 kHz on a log scale and clamped. Q = 0.707.
- **Broadband loss:** an extra `e^{−α(250 Hz)·d_eff}` in the gain, which matters on Mars.

### World scaling (true level)
- **Impedance between worlds.** Using `Z(z)` at the listener:
  - **Ground sources** (S4–S8, S10): radiate fixed power, so `ΔL = 10·log10(Z_w/Z_E)` [PA Q6]. Mars −20 dB, Titan +10 dB, Venus +20 dB, matching Petculescu & Lueptow.
  - **Flow noise** (S1–S3, S9, S12; with `Z(z)` at the listener, Appendix D R10): pressure amplitude `∝ ρ·I_u·U²` (rumble) and `∝ ρ·U³/c` (hiss) [SS §1]. Level `20·log10` of the ratio to Earth at the same reference.
- **Listener in thinner air.** A ground source heard at height z gets `+10·log10(Z(z)/Z(0))` on top of the absorption.
- **True level:** `L_true(bed) = L_ref_E(bed) + L_rel + ΔL_world + live driver terms` (the §7 gains, in dB).
- **Earth reference levels:** in `tuning.ts` as CREATIVE placeholders, apart from surf, which follows Bolin & Åbom. Defaults:

| Bed | Earth reference level |
|---|---|
| wind at 7 m/s | 55 dB |
| hiss | −10 dB relative to rumble |
| sea | 62 dB |
| rain (moderate) | 58 dB |
| river (100 m³/s) | 60 dB |
| lava | 65 dB |
| sand at threshold + 5 m/s | 50 dB |
| gas roar | 60 dB |
| thunder at 1 km | 100 dB peak |

### Presentation
- **One offset for the whole world.** `G_present = −ΔL_world(ground) + 0`: quiet worlds are raised and loud worlds lowered by the same single offset. Relative levels within a world are kept.
- **Clamp:** to ±30 dB.
- **Caption** for |ΔL| ≥ 3 dB: "Real level: about 20 dB quieter than on Earth (raised so you can hear it)" or "... louder than on Earth (lowered)".
- **Map to gain:** `gain = 10^((L_true + G_present − L_TARGET)/20)`, with `L_TARGET = 70` dB, so a 70 dB scene reaches the bus at unity.
- **Loudness:** beds are normalised at bake to the same loudness, −30 LUFS integrated, measured in the worker with a K-weighting approximation [SP §5]. Cross-fades are equal power.

### Pan
- **Direction:** `pan = clamp(Σ I_i·sin(b_i − head) / Σ I_i, −0.8, 0.8)`, equal-power (StereoPanner).
- **Front/back:** no cue for it [SP §4].
- **No information by pan alone:** captions carry direction ("surf to the south") (R9, mono PA).

> **Appendix D rulings in this section:** R1 (the area integral above). **R8, presence before presentation:** a bed is present only if its class fraction > 0, its driver > 0 and its true level is within 40 dB of the loudest present bed; a bed that is not present is silent and never captioned. **R10:** for S1–S3, S9 and S12 the flow-noise offset (§11.3) uses `Z(z)` at the listener, not the ground's. Full text in [R13.11](files-tests.md#r1311-files-tests-constants-and-the-module-contract).

Ducking, the master and stage audibility (spec §11.5, §11.7) are in [R13.9](buses-stage.md#r139-buses-ducking-master-settings-and-stage-audibility).

### As built in #116 ([Q-448](../../decisions/sound-ambience.md))

- **Mixer** (`frontend/src/sound/ambience/mixer.ts`): `AmbienceMixer(ctx, bus, opts?)` with `setWorld(key)`, `apply(frame, palette)`, `fire(strike, air, palette, { nowS, z_km, head })`, `fadeOut(s)`, `fadeIn()`, `setHarmonicSendDb(db)`, `stats()`, `dispose()`.
  - **One group per world:** `worldGain` into the ambience bus, plus `harmGain` into the shared harmonic branch. The harmonic beds (S1, S8, S12) and thunder tap `harmGain`.
  - **Per bed:** `source(loop) → lowpass → highshelf (1 kHz, snow) → bedGain → [StereoPanner] → worldGain`. Without a StereoPanner the bed has 4 nodes and is centred.
  - **Per event:** `source → lowpass → gain → [panner] → worldGain`.
- **Automation:**
  - `apply()` writes only bed params, with `setTargetAtTime` and dead bands (0.25 dB, 2 % of the cut-off, 0.02 pan, 0.5 % rate).
  - Fades and the world crossfade write only the group gains, also with `setTargetAtTime`. Nothing uses `setValueCurveAtTime`, so automation kinds never overlap on one param.
  - The crossfade is an exponential approach with τ = 1 s / 7, not an equal-power curve.
- **Fades:**
  - Fades run on the audio clock with τ = length / 7, so the level is −61 dB at the end.
  - Sources stop from a wall-clock timer 0.05 s after the fade, never from a mixer tick, and never from a `stop()` scheduled when the fade starts.
  - Coming back during a fade ramps the same group up again.
- **World change:** any new world key fades the old group at once, whatever the new world holds, airless included.
- **Thunder:**
  - Thunder starts at `t0 + d/c` on the audio clock, with gain `stageGainDb(level_dB, presentOffsetDb(air))`.
  - It is dropped when it is not baked or when `d/c > THUNDER_MAX_DELAY_S` (15 s).
  - At most 4 thunder events are live or pending at once. Fades, world changes and `dispose` cancel pending ones.
- **Loop** (`ambienceLoop.ts`, wrapped by `useAmbience.ts`):
  - **Gating:** a 10 Hz tick on `requestAnimationFrame` while the fly view is live. The tick is pure apart from injected deps.
  - **AirModel:** rebuilt every tick while the world forms or waits, and once when it settles. After that it is rebuilt after an 800 ms debounce of `Ps|fluid|gas|locked|Tstar|orbit|co2`.
  - **Beds:** selected per world key. The ready set comes from `palette.get` every tick.
  - **Strikes:** the scheduler runs 0.3 s ahead of now.
  - **Errors:** each tick is wrapped in try/catch. An error logs once, fades out, and shows "Sound unavailable."; the weather keeps publishing.
- **Holder** (`ambienceHolder.ts`):
  - **Lifetime:** the palette and the mixer live in the holder and are released after 2 minutes with no active loop.
  - **Early baking:** the palette bakes before the unlock click, through an `OfflineAudioContext`.
- **Tick cost:** median 0.10 ms, p95 0.22 ms on the dev machine, not counting `samplePlace` (opt-in bench, `SX_AMB_BENCH=1`). The A15 figure is not measured yet.
- **Vent bursts not fired:** §7 S8 gives no rate (`VENT_BURST_PER_MIN = null` [verify]). S8 variant 1 is baked but not played.
