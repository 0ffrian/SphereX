"""``/v1/sky/...``: the sky background, served from the local mirror only (never upstream).

- ``GET /v1/sky/index.json``: the surveys present on disk (an empty list when none).
- ``GET /v1/sky/{survey}/equirect_{W}x{H}.jpg``: the baked all-sky image
  (``app.core.sky.surveys.CONVENTION``).
- ``GET /v1/sky/{survey}/hips/properties``, ``.../hips/Norder3/Allsky.jpg`` and
  ``.../hips/Norder{k}/Dir{d}/Npix{n}.jpg``: the mirrored HiPS in IRSA's layout.

Every path segment is matched by a regex and the file path is rebuilt from the parsed values
and the registry id, so no request text reaches the file system. A missing file is the usual
404 ``{"error": "not_found", ...}``. These endpoints are beyond D-16 (proposed Q- entry).
"""

from __future__ import annotations

import re
from pathlib import Path as FsPath
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Path
from fastapi.responses import FileResponse

from app.api.deps import get_ctx
from app.api.models import ErrorResponse
from app.context import Context
from app.core.sky.surveys import (
    ALLSKY_RELPATH,
    CONVENTION,
    EQUIRECT_RE,
    FRAME,
    PROPERTIES_NAME,
    SURVEY_ID_PATTERN,
    SURVEYS,
    Survey,
    check_properties,
    hips_dir,
    max_contiguous,
    read_manifest,
    read_properties,
    sky_root,
    survey_dir,
    tile_relpath,
)
from app.errors import ApiError

router = APIRouter(prefix="/v1/sky", tags=["sky"])

IMMUTABLE = {"Cache-Control": "public, max-age=31536000, immutable"}
MAX_HIPS_ORDER = 29
NORDER_RE = re.compile(r"^Norder([0-9]{1,2})$")
DIR_RE = re.compile(r"^Dir([0-9]{1,10})$")
NPIX_RE = re.compile(r"^Npix([0-9]{1,19})\.jpg$")

SurveyId = Annotated[str, Path(pattern=SURVEY_ID_PATTERN)]
EquirectName = Annotated[str, Path(pattern=EQUIRECT_RE.pattern)]
NorderSeg = Annotated[str, Path(pattern=NORDER_RE.pattern)]
DirSeg = Annotated[str, Path(pattern=DIR_RE.pattern)]
NpixSeg = Annotated[str, Path(pattern=NPIX_RE.pattern)]
ERRORS: dict[int | str, dict[str, object]] = {404: {"model": ErrorResponse}}


def _survey(survey_id: str) -> Survey:
    survey = SURVEYS.get(survey_id)
    if survey is None:
        raise ApiError(404, "not_found", f"Unknown sky survey '{survey_id}'.")
    return survey


def _num(rx: re.Pattern[str], segment: str) -> int:
    m = rx.match(segment)
    if m is None:  # the path pattern already matched; kept for the type checker
        raise ApiError(404, "not_found", f"Bad path segment '{segment}'.")
    return int(m.group(1))


def _send(ctx: Context, path: FsPath, media_type: str, what: str) -> FileResponse:
    root = sky_root(ctx.settings.cache_dir).resolve()
    try:
        real = path.resolve()
    except OSError:
        real = path
    if not real.is_relative_to(root) or not real.is_file():
        raise ApiError(404, "not_found", f"{what} is not in the local sky mirror.")
    return FileResponse(real, media_type=media_type, headers=IMMUTABLE)


def equirect_files(sdir: FsPath) -> list[tuple[int, int, str]]:
    """(width, height, version) of the baked images present, smallest first.

    ``version`` changes whenever the file is rebaked (mtime and size). The index puts it in the
    image URL as ``?v=``: the file is served ``immutable`` under a fixed name, so without it a
    browser would keep an old bake for a year.
    """
    if not sdir.is_dir():
        return []
    out = []
    for p in sdir.iterdir():
        m = EQUIRECT_RE.match(p.name)
        if not m:
            continue
        try:
            st = p.stat()
        except OSError:
            continue
        w, h = int(m.group(1)), int(m.group(2))
        if w == 2 * h and p.is_file():
            out.append((w, h, f"{st.st_mtime_ns:x}-{st.st_size:x}"))
    return sorted(out)


def survey_entry(cache_dir: FsPath, survey: Survey) -> dict[str, Any] | None:
    """The index entry for one survey, or None when nothing of it is on disk."""
    equirects = equirect_files(survey_dir(cache_dir, survey.id))
    props = read_properties(cache_dir, survey.id)
    hips: dict[str, Any] | None = None
    if props is not None and not check_properties(props, survey):
        manifest = read_manifest(cache_dir, survey.id) or {}
        orders = manifest.get("complete_orders")
        max_local = max_contiguous(orders if isinstance(orders, list) else [])
        if max_local is not None:
            hips = {
                "url": f"/v1/sky/{survey.id}/hips",
                "max_order_local": max_local,
                "tile_width": survey.tile_width,
                "format": survey.tile_format,
            }
    if not equirects and hips is None:
        return None
    return {
        "id": survey.id,
        "title": survey.title,
        "credit": survey.credit,
        "tag": "derived",
        "formula": survey.formula,
        "frame": FRAME,
        "convention": CONVENTION,
        "equirect": [
            {"url": f"/v1/sky/{survey.id}/equirect_{w}x{h}.jpg?v={v}", "width": w, "height": h}
            for w, h, v in equirects
        ],
        "hips": hips,
    }


@router.get("/index.json")
def sky_index(ctx: Annotated[Context, Depends(get_ctx)]) -> dict[str, Any]:
    cache_dir = ctx.settings.cache_dir
    surveys = [e for s in SURVEYS.values() if (e := survey_entry(cache_dir, s)) is not None]
    return {"surveys": surveys}


@router.get("/{survey_id}/hips/properties", responses=ERRORS)
def sky_properties(survey_id: SurveyId, ctx: Annotated[Context, Depends(get_ctx)]) -> FileResponse:
    survey = _survey(survey_id)
    path = hips_dir(ctx.settings.cache_dir, survey.id) / PROPERTIES_NAME
    return _send(ctx, path, "text/plain; charset=utf-8", "The HiPS properties file")


@router.get("/{survey_id}/hips/{norder}/{name}", responses=ERRORS)
def sky_allsky(
    survey_id: SurveyId,
    norder: NorderSeg,
    name: Annotated[str, Path(pattern=r"^Allsky\.jpg$")],
    ctx: Annotated[Context, Depends(get_ctx)],
) -> FileResponse:
    survey = _survey(survey_id)
    if norder != "Norder3":
        raise ApiError(404, "not_found", "Only Norder3/Allsky.jpg is mirrored.")
    path = hips_dir(ctx.settings.cache_dir, survey.id) / ALLSKY_RELPATH
    return _send(ctx, path, "image/jpeg", "Norder3/Allsky.jpg")


@router.get("/{survey_id}/hips/{norder}/{ndir}/{npix}", responses=ERRORS)
def sky_tile(
    survey_id: SurveyId,
    norder: NorderSeg,
    ndir: DirSeg,
    npix: NpixSeg,
    ctx: Annotated[Context, Depends(get_ctx)],
) -> FileResponse:
    survey = _survey(survey_id)
    order, d, n = _num(NORDER_RE, norder), _num(DIR_RE, ndir), _num(NPIX_RE, npix)
    if order > MAX_HIPS_ORDER or n >= 12 * 4**order or d != (n // 10000) * 10000:
        raise ApiError(404, "not_found", f"No HiPS tile {norder}/{ndir}/{npix}.")
    path = hips_dir(ctx.settings.cache_dir, survey.id) / tile_relpath(order, n)
    return _send(ctx, path, "image/jpeg", f"Tile {norder}/{ndir}/{npix}")


@router.get("/{survey_id}/{name}", responses=ERRORS)
def sky_equirect(
    survey_id: SurveyId, name: EquirectName, ctx: Annotated[Context, Depends(get_ctx)]
) -> FileResponse:
    survey = _survey(survey_id)
    m = EQUIRECT_RE.match(name)
    if m is None:  # the path pattern already matched; kept for the type checker
        raise ApiError(404, "not_found", f"No sky image '{name}'.")
    w, h = int(m.group(1)), int(m.group(2))
    path = survey_dir(ctx.settings.cache_dir, survey.id) / f"equirect_{w}x{h}.jpg"
    return _send(ctx, path, "image/jpeg", f"The {w}x{h} sky image")
