# Sound: baking, live mixing and levels

> **Part of:** Rendering & sound spec ([index](../README.md)) · **Sections:** R13.7, R13.8 · **Implements:** [Q-439, Q-440, Q-444](../../decisions/sound-ambience.md) · **Read with:** [buses-stage.md](buses-stage.md) (R13.9), [sources-weather.md](sources-weather.md) (R13.5)

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

- **Incoherent area-source integral (Rayleigh):** `I = Σ_i A_i · c_i · e^{−2·α(f_b)·d_i} / (4π d_i²)`, where `c_i` is the sample's class membership (0/1, or rain weight) and `f_b` the bed's band centre.
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
  - **Flow noise** (S1–S3, S9, S12): pressure amplitude `∝ ρ·I_u·U²` (rumble) and `∝ ρ·U³/c` (hiss) [SS §1]. Level `20·log10` of the ratio to Earth at the same reference.
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

> **Appendix D, R1 (area-source integral):** integrate each sample's sector exactly with a cos² surface directivity factor (replaces the plain `A_i/(4π d²)` sum); an infinite plane is then flat with height (under 0.1 dB) until absorption acts. Text in [R13.11](files-tests.md#r1311-files-tests-constants-and-the-module-contract).

Ducking, the master and stage audibility (spec §11.5, §11.7) are in [R13.9](buses-stage.md#r139-buses-ducking-master-settings-and-stage-audibility).
