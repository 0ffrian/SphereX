# Frame-time checks

> **Part of:** Rendering & haptics spec ([index](../README.md)) · **Section:** R11 · Frame-time gate for R5.7 ([display rules](../display-rules.md)) · **Implements:** D-05, Q-66

A renderer that misses its quality tier's target on the real devices does not merge. This is a manual procedure; the results table below is empty until someone measures.

## Targets (R5.7)

| Quality tier | Device class                                 | Target |
| ------------ | -------------------------------------------- | ------ |
| High         | Desktop GPU                                  | 60 fps |
| Medium       | Zenbook 14X (Iris Xe), Asus A15 (integrated) | 60 fps |
| Low          | Android phones (realme 14 Pro, Samsung)      | 30 fps |

Device pixel ratio is capped at 1.5 (D-05). The frame-time governor drops one quality tier when frames take more than 33 ms (`SLOW_FRAME_MS`, R5.7) for 2 s, and the viewer says so. The low quality tier draws at most 30 fps. A run where the governor fires on a device counts as a miss for the quality tier it started on.

## Procedure (per device, per body type)

1. Build and serve the production bundle in fixtures mode: `npm run perf:build`, then `npm run perf:preview` (it listens on the LAN, so a phone on the same network can open it). This is the minified production build. Only the fixtures mode adds the `__sxViewer` and `__sxShow` hooks used below, so the plain `npm run build` and the hosted copy cannot be measured this way. Close other tabs and plug laptops in. On phones, turn battery saver off and keep the screen at normal brightness.
2. Open the app in Chrome. Load the fixture for the body type (`shared/fixtures/`) so the data does not vary.
3. Set the honesty state to `+ Artistic` (the heaviest) and the view to the default framing.
4. Let it run 10 s untouched, then 20 s while rotating slowly with the pointer or touch.
5. Read the stats in the console (on phones use remote debugging, `chrome://inspect`):
   ```js
   __sxViewer.renderStats();
   ```
   It returns `{ tier, backend, frames, p50Ms, p95Ms, drops }`. Record `p50Ms` and `p95Ms` (and the fps they imply), `tier`, `backend` (WebGPU or WebGL2) and `drops` (quality-tier drops by the governor; any drop is a miss). Call it after the 30 s run, so `frames` covers the whole run.
6. To force a quality tier for a comparison, call `__sxViewer.setQualityTier('low' | 'medium' | 'high')`, or open the page with `?quality=high`.
7. Repeat for each body type: star, gas giant or brown dwarf, rocky or water world, nebula or remnant, asteroid (shape model), comet.
8. Pass when the fps implied by p50 meets the target and `drops` is 0.

## Results

Do not fill in numbers that were not measured. Cell format: `p50 ms / p95 ms / quality tier / drops`.

| Body type               | Zenbook 14X | Asus A15   | realme 14 Pro | Samsung    |
| ----------------------- | ----------- | ---------- | ------------- | ---------- |
| Star                    | to measure  | to measure | to measure    | to measure |
| Gas giant / brown dwarf | to measure  | to measure | to measure    | to measure |
| Rocky / water world     | to measure  | to measure | to measure    | to measure |
| Nebula / remnant        | to measure  | to measure | to measure    | to measure |
| Asteroid (shape model)  | to measure  | to measure | to measure    | to measure |
| Comet                   | to measure  | to measure | to measure    | to measure |

Record the browser version, date and commit hash with each column.
