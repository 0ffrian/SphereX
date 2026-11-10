"""Bake the maps and write them in the R6.7 layout."""

from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import tempfile
import time
import uuid
from dataclasses import asdict, dataclass
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
BAKER_RULES_VERSION = "3"  # 3: issue #71 physics-based asteroid shape, craters, height.png scale

FILES = ("albedo.webp", "height.png", "height.bin", "normal.png")


@dataclass(frozen=True)
class BakeResult:
    albedo: NDArray[np.uint8]  # (H, W, 3) sRGB
    height: F64  # (H, W), fraction of the radius
    height_png: NDArray[np.uint8]  # (H, W): asteroids 0.5 + h / relief_amp, else min-max
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
    if p.kind == "asteroid" and p.relief_amp > 0:
        # Fixed scale (R6.7, issue #71): 0.5 + h / relief_amp, so the viewer's displacement scale
        # relief_amp reproduces h. Values beyond the design range are clipped (display only;
        # height.bin keeps the exact field).
        png = np.rint(np.clip(0.5 + h / p.relief_amp, 0.0, 1.0) * 255).astype(np.uint8)
    elif hi - lo < 1e-12:
        png = np.full(h.shape, 128, dtype=np.uint8)
    else:
        png = np.rint((h - lo) / (hi - lo) * 255).astype(np.uint8)
    return BakeResult(albedo, h, png, normals_from_height(h, p.radius_m), p.missing)


def _save(img: Image.Image, fmt: str, **kw: object) -> bytes:
    buf = io.BytesIO()
    img.save(buf, fmt, **kw)
    return buf.getvalue()


def webp_rgb(rgb: NDArray[np.uint8]) -> bytes:
    """Lossless WebP of an (H, W, 3) sRGB map. Equal maps give equal bytes."""
    return _save(Image.fromarray(rgb, "RGB"), "WEBP", lossless=True, quality=100, method=4)


def png_image(pixels: NDArray[np.uint8], mode: str) -> bytes:
    """PNG with no timestamp (``mode`` "L" or "RGB"). Equal maps give equal bytes."""
    return _save(Image.fromarray(pixels, mode), "PNG", compress_level=9)


def encode(r: BakeResult) -> dict[str, bytes]:
    """File bytes. WebP is lossless and PNG has no timestamp, so equal maps give equal bytes."""
    return {
        "albedo.webp": webp_rgb(r.albedo),
        "height.png": png_image(r.height_png, "L"),
        "height.bin": r.height.astype("<f2").tobytes(),  # float16 little-endian, W x H
        "normal.png": png_image(r.normal, "RGB"),
    }


_WIN_RESERVED = {
    "con",
    "prn",
    "aux",
    "nul",
    *(f"com{i}" for i in range(1, 10)),
    *(f"lpt{i}" for i in range(1, 10)),
}
META = "bake.json"


def _segment(name: str, what: str) -> str:
    """One safe path segment: percent-encoded, with Windows aliasing removed.

    ``:`` and other unsafe characters become ``%XX``. A trailing dot or space (stripped by
    Windows, so ``foo.`` would alias ``foo``) and device names such as ``nul`` have their last
    character or first character escaped. Ids that differ only in letter case still share a
    directory on Windows and macOS; real ids do not (SBDB, SIMBAD, Exoplanet Archive).
    """
    if name in ("", ".", ".."):
        raise ValueError(f"unsafe {what}: {name!r}")
    seg = quote(name, safe="")
    if seg[-1] in ". ":
        seg = seg[:-1] + f"%{ord(seg[-1]):02X}"
    if seg.split(".")[0].lower() in _WIN_RESERVED:
        seg = f"%{ord(seg[0]):02X}" + seg[1:]
    return seg


def texture_dir(root: Path, object_id: str, generator_version: str, seed: int) -> Path:
    """``{root}/{id}/{generator_version}/{seed}`` (R6.7); segments are percent-encoded."""
    return root / _segment(object_id, "id") / _segment(generator_version, "version") / str(seed)


def bake_dir(
    root: Path, object_id: str, generator_version: str, seed: int, width: int, height: int
) -> Path:
    """Where one size is written: ``{texture_dir}/{width}x{height}``.

    Each size has its own directory, so two sizes of one object never replace each other.
    """
    return texture_dir(root, object_id, generator_version, seed) / f"{width}x{height}"


def bake_key(p: BakeParams, width: int, height: int) -> str:
    """Hash of everything that decides the bytes: the parameters, the size and the rules version.

    R6.7 keys the directory by id, version and seed only; this key lives inside it, so a card
    that changed (N3) or a different size (B2) is rebaked instead of served stale.
    """
    doc = {"rules": BAKER_RULES_VERSION, "w": width, "h": height, "params": asdict(p)}
    return hashlib.sha256(json.dumps(doc, sort_keys=True).encode()).hexdigest()


def _is_valid(out: Path, key: str) -> bool:
    try:
        meta = json.loads((out / META).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    if not isinstance(meta, dict) or meta.get("key") != key:
        return False
    return all((out / f).is_file() for f in FILES)


def bake_to_cache(
    p: BakeParams,
    root: Path,
    object_id: str,
    generator_version: str,
    width: int = 2048,
    height: int = 1024,
) -> Path:
    """Bake unless a valid entry exists; safe for concurrent callers on the same key.

    The directory holds one size (``bake_dir``). Files are written to a temporary directory and
    moved into place in one rename. A valid entry is never deleted: if another worker finishes
    first, this one discards its own copy.
    """
    out = bake_dir(root, object_id, generator_version, p.seed, width, height)
    key = bake_key(p, width, height)
    if _is_valid(out, key):
        return out
    files = encode(bake(p, width, height))
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(dir=out.parent, prefix=".bake-"))
    try:
        for name, data in files.items():
            (tmp / name).write_bytes(data)
        (tmp / META).write_text(json.dumps({"key": key}), encoding="utf-8")
        tmp.chmod(0o755)  # mkdtemp makes it 0700; the API process must be able to serve it
        for attempt in range(5):
            if attempt:
                time.sleep(0.05 * attempt)  # Windows: a file of the old entry may still be open
            if _is_valid(out, key):
                return out  # another worker won the race
            if out.exists():  # stale or incomplete: move it aside, never delete in place
                aside = out.parent / f".stale-{uuid.uuid4().hex}"
                try:
                    os.rename(out, aside)
                except OSError:
                    continue
                shutil.rmtree(aside, ignore_errors=True)
            try:
                os.replace(tmp, out)
                return out
            except OSError:
                continue  # someone created out between our checks: look again
        if _is_valid(out, key):
            return out
        raise OSError(f"could not publish textures to {out}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
