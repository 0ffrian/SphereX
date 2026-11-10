# R11.3 Frame-time checks

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Sections:** R11.3 (a sub-page of [R11](../acceptance-tests.md): the frame-time gate for R5.7; the A15 session order is [R11.4](a15-checks.md)) · **Implements:** [D-05, Q-64, Q-132](../../decisions/platform-hosting.md), [Q-66](../../decisions/rendering-motion.md) · **Read with:** [display-rules.md](../display-rules.md) (R5.5, R5.7)

A renderer that misses its quality level's target on the real devices does not merge. This is a manual procedure; the results table below is empty until someone measures.

## Targets (R5.7)

The quality levels, the level each device starts on and their frame-rate targets are owned by [R5.7](../display-rules.md#r57-motion-and-time-lapse); this page holds only the measurement. The **event gate is the A15** (desktop Chrome, Q-132): it starts on Medium (60 fps target). The phone columns below are after the event. A run where the governor fires counts as a miss for the level it started on.

## Procedure (per device, per body type)

1. Build and serve the production bundle in fixtures mode: `npm run perf:build`, then `npm run perf:preview`. `perf:build` also copies the fixture cards and render params into `dist-fixtures/fixtures/`. The preview listens on the LAN at port 4173. On the A15, open `http://localhost:4173` (localhost is a secure context).
   - **Phones (after the event) need a secure context for WebGPU.** Plain HTTP over the LAN runs the WebGL2 fallback, which is the wrong backend to measure. Either serve HTTPS (`VITE_HTTPS=1 npm run perf:preview`, a self-signed certificate: accept it once on the phone), or forward the port over USB (`chrome://inspect` → Port forwarding, 4173 → `localhost:4173`) and open `http://localhost:4173` on the phone. `localhost` counts as secure. Check that step 5 reports `backend: 'webgpu'`. This is the minified production build. Only the fixtures mode adds the `__sxViewer` and `__sxShow` hooks used below, so the plain `npm run build` and the hosted copy cannot be measured this way. Close other tabs and plug laptops in. On phones, turn battery saver off and keep the screen at normal brightness.
2. Open the app in Chrome and load the fixture for the body type from the console, so the data does not vary:
   ```js
   const f = (dir, name) =>
     fetch(`/fixtures/${dir}/${name}.json`).then((r) => r.json());
   const show = async (name) =>
     __sxShow(await f("cards", name), await f("params", name), "artistic");
   await show("star"); // or gas_giant, brown_dwarf, planet_rocky, planet_water, nebula, nova, asteroid_shape, comet
   ```
   This draws at `+ Artistic`, the heaviest honesty state. The fixtures' texture URLs (`/data/textures/…`) and the Eros shape model (`/data/shapes/eros-gaskell.glb`) are not served here: `vite preview` does not run the fixtures plugin, which serves them under `npm run dev:fixtures` (issue #62, Q-114). Baked bodies therefore draw their flat fallback and `asteroid_shape` a sphere. Measure those two under `npm run dev:fixtures` or against the real backend.
3. Leave the view at its default framing.
4. Let it run 10 s untouched, then 20 s while rotating slowly with the pointer or touch.
5. Record the run in the console (fixtures build; on phones use remote debugging, `chrome://inspect`). `__sxPerf.record(20)` samples every frame interval of the whole run, counts stalls (intervals over 250 ms) and returns the summary, the tiers at start and end, `drops` for the run and a verdict for the 30 fps floor and the start level's target. It fails a run with too few samples, a viewer that did not draw every frame, a drop, a stall or a non-event configuration, and says why. Start the body rotating first. The viewer's own stats are:
   ```js
   await __sxPerf.record(20);
   __sxViewer.renderStats();
   ```
   `renderStats()` returns `{ tier, backend, frames, p50Ms, p95Ms, drops }`, but its percentiles cover only the last 240 frames (under 2 s at 144 Hz) and skip intervals over 250 ms, so they are not the whole run. Record `p50Ms` and `p95Ms` (and the fps they imply), `tier`, `backend` (WebGPU or WebGL2) and `drops` (quality-level drops by the governor; any drop is a miss). Call it after the 30 s run, so `frames` covers the whole run. On Low with a coarse pointer (phones, after the event) the viewer caps itself at 30 fps, so a p50 near 33 ms there is the cap, not headroom.
6. To force a quality level for a comparison, call `__sxViewer.setQualityTier('low' | 'medium' | 'high')`, or open the page with `?quality=high`.
7. Repeat for each body type: star, gas giant or brown dwarf, rocky or water world, nebula or remnant, asteroid (shape model), comet.
8. Pass when the fps implied by p50 meets the target and `drops` is 0. The fps is rounded to the nearest whole number before comparing (a vsynced 16.7 ms p50 counts as 60). `drops` is cumulative since the page loaded, so reload for each run.

## Results

Do not fill in numbers that were not measured. Cell format: `p50 ms / p95 ms / quality level / drops`.

The A15 column is the event gate. The realme and Samsung columns are after the event. The Zenbook is no longer the demo machine (Q-132); keep its column only if someone measures it.

| Body type               | Asus TUF A15 (event) | realme 14 Pro (after) | Samsung (after) | Zenbook 14X |
| ----------------------- | -------------------- | --------------------- | --------------- | ----------- |
| Star                    | to measure  | to measure | to measure    | to measure |
| Gas giant / brown dwarf | to measure  | to measure | to measure    | to measure |
| Rocky / water world     | to measure  | to measure | to measure    | to measure |
| Nebula / remnant        | to measure  | to measure | to measure    | to measure |
| Asteroid (shape model)  | to measure  | to measure | to measure    | to measure |
| Asteroid (procedural), the R11 gate body: texture size drawn, or "gate not answered" ([R11.4](a15-checks.md)) | to measure | to measure | to measure | to measure |
| Comet                   | to measure  | to measure | to measure    | to measure |

Record the browser version, date and commit hash with each column, plus the `Win32_ComputerSystem.Model` string and the GPU probe's adapter vendor and architecture ([R11.4](a15-checks.md)). Reviewers reject a row without them.

### Bloom before and after (#50)

Measured with `__sxPerf.record(20)` in the vsync-off run of [R11.4](a15-checks.md) step 4. Cell format: `p50 ms / p95 ms / quality level / drops`.

| Body                 | Before (main) | After (#50) |
| -------------------- | ------------- | ----------- |
| HDR emitter (nebula) | to measure    | to measure  |
| HDR emitter (nova)   | to measure    | to measure  |
| Star (no HDR)        | to measure    | to measure  |
| Rocky world (no HDR) | to measure    | to measure  |
