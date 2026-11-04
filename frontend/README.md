# frontend

Vite + TypeScript + React web app. three.js **r187** (`three/webgpu`).

Status: **scaffold only** (set up 4 Nov 2026, before the 14 Nov build start, at the team's request). It has the tooling, the data-contract types, typed placeholder modules for every R10 file and a viewer smoke scene (one plain sphere). No object is loaded yet.

## Run it

Needs Node 24 (`.nvmrc`) and npm.

```sh
cd frontend
npm ci              # exact versions from package-lock.json
npm run dev         # http://localhost:5173
```

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

| Script                    | Does                                                                           |
| ------------------------- | ------------------------------------------------------------------------------ |
| `dev`                     | Vite dev server                                                                |
| `dev:phone`               | Vite on the LAN (`--host`) with HTTPS                                          |
| `build`                   | `tsc -b && vite build`                                                         |
| `preview`                 | serve `dist/`                                                                  |
| `typecheck`               | `tsc -b --noEmit` (strict, `noUncheckedIndexedAccess`, `noImplicitOverride`)   |
| `lint`                    | ESLint flat config (typescript-eslint, react-hooks)                            |
| `format` / `format:check` | Prettier                                                                       |
| `test`                    | Vitest (jsdom)                                                                 |
| `test:e2e`                | Playwright smoke test, Chromium only (`npx playwright install chromium` first) |

CI: [`.github/workflows/frontend.yml`](../.github/workflows/frontend.yml) runs typecheck, lint, format check, unit tests and build, plus a separate Playwright job.

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
| `globals`                          | 17.14.0 |                                                       |
| `prettier`                         | 3.9.10  |                                                       |

UI components come from **animate-ui** (A10), a shadcn-style copy-in registry. `components.json` is set up for the shadcn CLI, but no components have been added yet. The `@animate-ui` registry URL in it is **[verify]** against the animate-ui docs before the first `npx shadcn@<pinned> add`.

## Layout

This follows [rendering doc R10](../docs/rendering/layout-tests-open-items.md#r10-file-layout-and-ownership). Three folders that R10 does not list are added: `contract/`, `state/` and `app/`.

```
src/
  contract/       data contract types: Tag, TV, ObjectType, ObjectCard, RenderParams, Layer (R3, D-04, D-12),
                  HapticKind, HapticEvent, HapticDriver, HapticProfile (R8.8, D-10, D-12), assertTagged()
  state/          Zustand store: card, params, honesty (null until Q-08), overrides (D-02)
  app/            React shell: App, ViewerPanel (canvas + on-screen controls), StatusLine
  viewer/         (Moon)  ViewerApp [smoke scene], lighting, modes, honesty, scaleBar, altText
    renderers/            AsteroidMesh, AsteroidProcedural, Comet, BrownDwarf, Star, ShaderBody
    fields/               fieldWorker (D-12 shared field; file name [verify])
  haptics/        (Moon, Atish for sources)  haptics, calibration
    drivers/              webVibrate, audio, tauri (stub, B-01)
    sources/              heightMap, meshNormal, field, terrain, flow, spectrum, lightcurve
e2e/              Playwright smoke test
```

Modules that are not built yet export a single `*_PLACEHOLDER = { spec, implemented: false }` and contain no behaviour. Each file's header names its spec section. `src/layout.test.ts` checks that every R10 file exists and exports something.

### Viewer smoke scene

- `ViewerApp.create(canvas)` builds a `WebGPURenderer` and awaits `renderer.init()`, then reports `backend` (`'webgpu'` or `'webgl2'`). If neither works, the status line says "unavailable".
- The scene has one plain sphere, one `DirectionalLight` and ambient at 0.03 (R5.1). It is labelled "Viewer placeholder: no object loaded".
- Pixel ratio is `min(devicePixelRatio, 1.5)`. The scene renders only when the view changes (R5.5).
- OrbitControls handle drag and wheel. Keyboard: arrows rotate, `+`/`−` zoom, `R` resets. There are on-screen rotate, zoom and reset buttons (R5.6, WCAG 2.5.7).
- On unmount, everything (controls, geometry, material, renderer, canvas) is disposed.
- In headless Chromium (Playwright), the renderer falls back to WebGL2. WebGPU on the phones is still **[verify]** (R12 item 1).
