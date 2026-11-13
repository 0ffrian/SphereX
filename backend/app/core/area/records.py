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

import json
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field
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
    # ISO-Z ``fetched_at`` of every SIA cone body read, sorted and unique, also on a failed cone
    # (so the field always means "every cone body read"; an incomplete ``AreaFrames`` is never
    # stored, so only a complete one dates a run, ``AreaResult.times``, Q-420 (9)). Not in
    # ``frames_jsonable`` on purpose: that form is the byte-compared record (A17.10), and a fetch
    # date differs between two runs on the same inputs. Nothing rebuilds an ``AreaFrames`` from
    # that JSON; a stored run keeps its dates in the reply head instead.
    sia_fetched: tuple[str, ...] = ()


def _mask_rows(mask: NDArray[np.bool_]) -> list[str]:
    return ["".join("1" if v else "0" for v in row) for row in mask]


def frames_jsonable(frames: AreaFrames) -> dict[str, Any]:
    """The frames record as plain JSON values (no timings), for byte comparison and the Day 0
    report. Coverage masks are rows of ``0``/``1`` (row 0 = lowest eta)."""
    return {
        "area_id": frames.spec.id,
        "frames": [asdict(f) for f in frames.frames],
        "coverage": [
            {
                "visit": c.visit,
                "polygon": [list(p) for p in c.polygon],
                "mask": _mask_rows(c.mask),
                "cells_covered": c.cells_covered,
                "pieces": c.pieces,
                "cells_lost": c.cells_lost,
                "holes": c.holes,
            }
            for c in frames.coverage
        ],
        "missing": list(frames.missing),
        "complete": frames.complete,
        "n_cones": frames.n_cones,
        "input_digests": list(frames.input_digests),
    }


def dots_jsonable(per_frame: Sequence[FrameDots]) -> list[dict[str, Any]]:
    """Dots per frame as plain JSON values (no timings)."""
    return [
        {
            "frame_id": fd.frame_id,
            "dots": [{**asdict(d), "flags": list(d.flags)} for d in fd.dots],
            "refused": dict(fd.refused),
            "noise": dict(fd.noise),
            "peaks": fd.peaks,
        }
        for fd in per_frame
    ]


def canonical(value: Any) -> bytes:
    """Sorted keys, no spaces: the byte form used by the determinism test (A17.10)."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
