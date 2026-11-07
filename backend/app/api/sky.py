"""``/v1/sky/...``: the sky background, served from the local mirror only (never upstream).

- ``GET /v1/sky/index.json``: the surveys present on disk (an empty list when none).
- ``GET /v1/sky/{survey}/equirect_{W}x{H}.jpg``: the baked all-sky image
  (``app.core.sky.surveys.CONVENTION``).
- ``GET /v1/sky/{survey}/hips/properties``, ``.../hips/Norder3/Allsky.jpg`` and
  ``.../hips/Norder{k}/Dir{d}/Npix{n}.jpg``: the mirrored HiPS in IRSA's layout.
- ``GET /v1/sky/cached``: positions whose frame list is complete in the derived cache, so the sky
  can mark the spots that load at once (``cached_objects``). Read only; never calls upstream.

Every path segment is matched by a regex and the file path is rebuilt from the parsed values
and the registry id, so no request text reaches the file system. A missing file is the usual
404 ``{"error": "not_found", ...}``. These endpoints are beyond D-16 (Q-87, Q-98).
"""

from __future__ import annotations

import json
import re
import threading
from collections import OrderedDict
from pathlib import Path as FsPath
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Path
from fastapi.responses import FileResponse

from app.api.deps import get_ctx
from app.api.models import ErrorResponse
from app.cache.store import LAYOUT_VERSION
from app.context import Context
from app.core.find.frames import FRAMES_SOURCE, frames_key
from app.core.find.resolver import load_object
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


# ---- Cached positions --------------------------------------------------------------------------

CACHED_FRAMES_FORMULA = (
    "number of frames in the stored complete frame list (derived.frames cache entry, written only "
    "when no cutout was deferred or failed and the search was not truncated)"
)
COUNT_MEMO_SIZE = 4096
_count_memo: OrderedDict[tuple[str, str], int] = OrderedDict()
_count_lock = threading.Lock()


def _frame_count(
    ctx: Context, object_id: str, meta_path: FsPath, meta: dict[str, Any]
) -> int | None:
    """Frames in the stored list. The count is memoised by (entry, body SHA-256), so each body is
    read (and verified by ``cache.get``) once per process; later calls only check that the body
    file still has the size its meta states."""
    sha = str(meta.get("body_sha256", ""))
    memo_key = (meta_path.stem, sha)
    with _count_lock:
        hit = _count_memo.get(memo_key)
    if hit is not None:
        try:
            size = meta_path.with_suffix(".body").stat().st_size
        except OSError:
            return None
        return hit if size == meta.get("body_size") else None
    entry = ctx.cache.get(frames_key(ctx, object_id))
    if entry is None or entry.meta.get("body_sha256") != sha:
        return None
    try:
        frames = json.loads(entry.body).get("frames")
    except (ValueError, AttributeError):
        return None
    if not isinstance(frames, list):
        return None
    n = len(frames)
    with _count_lock:
        _count_memo[memo_key] = n
        while len(_count_memo) > COUNT_MEMO_SIZE:
            _count_memo.popitem(last=False)
    return n


def cached_objects(ctx: Context) -> list[dict[str, Any]]:
    """Objects with a complete stored frame list for the current settings, with their position.

    Reads only the ``derived.frames`` meta files of this data release (one per object, never the
    raw cutouts). A meta is used only when its digest is the key ``frames_key`` builds now from
    the id it names, so an entry made with another cutout size, search radius, epoch or
    derivation version is skipped. The position comes from the object registry
    (``derived.object``) or from a coordinate id; an object that is not in the registry, moving,
    or has no frames is left out. Corrupt files are skipped, never a 500.
    """
    s = ctx.settings
    base = ctx.cache.root / LAYOUT_VERSION / FRAMES_SOURCE / s.data_release
    out: list[dict[str, Any]] = []
    if not base.is_dir():
        return out
    for meta_path in sorted(base.glob("*/*.json")):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            object_id = meta["key"]["query"]["id"]
        except (OSError, ValueError, KeyError, TypeError):
            continue
        if not isinstance(object_id, str) or not isinstance(meta.get("body_sha256"), str):
            continue
        if frames_key(ctx, object_id).digest != meta_path.stem:
            continue
        try:
            # A registry body can pass its SHA-256 check and still not be a ResolvedObject (an
            # older layout, a hand edit): skip that entry rather than fail the whole list.
            obj = load_object(ctx, object_id)
        except (ValueError, KeyError, TypeError):
            continue
        if obj is None or obj.moving:
            continue
        n = _frame_count(ctx, object_id, meta_path, meta)
        if not n:
            continue
        out.append(
            {
                "id": obj.id,
                "name": obj.name,
                # The text the resolver was given (alias-mapped), so a search for it is a cache hit.
                "query": obj.query,
                "ra": obj.ra,
                "dec": obj.dec,
                "resolver": obj.resolver,
                "frames": n,
                "provenance": {k: obj.provenance[k] for k in ("ra", "dec") if k in obj.provenance},
            }
        )
    out.sort(key=lambda o: str(o["id"]))
    return out


@router.get("/cached")
def sky_cached(ctx: Annotated[Context, Depends(get_ctx)]) -> dict[str, Any]:
    return {
        "objects": cached_objects(ctx),
        "data_release": ctx.settings.data_release,
        "provenance": {"frames": {"tag": "derived", "formula": CACHED_FRAMES_FORMULA}},
    }


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
