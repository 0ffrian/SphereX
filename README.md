# Shift & Spectrum

NASA Space Apps 2026, Port Louis. Challenge: **Planet X and SPHEREx**.

A public web tool: enter coordinates or a name, watch real SPHEREx frames of that patch play as a series, click any object to see its spectrum, then explore it as a 3D body you can rotate, listen to and (on Android) feel.

## Repo map

| Path | What |
|---|---|
| [docs/](docs/) | Specs, decision log and UML diagrams. Start with [docs/README.md](docs/README.md). |
| [mockup/spherex-ui.html](mockup/spherex-ui.html) | Single-file UI mock-up. Open it in a browser. |
| [backend/](backend/README.md) | Python 3.12 FastAPI: name resolver, SPHEREx frames and cutouts, read-through cache (see its README). |
| [frontend/](frontend/) | Web app, 3D viewer, haptics and audio (empty until the event). |
| [shared/](shared/) | JSON schemas for the ObjectCard and RenderParams. |

## Run it (from the repo root)

Needs Node 24 or later.

```bash
npm run setup       # first time: installs frontend dependencies from the lockfile
                    # (setup:clean = npm ci; stop any running dev server first on Windows)
npm run dev         # http://localhost:5173, and on the LAN at http://<this-PC's-IP>:5173 (Vite prints it)
npm run dev:phone   # same on HTTPS (self-signed); use this on phones so WebGPU is available
npm run check       # typecheck + lint + unit tests + build
```

Other root scripts: `build`, `preview`, `test`, `test:e2e`, `lint`, `typecheck`, `format`. They all forward to `frontend/`, and the dependencies live in `frontend/package.json`.

## Backend (from the repo root)

Needs Python 3.12 and [uv](https://docs.astral.sh/uv/) 0.12.

```bash
npm run backend:setup      # uv sync from backend/uv.lock
npm run backend:dev        # API on http://localhost:8000, all routes under /v1
npm run backend:check      # ruff + mypy + pytest (offline, recorded fixtures)
npm run backend:prefetch   # fill the cache for the test targets while the internet is good
```

`SX_OFFLINE=1` never touches the network (the demo runs this way). The cache lives outside the repo; details in [backend/README.md](backend/README.md).

## Status

Pre-event: design and documentation only. Building starts 14 Nov 2026.
