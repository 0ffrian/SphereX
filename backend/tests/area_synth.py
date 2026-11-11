"""Synthetic area cutouts for the dots tests (deterministic; nothing binary is committed).

``AreaSynth`` extends Stage 2's ``Synth`` with pixel-integrated Gaussian sources, seeded noise
and a ``WCS-WAVE`` table. The table and its ``W`` keywords are copied from a recorded QR2 cutout
at runtime (one approach, no hand-written table), with ``CRPIX1W``/``CRPIX2W`` kept, so the
synthetic pixels look up the same detector region.
"""

from __future__ import annotations

import io
import math
import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

import numpy as np
from astropy.io import fits

from app.core.area.config import DEFAULT_AREA_CONFIG, AreaConfig, AreaSpec
from app.core.area.geometry import AreaBox, CellGrid
from app.core.area.records import AreaFrame, Coverage
from app.core.find import wcs
from tests.helpers import entries
from tests.measure_synth import MP_BITS, Synth, celestial_header

WAVE_SOURCE_FRAME = "2026W12_2A_0158_3_D1"
WAVE_KEY = re.compile(
    r"^(WCSAXES|WCSNAME|CNAME\d|CRPIX\d|CDELT\d|CUNIT\d|CTYPE\d|CRVAL\d|P[SV]\d_\d)W$"
)


@lru_cache(maxsize=1)
def _wave_parts() -> tuple[dict[str, Any], bytes]:
    for meta, body in entries("irsa_cutout"):
        if meta["key"]["query"].get("frame_id") == WAVE_SOURCE_FRAME:
            h = wcs.open_fits(body)
            hd = h["IMAGE"].header
            keys = {k: hd[k] for k in hd if WAVE_KEY.match(k)}
            buf = io.BytesIO()
            fits.HDUList([fits.PrimaryHDU(), h["WCS-WAVE"].copy()]).writeto(buf)
            return keys, buf.getvalue()
    raise LookupError(WAVE_SOURCE_FRAME)


def gaussian_pixels(nx: int, ny: int, x0: float, y0: float, total: float, sigma: float) -> Any:
    """A pixel-integrated circular Gaussian of ``total`` (sum of pixel values)."""
    xs = np.arange(nx, dtype=np.float64)
    ys = np.arange(ny, dtype=np.float64)
    s2 = sigma * math.sqrt(2.0)
    erf = np.vectorize(math.erf)
    fx = 0.5 * (erf((xs + 0.5 - x0) / s2) - erf((xs - 0.5 - x0) / s2))
    fy = 0.5 * (erf((ys + 0.5 - y0) / s2) - erf((ys - 0.5 - y0) / s2))
    return total * np.outer(fy, fx)


@dataclass
class AreaSynth(Synth):
    nx: int = 96
    ny: int = 80
    crval: tuple[float, float] = (150.0, 2.0)
    sources: list[tuple[float, float, float]] = field(default_factory=list)

    def add_gaussian(self, x: float, y: float, total: float, sigma: float = 1.0) -> AreaSynth:
        self.image += gaussian_pixels(self.nx, self.ny, x, y, total, sigma)
        self.sources.append((x, y, total))
        return self

    def add_noise(self, seed: int) -> AreaSynth:
        rng = np.random.default_rng(seed)
        self.image += rng.normal(0.0, math.sqrt(self.var), self.image.shape)
        return self

    def hdul(self) -> fits.HDUList:
        base = super().hdul()
        keys, table = _wave_parts()
        for k, v in keys.items():
            base["IMAGE"].header[k] = v
        base.append(fits.open(io.BytesIO(table))["WCS-WAVE"].copy())
        return base

    def body(self) -> bytes:
        buf = io.BytesIO()
        self.hdul().writeto(buf)
        return buf.getvalue()


def spec_for(s: AreaSynth, *, width: float | None = None, height: float | None = None) -> AreaSpec:
    """An area centred on the synthetic cutout's reference pixel, the cutout size by default."""
    pix = 6.15 / 3600.0
    return AreaSpec(
        id="synth",
        ra=s.crval[0],
        dec=s.crval[1],
        width_deg=width or s.nx * pix,
        height_deg=height or s.ny * pix,
        data_release="synthetic",
        windows=(),
    )


def band_of(s: AreaSynth) -> tuple[float, float]:
    h = s.hdul()
    vals = [wcs.wavelength_at(h, x, y) for x in (0, s.nx - 1) for y in (0, s.ny - 1)]
    lo = min(v[0] for v in vals if v)
    hi = max(v[0] for v in vals if v)
    return math.floor(lo * 1e5) / 1e5 - 0.01, math.ceil(hi * 1e5) / 1e5 + 0.01


def frame_for(s: AreaSynth, frame_id: str = "SYN_1_D1", **kw: Any) -> AreaFrame:
    lo, hi = band_of(s)
    base: dict[str, Any] = {
        "frame_id": frame_id,
        "obs_id": frame_id[:-3],
        "detector": 1,
        "visit": 1,
        "exposure": 1,
        "time": "2026-03-20T08:00:00.000Z",
        "t_min": "2026-03-20T08:00:00.000Z",
        "t_max": "2026-03-20T08:00:00.000Z",
        "wavelength_min_um": lo,
        "wavelength_max_um": hi,
        "s_region": "POLYGON ICRS 0 0 1 0 1 1",
        "cutout_ra": s.crval[0],
        "cutout_dec": s.crval[1],
        "cutout_size_arcsec": 0.0,
        "cutout_key": None,
        "cutout_sha256": None,
        "access_url": "",
    }
    base.update(kw)
    return AreaFrame(**base)


def full_coverage(spec: AreaSpec, cfg: AreaConfig = DEFAULT_AREA_CONFIG) -> Coverage:
    """Every cell covered; the polygon is the box (deprojected corners)."""
    box = AreaBox.of(spec)
    grid = CellGrid.of(box, cfg.coverage_cell_arcsec)
    w, h = grid.nx * grid.cell_deg / 2.0, grid.ny * grid.cell_deg / 2.0
    ra, dec = box.deproject_many(np.array([-w, w, w, -w]), np.array([-h, -h, h, h]))
    poly = tuple((round(float(a), 7), round(float(d), 7)) for a, d in zip(ra, dec, strict=True))
    return Coverage(
        1, np.ones((grid.ny, grid.nx), dtype=np.bool_), poly, grid.nx * grid.ny, 1, 0, 0
    )


def flag_value(*names: str) -> int:
    v = 0
    for n in names:
        v |= 1 << MP_BITS[n]
    return v


__all__ = [
    "AreaSynth",
    "band_of",
    "celestial_header",
    "flag_value",
    "frame_for",
    "full_coverage",
    "gaussian_pixels",
    "spec_for",
]
