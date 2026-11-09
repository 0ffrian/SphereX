# frontend

Vite + TypeScript + React web app. three.js **r187** (`three/webgpu`).

Status: the tooling, the data-contract types, typed placeholder modules for every R10 file and a viewer smoke scene (one plain sphere), set up on 4 Nov 2026. M1 (issue #3, 5 Nov 2026) adds the SPHEREx flipbook and spectrum view: search by name or RA/Dec, frame playback, the spectrum chart, Rainbow Trails and the shareable URL hash. Issue #7 (M2) adds the 3D viewer for the baked types: see "Viewer: baked types" below. Issues #9, #10 and #11 (M3) add the haptics and sound modules (`src/haptics`), built and tested against fixtures and the haptics test page; M5 wires them into the app. On 7 Nov 2026 a feasibility prototype (branch `feat/sky-view-prototype`, not yet confirmed by Moon, D-17) rebuilt the shell in the mock-up's layout with an all-sky image as the main view: see "Shell and sky view (prototype)" below.

## Run it

Needs Node 24 (`.nvmrc`) and npm.

```sh
cd frontend
npm ci              # exact versions from package-lock.json
npm run dev         # http://localhost:5173, /v1 proxied to the backend
npm run dev:fixtures  # same app, /v1 answered by SYNTHETIC fixtures (no backend)
```

### Backend and fixtures

- `npm run dev` proxies `/v1` (the D-16 API) to `http://localhost:8000`. Set `SX_API_TARGET` to use another address. `npm run preview` proxies the same way.
- `npm run dev:fixtures` (`vite --mode fixtures`) answers `/v1` from [`fixtures/`](fixtures/README.md) instead. That data is **synthetic**; the page then shows a "Fixture data" banner and "Fixture" badges. The fixtures exist only on the dev server: no app module imports them, and `npm run build` fails if a fixture marker reaches `dist/` (`scripts/check-dist.js`).
- Playwright always runs on the fixtures.
- **Uncached positions on a live backend:** run the backend with `SX_LIVE_CUTOUTS_PER_REQUEST=3` in dev (see the [backend README](../backend/README.md)). Each `/frames` reply then comes back well inside the 90 s request timeout, and the flipbook fetches the rest progressively (below). Any value works; with the default 24 a reply can take longer than 90 s, which the flipbook treats as "still working" and asks again.

### Phone testing over the LAN (Android Chrome)

WebGPU needs a secure context, and a phone reaches the laptop by IP rather than `localhost`, so the phone script serves HTTPS with a self-signed certificate (`@vitejs/plugin-basic-ssl`):

```sh
npm run dev:phone   # vite --host --mode phone → https://<laptop-LAN-IP>:5173
```

1. Put the phone and the laptop on the same Wi-Fi. Vite prints the `Network:` URL.
2. Open that `https://` URL in Chrome on the phone and accept the certificate warning (Advanced → Proceed).
3. The status line under the viewer shows which backend is running: `WebGPU` or `WebGL2 (fallback)`. Check `chrome://gpu` on the phone too (R12 item 1).

If Windows Firewall prompts for Node.js, allow it on private networks. Setting `VITE_HTTPS=1` turns on the same certificate in any mode.

### Scripts

| Script                    | Does                                                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev`                     | Vite dev server                                                                                                                                 |
| `dev:phone`               | Vite on the LAN (`--host`) with HTTPS                                                                                                           |
| `dev:fixtures`            | Vite dev server with `/v1` served from the synthetic fixtures                                                                                   |
| `build`                   | `tsc -b && vite build`, then `check:dist`                                                                                                       |
| `check:dist`              | Fails if fixture code or data is in `dist/`                                                                                                     |
| `preview`                 | serve `dist/`                                                                                                                                   |
| `typecheck`               | `tsc -b --noEmit` (strict, `noUncheckedIndexedAccess`, `noImplicitOverride`)                                                                    |
| `lint`                    | ESLint flat config (typescript-eslint, react-hooks)                                                                                             |
| `format` / `format:check` | Prettier                                                                                                                                        |
| `test`                    | Vitest (jsdom)                                                                                                                                  |
| `test:e2e`                | Playwright smoke, flipbook, shader-kind, sky, colour and progressive tests on fixtures, Chromium only (`npx playwright install chromium` first) |
| `contract:gen`            | Rewrites `src/contract/generated.ts` from `../shared/schemas/` (D-18)                                                                           |
| `contract:check`          | Fails if `src/contract/generated.ts` differs from a fresh generation                                                                            |

CI: [`.github/workflows/frontend.yml`](../.github/workflows/frontend.yml) runs the contract check, typecheck, lint, format check, unit tests and build, plus a separate Playwright job.

## Pinned versions

All versions are exact (`.npmrc` has `save-exact=true`); no `^` or `~`. Never upgrade to "latest" without updating this table.

| Package                            | Version | Note                                                  |
| ---------------------------------- | ------- | ----------------------------------------------------- |
| `three`                            | 0.187.0 | r187, used through `three/webgpu` (R2, D-03)          |
| `@types/three`                     | 0.187.0 | exact match                                           |
| `three-mesh-bvh`                   | 0.9.18  | for real shape-model meshes only (R2)                 |
| `react`, `react-dom`               | 19.3.1  |                                                       |
| `@types/react`, `@types/react-dom` | 19.3.0  |                                                       |
| `zustand`                          | 5.0.16  |                                                       |
| `vite`                             | 8.3.5   |                                                       |
| `@vitejs/plugin-react`             | 6.2.1   | needs Vite 8                                          |
| `@vitejs/plugin-basic-ssl`         | 2.3.0   | `dev:phone` only                                      |
| `tailwindcss`, `@tailwindcss/vite` | 4.3.4   | Tailwind v4 through the Vite plugin                   |
| `typescript`                       | 6.0.3   | not 7.x: `typescript-eslint` 8.72.1 supports `<6.1.0` |
| `@types/node`                      | 24.19.2 | matches Node 24                                       |
| `vitest`                           | 5.1.0   |                                                       |
| `jsdom`                            | 30.1.3  |                                                       |
| `@playwright/test`                 | 1.64.1  |                                                       |
| `eslint`                           | 10.14.0 |                                                       |
| `@eslint/js`                       | 10.0.1  |                                                       |
| `typescript-eslint`                | 8.72.1  |                                                       |
| `eslint-plugin-react-hooks`        | 7.1.1   |                                                       |
| `json-schema-to-typescript`        | 16.0.0  | generates `src/contract/generated.ts` (D-18)          |
| `ajv`                              | 8.20.0  | validates shared fixtures in tests (draft-07)         |
| `globals`                          | 17.14.0 |                                                       |
| `prettier`                         | 3.9.10  |                                                       |

UI components come from **animate-ui** (A10), a shadcn-style copy-in registry. `components.json` is set up for the shadcn CLI, but no components have been added yet. The `@animate-ui` registry URL in it is **[verify]** against the animate-ui docs before the first `npx shadcn@<pinned> add`.

## Layout

This follows [rendering doc R10](../docs/rendering/layout-tests-open-items.md#r10-file-layout-and-ownership). Three folders that R10 does not list are added: `contract/`, `state/` and `app/`.

```
src/
  contract/       generated.ts: types from shared/schemas/ (D-18, do not edit). Hand-written next to it:
                  TV<T>, HapticKind, HapticEvent, HapticDriver (R8.8, Q-19), assertTagged()
  state/          Zustand store: card, params, honesty (starts at `derived`, D-21), overrides (D-02),
                  and the `sky` slice (flipbook session: search, frames, playback, spectrum)
  app/            React shell: App, ViewerPanel (canvas + on-screen controls), StatusLine,
                  FixtureBanner, LiveAnnouncer, ViewerPanel.test.tsx, useHashSync + urlHash (A10 hash routing),
                  Segmented (radio-group segmented control)
    api/                  M1 API client (D-16): types (TEMPORARY until D-18 generation), checks, errors
    search/               SearchBar, parseQuery (name or RA, Dec in degrees), the 5 test targets
    flipbook/             Flipbook player, cutout preloading, playback, Rainbow Trails (D-28); session.tsx
                          (preload + playback timer shared by the panel and the transport bar);
                          colourMode + ColourViews (Raw | Colour: wavelength tint, SPHEREx composite)
    island/               (issue #66) Island, GridLoader (smoothui's, vendored; Q-123), islandStore, islandText (the "Thinking" sentence)
    shell/                (prototype) ToolRail + railIcons, Transport, PanelCard + Panels, Readout, icons, shellStore,
                          shortcuts ("/" focuses search)
    build/                (issue #60) SelectedCard, BuildPane, MouldStrip, useMould, selectedBody
    sky/                  (prototype) SkyPane (sky view, markers, picking), useTargetMarkers, readout feed
    spectrum/             SpectrumPanel, hand-rolled SVG SpectrumChart, scales
  test/           test-only helpers (fixtureFetch, sharedFixtures: loads shared/fixtures; fakeHaptics,
                  fakeAudio, hapticRecorder: haptics fakes)
  viewer/         (Moon)  ViewerApp, lighting, modes, honesty, scaleBar, altText, renderPlan + planCommon + planTypes (pure plan)
    renderers/            AsteroidMesh, AsteroidProcedural, Comet, BrownDwarf, Star (plan functions), build (plan to three.js), ShaderBody
    mould/                (issue #60) mouldSteps (pure steps, layers, progress, pose), MouldRig (apply / undo a pose)
    fields/               fieldWorker (D-12 shared field; file name [verify])
    sky/                  (prototype) SkyView (inside-out sky sphere, three r187), skyMath (pure: RA/Dec,
                          camera, picking, pan/zoom), surveys (which equirect to load)
  haptics/        (Atish)  haptics (engine), audioContext, audioGraph, settings, calibration, platform,
                  pitch, spectrumMapping, tuning (every tuning constant, D-13), profiles (buildHaptics,
                  TouchHaptics), probe (TouchProbe)
    drivers/              webVibrate, audio, tauri (stub, B-01)
    sources/              types, relief, heightMap, meshNormal, field, dataPulse, terrain, flow,
                          spectrum, lightcurve
    sound/                listenSweep (A8 Listen sweep)
    ui/                   PulseIndicator, UnlockButton, SpectrumHapticsPad, CalibrationWizard, HapticsSettings
  hapticsTestPage/  dev-only haptics test page (/haptics-test.html on the dev server; not built)
e2e/              Playwright smoke test and flipbook flow (fixtures mode)
fixtures/         SYNTHETIC dev/test fixtures and their Vite dev plugin (see fixtures/README.md)
scripts/          check-dist.js (post-build check)
```

Modules that are not built yet (now only the Tauri driver) export a single `*_PLACEHOLDER = { spec, implemented: false }` and contain no behaviour. Each file's header names its spec section. `src/layout.test.ts` checks that every R10 file exists and exports something.

### Haptics test page

`npm run dev` (or `npm run dev:phone` for HTTPS on a phone over the LAN), then open `/haptics-test.html`. It has synthetic inputs only, in three panels:

- **Engine:** every event kind, level and tag, pulse trains at 1, 2, 4, 12 and 20 Hz, the output switches, the honesty state, the audio latency readout and the pulse indicator.
- **Spectrum** (issue #10): a synthetic spectrum with a dip to feel with the spectrum pad, the calibration wizard and the settings.
- **Texture** (issue #11): a feel pad per synthetic body (gas giant, water world, rocky world, procedural asteroid, comet coma, nebula), built through `buildHaptics` with its refusals listed, and the Listen sweep.

Tap "Turn on vibration and sound" first. Debug a phone with `chrome://inspect`. The page is not a build input, so `vite build` never includes it.

### Viewer smoke scene

- `ViewerApp.create(canvas)` builds a `WebGPURenderer` and awaits `renderer.init()`, then reports `backend` (`'webgpu'` or `'webgl2'`). If neither works, the status line says "unavailable".
- The scene has one plain sphere, one `DirectionalLight` and ambient at 0.03 (R5.1). It is labelled "Viewer placeholder: no object loaded".
- Pixel ratio is `min(devicePixelRatio, 1.5)`. The scene renders only when the view changes (R5.5).
- OrbitControls handle drag and wheel. Keyboard: arrows rotate, `+`/`−` zoom, `R` resets. There are on-screen rotate, zoom and reset buttons (R5.6, WCAG 2.5.7).
- On unmount, everything (controls, geometry, material, renderer, canvas) is disposed.
- In headless Chromium (Playwright), the renderer falls back to WebGL2. WebGPU on the phones is still **[verify]** (R12 item 1).

### Viewer: baked types (M2, issue #7)

- **Plan, then draw.** `viewer/renderPlan.ts` turns an `ObjectCard` + `RenderParams` + `PlanContext` (honesty, view mode, comet epoch, light-curve scrub, failed loads) into a pure `RenderPlan`; `renderers/build.ts` turns the plan into three.js objects. All decisions are in the plan and are tested without a GPU. `ViewerApp.setObject(card, params, ctx)` / `showPlan(plan)` draw it.
- **Draw only what the backend offered.** The tier fallback (D-32) happens in the backend; the viewer never invents a layer. A layer is drawn only if the backend offered it (`params.layers`), every field in its `requires` is on the card, its tag passes the honesty state (D-21), and its mesh or texture loaded. Otherwise it is listed in `plan.missing` with a reason (`honesty`, `data`, `backend`, `load`, `epoch`, `mode`, `unverified`) and shown in plain words under "Not drawn" (`app/messages.ts`). A body falls back to a plain flat-tinted sphere, never blank.
- **Renderers:** `AsteroidMesh` (R7.1), `AsteroidProcedural` (R7.2), `Comet` with the Aug/Dec toggle (R7.3), `BrownDwarf` incl. binary (R7.4), `Star` incl. Mira and T Tauri (R7.5); `candidate` (R7.6) shows the message instead. Shader-only types (D-01) are not drawn yet.
- **Shell modules:** `lighting.ts` (R5.1), `modes.ts` (R5.2, D-23), `honesty.ts` (R5.3, D-21), `scaleBar.ts` (R5.4), `altText.ts` (R9).
- **Panel:** 3-state honesty control (starts at + Estimated), view-mode buttons, comet epoch buttons, light-curve slider, scale bar, legend with a Measured/Estimated/Default badge per layer, "Not drawn" list, canvas `aria-label` that follows the view, and a polite live region. Auto-spin runs only if the plan spins and `prefers-reduced-motion` is not set (read live), and has a Pause/Resume button (WCAG 2.2.2). The scale bar says "at most X across (upper limit)" for the comet nucleus and has a "Why this size?" button with the formula, assumption or source. Display defaults (light from the front, fixed glow) are listed under "Shown as a default" with a Default chip.
- **Rebuilds.** The scene is rebuilt only when `sceneKey(plan)` changes; textures and meshes are cached by URL (`AssetCache`) and the spin angle is kept. Gas shells and dust are instanced `Sprite`s because r187 draws `Points` at 1 px. The camera frames `plan.extent` (T Tauri disc, star trail).
- **Baked textures** (asteroid albedo, brown-dwarf bands) hold the colour already: they are shown in the visible view with a white tint and left out of the SPHEREx infrared view.
- **Open values (config, `[verify]`):** `BROWN_DWARF_CONFIG.flux45Reference` and `STAR_CONFIG.spherexBaselineYears` are `null`, so the brown-dwarf glow and the `star` motion trail are refused as "unverified"; the Mauritius comparison length in `scaleBar.ts` is `null`.
- The panel draws whatever `card` and `params` are in the store; nothing loads them yet (the M5 integration does), so in the browser the placeholder shows until then. Tests load the synthetic shared fixtures through `src/test/sharedFixtures.ts`.

### Shell and sky view (prototype, 7 Nov 2026)

- **Layout** (from `mockup/spherex-ui.html`, tokens in `src/index.css`): dark bezel; fixture banner and RA/Dec readout on top (no brand: the h1 is screen-reader only, Q-124); tool rail on the left (Sky, Flipbook, Spectrum, 3D viewer; no Haptics tool until M5) in the mock-up's icon style with a sliding highlight; the island at the top centre (issue #66, Q-121: a circle at rest, "Thinking" while an object is found, then it grows and moves into the panel, and back up on close; `src/app/island/`); the sky view as the main pane; transport bar bottom left; search pill bottom right with the quick picks above it. The Flipbook and Spectrum tools open a floating panel card (object info + flipbook + spectrum); the 3D viewer opens the build pane (below). At ≤ 640 px the rail becomes a row and the panel a bottom sheet.
- **Sky image:** `GET /v1/sky/index.json` (not in D-16, Q-87). The smallest equirect loads first; a larger one replaces it on a device that can hold it (renderer max texture size), never above 4096 px on a coarse-pointer device or with Save-Data (`SKY_PHONE_MAX_WIDTH`). With no image installed, a coordinate grid and a note show; picking still works. The picture wears the Estimated badge with the index's formula and its credit line.
- **Orientation:** seen from inside, north up, east (higher RA) to the left. `viewer/sky/skyMath.ts` documents the frame; unit tests check it against a real r187 camera and the sphere's UVs, and `e2e/sky.spec.ts` reads it back from the screen on the synthetic fixture sky (red = RA, green = Dec).
- **Interaction:** drag pans, wheel or pinch zooms (FOV 120° to 2°); a click (moved < 5 px) picks the position under the pointer, analytically from the camera ray, and runs the search with `ra,dec` (6 decimals, tagged `derived`, Q-25). Markers for the five quick-pick targets are placed from `/v1/resolve`. Smaller "cached, loads instantly" dots mark the positions `GET /v1/sky/cached` lists (not in D-16; `sky/cachedMarkers.ts`, `useCachedMarkers.ts`); a target already marked is not marked twice (same id, or within 2″), the label shows on hover or focus, and the list is loaded again when a frame list has just become complete. Keyboard on the canvas: arrows pan, +/− zoom, R resets, Enter picks the centre; no on-screen pan and zoom buttons (Q-123); "/" anywhere focuses the search.
- **Performance:** render on demand, pixel ratio ≤ 1.5 (D-05), mipmaps with anisotropy, image decode off the main thread (`ImageBitmapLoader`), texture swaps wait for the end of a drag, no React render per pointer move (readout and markers are written from refs). HiPS tile LOD is not built yet.

### Select and Build it (issue #60, Q-113)

- **Select:** a marker click searches the object as before but does not open the flipbook: green corner brackets and the name mark it on the sky, and a top-centre card (a polite live region) shows its name, its type (from the render params once loaded, otherwise "Object on the sky") and two buttons, **See fingerprint** (the object panel at the spectrum) and **Build it**. × and Escape (from anywhere, also while the marker has focus) deselect: the card, the brackets and the object in the link go, focus stays on the marker, and clicking it again selects it again. A body that failed with a timeout or a network or server error is asked for again on the next Build it or marker click. Right-clicking (long press on a phone, or the ContextMenu key on a focused marker) the brackets or any marker brings the card back, and the browser menu is suppressed there only; on a picked position without an object the card shows the coordinates, "No 3D model at this position" and a disabled Build it. A typed search still opens the object panel, which has **Build it in 3D**.
- **Split view:** Build it moves the sky to the left half (still live: drag, zoom and markers work there) and opens the build pane on the right; the flipbook transport (made `inert`) and the quick picks step aside. At ≤ 640 px the pane is a full-height sheet. `&build` (or `#build` alone) is in the hash while it is open; opening pushes a history entry marked `{ sxBuild: true }` in `history.state`, so Back closes it; × and Escape go back over that entry (or replace it when the current entry is not the marked one), so no extra Back step is left. **New seed** is disabled for bodies with nothing generated from the seed (baked asteroids). Focus goes to the pane title on open and back to the marker (or the rail button) on close.
- **The pane** is the one 3D view: "Building <name>" and the type, the tools **Feel** (says touch feedback is not connected yet; Atish's TouchHaptics, M5), **Replay**, **New seed** (seed + 1 in the browser) and **Close**, the ViewerApp canvas, the numbered steps, the **Show** honesty control and a **Details** disclosure with everything else of the old viewer card (rotate and zoom buttons, colour modes, epochs, scale bar, legend, not drawn). In the pane a drag turns the body (mock-up), wheel and pinch zoom, the keys are unchanged. The rail's 3D viewer opens the same pane with the body built at once.
- **Moulding** (`viewer/mould/`, `app/build/useMould.ts`): the card and params come from `/card` and `/render-params` (D-16); the whole body is planned and loaded first behind "Loading the 3D view", then the mock-up's steps play (2.3 s each, smoothstep). Each step reveals real plan layers (later ones are held with `PlanContext.hold`) and runs knobs whose value 1 is the normal render (scale and wireframe scaffold; sphere-to-shape morph; volume growth; the generated worlds' terrain, sea, colour and clouds). At the end nothing is held and the pose is cleared, so the frame is the normal render (checked by `e2e/build.spec.ts`). Reduced motion shows the built body at once.
- **Fixtures:** search **Aqua Prime** (or click its lilac marker near RA 38°, Dec −12°): the shared planet_water fixture, built from the same files as its golden. Its surface is `artistic`, so **Build it, Replay and New seed raise the Show level to + Artistic** (a global level change, announced; a **proposed exception to D-21** that Moon must confirm, Q-113 item 7) and the Show control stays in the pane to go back.
- **e2e:** `openViewer` opens the pane and pins its stage to the reference canvas size (574 × 430) so the committed reference pictures still apply.

### Flipbook and spectrum (M1, issue #3)

- **Search:** a name, or RA, Dec in decimal degrees (`parseQuery`). Three or more numbers (sexagesimal) ask for decimal degrees. Quick picks for the five A1.1 targets.
- **Flipbook:** plays the frames in the order the API lists them. Play/pause, step, a scrubber and a speed control (in the shell's transport bar; Home/End in the flipbook go to the first and last frame); it shows each frame's number, wavelength, UTC time and flags. Play is enabled once the current frame and the next 3 cutouts have loaded or failed; a failed cutout shows "Cutout unavailable" instead of a picture. When `north_up` is false, a note says the picture may rotate between frames.
- **Fixed frame grid** (`flipbook/frameGrid.ts`): SPHEREx cutouts differ in size (58×58 to 59×59 px, smaller where a detector edge clips them), so every frame of an object is drawn on one N×N grid of source pixels (N = the largest side, rounded up to odd; 59 when no size is stated) at one scale, in a square box that never changes size. Native-orientation frames are shifted by whole pixels so the object's (x, y) lands on the grid centre; frames on a shared north-up grid are drawn at offset 0 (Rainbow Trails uses their own x, y). Grid area that a frame leaves without data (a cutout clipped at a detector edge, wider than a 1 px sliver) is hatched dark grey, not black, behind the frame; it is static. For an object with such frames one steady line says how many ("2 of 240 frames are at a detector edge; their missing part is hatched.", with the hatch swatch); the per-frame caption shows only while paused or stopped, in space reserved for every frame (`flipbook/noData.ts`, R9: nothing flashes during playback). The tint layer has the frame's box; the ring stays on the grid centre. The caption's flags line and the preload line reserve two lines, so nothing below moves during playback.
- **Picture swap** (`flipbook/frameSwap.ts`, `useFrameSwap.ts`): the viewer keeps two `<img>` slots for the object and decodes the next frame in the hidden one (`HTMLImageElement.decode()`), then swaps, so it never shows an undecoded, black `<img>`. The picture, placement, tint, ring, hatching, caption and the transport bar's frame number and wavelength follow the shown frame and change together; the scrubber shows the requested frame. A decode slower than 1 s stops holding the old picture (the frame shows once it loads); "Cutout unavailable" appears only for a failed cutout or a real load error of that frame's own URL, never for a decode the browser cut short. The playback timer keeps its pace and never waits for a decode. When decodes are slower than the timer, a passed frame is shown only if it was requested after the frame on screen, so the picture never steps back; a decode of a cutout still downloading is replaced by the newest request (scrubbing). `data-shown`, `data-late`, `data-timed-out` and `data-decode-failed` on the viewer are diagnostics.
- **Overlays on the grid** (issue #12, A4.9; Q-102): Gaia and WISE markers (cutout pixels) and the flag mask are drawn with the shown frame's grid placement (`frameGrid.ts` `markersOnGrid`, the same whole-pixel shift as the picture), so they stay on their sources and change with the picture, not with the requested frame; a marker off the frame's own pixels (hatched no-data) or off the grid is not drawn. The mask sits above the wavelength tint. They are not drawn on the SPHEREx composite (its own north-up grid); a note says so. While frames load progressively a switched-on layer waits ("Overlays load once all the frames are in") and `/overlays` is asked for once, when the list is complete; a reply made after Stop is asked for again when Continue completes it. The field-of-view map, contamination note and marker list name the shown frame too.
- **Keyboard:** in the flipbook, Space or K plays and pauses, ←/→ step, Home/End go to the first and last frame. These keys are ignored while focus is on a button or form field (which keep their own keys) and when Alt, Ctrl or Meta is held. Space/K do nothing while the Play button is disabled.
- **Spectrum:** the ring on the object (or "Show spectrum") loads `GET /v1/objects/{id}/spectrum`. The SVG chart draws 1σ error bars; flagged points are hollow orange diamonds, named in the legend. A data table lists every point and can jump to its frame.
- **Rainbow Trails (D-28):** one dot per frame, in false colour: hue = wavelength. The colour is `derived` and wears the Estimated badge; in "Measured only" the dots go monochrome. Offered only for moving objects whose frames share a north-up grid and once a cutout has loaded; otherwise the button is disabled with the reason.
- **Colour views** (prototype, 7 Nov 2026; `flipbook/colourMode.ts`, `ColourViews.tsx`): a "Picture" switch, Raw | Colour (default Raw), and with Colour a "Colour view" switch, Wavelength tint | SPHEREx composite. Both are radio groups (one Tab stop, arrow keys, Home/End), 32 px tall with a mouse and 44 px on touch.
  - _Wavelength tint:_ each grey cutout is multiplied by the Rainbow Trails colour of its own wavelength (a `mix-blend-mode: multiply` layer over the pixelated image: pixel-sharp, no extra requests, nothing allocated per frame). Playback, scrubber and preload are unchanged. Estimated badge ("false colour: hue = wavelength" plus the stretch) and a legend with the current λ marked on the 0.75–5.0 µm scale.
  - _SPHEREx composite:_ `GET /v1/objects/{id}/composite` (not in D-16; types in `app/api/types.ts`, checked by `parseComposite`: a composite with an image needs a formula, size, scale, object pixel, `north_up` and one band per channel), once per object (cached in the store). The PNG is shown pixel-sharp at the flipbook's size with a ring at (x, y), "North up, east left", a blue/green/red legend with each band's wavelength and time, and the Estimated badge with the reply's formula. The transport bar is disabled with a note while it shows. A refused composite (`image_url: null`) says why from `missing`; request errors (`offline_cache_miss`, `upstream_unavailable`, …) show an error box with Try again.
  - In "Measured only" (D-21) both colour views fall back to the grey frames with a note (the M1 page has no honesty toggle in the flipbook; the 3D viewer's control sets it).
- **URL hash:** `#ra=<deg>&dec=<deg>[&name=<search>][&frame=<frame_id>][&colour=tint|composite]`; without `colour` the flipbook shows the raw frames, so older links keep working. A typed search pushes a history entry; pausing or stepping updates `frame` in place. Going back to the page without a hash clears the search; unusable parts of a link are shown under the search field and announced.
- **Progressive frames** (`flipbook/progressive.ts`, `FramesProgress.tsx`): when a frames reply lists `cutouts:deferred:<n>`, the flipbook shows (and plays) the frames it has, with "Fetching SPHEREx frames for this spot from the archive… 18 of 266 ready" and a Stop button, and asks again one request at a time (0.5 s apart) until nothing is deferred, merging new frames by `frame_id` in the backend's order without moving the current frame or playback. Numbers: _ready_ = frames listed; _found_ = ready + still to download (`cutouts:deferred`) + not usable (per-frame refusals such as `outside_cutout` or a failed `cutout:`). A client timeout is "still working" and is asked again (up to 5 in a row); server and network errors back off 2 s → 30 s and give up after 5 retries in a row with the error box and Try again (before the first reply they show the error at once, as before). Stop keeps the frames; Continue fetches the rest; a new search cancels it. The spectrum and the colour composite wait for the complete list ("measured once all frames have been downloaded"); after Stop they can be made from the frames found so far, and the backend lists the deferred cutouts in their `missing`. Progress goes to the polite live region at most every 15 s; completion and Stop always do.
- **States:** staged loading messages (with elapsed seconds after 5 s), `role="alert"` errors with "Try again", empty and refused results explained from `missing`, and a polite live region for status changes (R9).
- **Honesty:** SPHEREx values wear a "Measured" badge and the display stretch an "Estimated" one (`derived`, the tooltip gives its parameters); fixture data wears "Fixture" instead, plus the page banner.
