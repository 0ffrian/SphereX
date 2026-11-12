# Acceptance tests

> **Part of:** Rendering & haptics spec ([index](README.md)) · **Sections:** R11 · **Implements:** [D-21](../decisions/contract-tags.md), [D-37](../decisions/rendering-engines.md), [D-05, Q-132](../decisions/platform-hosting.md), [Q-69](../decisions/rendering-motion.md), [Q-113](../decisions/shell-surfaces.md), [Q-133](../decisions/haptics-sound.md) · **Read with:** [reference/README.md](reference/README.md) (R11.1), [reference/checklist.md](reference/checklist.md) (R11.2), [reference/frame-time.md](reference/frame-time.md) (R11.3), [reference/a15-checks.md](reference/a15-checks.md) (R11.4), [testing.md](../architecture/testing.md)

## R11. Acceptance tests

> **Known gap ([Q-416](../decisions/shell-surfaces.md), PR #104):** the build header's Ambience toggle (the artistic Atmosphere; Hear it opens from Details since Q-450) still plays at Measured only, which the honesty test below forbids, until Atish wires `build/hearAudio.ts` to the honesty filter and the shared audio bus.

The sub-pages are R11.1 [reference frames](reference/README.md), R11.2 the [visual review checklist](reference/checklist.md), R11.3 [frame-time checks](reference/frame-time.md) and R11.4 the [A15 event-machine checks](reference/a15-checks.md).

**Event build (desktop Chrome on the A15, sound only; Q-132)**

- **Determinism:** the same card and seed give the same SHA-256 for every texture. Frames drawn by the D-37 engines are exempt ([R5.9](engines.md#r59-prototype-engines-d-37)).
- **Seam:** the mean absolute height difference between column 0 and column W−1 is less than the median neighbour difference.
- **Normals:** every decoded normal has length 1 ± 0.02.
- **Honesty:** the toggle starts at + Estimated. In Measured only, no layer with a tag other than `measured` is drawn, and every sound the R8.2 filter hides is silent: procedural and shader-kind texture sounds, a `derived` `teq_pulse`, the Track path voice (D-21).
- **Refusal:** removing `diameter_km` from an asteroid card puts the mesh in `missing`, with no crash.
- **Performance:** ≥30 fps rotating `asteroid_procedural` at 2048×1024 on the A15, at the quality level it starts on (Medium), with no governor drop (R11.3). The same ≥30 fps while rotating, at + Artistic, for the D-37 engines: the rock engine on an asteroid, and a planet with both world-engine instances (globe and fly view) open ([R5.9](engines.md#r59-prototype-engines-d-37)); **not yet measured** (R12 #43).
- **Sound:**
  - no more than 40 events per second under fast drags
  - the vibrate driver is not in the engine, and the audio driver plays every event
  - in Measured only, gas giant and planet texture sounds are silent; the `teq_pulse` plays only when `teq_K` is `measured` (D-21)
  - **Body tone (Q-133):** the tone's pitch is monotone in the sampled height, and the tone stops on release, on leaving the body and when the honesty level hides its tag (R8.9.1)
  - **Track (Q-134):** one tick per exposure, pitch rising with wavelength; the path voice is silent in Measured only (R8.9.2)
- **Shared field:** on a gas giant, band-boundary ticks line up with the drawn band edges, so the shader and the field agree.
- **Spectrum haptics:** dragging across a known absorption dip gives at least 3 consecutive quiet steps.
- **Comet:** toggling Aug/Dec changes the CO and H₂O shells. No tail is drawn for August.

**Automated gates (Playwright, `frontend/e2e/`)**

- `golden.spec.ts`: every fixture with a 3D view at each honesty state, compared with `e2e/__goldens__/` by SSIM (R11.1; thresholds Q-69).
- `determinism.spec.ts`: the settled frame depends only on what is shown (Q-66).
- `build.spec.ts`: the final frame of a build equals the normal render of the same card and seed, by SSIM (R5.8, Q-113).
- `shaderKinds.spec.ts`, `shaderLibrary.spec.ts`: the shader kinds draw and stay deterministic.

**After the event (phones and vibration; Q-132)**

- ≥30 fps rotating `asteroid_procedural` at 1024×512 on the realme 14 Pro.
- The vibrate driver is a silent no-op on iPhone, and the audio driver still plays.
- The calibration values (`minMs`, level set, `avOffsetMs`) persist.
- Both Android phones feel the 8 ms tick after calibration.
- After calibration, the audio–vibration offset is under a threshold (threshold: **[verify]**, R12 #33).
