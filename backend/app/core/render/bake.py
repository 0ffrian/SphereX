"""Bake the maps and write them in the R6.7 layout."""

from __future__ import annotations

import io
import os
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

import numpy as np
from numpy.typing import NDArray
from PIL import Image

from app.core.render import height as heights
from app.core.render import palette
from app.core.render.noise import F64, sphere_dirs
from app.core.render.normals import normals_from_height
from app.core.render.params import BakeParams

# R6.7: bump whenever a rule in R6.2 to R6.5 changes, so cached maps are not reused.
BAKER_RULES_VERSION = "1"

FILES = ("albedo.webp", "height.png", "height.bin", "normal.png")


@dataclass(frozen=True)
class BakeResult:
    albedo: NDArray[np.uint8]  # (H, W, 3) sRGB
    height: F64  # (H, W), fraction of the radius
    height_png: NDArray[np.uint8]  # (H, W), min-max scaled for display
    normal: NDArray[np.uint8]  # (H, W, 3)
    missing: tuple[str, ...]


def bake(p: BakeParams, width: int = 2048, height: int = 1024) -> BakeResult:
    if width != 2 * height or height < 4:
        raise ValueError("maps are equirectangular: width must be 2 x height")
    dirs = sphere_dirs(height, width)
    if p.kind == "asteroid":
        h, floor = heights.asteroid_height(p, dirs)
        albedo = palette.asteroid_albedo(p, heights.lowfreq(dirs, p.seed), floor)
    else:
        h = heights.bands_height(dirs)
        albedo = palette.bands_albedo(p, heights.band_field(dirs, p.seed))
    lo, hi = float(h.min()), float(h.max())
    if hi - lo < 1e-12:
        png = np.full(h.shape, 128, dtype=np.uint8)
    else:
        png = np.rint((h - lo) / (hi - lo) * 255).astype(np.uint8)
    return BakeResult(albedo, h, png, normals_from_height(h, p.radius_m), p.missing)


def _save(img: Image.Image, fmt: str, **kw: object) -> bytes:
    buf = io.BytesIO()
    img.save(buf, fmt, **kw)
    return buf.getvalue()


def encode(r: BakeResult) -> dict[str, bytes]:
    """File bytes. WebP is lossless and PNG has no timestamp, so equal maps give equal bytes."""
    return {
        "albedo.webp": _save(
            Image.fromarray(r.albedo, "RGB"), "WEBP", lossless=True, quality=100, method=4
        ),
        "height.png": _save(Image.fromarray(r.height_png, "L"), "PNG", compress_level=9),
        "height.bin": r.height.astype("<f2").tobytes(),  # float16 little-endian, W x H
        "normal.png": _save(Image.fromarray(r.normal, "RGB"), "PNG", compress_level=9),
    }


def _segment(name: str, what: str) -> str:
    if name in ("", ".", ".."):
        raise ValueError(f"unsafe {what}: {name!r}")
    return quote(name, safe="")  # ':' becomes %3A so ids such as sbdb:101955 work on Windows


def texture_dir(root: Path, object_id: str, generator_version: str, seed: int) -> Path:
    """``{root}/{id}/{generator_version}/{seed}`` (R6.7); segments are percent-encoded."""
    return root / _segment(object_id, "id") / _segment(generator_version, "version") / str(seed)


def bake_to_cache(
    p: BakeParams,
    root: Path,
    object_id: str,
    generator_version: str,
    width: int = 2048,
    height: int = 1024,
) -> Path:
    """Bake unless all four files exist; write atomically (a half-written bake is never seen)."""
    out = texture_dir(root, object_id, generator_version, p.seed)
    if all((out / f).is_file() for f in FILES):
        return out
    files = encode(bake(p, width, height))
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(dir=out.parent, prefix=".bake-"))
    try:
        for name, data in files.items():
            (tmp / name).write_bytes(data)
        tmp.chmod(0o755)  # mkdtemp makes it 0700; the API process must be able to serve it
        if out.exists():
            shutil.rmtree(out)  # an incomplete earlier bake
        os.replace(tmp, out)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return out
