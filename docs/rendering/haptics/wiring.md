# Haptics: wiring checklist for the event build

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R8.8.1 · **Implements:** [D-20, Q-78, Q-133, Q-134](../../decisions/haptics-design.md), [D-21](../../decisions/contract.md), [Q-73, Q-83](../../decisions/haptics-built.md), [Q-132](../../decisions/platform-hosting.md), [Q-113](../../decisions/sky-shell.md) · **Read with:** [engine-api.md](engine-api.md) (R8.8), [../display-rules.md](../display-rules.md) (R5.6 Feel mode), [../build-mould.md](../build-mould.md) (R5.8)

### R8.8.1 Wiring checklist (M5)

Issues #9 to #11 built the engine, drivers, sources, calibration and the Listen sweep against fixtures. None of it is wired into the app yet. This is the order to wire it for the event build (desktop Chrome on the A15, sound only, Q-132). Owner: Atish (D-13, D-17).

**Event build**

1. **One engine:** `createHaptics()` once, with the audio driver only. `bindEngine(outputs)` for the settings (R8.7).
2. **Honesty:** `bindHonesty(engine, get, subscribe)` (`haptics.ts`) from the store's honesty toggle (D-21), so every sound follows the same filter as the layers (R8.2).
3. **Unlock and indicator:** one `UnlockButton`; on the A15 it reads "Turn on sound" (Q-73). The Feel toggle's click and the Listen button's click are user activations too, so either may unlock. Mount `PulseIndicator` (D-20); at the event it shows what is heard.
4. **Tone stream:** build `startTone` / `updateTone` / `stopTone` in the engine and the audio driver (R8.8, Q-169), with the sustained timbres of R8.9 (Q-170).
5. **Feel (R5.6, R5.8):** the build pane's Feel toggle (`frontend/src/app/build/BuildPane.tsx`, Q-113 item 5) turns on desktop Feel mode over the pane's canvas. A primary-button drag on the body goes through `TouchProbe` (`shaderProbeOptions(body, build)` for shader kinds, `planProbeBodies(plan.bodies)` for planned kinds) into `TouchHaptics.move`; the viewer's frame loop calls `TouchHaptics.poll(now)` while the button is down (Q-83); pointer up, cancel and leave call `release`. Replace the note "Touch feedback arrives with the phone build." with what Feel does now.
6. **Body tone (R8.9.1, Q-133):** the height-map, terrain and mesh sources drive the `body` tone from their height sample instead of emitting clicks. The mesh source needs the `three-mesh-bvh` raycast and mesh height (Q-168).
7. **`buildHaptics` options:** `overrides` (required, the D-27 overrides the body was built with), `planBodies` (the comet nucleus), `heightGrid` (`loadHeightGrid(params.textures.height_bin)`), `epoch` and `gas` (the comet toggle and the gas selected on the spectrum), and `meshNormals: true` only once the raycast fills `TouchSample.normal` (Q-78). Rebuild when the body, overrides, epoch or gas change; show `missing` with the other refusals.
8. **Light curve:** the scrubber calls `TouchHaptics.scrub(index)` and `endScrub()`.
9. **Spectrum:** mount `SpectrumHapticsPad` over `SpectrumChart` with the chart's `lambdaDomain`.
10. **Listen tab:** from the Listen button's click, `const plan = planSweep(mapping, gasLinesForEpoch(card, epoch))`. When `plan` is null (no usable spectrum, or one wavelength), say there is nothing to play; otherwise `engine.unlock()` and then `sweep.play(plan, engine.honesty)`, as the test page's Texture panel does. Bind the sweep to the honesty toggle too, `bindHonesty(sweep, get, subscribe)`, so `ListenSweep.setHonesty` stops a tone or chime the new state hides.
11. **Track path sound (R8.9.2, Q-134):** with the Track tool (A20, [track-ui.md](../../architecture/moving-objects/track-ui.md)): exposure ticks, the `path` tone and the reference click with its mute.

**After the event (Q-132)**

- Add the vibrate driver to the engine where `deviceVibrates` is true, and run `applyStoredCalibration` at start-up (R8.7).
- Decide when `CalibrationWizard` first runs (start-up or first entry to Touch mode); it runs only where `deviceVibrates` is true.
- Touch mode (R5.6): one pointer down turns orbit controls off and feels; two pointers rotate and zoom. Whether the Touch-mode toggle is itself the unlock button is open (Q-73).
- The height ticks return as vibration only (Q-172).
