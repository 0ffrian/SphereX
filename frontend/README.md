# frontend

Vite + TypeScript + React web app. three.js **r187** (`three/webgpu`).

Status: the tooling, the data-contract types, typed placeholder modules for every R10 file and a viewer smoke scene (one plain sphere), set up on 4 Nov 2026. M1 (issue #3, 5 Nov 2026) adds the SPHEREx flipbook and spectrum view: search by name or RA/Dec, frame playback, the spectrum chart, Rainbow Trails and the shareable URL hash. The 3D viewer does not load an object yet.

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

| Script                    | Does                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `dev`                     | Vite dev server                                                                                          |
| `dev:phone`               | Vite on the LAN (`--host`) with HTTPS                                                                    |
| `dev:fixtures`            | Vite dev server with `/v1` served from the synthetic fixtures                                            |
| `build`                   | `tsc -b && vite build`, then `check:dist`                                                                |
| `check:dist`              | Fails if fixture code or data is in `dist/`                                                              |
| `preview`                 | serve `dist/`                                                                                            |
| `typecheck`               | `tsc -b --noEmit` (strict, `noUncheckedIndexedAccess`, `noImplicitOverride`)                             |
| `lint`                    | ESLint flat config (typescript-eslint, react-hooks)                                                      |
| `format` / `format:check` | Prettier                                                                                                 |
| `test`                    | Vitest (jsdom)                                                                                           |
| `test:e2e`                | Playwright smoke and flipbook tests on fixtures, Chromium only (`npx playwright install chromium` first) |
| `contract:gen`            | Rewrites `src/contract/generated.ts` from `../shared/schemas/` (D-18)                                    |
| `contract:check`          | Fails if `src/contract/generated.ts` differs from a fresh generation                                     |

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
  state/          Zustand store: card, params, honesty (null until Q-08), overrides (D-02),
                  and the `sky` slice (flipbook session: search, frames, playback, spectrum)
  app/            React shell: App, ViewerPanel (canvas + on-screen controls), StatusLine,
                  FixtureBanner, LiveAnnouncer, useHashSync + urlHash (A10 hash routing)
    api/                  M1 API client (D-16): types (TEMPORARY until D-18 generation), checks, errors
    search/               SearchBar, parseQuery (name or RA, Dec in degrees), the 5 test targets
    flipbook/             Flipbook player, cutout preloading, playback, Rainbow Trails (D-28)
    spectrum/             SpectrumPanel, hand-rolled SVG SpectrumChart, scales
  test/           test-only helpers (fixtureFetch)
  viewer/         (Moon)  ViewerApp [smoke scene], lighting, modes, honesty, scaleBar, altText
    renderers/            AsteroidMesh, AsteroidProcedural, Comet, BrownDwarf, Star, ShaderBody
    fields/               fieldWorker (D-12 shared field; file name [verify])
  haptics/        (Moon, Atish for sources)  haptics, calibration
    drivers/              webVibrate, audio, tauri (stub, B-01)
    sources/              heightMap, meshNormal, field, terrain, flow, spectrum, lightcurve
e2e/              Playwright smoke test and flipbook flow (fixtures mode)
fixtures/         SYNTHETIC dev/test fixtures and their Vite dev plugin (see fixtures/README.md)
scripts/          check-dist.js (post-build check)
```

Modules that are not built yet export a single `*_PLACEHOLDER = { spec, implemented: false }` and contain no behaviour. Each file's header names its spec section. `src/layout.test.ts` checks that every R10 file exists and exports something.

### Viewer smoke scene

- `ViewerApp.create(canvas)` builds a `WebGPURenderer` and awaits `renderer.init()`, then reports `backend` (`'webgpu'` or `'webgl2'`). If neither works, the status line says "unavailable".
- The scene has one plain sphere, one `DirectionalLight` and ambient at 0.03 (R5.1). It is labelled "Viewer placeholder: no object loaded".
- Pixel ratio is `min(devicePixelRatio, 1.5)`. The scene renders only when the view changes (R5.5).
- OrbitControls handle drag and wheel. Keyboard: arrows rotate, `+`/`−` zoom, `R` resets. There are on-screen rotate, zoom and reset buttons (R5.6, WCAG 2.5.7).
- On unmount, everything (controls, geometry, material, renderer, canvas) is disposed.
- In headless Chromium (Playwright), the renderer falls back to WebGL2. WebGPU on the phones is still **[verify]** (R12 item 1).

### Flipbook and spectrum (M1, issue #3)

- **Search:** a name, or RA, Dec in decimal degrees (`parseQuery`). Three or more numbers (sexagesimal) ask for decimal degrees. Quick picks for the five A1.1 targets.
- **Flipbook:** plays the frames in the order the API lists them. Play/pause, step, first/last, a scrubber and a speed control; it shows each frame's number, wavelength, UTC time and flags. Play is enabled once the current frame and the next 3 cutouts have loaded or failed; a failed cutout shows "Cutout unavailable" instead of a picture. When `north_up` is false, a note says the picture may rotate between frames.
- **Keyboard:** in the flipbook, Space or K plays and pauses, ←/→ step, Home/End go to the first and last frame. These keys are ignored while focus is on a button or form field (which keep their own keys) and when Alt, Ctrl or Meta is held. Space/K do nothing while the Play button is disabled.
- **Spectrum:** the ring on the object (or "Show spectrum") loads `GET /v1/objects/{id}/spectrum`. The SVG chart draws 1σ error bars; flagged points are hollow orange diamonds, named in the legend. A data table lists every point and can jump to its frame.
- **Rainbow Trails (D-28):** one dot per frame, in false colour: hue = wavelength. The colour is `derived` and wears the Estimated badge; in "Measured only" the dots go monochrome. Offered only for moving objects whose frames share a north-up grid and once a cutout has loaded; otherwise the button is disabled with the reason.
- **URL hash:** `#ra=<deg>&dec=<deg>[&name=<search>][&frame=<frame_id>]`. A typed search pushes a history entry; pausing or stepping updates `frame` in place. Going back to the page without a hash clears the search; unusable parts of a link are shown under the search field and announced.
- **States:** staged loading messages (with elapsed seconds after 5 s), `role="alert"` errors with "Try again", empty and refused results explained from `missing`, and a polite live region for status changes (R9).
- **Honesty:** SPHEREx values wear a "Measured" badge and the display stretch an "Estimated" one (`derived`, the tooltip gives its parameters); fixture data wears "Fixture" instead, plus the page banner.
