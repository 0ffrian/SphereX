"""The Day 0 count (A16.6, A16.7, Q-148, Q-401): measured facts of one area run.

A plain dict, written as JSON by ``scripts/area_discovery.py --day0`` (outside the repo). Times
are wall-clock seconds of this run and are never compared byte for byte.
"""

from __future__ import annotations

import itertools
import statistics
from collections import Counter
from collections.abc import Sequence
from typing import Any

from app.core.area.config import AreaConfig, method_settings
from app.core.area.records import AreaFrames, FrameDots, canonical, dots_jsonable
from app.timefmt import parse_utc

PIXEL_DEG = 6.15 / 3600.0
# Day 0 only: a dot within this distance of the predicted position counts as the object's dot
# (the floor of A17.3's r_match, 2 px). Not a pipeline setting.
OBJECT_MATCH_PX = 2.0


def _sep_px(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    import math

    dra = ((ra1 - ra2 + 180.0) % 360.0 - 180.0) * math.cos(math.radians((dec1 + dec2) / 2))
    return math.hypot(dra, dec1 - dec2) / PIXEL_DEG


def _median(values: Sequence[float]) -> float | None:
    return float(statistics.median(values)) if values else None


def report(
    frames: AreaFrames,
    per_frame: Sequence[FrameDots] | None,
    cfg: AreaConfig,
    *,
    positions: dict[str, tuple[float, float]] | None = None,
    object_name: str | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "area": frames.spec.id,
        "complete": frames.complete,
        "missing": list(frames.missing),
        "settings": method_settings(cfg),
    }
    cones = frames.cones
    out["cones"] = {
        "n": len(cones),
        "by_verdict": dict(Counter(c.verdict for c in cones)),
        "maxrec": sum(c.truncated for c in cones),
        "rows": [c.rows for c in cones],
        "seconds_total": sum(c.seconds for c in cones),
    }
    fr = frames.frames
    visits = sorted({f.visit for f in fr})
    times = {v: sorted({f.time for f in fr if f.visit == v}) for v in visits}
    spans_s = {
        v: (parse_utc(t[-1]) - parse_utc(t[0])).total_seconds() for v, t in times.items() if t
    }
    mids = [parse_utc(t[0]) + (parse_utc(t[-1]) - parse_utc(t[0])) / 2 for t in times.values()]
    out["frames"] = {
        "n": len(fr),
        "per_visit": {str(v): sum(f.visit == v for f in fr) for v in visits},
        "exposures_per_visit": {str(v): len(times[v]) for v in visits},
        "detectors_per_exposure": dict(
            Counter(
                str(len({f.detector for f in fr if (f.visit, f.exposure) == key}))
                for key in {(f.visit, f.exposure) for f in fr}
            )
        ),
        "visit_span_s": {str(v): s for v, s in spans_s.items()},
        "visit_gap_h": [(b - a).total_seconds() / 3600.0 for a, b in itertools.pairwise(mids)],
    }
    st = frames.stats
    each = [s for s in st.get("cutout_seconds_each", []) if s > 0]
    out["cutouts"] = {
        "n_frames": len(fr),
        "n_usable": sum(f.cutout_sha256 is not None for f in fr),
        "mb": st.get("cutout_bytes", 0) / 1e6,
        "seconds_total": st.get("cutout_seconds"),
        "seconds_median": _median(each),
        "size_arcsec": sorted({f.cutout_size_arcsec for f in fr}),
    }
    cell_deg2 = (cfg.coverage_cell_arcsec / 3600.0) ** 2
    cov_deg2 = {c.visit: float(c.mask.sum()) * cell_deg2 for c in frames.coverage}
    out["coverage"] = {
        str(c.visit): {
            "cells_covered": c.cells_covered,
            "pieces": c.pieces,
            "cells_lost": c.cells_lost,
            "holes": c.holes,
            "deg2": cov_deg2[c.visit],
        }
        for c in frames.coverage
    }
    if per_frame is None:
        return out

    visit_of = {f.frame_id: f.visit for f in fr}
    n_dots = sum(len(fd.dots) for fd in per_frame)
    measured = [fd for fd in per_frame if fd.noise]
    refused: Counter[str] = Counter()
    for fd in per_frame:
        refused.update(dict(fd.refused))
    frame_deg2 = sum(cov_deg2.get(visit_of[fd.frame_id], 0.0) for fd in measured)
    t = [fd.timings for fd in measured]
    calls = sum(x.get("measure_calls", 0.0) for x in t)
    ratios = [
        dict(fd.noise)["mesh_std_median"] / dict(fd.noise)["sqrt_var_median"]
        for fd in measured
        if dict(fd.noise).get("sqrt_var_median")
    ]
    body = canonical(dots_jsonable(per_frame))
    out["dots"] = {
        "n": n_dots,
        "per_frame": {fd.frame_id: len(fd.dots) for fd in per_frame},
        "peaks_per_frame": {fd.frame_id: fd.peaks for fd in per_frame},
        "per_deg2_per_frame": n_dots / frame_deg2 if frame_deg2 else None,
        "refused": dict(sorted(refused.items())),
        "record_bytes_per_dot": len(body) / n_dots if n_dots else None,
    }
    out["noise"] = {
        "mesh_std_over_sqrt_var_median": _median(ratios),
        "mesh_std_over_sqrt_var_range": [min(ratios), max(ratios)] if ratios else None,
    }
    out["timings"] = {
        "dots_seconds_total": sum(x.get("total_s", 0.0) for x in t),
        "mesh_ms_median": _median([1000 * x["mesh_s"] for x in t if "mesh_s" in x]),
        "detect_ms_median": _median([1000 * x["detect_s"] for x in t if "detect_s" in x]),
        "wcs_ms_median": _median([1000 * x["wcs_s"] for x in t if "wcs_s" in x]),
        "measure_ms_per_call": 1000 * sum(x.get("measure_s", 0.0) for x in t) / calls
        if calls
        else None,
    }
    if positions is not None:
        out["object"] = object_report(fr, per_frame, positions, object_name)
    return out


def object_report(
    fr: Sequence[Any],
    per_frame: Sequence[FrameDots],
    positions: dict[str, tuple[float, float]],
    name: str | None,
) -> dict[str, Any]:
    """Per frame: the dot within ``OBJECT_MATCH_PX`` of the predicted position, if any."""
    dots = {fd.frame_id: fd for fd in per_frame}
    rows = {}
    for f in fr:
        if f.frame_id not in positions:
            continue
        ra, dec = positions[f.frame_id]
        near = [
            (round(_sep_px(d.ra, d.dec, ra, dec), 3), d)
            for d in (dots[f.frame_id].dots if f.frame_id in dots else ())
            if _sep_px(d.ra, d.dec, ra, dec) <= OBJECT_MATCH_PX
        ]
        near.sort(key=lambda p: p[0])
        rows[f.frame_id] = (
            {
                "found": True,
                "sep_px": near[0][0],
                "snr": near[0][1].snr,
                "flags": list(near[0][1].flags),
            }
            if near
            else {"found": False, "cutout": f.cutout_sha256 is not None}
        )
    return {
        "name": name,
        "match_px": OBJECT_MATCH_PX,
        "frames_predicted": len(rows),
        "frames_found": sum(r["found"] for r in rows.values()),
        "per_frame": rows,
    }
