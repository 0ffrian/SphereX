"""The records P3 hands to P4 to P7 (A17.1, A17.2). Frozen: later steps add labels in their own
records and never edit these.

Internal names stay ``AreaFrame``/``Dot``; the served shapes are the generated ``Area*`` types
(Q-208 (18)), built by P7. A served dot drops ``visit`` and ``sigma_c_px`` and adds ``label``
(Q-208 (3)).

Rounding (fixed, so the records are byte-stable, A17.10): positions on the sky 7 dp (deg),
pixel ``x``/``y`` 3 dp, ``sigma_c_px`` 4 dp, flux and error 3 dp (uJy), S/N 2 dp, wavelengths
5 dp (um). Frame bands are the SIA values floored/ceiled at 5 dp, so a dot's rounded wavelength
inside the raw band stays inside the served band.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
from numpy.typing import NDArray

from app.core.area.config import AreaSpec


@dataclass(frozen=True)
class AreaFrame:
    frame_id: str
    obs_id: str
    detector: int
    visit: int
    exposure: int
    time: str  # the exposure's time (earliest midpoint of its frames), ISO UTC Z, ms
    t_min: str
    t_max: str
    wavelength_min_um: float
    wavelength_max_um: float
    s_region: str  # "POLYGON ICRS ra dec ..." as served (Q-208)
    # Cutout geometry (Q-400 (3)): centre and size of the request.
    cutout_ra: float
    cutout_dec: float
    cutout_size_arcsec: float
    # ASSUMPTION: the cache key digest of the cutout (A17.1 names the field, not its form);
    # ``None`` when no cutout key was made.
    cutout_key: str | None
    cutout_sha256: str | None  # SHA-256 of the cached body; None: no usable cutout
    access_url: str  # internal: the SIA access URL (never served)


@dataclass(frozen=True, eq=False)
class Coverage:
    """One visit's coverage (A17.1): the 30 arcsec cell mask on the area's gnomonic plane
    (row 0 = lowest eta, column 0 = lowest xi) and the served outline of the kept piece."""

    visit: int
    mask: NDArray[np.bool_]  # kept piece only
    polygon: tuple[tuple[float, float], ...]  # (ra, dec), 7 dp; () when nothing is covered
    cells_covered: int  # before the largest piece was chosen
    pieces: int
    cells_lost: int  # covered cells outside the kept piece
    holes: int  # uncovered regions enclosed by the kept piece (counted, never refused)


@dataclass(frozen=True)
class Dot:
    dot_id: str
    frame_id: str
    detector: int
    visit: int
    exposure: int
    time: str
    x: float  # PNG convention of Track's /frames (wcs.to_png_xy), Q-400 (9)
    y: float
    sigma_c_px: float
    ra: float
    dec: float
    flux_uJy: float
    flux_err: float
    snr: float
    wavelength_um: float
    bandwidth_um: float
    flags: tuple[str, ...]


@dataclass(frozen=True)
class FrameDots:
    frame_id: str
    dots: tuple[Dot, ...]
    refused: tuple[tuple[str, int], ...]  # (reason, count), sorted by reason
    noise: tuple[tuple[str, float], ...]  # mesh_std_median, sqrt_var_median
    peaks: int  # peaks above the threshold before the separation rule
    timings: dict[str, float] = field(default_factory=dict, compare=False, hash=False)


@dataclass(frozen=True)
class ConeLog:
    ra: float
    dec: float
    verdict: str  # cached | live | fail | failed
    rows: int
    truncated: bool
    seconds: float = field(compare=False, hash=False)


@dataclass(frozen=True, eq=False)
class AreaFrames:
    spec: AreaSpec
    frames: tuple[AreaFrame, ...]  # sorted by (time, detector, frame_id)
    coverage: tuple[Coverage, ...]  # one per visit, in visit order
    missing: tuple[str, ...]  # sorted, unique
    complete: bool  # False: a cone failed; P7 never stores it (A17.1)
    n_cones: int
    input_digests: tuple[str, ...]  # SHA-256 of every SIA and cutout body used, sorted
    cones: tuple[ConeLog, ...] = ()
    stats: dict[str, Any] = field(default_factory=dict)  # Day 0 timings and sizes, not compared
