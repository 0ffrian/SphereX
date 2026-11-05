"""API errors: JSON ``{"error": code, "detail": sentence}`` with a 4xx/5xx status (brief)."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.cache.store import CacheMissOffline, UpstreamUnavailable

log = logging.getLogger("shift_spectrum")


class ApiError(Exception):
    def __init__(self, status: int, code: str, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.code = code
        self.detail = detail


INTERNAL = {"error": "internal", "detail": "Something went wrong on the server."}


def install_catch_all(app: FastAPI) -> None:
    """Turn any unhandled error into the JSON 500.

    This is an HTTP middleware, not an exception handler: an ``Exception`` handler runs in
    Starlette's ServerErrorMiddleware, outside CORSMiddleware, so its response would carry no
    CORS headers and the browser would only see "Failed to fetch". Install this before
    CORSMiddleware so that CORS ends up outermost.
    """

    @app.middleware("http")
    async def _catch_all(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        try:
            return await call_next(request)
        except Exception as exc:
            # Log the traceback on the server; never send it to the client.
            log.error("unhandled error on %s", request.url.path, exc_info=exc)
            return JSONResponse(status_code=500, content=INTERNAL)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status, content={"error": exc.code, "detail": exc.detail}
        )

    @app.exception_handler(CacheMissOffline)
    async def _offline(_: Request, exc: CacheMissOffline) -> JSONResponse:
        detail = (
            "This data is not in the offline cache (SX_OFFLINE=1). "
            "Try one of the pre-fetched targets."
        )
        return JSONResponse(
            status_code=503, content={"error": "offline_cache_miss", "detail": detail}
        )

    @app.exception_handler(UpstreamUnavailable)
    async def _upstream(_: Request, exc: UpstreamUnavailable) -> JSONResponse:
        detail = (
            "The archive did not answer in time and nothing is cached for this request. "
            "Try again later or pick a pre-fetched target."
        )
        return JSONResponse(
            status_code=503, content={"error": "upstream_unavailable", "detail": detail}
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", ()))
        detail = f"Invalid request: {where} {first.get('msg', '')}".strip()
        return JSONResponse(status_code=400, content={"error": "bad_request", "detail": detail})

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = "not_found" if exc.status_code == 404 else "http_error"
        return JSONResponse(
            status_code=exc.status_code, content={"error": code, "detail": str(exc.detail)}
        )
