# R11.4 A15 event-machine checks

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R11.4 (a sub-page of [R11](../acceptance-tests.md): the one-sitting runbook for the checks only the A15 can answer, issue #16) · **Implements:** [Q-132, D-05, Q-64](../../decisions/platform-hosting.md) · **Read with:** [frame-time.md](frame-time.md) (R11.3, where frame-time and bloom numbers go), [open-items.md](../open-items.md) (R12 #1, #10, #35), [frontend-platform.md](../../architecture/frontend-platform.md) (A10.1, where the GPU summary goes)

This page is tooling and order, not results. It holds only the two facts nobody else owns: the **machine record** and the **GPU probe report** (the evidence behind A10.1's GPU line and R12 #1), plus the device-lost observation. Frame times and bloom numbers go in [R11.3](frame-time.md), audio values in R12 and `sound/tuning.ts`, the GPU summary in A10.1. Every A15 cell stays "to measure" until Atish fills it on the A15 itself. Numbers from any other machine never go in a committed file.

Run the steps in this order, in one sitting.

## 1. Machine record

Goes with every result row (R11.3 rejects a row without it).

- The model, from PowerShell: `(Get-CimInstance Win32_ComputerSystem).Model`. It must be the A15. (`wmic` is absent on current Windows builds.)
- `chrome://version` (full string), the commit hash under test, the date.
- Plugged in or on battery; the Windows power mode.
- The **Armoury Crate GPU mode** (Eco, Standard or Ultimate), the NVIDIA Control Panel setting and the Windows Graphics setting for Chrome, and the display refresh rate.

Pre-checks: Windows "Animation effects" is on (otherwise `prefers-reduced-motion` stops the auto-spin and the run is not a rotating run); `chrome://gpu` says "Hardware accelerated".

## 2. GPU adapter (R12 #1)

1. Enable `chrome://flags/#enable-webgpu-developer-features` for this step only. Without it Chrome may leave `device` and `description` empty (**[verify]** on the A15).
2. `npm run dev`, open `http://localhost:5173/gpu-probe.html` (dev only; it is not built and check-dist fails if it leaks into `dist/`).
3. Paste the whole report below. Save the `chrome://gpu` page too.
4. Turn the flag off again before any frame-time run.
5. Put the summary (vendor and architecture, RTX 3050 or integrated, compatibility mode, max texture size) in A10.1.

The report asks for an adapter exactly as three r187 does (`featureLevel: 'compatibility'`, no power preference), then with `low-power` and `high-performance`, so a hybrid-GPU laptop shows which adapter each preference gets. It also reports `core-features-and-limits` (without it three runs in compatibility mode with MSAA off), `maxTextureDimension2D`, three's own backend and, on WebGL2, the unmasked renderer string. A field Chrome does not report reads "not reported"; nothing is inferred.

Probe report: to measure.

## 3. Frame times (R11.3)

Follow the R11.3 procedure. On top of it:

- Reload the page for each run (`drops` is cumulative per viewer).
- Start the body rotating, then in the console `await __sxPerf.record(20)` (fixtures build only). Paste the result. Its verdicts say why a run fails: too few samples, the viewer not drawing every frame, a quality drop, a stall, or "not the event configuration" (needs WebGPU and a start on Medium). It reports both the 30 fps floor (D-05, the R11 gate) and the start level's target (R5.7); Q-64 is still open on which one wins, so neither is hidden.
- **The gate body** is `asteroid_procedural` at 2048×1024 (R11). The fixture textures are smaller, so measure the real 'Oumuamua demo row through the app with the backend up: `npm run backend:dev`, then `npm --prefix frontend run perf:build && npm --prefix frontend run perf:preview` (the preview proxies `/v1` and `/data`). Record the texture size actually drawn (DevTools, Network, the texture PNG). If it is not 2048×1024 (for example the 1024×512 demo pack), the row reads "gate not answered (texture W×H)", never a pass.
- Other baked bodies: `npm run dev:fixtures`, as R11.3 step 2 says.
- A stall reason: rerun once and record both runs; two in a row means file a bug.

## 4. Bloom before and after (#50)

"Before" is this main build, with HDR emitters (nebula, nova) against none (star, rocky world), `__sxPerf.record(20)` for each. "After" is the same on #50's branch. Run **only this step** in a Chrome started with `--disable-gpu-vsync --disable-frame-rate-limit` (**[verify]** the switches on the A15's Chrome); never run a gate that way. A result at the display rate both times means "saving not visible". Numbers go in R11.3's bloom table.

## 5. GPU device lost (#84; steps only, the last GPU step)

With a body on screen, open `chrome://gpucrash` in another tab (**[verify]**; fallback `chrome://gpuclean`). Copy the console text that starts `THREE.WebGPURenderer: WebGPU Device Lost` and note what the viewer shows. A blank screen is a bug against #84; once #84 lands, its handler replaces that console line. `device.destroy()` is not a valid trigger (reason `'destroyed'` is ignored by three). Afterwards **restart Chrome** and re-check "Hardware accelerated" before any further run, because repeated GPU crashes can disable acceleration.

Observation: to measure.

## 6. Audio (R12 #10, #35): pending #76

`outputLatency` is read on the sound-check page (`sound-check.html`, R13.9, #116), wired and Bluetooth; the haptics test page that used to show it is deleted (D-39). The app's sound settings show the Bluetooth hint too (#83). Lookahead is judged by ear after #76. Results go in R12 and `haptics/tuning.ts` (`AUDIO_LOOKAHEAD_S`, `HIGH_OUTPUT_LATENCY_S`), not here.

## 7. After the sitting

File a bug for each miss. Fill the R11.3 table, the A10.1 GPU line and R12 #1 from the records above; this page keeps only the machine record, the probe report and the device-lost observation.
