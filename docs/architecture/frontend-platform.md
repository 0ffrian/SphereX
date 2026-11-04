# Frontend and platform

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A10–A10.1 · **Implements:** D-03, D-05

## A10 Frontend and platform

| Area | Choice | Note |
|---|---|---|
| Build | Vite + TypeScript | Pin exact versions in `package.json` and the lockfile. |
| UI | React, TypeScript, Tailwind, animate-ui components | animate-ui is the agreed UI library. |
| 3D | three.js **r187** through `three/webgpu` (`WebGPURenderer`, WebGL2 fallback **[verify]**) (D-03) | The mock-up stays on r128 and is not ported in place. Generators move from the mock-up into ES modules, kept as plain modules so they work with or without React. |
| State | Zustand. One store holding the current ObjectCard, RenderParams, overrides and edited sliders. | |
| Haptics | `frontend/src/haptics/`: engine, web vibrate driver, audio driver, event sources (rendering doc §8.8, §10) | [Section 9](haptics.md#a9-haptics). |
| Backend | Python 3.12 API with Astropy, plus the texture baker (`numpy`, `scipy`, `opencv-python-headless`, `Pillow`, CPU only) | Framework not chosen yet (Q-01). |
| Data access | A thin backend proxy for IRSA, Gaia, Horizons, SBDB, SIMBAD and the Exoplanet Archive | Browser access (CORS) was **not tested**. A proxy also gives caching and keeps API keys off the client. Python with Astropy fits the challenge's Astropy hint. |
| Hosting | Not decided: the same AWS server or static hosting (Q-02) | |
| Caching | Pre-fetch and store results for all five test targets and the demo objects. Pre-bake their textures. | IRSA times out, so a live demo must not depend on it. |
| Hash routing | Share a link with coordinates or an asset id in the URL | Optional challenge item. |
| Fallbacks | Procedural look, procedural sound, audio when there is no vibration, recorded backup demo | Every optional service has one. |

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
