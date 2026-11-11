"""Write the synthetic Area search fixtures (issue #92, A17.8, A17.9, Q-208).

    uv run python -m scripts.area_fixtures           # rewrite shared/fixtures/area/
    uv run python -m scripts.area_fixtures --check   # exit 1 if a committed file differs

**Everything here is synthetic.** Positions, times, fluxes, wavelengths, flags and verdicts are
made up to exercise the Area search UI and the contract (D-29: the frontend builds against them
before the backend exists). Nothing here is SPHEREx data or a result for a real object, and no
value here is a pipeline setting to copy: the numbers in ``method.settings`` are the starting
values A17.2 to A17.13 write down, repeated so the replies have the shape P3 and P7 will send.

Two areas:

- ``fixture:area-main`` (``shared/fixtures/area/``): 2 visits x 4 exposures x 2 detectors, 30
  stars, 1 fixed source, 18 glitches, one static one-visit tracklet and 4 movers (``found_blind``,
  ``unexplained``, ``unchecked`` by a failed Horizons call, ``possible`` with ``one_visit``), plus
  a full ``checks`` reply (test mover, 4 x 4 grid, a control of 0 in 20).
- ``fixture:area-multivisit`` (``shared/fixtures/area/multivisit/``): 4 visits for D7, one
  ``rate_grid`` track, and ``checks:not_run``.

Determinism: no clock, no global random state. Positions come from fixed paths and a seeded
``random.Random``; every list is emitted in a defined order; floats are rounded to fixed places;
files are UTF-8 with LF. A rerun reproduces the committed bytes (``--check``; the test runs this
module in a subprocess and compares).
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from app.settings import BACKEND_DIR
from app.timefmt import iso_utc_z

OUT_DIR = BACKEND_DIR.parent / "shared" / "fixtures" / "area"

PIXEL_DEG = 6.15 / 3600.0  # SPHEREx pixel (A17 "Units and symbols")
SYNTHETIC = "synthetic fixture"
DATA_RELEASE = "synthetic_fixture"
FILES = ("summary.json", "known.json", "dots.json", "tracks.json", "checks.json", "export.ecsv")

# Synthetic detector bands (um) and resolving power, only to give each dot a wavelength.
BANDS: dict[int, tuple[float, float]] = {
    1: (0.75, 1.11),
    2: (1.11, 1.64),
    3: (1.64, 2.42),
    4: (2.42, 3.82),
}
RESOLVING_POWER = 41.0
EXPOSURE_STEP_S = 120.0
WILSON_Z = 1.959964

# The starting values of A17.2 to A17.13, repeated as the reply's `method.settings` (Q-208 (5)).
SETTINGS: dict[str, int | float | str] = {
    "area_version": "fixture-0",
    "bg_box_px": 32,
    "bg_sigma": 3.0,
    "bg_iters": 5,
    "k_detect": 5.0,
    "min_sep_px": 3.0,
    "aperture_px": 3.0,
    "annulus_in_px": 6.0,
    "annulus_out_px": 9.0,
    "visit_gap_h": 1.0,
    "k_visit": 3,
    "r_match_min_px": 2.0,
    "rms_max_px": 1.0,
    "min_motion_px": 1.0,
    "ambiguity_ratio": 0.5,
    "rate_max_deg_day": 1.2,
    "r_known_min_px": 3.0,
    "v_lim": 22.0,
    "sed_snr_min": 3.0,
    "sed_min_dots": 6,
    "sed_sigma_floor": 0.15,
    "sed_chi2_max": 3.0,
}
SED_CHI2_MAX = 3.0
SED_SIGMA_FLOOR = 0.15

ORBIT_ASSUMPTION = (
    "orbit solutions from SkyBoT (candidates) and JPL Horizons (positions) as of fetched_at, "
    "seen from SPHEREx (500@-163182)"
)
PLANTED_ASSUMPTION = (
    "synthetic point sources added in memory to this area's recorded cutouts; "
    "PSF and distance model in method.checks"
)


def _src(what: str) -> str:
    return f"{SYNTHETIC}: {what}"


PROV_INDEX = {
    "areas": {
        "tag": "derived",
        "source": _src("made-up index"),
        "formula": "the prepared derived.area entries whose params_hash matches the running "
        "code and settings (A17.10); n_frames and n_visits counted from each summary",
    }
}
PROV_SUMMARY = {
    "frames": {"tag": "measured", "source": _src("made-up frame list, not SPHEREx data")},
    "coverage": {
        "tag": "derived",
        "source": _src("made-up footprints"),
        "formula": "per visit, the union of its frames' s_region clipped to the area (A17.1)",
    },
    "steps": {
        "tag": "derived",
        "source": _src("counts of the fixture's own dots and tracks"),
        "formula": "labels counted in /dots, statuses and verdicts counted in /tracks "
        "(A17.3 to A17.5)",
    },
}
PROV_KNOWN = {
    "positions": {
        "tag": "model_dependent",
        "source": _src("made-up positions of made-up objects"),
        "assumption": ORBIT_ASSUMPTION,
    },
    "skybot": {"tag": "measured", "source": _src("made-up answer dates")},
}
PROV_DOTS = {
    "position": {
        "tag": "derived",
        "source": _src("made-up centroids"),
        "formula": "RA/Dec = the measured centroid (x, y) through the frame WCS (A17.2); "
        "here a linear tangent-plane map",
    },
    "photometry": {"tag": "measured", "source": _src("made-up x, y, flux, error, S/N, flags")},
    "wavelength": {"tag": "measured", "source": _src("made-up wavelengths")},
    "label": {
        "tag": "derived",
        "source": _src("labels set by the fixture generator"),
        "formula": "glitch, fixed and star rules of A17.3 with the thresholds in method.settings",
    },
}
PROV_TRACKS_BASE = {
    "tracks": {
        "tag": "derived",
        "source": _src("made-up tracks"),
        "formula": "tracklets and visit pairs of A17.4 (A17.12 for rate_grid) with the "
        "thresholds in method.settings",
    },
    "match": {
        "tag": "model_dependent",
        "source": _src("made-up known objects"),
        "assumption": ORBIT_ASSUMPTION,
    },
}
PROV_SED = {
    "tag": "derived",
    "source": _src("made-up scores"),
    "formula": "weighted degree-2 fit of ln F against ln wavelength, chi2_red against "
    "sed_chi2_max (A17.13)",
}
PROV_CHECKS = {
    "test_mover": {
        "tag": "model_dependent",
        "source": _src("made-up planted mover"),
        "assumption": PLANTED_ASSUMPTION,
    },
    "completeness": {
        "tag": "model_dependent",
        "source": _src("made-up grid"),
        "assumption": PLANTED_ASSUMPTION,
    },
    "control": {
        "tag": "derived",
        "source": _src("made-up control"),
        "formula": "tracks found on the same frames with the mid-times permuted at random; "
        "seeds in method.checks (A17.6)",
    },
}


# ------------------------------------------------------------------------------------- geometry


@dataclass(frozen=True)
class AreaGeom:
    area_id: str
    ra0: float
    dec0: float
    width_deg: float
    height_deg: float

    @property
    def nx(self) -> int:
        return round(self.width_deg / PIXEL_DEG)

    @property
    def ny(self) -> int:
        return round(self.height_deg / PIXEL_DEG)

    def radec(self, x: float, y: float) -> tuple[float, float]:
        """Linear tangent-plane map: +x is east, +y is north (synthetic WCS)."""
        cos_dec = math.cos(math.radians(self.dec0))
        ra = self.ra0 + (x - self.nx / 2) * PIXEL_DEG / cos_dec
        dec = self.dec0 + (y - self.ny / 2) * PIXEL_DEG
        return round(ra % 360.0, 7), round(dec, 7)

    def rect(self, x0: float, x1: float) -> list[list[float]]:
        """Corners of the strip x0..x1 over the full height, counter-clockwise from south-west."""
        corners = [(x0, 0.0), (x1, 0.0), (x1, float(self.ny)), (x0, float(self.ny))]
        return [list(self.radec(x, y)) for x, y in corners]


@dataclass(frozen=True)
class Frame:
    frame_id: str
    detector: int
    visit: int
    exposure: int
    time: datetime
    x_max: float  # this visit's coverage is x in [0, x_max]


@dataclass
class Dot:
    frame: Frame
    x: float
    y: float
    flux: float
    err: float
    flags: list[str]
    label: str
    owner: str  # internal: "star:3", "mover:A1", ...
    dot_id: str = ""


@dataclass(frozen=True)
class Mover:
    """A straight path in pixels: (x0, y0) at t0, (vx, vy) px/day."""

    name: str
    x0: float
    y0: float
    vx: float
    vy: float
    t0: datetime
    flux: dict[int, float]

    def at(self, t: datetime) -> tuple[float, float]:
        dt = (t - self.t0).total_seconds() / 86400.0
        return self.x0 + self.vx * dt, self.y0 + self.vy * dt

    @property
    def rate_deg_day(self) -> float:
        return math.hypot(self.vx, self.vy) * PIXEL_DEG

    @property
    def pa_deg(self) -> float:
        return math.degrees(math.atan2(self.vx, self.vy)) % 360.0


@dataclass
class Spec:
    """One synthetic area."""

    geom: AreaGeom
    detectors: tuple[int, ...]
    visit_starts: list[datetime]
    n_exposures: int
    coverage_x: dict[int, float]  # visit -> x_max of its coverage
    computed_at: datetime
    seed: int
    frames: list[Frame] = field(default_factory=list)

    def build_frames(self) -> None:
        stem = self.geom.area_id.split(":", 1)[1]
        frames = [
            Frame(
                frame_id=f"fixture-{stem}-v{v}e{e}-D{d}",
                detector=d,
                visit=v,
                exposure=e,
                time=start + timedelta(seconds=EXPOSURE_STEP_S * (e - 1)),
                x_max=self.coverage_x[v],
            )
            for v, start in enumerate(self.visit_starts, start=1)
            for e in range(1, self.n_exposures + 1)
            for d in self.detectors
        ]
        self.frames = sorted(frames, key=lambda f: (f.time, f.detector, f.frame_id))


def _r(value: float, places: int) -> float:
    return round(value, places) + 0.0  # + 0.0 turns -0.0 into 0.0


def _wavelength(frame: Frame, geom: AreaGeom, x: float) -> tuple[float, float]:
    lo, hi = BANDS[frame.detector]
    wl = lo + (hi - lo) * min(max(x / geom.nx, 0.0), 1.0)
    return _r(wl, 4), _r(wl / RESOLVING_POWER, 4)


def _too_close(x: float, y: float, taken: list[tuple[float, float]], r: float) -> bool:
    return any(math.hypot(x - a, y - b) < r for a, b in taken)


# ------------------------------------------------------------------------------------- dots


@dataclass
class Built:
    spec: Spec
    dots: list[Dot]
    tracks: list[dict[str, Any]]
    track_dots: dict[str, list[Dot]]  # mover name -> its dots (track or possible)


def _mover_dots(spec: Spec, m: Mover, frames: list[Frame], err: float) -> list[Dot]:
    out = []
    for f in frames:
        x, y = m.at(f.time)
        out.append(
            Dot(f, _r(x, 2), _r(y, 2), m.flux[f.detector], err, [], "mover", f"mover:{m.name}")
        )
    return out


def _place_static(
    spec: Spec,
    rng: random.Random,
    n: int,
    taken: list[tuple[float, float]],
    margin: float,
) -> list[tuple[float, float]]:
    x_max = min(spec.coverage_x.values())
    out: list[tuple[float, float]] = []
    while len(out) < n:
        x = rng.uniform(margin, x_max - margin)
        y = rng.uniform(margin, spec.geom.ny - margin)
        if not _too_close(x, y, taken + out, 8.0):
            out.append((x, y))
    return out


def _assign_ids(spec: Spec, dots: list[Dot]) -> None:
    """``<frame_id>:<n>``, n from 1 by the peak pixel's row, then column (A17.2, Q-208 (14))."""
    by_frame: dict[str, list[Dot]] = {}
    for d in dots:
        by_frame.setdefault(d.frame.frame_id, []).append(d)
    for frame_id, group in by_frame.items():
        group.sort(key=lambda d: (math.floor(d.y + 0.5), math.floor(d.x + 0.5), d.x, d.y))
        for n, d in enumerate(group, start=1):
            d.dot_id = f"{frame_id}:{n}"


def _dot_order(spec: Spec) -> Any:
    index = {f.frame_id: i for i, f in enumerate(spec.frames)}

    def key(d: Dot) -> tuple[int, int]:
        return index[d.frame.frame_id], int(d.dot_id.rsplit(":", 1)[1])

    return key


def _build(
    spec: Spec,
    movers: list[Mover],
    mover_frames: dict[str, list[Frame]],
    n_stars: int,
    n_glitches: int,
    fixed: bool,
) -> tuple[list[Dot], dict[str, list[Dot]]]:
    rng = random.Random(spec.seed)
    dots: list[Dot] = []
    by_mover: dict[str, list[Dot]] = {}
    for m in movers:
        md = _mover_dots(spec, m, mover_frames[m.name], 4.0)
        by_mover[m.name] = md
        dots.extend(md)
    taken = [(d.x, d.y) for d in dots]
    statics = _place_static(spec, rng, n_stars + (1 if fixed else 0), taken, 20.0)
    for i, (x, y) in enumerate(statics):
        is_fixed = fixed and i == len(statics) - 1
        base = rng.uniform(30.0, 3000.0)
        tilt = rng.uniform(0.6, 1.4)
        for f in spec.frames:
            flux = base * (tilt if f.detector == max(spec.detectors) else 1.0)
            jx, jy = rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05)
            dots.append(
                Dot(
                    f,
                    _r(x + jx, 2),
                    _r(y + jy, 2),
                    flux,
                    2.0 + 0.01 * flux,
                    [],
                    "fixed" if is_fixed else "star",
                    f"{'fixed' if is_fixed else 'star'}:{i}",
                )
            )
    for g in range(n_glitches):
        f = spec.frames[rng.randrange(len(spec.frames))]
        in_frame = [(d.x, d.y) for d in dots if d.frame is f]
        while True:
            x = rng.uniform(5.0, f.x_max - 5.0)
            y = rng.uniform(5.0, spec.geom.ny - 5.0)
            if not _too_close(x, y, in_frame, 8.0):
                break
        flux = rng.uniform(50.0, 500.0)
        flags = ["TRANSIENT"] if g % 3 == 0 else []
        dots.append(Dot(f, _r(x, 2), _r(y, 2), flux, 3.0, flags, "glitch", f"glitch:{g}"))
    _assign_ids(spec, dots)
    dots.sort(key=_dot_order(spec))
    return dots, by_mover


def _dot_json(spec: Spec, d: Dot, *, with_id: bool = True) -> dict[str, Any]:
    ra, dec = spec.geom.radec(d.x, d.y)
    wl, bw = _wavelength(d.frame, spec.geom, d.x)
    out: dict[str, Any] = {}
    if with_id:
        out["dot_id"] = d.dot_id
    out.update(
        {
            "frame_id": d.frame.frame_id,
            "detector": d.frame.detector,
            "exposure": d.frame.exposure,
            "time": iso_utc_z(d.frame.time),
            "x": d.x,
            "y": d.y,
            "ra": ra,
            "dec": dec,
            "flux_uJy": _r(d.flux, 1),
            "flux_err": _r(d.err, 1),
            "snr": _r(_r(d.flux, 1) / _r(d.err, 1), 2),
            "wavelength_um": wl,
            "bandwidth_um": bw,
            "flags": sorted(d.flags),
        }
    )
    if with_id:
        out["label"] = d.label
    return out


# ------------------------------------------------------------------------------------- replies


def _wilson(k: int, n: int) -> list[float]:
    p = k / n
    z2 = WILSON_Z**2
    centre = (p + z2 / (2 * n)) / (1 + z2 / n)
    half = WILSON_Z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / (1 + z2 / n)
    return [_r(max(0.0, centre - half), 4), _r(min(1.0, centre + half), 4)]


def _sed(dots: list[Dot], chi2: float | None) -> dict[str, Any]:
    used = [d for d in dots if d.flux / d.err >= float(SETTINGS["sed_snr_min"])]
    detectors = {d.frame.detector for d in used}
    if len(used) < int(SETTINGS["sed_min_dots"]) or len(detectors) < 2 or chi2 is None:
        return {
            "label": "too_few",
            "chi2_red": None,
            "n_dots": len(used),
            "sigma_floor": SED_SIGMA_FLOOR,
        }
    label = "smooth" if chi2 <= SED_CHI2_MAX else "rough"
    return {"label": label, "chi2_red": chi2, "n_dots": len(used), "sigma_floor": SED_SIGMA_FLOOR}


def _tracklets(m: Mover, dots: list[Dot]) -> list[dict[str, Any]]:
    out = []
    for v in sorted({d.frame.visit for d in dots}):
        ids = [d.dot_id for d in dots if d.frame.visit == v]
        out.append(
            {
                "visit": v,
                "dot_ids": ids,
                "v_in_deg_day": _r(m.rate_deg_day * 0.97, 4),  # synthetic in-visit parallax
                "pa_in_deg": _r((m.pa_deg + 2.5) % 360.0, 2),
                "rms_px": 0.12,
            }
        )
    return out


def _track(
    m: Mover,
    dots: list[Dot],
    *,
    status: str,
    reason: str | None,
    verdict: str,
    match: dict[str, Any] | None,
    linker: str,
    unchecked_by: list[str],
    chi2: float | None,
) -> dict[str, Any]:
    paired = status == "track"
    return {
        "track_id": "",
        "visits": sorted({d.frame.visit for d in dots}),
        "tracklets": _tracklets(m, dots),
        "rate_deg_day": _r(m.rate_deg_day, 4) if paired else None,
        "pa_deg": _r(m.pa_deg, 2) if paired else None,
        "u_inv_au": 0.62 if paired else None,
        "status": status,
        "reason": reason,
        "verdict": verdict,
        "match": match,
        "linker": linker,
        "unchecked_by": sorted(unchecked_by),
        "sed": _sed(dots, chi2),
    }


def _number_tracks(
    spec: Spec, tracks: list[tuple[dict[str, Any], list[Dot]]]
) -> list[dict[str, Any]]:
    """``T1…`` in order of first time, ties by the first dot (A17.4)."""
    key = _dot_order(spec)
    ordered = sorted(tracks, key=lambda t: key(min(t[1], key=key)))
    for i, (track, _dots) in enumerate(ordered, start=1):
        track["track_id"] = f"T{i}"
    return [t for t, _ in ordered]


def _steps(dots: list[Dot], tracks: list[dict[str, Any]], n_static: int) -> dict[str, int]:
    label = [d.label for d in dots]
    verdict = [t["verdict"] for t in tracks]
    return {
        "n_dots": len(dots),
        "n_glitches": label.count("glitch"),
        "n_stars": label.count("star"),
        "n_fixed": label.count("fixed"),
        "n_static_one_visit": n_static,
        "n_tracks": sum(t["status"] == "track" for t in tracks),
        "n_possible": sum(t["status"] == "possible" for t in tracks),
        "n_found_blind": verdict.count("found_blind"),
        "n_unexplained": verdict.count("unexplained"),
        "n_unchecked": verdict.count("unchecked"),
    }


def _head(spec: Spec, missing: list[str]) -> dict[str, Any]:
    stamp = iso_utc_z(spec.computed_at)
    return {"cached_at": stamp, "computed_at": stamp, "missing": sorted(set(missing))}


def _known_object(
    spec: Spec,
    designation: str,
    kind: str,
    v_mag: float | None,
    object_id: str | None,
    path: Mover,
    frames: list[Frame],
    offset_px: float,
    track_available: bool,
) -> dict[str, Any]:
    positions = []
    for f in frames:
        x, y = path.at(f.time)
        ra, dec = spec.geom.radec(x + offset_px, y + offset_px)
        positions.append({"frame_id": f.frame_id, "time": iso_utc_z(f.time), "ra": ra, "dec": dec})
    return {
        "designation": designation,
        "number": None,
        "object_id": object_id,
        "kind": kind,
        "v_mag": v_mag,
        "n_frames": len(frames),
        "n_visits": len({f.visit for f in frames}),
        "positions": positions,
        "track_available": track_available,
    }


def _summary(spec: Spec, steps: dict[str, int], missing: list[str]) -> dict[str, Any]:
    g = spec.geom
    coverage = [
        {"visit": v, "polygon": g.rect(0.0, spec.coverage_x[v])} for v in sorted(spec.coverage_x)
    ]
    frames = []
    for f in spec.frames:
        lo, hi = BANDS[f.detector]
        corners = " ".join(f"{a:.7f} {b:.7f}" for a, b in g.rect(0.0, f.x_max))
        frames.append(
            {
                "frame_id": f.frame_id,
                "detector": f.detector,
                "visit": f.visit,
                "exposure": f.exposure,
                "time": iso_utc_z(f.time),
                "wavelength_min_um": lo,
                "wavelength_max_um": hi,
                "s_region": f"POLYGON ICRS {corners}",
            }
        )
    return {
        **{k: v for k, v in _index_entry(spec).items() if k not in {"computed_at", "cached_at"}},
        "frames": frames,
        "coverage": coverage,
        "steps": steps,
        "method": {"settings": dict(SETTINGS)},
        **_head(spec, missing),
        "provenance": PROV_SUMMARY,
    }


def _index_entry(spec: Spec) -> dict[str, Any]:
    g = spec.geom
    stamp = iso_utc_z(spec.computed_at)
    return {
        "area_id": g.area_id,
        "ra": g.ra0,
        "dec": g.dec0,
        "width_deg": g.width_deg,
        "height_deg": g.height_deg,
        "data_release": DATA_RELEASE,
        "n_frames": len(spec.frames),
        "n_visits": len(spec.visit_starts),
        "computed_at": stamp,
        "cached_at": stamp,
    }


def _dots_reply(spec: Spec, dots: list[Dot], missing: list[str]) -> dict[str, Any]:
    visits = [
        {"visit": v, "dots": [_dot_json(spec, d) for d in dots if d.frame.visit == v]}
        for v in range(1, len(spec.visit_starts) + 1)
    ]
    return {"visits": visits, **_head(spec, missing), "provenance": PROV_DOTS}


def _skybot(spec: Spec) -> list[dict[str, Any]]:
    base = spec.computed_at - timedelta(minutes=3)
    return [
        {"visit": v, "fetched_at": iso_utc_z(base + timedelta(seconds=30 * (v - 1)))}
        for v in range(1, len(spec.visit_starts) + 1)
    ]


def _ecsv(spec: Spec) -> str:
    return (
        "# %ECSV 1.0\n"
        "# ---\n"
        "# datatype: []\n"
        "# meta:\n"
        f"#   source: '{SYNTHETIC}: header-only stub (issue #92); the real writer is P7 "
        "(A17.7, A19.9)'\n"
        f"#   area_id: '{spec.geom.area_id}'\n"
        "#   area_columns: [track_id, dot_id, status, verdict, match_designation]\n"
    )


def _not_run_checks(spec: Spec) -> dict[str, Any]:
    return {
        "method": {"settings": dict(SETTINGS)},
        **_head(spec, ["checks:not_run"]),
        "provenance": {},
    }


# ------------------------------------------------------------------------------------- areas


def main_area() -> tuple[dict[str, Any], dict[str, str]]:
    geom = AreaGeom("fixture:area-main", 150.0, 10.0, 1.0, 0.6)
    v1 = datetime(2026, 1, 15, 3, 0, 0, tzinfo=UTC)
    v2 = v1 + timedelta(hours=24.4)
    nx = geom.nx
    spec = Spec(
        geom=geom,
        detectors=(1, 4),
        visit_starts=[v1, v2],
        n_exposures=4,
        coverage_x={1: float(math.floor(0.75 * nx)), 2: float(nx)},
        computed_at=datetime(2026, 11, 10, 12, 0, 0, tzinfo=UTC),
        seed=92,
    )
    spec.build_frames()
    frames = spec.frames
    v2_d4 = [f for f in frames if f.visit == 2 and f.detector == 4]
    v1_d1 = [f for f in frames if f.visit == 1 and f.detector == 1]
    a1 = Mover("A1", 150.0, 60.0, 290.0, 40.0, v1, {1: 40.0, 4: 60.0})
    t2 = Mover("U1", 120.0, 120.0, 180.0, -30.0, v1, {1: 30.0, 4: 22.0})
    a2 = Mover("A2", 300.0, 250.0, -150.0, 60.0, v1, {1: 50.0, 4: 70.0})
    red = Mover("R1", 500.0, 200.0, 250.0, 300.0, v2, {4: 36.0})
    static = Mover("S1", 80.0, 300.0, 40.0, 30.0, v1, {1: 28.0})
    c1 = Mover("C1", 380.0, 330.0, 200.0, 0.0, v1, {})
    movers = [a1, t2, a2, red, static]
    mover_frames = {"A1": frames, "U1": frames, "A2": frames, "R1": v2_d4, "S1": v1_d1}
    dots, by_mover = _build(spec, movers, mover_frames, n_stars=30, n_glitches=18, fixed=True)
    # One OUTLIER on the found-blind mover's core (Q-139, Q-178): kept and flagged.
    by_mover["A1"][5].flags.append("OUTLIER")

    horizons = "horizons:Synthetic fixture A2"
    stamp_code = f"stamp:{next(d.dot_id for d in reversed(dots) if d.label == 'star')}"
    skybot = _skybot(spec)
    known_objs = [
        _known_object(
            spec, "Synthetic fixture A1", "asteroid", 18.4, "synthetic-mover", a1, frames, 0.3, True
        ),
        _known_object(
            spec,
            "Synthetic fixture C1",
            "comet",
            21.5,
            None,
            c1,
            [f for f in frames if f.visit == 1],
            0.0,
            False,
        ),
    ]
    a1_known = known_objs[0]
    seps = []
    by_frame = {p["frame_id"]: p for p in a1_known["positions"]}
    for d in by_mover["A1"]:
        ra, dec = geom.radec(d.x, d.y)
        p = by_frame[d.frame.frame_id]
        dra = (ra - p["ra"]) * math.cos(math.radians(dec))
        seps.append(math.hypot(dra, dec - p["dec"]) / PIXEL_DEG)
    seps.sort()
    median = (seps[len(seps) // 2 - 1] + seps[len(seps) // 2]) / 2
    match = {
        "designation": "Synthetic fixture A1",
        "number": None,
        "object_id": "synthetic-mover",
        "v_mag": 18.4,
        "median_sep_px": _r(median, 2),
        "fetched_at": skybot[0]["fetched_at"],
    }
    raw = [
        (
            _track(
                a1,
                by_mover["A1"],
                status="track",
                reason=None,
                verdict="found_blind",
                match=match,
                linker="pairs",
                unchecked_by=[],
                chi2=1.2,
            ),
            by_mover["A1"],
        ),
        (
            _track(
                t2,
                by_mover["U1"],
                status="track",
                reason=None,
                verdict="unexplained",
                match=None,
                linker="pairs",
                unchecked_by=[],
                chi2=7.8,
            ),
            by_mover["U1"],
        ),
        (
            _track(
                a2,
                by_mover["A2"],
                status="track",
                reason=None,
                verdict="unchecked",
                match=None,
                linker="pairs",
                unchecked_by=[horizons],
                chi2=1.9,
            ),
            by_mover["A2"],
        ),
        (
            _track(
                red,
                by_mover["R1"],
                status="possible",
                reason="one_visit",
                verdict="possible",
                match=None,
                linker="pairs",
                unchecked_by=[],
                chi2=None,
            ),
            by_mover["R1"],
        ),
    ]
    tracks = _number_tracks(spec, raw)
    assert [t["verdict"] for t in tracks] == ["found_blind", "unexplained", "unchecked", "possible"]

    dots_missing = [stamp_code]
    known_missing = [horizons]
    tracks_missing = [horizons, "rate_grid:visits"]
    checks = _main_checks(spec, frames)
    steps = _steps(dots, tracks, n_static=1)
    replies: dict[str, Any] = {
        "dots.json": _dots_reply(spec, dots, dots_missing),
        "known.json": {
            "known": known_objs,
            "skybot": skybot,
            **_head(spec, known_missing),
            "provenance": PROV_KNOWN,
        },
        "tracks.json": {
            "tracks": tracks,
            "skybot": skybot,
            **_head(spec, tracks_missing),
            "provenance": {**PROV_TRACKS_BASE, "sed": PROV_SED},
        },
        "checks.json": checks,
    }
    union = [m for r in replies.values() for m in r["missing"]]
    replies["summary.json"] = _summary(spec, steps, union)
    return _index_entry(spec), _serialise(spec, replies)


def _main_checks(spec: Spec, frames: list[Frame]) -> dict[str, Any]:
    planted = Mover("P1", 200.0, 20.0, 170.0, 30.0, spec.visit_starts[0], {1: 24.0, 4: 24.0})
    planted_dots = []
    for f in frames:
        x, y = planted.at(f.time)
        planted_dots.append(
            Dot(f, _r(x, 2), _r(y, 2), planted.flux[f.detector], 3.0, [], "mover", "planted")
        )
    ra, dec = spec.geom.radec(planted.x0, planted.y0)
    snr_bins = [
        {"min": 5.0, "max": 8.0},
        {"min": 8.0, "max": 12.0},
        {"min": 12.0, "max": 20.0},
        {"min": 20.0, "max": None},
    ]
    rate_bins = [
        {"min": 0.02, "max": 0.1},
        {"min": 0.1, "max": 0.3},
        {"min": 0.3, "max": 0.6},
        {"min": 0.6, "max": 1.2},
    ]
    n = 50
    # Made-up recovery counts: higher S/N finds more, the fastest bin fewer (synthetic shape only).
    k_table = [[22, 25, 24, 15], [36, 39, 38, 27], [44, 46, 45, 35], [48, 49, 49, 41]]
    cells = []
    for s in range(4):
        for r in range(4):
            k = k_table[s][r]
            cells.append(
                {
                    "snr_bin": s,
                    "rate_bin": r,
                    "n": n,
                    "k": k,
                    "frac": _r(k / n, 4),
                    "wilson95": _wilson(k, n),
                }
            )
    n_runs = 20
    return {
        "test_mover": {
            "ra": ra,
            "dec": dec,
            "rate_deg_day": _r(planted.rate_deg_day, 4),
            "pa_deg": _r(planted.pa_deg, 2),
            "snr": 8.0,
            "dots": [_dot_json(spec, d, with_id=False) for d in planted_dots],
            "recovered": True,
            "reason": None,
        },
        "completeness": {"snr_bins": snr_bins, "rate_bins": rate_bins, "cells": cells},
        "control": {"n_runs": n_runs, "tracks_per_run": [0] * n_runs, "mean": 0.0, "max": 0},
        "linker": "pairs",
        "method": {
            "settings": dict(SETTINGS),
            "checks": {
                "seeds": list(range(1, 102)),
                "n_per_cell": n,
                "snr_bins": snr_bins,
                "rate_bins": rate_bins,
                "n_control_runs": n_runs,
                "psf": f"{SYNTHETIC}: Gaussian, width measured on isolated stars of the area",
                "distance_model": f"{SYNTHETIC}: u = 1/distance with distance 1.5 AU",
            },
        },
        **_head(spec, ["rate_grid:visits"]),
        "provenance": PROV_CHECKS,
    }


def multivisit_area() -> tuple[dict[str, Any], dict[str, str]]:
    geom = AreaGeom("fixture:area-multivisit", 210.0, -20.0, 0.6, 0.6)
    v1 = datetime(2026, 2, 3, 6, 0, 0, tzinfo=UTC)
    starts = [v1 + timedelta(days=k) for k in range(4)]
    spec = Spec(
        geom=geom,
        detectors=(2, 3),
        visit_starts=starts,
        n_exposures=2,
        coverage_x={v: float(geom.nx) for v in range(1, 5)},
        computed_at=datetime(2026, 11, 10, 12, 5, 0, tzinfo=UTC),
        seed=921,
    )
    spec.build_frames()
    faint = Mover("F1", 60.0, 80.0, 70.0, 50.0, v1, {2: 18.0, 3: 21.0})
    dots, by_mover = _build(
        spec, [faint], {"F1": spec.frames}, n_stars=8, n_glitches=4, fixed=False
    )
    raw = [
        (
            _track(
                faint,
                by_mover["F1"],
                status="track",
                reason=None,
                verdict="unexplained",
                match=None,
                linker="rate_grid",
                unchecked_by=[],
                chi2=1.4,
            ),
            by_mover["F1"],
        )
    ]
    tracks = _number_tracks(spec, raw)
    steps = _steps(dots, tracks, n_static=0)
    skybot = _skybot(spec)
    replies: dict[str, Any] = {
        "dots.json": _dots_reply(spec, dots, []),
        "known.json": {"known": [], "skybot": skybot, **_head(spec, []), "provenance": PROV_KNOWN},
        "tracks.json": {
            "tracks": tracks,
            "skybot": skybot,
            **_head(spec, []),
            "provenance": {**PROV_TRACKS_BASE, "sed": PROV_SED},
        },
        "checks.json": _not_run_checks(spec),
    }
    union = [m for r in replies.values() for m in r["missing"]]
    replies["summary.json"] = _summary(spec, steps, union)
    return _index_entry(spec), _serialise(spec, replies)


def _dump(data: Any) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def _serialise(spec: Spec, replies: dict[str, Any]) -> dict[str, str]:
    out = {name: _dump(replies[name]) for name in FILES if name.endswith(".json")}
    out["export.ecsv"] = _ecsv(spec)
    return out


def fixture_files() -> dict[str, bytes]:
    """Relative path under ``shared/fixtures/area/`` -> exact bytes."""
    main_entry, main_files = main_area()
    multi_entry, multi_files = multivisit_area()
    entries = sorted([main_entry, multi_entry], key=lambda e: str(e["area_id"]))
    index = {
        "areas": entries,
        "cached_at": min(str(e["cached_at"]) for e in entries),
        "computed_at": max(str(e["computed_at"]) for e in entries),
        "missing": [],
        "provenance": PROV_INDEX,
    }
    files = {"index.json": _dump(index)}
    files.update(main_files)
    files.update({f"multivisit/{k}": v for k, v in multi_files.items()})
    return {k: v.encode("utf-8") for k, v in sorted(files.items())}


def main(argv: list[str] | None = None, *, out_dir: Path = OUT_DIR) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--check", action="store_true", help="compare with the files on disk")
    args = ap.parse_args(argv)
    files = fixture_files()
    stale = [rel for rel, data in files.items() if _read(out_dir / rel) != data]
    if args.check:
        for rel in stale:
            print(f"differs: {rel}", file=sys.stderr)
        if not stale:
            print(f"{len(files)} area fixture files match {out_dir.name}/")
        return 1 if stale else 0
    for rel in stale:
        (out_dir / rel).parent.mkdir(parents=True, exist_ok=True)
        (out_dir / rel).write_bytes(files[rel])
    print(f"{len(files)} files, {len(stale)} written, under {out_dir}")
    return 0


def _read(path: Path) -> bytes | None:
    try:
        return path.read_bytes()
    except OSError:
        return None


if __name__ == "__main__":
    raise SystemExit(main())
