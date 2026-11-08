"""Colour HiPS surveys for the sky background: registry, on-disk layout and the mirror manifest.

Layout under ``{SX_CACHE_DIR}/sky/{survey}/`` (outside git, D-25):

- ``hips/properties``, ``hips/Norder3/Allsky.jpg`` and ``hips/Norder{k}/Dir{d}/Npix{n}.jpg``:
  the IRSA HiPS layout (IVOA HiPS 1.0), with ``d = (n // 10000) * 10000``.
- ``mirror.json``: written by ``scripts.sky_mirror`` after it counts the files on disk.
- ``equirect_{W}x{H}.jpg``: written by ``scripts.sky_bake``.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SKY_DIR = "sky"
HIPS_DIR = "hips"
MANIFEST_NAME = "mirror.json"
PROPERTIES_NAME = "properties"
ALLSKY_RELPATH = "Norder3/Allsky.jpg"

SURVEY_ID_PATTERN = r"^[a-z0-9_]{1,40}$"
EQUIRECT_RE = re.compile(r"^equirect_([1-9][0-9]{2,4})x([1-9][0-9]{2,4})\.jpg$")

# The equirectangular convention the frontend depends on (fixed). ICRS.
CONVENTION = "RA = 360*(x+0.5)/W deg, increasing right; Dec = 90 - 180*(y+0.5)/H deg"
FRAME = "icrs"


@dataclass(frozen=True)
class Survey:
    """One colour HiPS on IRSA.

    ``formula`` and ``credit`` are copied from the survey's ``properties`` file (fetched 7 Nov
    2026); they are display text, not physical values.
    """

    id: str
    base_url: str
    title: str
    # [verify] the exact credit line each provider asks for (obs_copyright, obs_ack,
    # hips_copyright CNRS/Unistra, hips_license ODbL-1.0).
    credit: str
    formula: str
    tile_width: int = 512
    tile_format: str = "jpeg"


SURVEYS: dict[str, Survey] = {
    "2mass_color": Survey(
        id="2mass_color",
        base_url="https://irsa.ipac.caltech.edu/data/hips/CDS/2MASS/Color",
        title="2MASS colour (J, H, Ks)",
        credit=(
            "2MASS: University of Massachusetts & IPAC/Caltech (NASA, NSF). "
            "HiPS: CDS (CNRS/Unistra), ODbL-1.0, mirrored by IRSA."
        ),
        formula=(
            "false colour: survey colour composite (R = Ks 2.16 um, G = H 1.66 um, "
            "B = J 1.23 um; each band sqrt-stretched by CDS, see hips_builder in properties); "
            "HEALPix tiles resampled to equirectangular, nearest sample of the area mean"
        ),
    ),
    "allwise_color": Survey(
        id="allwise_color",
        base_url="https://irsa.ipac.caltech.edu/data/hips/CDS/AllWISE/RGB-W4-W2-W1",
        title="AllWISE colour (W1, W2, W4)",
        credit=(
            "WISE/NEOWISE: UCLA & JPL/Caltech (NASA); IPAC/NASA. "
            "HiPS: CDS (CNRS/Unistra), mirrored by IRSA."
        ),
        formula=(
            "false colour: survey colour composite (R = W4 22 um, G = W2 4.6 um, "
            "B = W1 3.4 um; log stretches from hips_rgb_* in properties); "
            "HEALPix tiles resampled to equirectangular, nearest sample of the area mean"
        ),
    ),
}


def sky_root(cache_dir: Path) -> Path:
    return cache_dir / SKY_DIR


def survey_dir(cache_dir: Path, survey_id: str) -> Path:
    return sky_root(cache_dir) / survey_id


def hips_dir(cache_dir: Path, survey_id: str) -> Path:
    return survey_dir(cache_dir, survey_id) / HIPS_DIR


def tile_relpath(order: int, npix: int) -> str:
    """IVOA HiPS 1.0 tile path, relative to the HiPS root."""
    return f"Norder{order}/Dir{(npix // 10000) * 10000}/Npix{npix}.jpg"


def tiles_in_order(order: int) -> int:
    return 12 << (2 * order)


def equirect_name(width: int, height: int) -> str:
    return f"equirect_{width}x{height}.jpg"


def parse_properties(text: str) -> dict[str, str]:
    """``key = value`` lines; ``#`` comments and blank lines are skipped (HiPS 1.0 §4.4)."""
    out: dict[str, str] = {}
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        key, _, value = s.partition("=")
        out[key.strip()] = value.strip()
    return out


def read_properties(cache_dir: Path, survey_id: str) -> dict[str, str] | None:
    path = hips_dir(cache_dir, survey_id) / PROPERTIES_NAME
    try:
        return parse_properties(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError):
        return None


def check_properties(props: Mapping[str, str], survey: Survey) -> list[str]:
    """Reasons the local tiles cannot be used as the registry expects; empty when fine."""
    problems = []
    if props.get("hips_frame") != "equatorial":
        problems.append(f"hips_frame is {props.get('hips_frame')!r}, expected 'equatorial'")
    if props.get("hips_tile_width") != str(survey.tile_width):
        problems.append(
            f"hips_tile_width is {props.get('hips_tile_width')!r}, expected {survey.tile_width}"
        )
    if survey.tile_format not in props.get("hips_tile_format", "").split():
        problems.append(f"hips_tile_format {props.get('hips_tile_format')!r} has no jpeg")
    return problems


def count_complete(hdir: Path, order: int) -> int:
    """Number of tiles of ``order`` present on disk (a final name means a complete file)."""
    n = 0
    base = hdir / f"Norder{order}"
    if not base.is_dir():
        return 0
    pat = re.compile(r"^Npix([0-9]+)\.jpg$")
    limit = tiles_in_order(order)
    for d in base.iterdir():
        if not d.is_dir() or not d.name.startswith("Dir"):
            continue
        with os.scandir(d) as it:
            for e in it:
                m = pat.match(e.name)
                if m and int(m.group(1)) < limit and e.is_file():
                    n += 1
    return n


def max_contiguous(orders: list[int]) -> int | None:
    """Highest k such that every order 0..k is in ``orders``; None when order 0 is absent."""
    have = set(orders)
    k = -1
    while k + 1 in have:
        k += 1
    return k if k >= 0 else None


def read_manifest(cache_dir: Path, survey_id: str) -> dict[str, Any] | None:
    path = survey_dir(cache_dir, survey_id) / MANIFEST_NAME
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def write_atomic(path: Path, data: bytes) -> None:
    """Write to a temp file in the same directory, then rename over ``path``."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".part")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def dir_bytes(root: Path) -> int:
    """Total size of the regular files under ``root`` (0 when absent)."""
    total = 0
    if not root.exists():
        return 0
    for dirpath, _, files in os.walk(root):
        for name in files:
            try:
                total += os.stat(os.path.join(dirpath, name)).st_size
            except OSError:
                continue
    return total
