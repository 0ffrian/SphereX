# Frontend and platform

> **Part of:** Architecture spec ([index](README.md)) · **Sections:** A10–A10.2 · **Implements:** [D-03, D-05, D-24, Q-132](../decisions/platform-hosting.md), [D-15, D-25](../decisions/data-sources.md), [D-22, D-27](../decisions/contract.md), [Q-29](../decisions/gemini.md), [Q-112](../decisions/pipeline-jobs.md), [Q-137](../decisions/scope-process.md) · **Read with:** [../../frontend/README.md](../../frontend/README.md), [../../backend/README.md](../../backend/README.md#settings-sx_-environment-variables) (settings), [../rendering/display-rules.md](../rendering/display-rules.md) (R5.5 budget), [sky-shell.md](sky-shell.md) (A21 app shell)

## A10 Frontend and platform

**The event build is desktop browser only** ([Q-132](../decisions/platform-hosting.md), decided 9 Nov 2026): it runs on Atish's Asus TUF A15 laptop, with no Android build and no `navigator.vibrate`. Phones and vibration come after the event. D-05, D-08 and D-24 still describe phones; their amendments are pending (Q-132).

| Area | Choice | Status | Note |
|---|---|---|---|
| Build | Vite + TypeScript | Built | Pin exact versions in `package.json` and the lockfile. |
| UI | React, TypeScript, Tailwind; `motion` 14.10.1 for animation; the smoothui grid loader copied into `src/app/island/GridLoader.tsx` (MIT, Q-123) | Built | animate-ui is the agreed component library, but no animate-ui component is used yet ([frontend README](../../frontend/README.md#pinned-versions)). |
| App shell | Sky view as the main pane, tool rail, island, object panel, Build it split view | Built (#47, #60, #64, #66) | Specified in A21 ([sky-shell.md](sky-shell.md)) and R5.8 ([../rendering/build-mould.md](../rendering/build-mould.md)). |
| 3D | three.js **r187** through `three/webgpu` (`WebGPURenderer`, WebGL2 fallback) (D-03) | Built | The fallback works in headless Chromium (SwiftShader); a real-GPU check on the A15 is open **[verify]** (A14.1). The mock-up stays on r128 and is not ported in place. |
| State | Zustand. One store holding the current ObjectCard, RenderParams, overrides and edited sliders. | Built | `overrides` type: D-27. D-22 keeps them in IndexedDB; **not built yet**, they live in memory ([A5.3](data-contract.md#a53-overrides)). |
| Sound and haptics | `frontend/src/haptics/`: engine, audio driver, web vibrate driver, event sources (R8.8) | Built against fixtures; wired into the app in M5 | At the event only the audio driver plays (Q-132). [A8](sound-voice.md#a8-sound-and-voice), [A9](haptics.md#a9-haptics). |
| Backend | **FastAPI** on Python 3.12 with Pydantic v2 models and Astropy, plus the texture baker (`numpy`, `scipy`, `opencv-python-headless`, `Pillow`, CPU only) (D-15) | Built | Versions pinned exactly. Every route: [A4.11](endpoints.md#a411-endpoint-register). |
| Settings | `SX_*` environment variables (`backend/app/settings.py`) | Built | Owner of every name and default: [backend/README.md](../../backend/README.md#settings-sx_-environment-variables). Specs name a setting and link there. |
| Data access | A thin backend proxy for IRSA, Gaia, Horizons, SBDB, SIMBAD, SkyBoT and the Exoplanet Archive | Built | Browser access (CORS) was **not tested**. A proxy also gives caching and keeps API keys off the client. |
| Caching | One read-through disk cache in the backend for every external call (D-25). `SX_OFFLINE=1` never touches the network; the demo runs in this mode. The pre-fetch script fills it for the five test targets and every demo object. The cached responses are also the test fixtures: never hand-edit them, re-record them with the pre-fetch script. | Built (#1) | IRSA times out and Gaia takes about 24 s per query, so a live demo must not depend on them. Key, order and storage rules: D-25 and [backend/README.md#cache-d-25](../../backend/README.md#cache-d-25). |
| Hosting | Local on the **Asus A15** (D-24). At the event the browser runs on the same laptop. One process serves the built frontend and the API from one origin. | **To build** (#15, Kevin) | Today `backend/app/main.py` mounts no frontend `dist`; development uses the Vite proxy. `http://localhost` is a secure context, so WebGPU needs no certificate when the browser runs on the A15 itself. The LAN, phone certificates (`mkcert`) and the router of D-24 are post-event, pending the D-24 amendment (Q-132). Run steps: [A10.2](#a102-running-the-event-build). |
| Hash routing | `#ra=…&dec=…[&name=…][&frame=…][&colour=tint\|composite][&build]` (`src/app/useHashSync.ts`, `urlHash.ts`; Q-95) | Built (#3, #47, #60) | Parameters and history rules are owned by A21.11 ([sky-shell-behaviour.md](sky-shell-behaviour.md)). Optional challenge item. |
| Fallbacks | Procedural look, procedural sound, recorded backup demo (#17) | Partly built | Every optional service has one. Backup video: #17 (M5). |

**Installed versions** (exact, from `frontend/package.json`, scaffold of 4 Nov 2026): three 0.187.0, React 19.3.1, Vite 8.3.5, TypeScript 6.0.3, Tailwind 4.3.4, Zustand 5.0.16. TypeScript is held at 6.0.3 because `typescript-eslint` 8.72.1 supports only TypeScript < 6.1. The full list is in the [frontend README](../../frontend/README.md#pinned-versions).

### A10.1 Performance budget (D-05)

The budget (frame rate, pixel ratio, mesh, points, textures, displacement, shader cost, quality levels) is owned by [R5.5 and R5.7](../rendering/display-rules.md). D-05 still has the old "render only on change" row; [D-34](../decisions/rendering-motion.md) (pending team confirmation) amends it to also render every frame while a simulation clock runs, and R5.5 follows D-34; Q-64 asks whether R5.7's 60 fps targets replace it. This section keeps only the targets and what has been measured.

- **Event target:** Atish's Asus TUF A15 laptop, desktop browser (Q-132, answers Q-15). Its GPU and browser version are **[verify]** (Atish, with #15); the D-05 budgets are kept until that is measured. The Intel Iris Xe (Zenbook 14X) named in D-05 is no longer the demo machine.
- **After the event:** the realme 14 Pro and a Samsung phone, Android 16 with Chrome, for vibration (D-05, D-08).
- **Sky texture:** 4096×2048 first, 8192×4096 where the GPU allows (Q-90, A21).
- **Measured so far:** frame times only in headless Chromium with software rendering (`frontend/e2e`); not on the A15 (Q-107, [rendering/reference/frame-time.md](../rendering/reference/frame-time.md)). Measuring on the A15 is part of #16.

### A10.2 Running the event build

The run steps for 14 to 15 Nov, gathered from D-24, D-25, Q-112 and Q-137. Owner: Kevin (M5, #15), with Atish (the A15).

1. **Before the event, with internet** (backend folder): `uv run python -m scripts.prefetch --group test`, `--group demo` and the Track object (433 Eros is in group `fixture`, see Q-NEW-ARCH-4 in [A3.12](targets.md#a312-test-and-demo-targets)); `uv run python -m scripts.sky_mirror --max-order 6 --max-mb 45000 --allow-unclonable --bake` for the sky (D-35, depth Q-88); the precomputed Area search areas (D3, A16.7); then `uv run python -m scripts.smoke_offline --group test` and `--group demo` to check every target answers offline; then `uv run python -m scripts.backup_cache` (zipped copy, D-25).
2. **Freeze the release:** `SX_DATA_RELEASE=spherex_qr2`; do not switch to DR1 (Q-137).
3. **Start the backend:** `SX_OFFLINE=1 SX_PREFETCH_ON_START=1 uv run uvicorn app.main:create_app --factory --host localhost --port 8000`. The warm start builds every demo object's card and bakes its textures from the cache before visitors arrive (about 17 s per bake otherwise, Q-112). Leave `SX_ADMIN_TOKEN` unset, so the Gemini repaint route does not exist; `SX_GEMINI_OFFLINE_CACHE` follows Q-29.
4. **Serve the frontend:** the one-origin server is #15 (to build). **Proposed (Q-NEW-ARCH-6):** until #15 lands, run `npm run build` and `npm run preview` in `frontend/` (port 4173, which proxies `/v1` and `/data` to the backend), and open `http://localhost:4173` in Chrome on the A15.
5. **Check:** `GET /v1/health` answers `{status: "ok", offline: true, data_release: "spherex_qr2"}`; open Eros in Track and one demo object in the flipbook.
6. **Fallback:** the recorded backup demo video (#17).
