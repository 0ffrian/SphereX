# Frontend and platform

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A10–A10.1 · **Implements:** D-03, D-05, D-15, D-24, D-25

## A10 Frontend and platform

| Area | Choice | Note |
|---|---|---|
| Build | Vite + TypeScript | Pin exact versions in `package.json` and the lockfile. |
| UI | React, TypeScript, Tailwind, animate-ui components | animate-ui is the agreed UI library. |
| 3D | three.js **r187** through `three/webgpu` (`WebGPURenderer`, WebGL2 fallback **[verify]**) (D-03) | The mock-up stays on r128 and is not ported in place. Generators move from the mock-up into ES modules, kept as plain modules so they work with or without React. |
| State | Zustand. One store holding the current ObjectCard, RenderParams, overrides and edited sliders. | `overrides` type: D-27. They stay in the browser (IndexedDB, D-22). |
| Haptics | `frontend/src/haptics/`: engine, web vibrate driver, audio driver, event sources (rendering doc §8.8, §10) | [Section 9](haptics.md#a9-haptics). |
| Backend | **FastAPI** on Python 3.12 with Pydantic v2 models and Astropy, plus the texture baker (`numpy`, `scipy`, `opencv-python-headless`, `Pillow`, CPU only) (D-15) | Versions pinned exactly when installed. Endpoints: D-16. The Gemini layer adds an admin endpoint and two read endpoints, not yet in D-16 ([A6.2](generators.md#a62-optional-gemini-artistic-layer), Q-122). |
| Data access | A thin backend proxy for IRSA, Gaia, Horizons, SBDB, SIMBAD and the Exoplanet Archive | Browser access (CORS) was **not tested**. A proxy also gives caching and keeps API keys off the client. Python with Astropy fits the challenge's Astropy hint. |
| Hosting | Local on the team's **Asus A15** laptop (D-24). One process serves the built frontend and the API from one origin, over HTTPS. Phones and other laptops connect over the local network. | WebGPU needs a secure context. Install a local root certificate on both Android phones (e.g. `mkcert`); whether a clicked-through self-signed certificate is enough is **[verify]**. Bring a router or hotspot. No public URL after the event. |
| Caching | One read-through disk cache in the backend for every external call (D-25). `SX_OFFLINE=1` never touches the network; the demo runs in this mode. A pre-fetch script fills the cache for the five test targets and every demo object. The cached responses are also the test fixtures: never hand-edit them, re-record them with the pre-fetch script. Pre-bake their textures. | IRSA times out and Gaia takes about 24 s per query, so a live demo must not depend on them. Key, order and storage rules: D-25. |
| Hash routing | Share a link with coordinates or an asset id in the URL | Optional challenge item. |
| Fallbacks | Procedural look, procedural sound, audio when there is no vibration, recorded backup demo | Every optional service has one. |

**Installed versions** (exact, from `frontend/package.json`, scaffold of 4 Nov 2026): three 0.187.0, React 19.3.1, Vite 8.3.5, TypeScript 6.0.3, Tailwind 4.3.4, Zustand 5.0.16. TypeScript is held at 6.0.3 because `typescript-eslint` 8.72.1 supports only TypeScript < 6.1. The full list is in the [frontend README](../../frontend/README.md#pinned-versions).

### A10.1 Performance budget (D-05)

Two targets:

- **Demo laptop:** Intel Iris Xe (Zenbook 14X).
- **Phones:** realme 14 Pro and a Samsung, both Android 16 with Chrome. Haptics can only be shown on the phones.

Where the budgets differ, take the tighter one:

| Item | Budget |
|---|---|
| Frame rate | ≥ 30 fps while rotating; render only on change |
| Pixel ratio | `min(devicePixelRatio, 1.5)` |
| Mesh | ≤ 50k triangles (decimate NASA GLBs offline) |
| Points | ≤ 60k |
| Textures | 2048×1024 desktop, 1024×512 mobile |
| Displacement | Desktop only |
| Browser shaders | Few texture reads per pixel, 5 or 6 noise octaves |
| Measured so far | Not measured on the real laptop or phones. Tested only in headless Chromium with software rendering. |
