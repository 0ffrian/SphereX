"""FastAPI application (D-15). Run: ``uv run uvicorn app.main:create_app --factory --port 8000``."""

from __future__ import annotations

import logging
import re
import subprocess
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api import areas, composite, gemini, objects, overlays, resolve, sky, spectrum
from app.context import make_context
from app.core.card.assets import AssetStore
from app.core.card.catalogue import SHAPE_URL_ROOT, load_shape_registry, mesh_file
from app.core.card.service import ObjectPipeline
from app.core.find.frames import FrameService
from app.core.find.overlays import OverlayService
from app.core.find.resolver import load_aliases
from app.core.measure.pool import MeasurePool
from app.core.render.background import TextureBaker
from app.core.render.gemini_paint import GeminiPainter, make_client
from app.core.warm import WarmCache, demo_queries
from app.errors import install_catch_all, install_error_handlers
from app.settings import Settings, get_settings

log = logging.getLogger("shift_spectrum")


def _inside_git_worktree(path: Path) -> bool:
    probe = path if path.exists() else next((p for p in path.parents if p.exists()), path)
    try:
        out = subprocess.run(
            ["git", "-C", str(probe), "rev-parse", "--is-inside-work-tree"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return out.stdout.strip() == "true"


_SHAPE_NAME = re.compile(r"[a-z0-9][a-z0-9._-]*\.glb")


def create_app(
    settings: Settings | None = None, *, transport: httpx.BaseTransport | None = None
) -> FastAPI:
    s = settings or get_settings()
    ctx = make_context(s, transport=transport)
    if _inside_git_worktree(s.cache_dir):
        log.warning(
            "SX_CACHE_DIR %s is inside a git work tree; D-25 keeps the cache outside git",
            s.cache_dir,
        )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        warm: WarmCache | None = None
        if s.prefetch_on_start:  # D-25 warm cache for the demo objects (issue #41)
            queries = demo_queries(s.targets_file, s.prefetch_group_list)
            warm = WarmCache(ctx, app.state.pipeline, app.state.aliases, queries)
            warm.start()
        app.state.warm = warm
        yield
        if warm is not None:
            warm.stop()
        app.state.overlays.close()  # stop the catalogue fetch pool (issue #12)
        # Issue #41: no new jobs, queued downloads, measurements and bakes dropped.
        app.state.pipeline.close()
        app.state.frames.close()
        app.state.measure_pool.close()
        app.state.baker.close()

    app = FastAPI(title="Shift & Spectrum API", version="0.1.0", lifespan=lifespan)
    app.state.ctx = ctx
    app.state.frames = FrameService(ctx)
    app.state.overlays = OverlayService(app.state.frames)
    app.state.measure_pool = MeasurePool(s.measure_workers)
    textures = s.textures_path
    textures.mkdir(parents=True, exist_ok=True)
    app.state.baker = TextureBaker(textures, s.bake_workers)
    app.state.pipeline = ObjectPipeline(
        app.state.frames,
        AssetStore(ctx.cache, s.assets_dir, s.data_release),
        measure_pool=app.state.measure_pool,
        baker=app.state.baker if s.bake_textures else None,
    )
    # Issue #41: a capped web request (/frames, /spectrum, overlays) downloads no cutouts itself;
    # it starts or joins the object's job, which downloads them in the shared bounded pool.
    app.state.frames.on_request = app.state.pipeline.request_frames
    app.state.aliases = load_aliases(s.targets_file)
    # Gemini layer (issue #14): no key -> client None, the layer is off and the code colour shows.
    app.state.gemini = GeminiPainter(s, ctx.cache, make_client(s, transport=transport))
    # Order matters: the middleware added last is outermost. The catch-all goes in first so
    # that CORS wraps it and a 500 still carries CORS headers.
    install_catch_all(app)
    if s.cors_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=s.cors_list,
            # GET, and POST for Track on demand (issue #142); the admin POST stays curl-only
            # because its X-SX-Admin-Token header is not an allowed header.
            allow_methods=["GET", "POST"],
            # Let the browser read the D-16 cached_at, the asset status (Q-39) and the
            # combine metadata (Q-50).
            expose_headers=[
                "X-SX-Cached-At",
                "X-SX-Asset-Status",
                "X-SX-Combine",
                "X-SX-Measuring",  # issue #41 first-stage answer (Q-111)
                "X-SX-Progress",
                "X-SX-Layer-Tag",  # the AI albedo's provenance tag (issue #14, Q-122)
            ],
        )
    install_error_handlers(app)
    app.include_router(resolve.router)
    app.include_router(objects.router)
    app.include_router(spectrum.router)
    app.include_router(composite.router)
    app.include_router(overlays.router)
    app.include_router(gemini.router)
    app.include_router(sky.router)
    app.include_router(areas.router)  # A17.8, issue #108
    # R6.7 / A5.4: the baked textures that RenderParams.textures point at (TEXTURE_URL_ROOT).
    app.mount("/data/textures", StaticFiles(directory=textures), name="textures")
    # Q-164: the pre-built demo pack's maps (committed, read only). Same StaticFiles rules as
    # above (no directory listing, no path outside the root); mounted offline too.
    if s.demo_textures_dir.is_dir():
        app.mount(
            "/data/demo-textures",
            StaticFiles(directory=s.demo_textures_dir),
            name="demo-textures",
        )

    shapes_dir = s.shapes_dir

    # Q-44 / Q-61: same-origin, read-only shape meshes. Only names that match the pattern and
    # that the registry lists (lod0 / lod1) are served, so no path can leave the folder and no
    # stray file is published.
    @app.get("/data/shapes/{name}", include_in_schema=False)
    def shape_mesh(name: str) -> FileResponse:
        path = None
        if _SHAPE_NAME.fullmatch(name):
            listed = {u for m in load_shape_registry(shapes_dir).values() for u in (m.lod0, m.lod1)}
            url = SHAPE_URL_ROOT + name
            path = mesh_file(shapes_dir, url) if url in listed else None
        if path is None:
            raise HTTPException(status_code=404, detail="no such shape model")
        return FileResponse(path, media_type="model/gltf-binary")

    @app.get("/v1/health", tags=["meta"])
    def health() -> dict[str, object]:
        # Issue #103: the start-up warm cache's progress, so the operator knows when the demo
        # objects answer from the cache. state "off" when SX_PREFETCH_ON_START is not set.
        warm: WarmCache | None = getattr(app.state, "warm", None)
        progress = (
            warm.status()
            if warm is not None
            else {"state": "off", "total": 0, "done": 0, "failed": 0}
        )
        return {
            "status": "ok",
            "offline": s.offline,
            "data_release": s.data_release,
            "warm": progress,
        }

    return app
