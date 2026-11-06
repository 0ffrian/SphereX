"""FastAPI application (D-15). Run: ``uv run uvicorn app.main:create_app --factory --port 8000``."""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import objects, resolve, spectrum
from app.context import make_context
from app.core.card.assets import AssetStore
from app.core.card.service import ObjectPipeline
from app.core.find.frames import FrameService
from app.core.find.resolver import load_aliases
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

    app = FastAPI(title="Shift & Spectrum API", version="0.1.0")
    app.state.ctx = ctx
    app.state.frames = FrameService(ctx)
    app.state.pipeline = ObjectPipeline(
        app.state.frames, AssetStore(ctx.cache, s.assets_dir, s.data_release)
    )
    app.state.aliases = load_aliases(s.targets_file)
    # Order matters: the middleware added last is outermost. The catch-all goes in first so
    # that CORS wraps it and a 500 still carries CORS headers.
    install_catch_all(app)
    if s.cors_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=s.cors_list,
            allow_methods=["GET"],
            # Let the browser read the D-16 cached_at and the asset status (Q-39).
            expose_headers=["X-SX-Cached-At", "X-SX-Asset-Status"],
        )
    install_error_handlers(app)
    app.include_router(resolve.router)
    app.include_router(objects.router)
    app.include_router(spectrum.router)

    @app.get("/v1/health", tags=["meta"])
    def health() -> dict[str, object]:
        return {"status": "ok", "offline": s.offline, "data_release": s.data_release}

    return app
