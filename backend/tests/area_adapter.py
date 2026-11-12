"""A test-only adapter: P3 records -> the served ``summary`` and ``dots`` replies (A17.8).

P7 builds the real replies (and labels); this adapter labels every dot ``mover`` and sets the
step counts P4 to P6 own to 0, so the contract rules that P3 controls can be checked now: ids,
order, frames, coverage, wavelengths, missing codes and provenance (Q-208).
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from app.core.area.config import method_settings
from app.core.area.records import AreaFrames, FrameDots

COMPUTED_AT = "2026-11-11T00:00:00.000Z"  # ASSUMPTION: a fixed run time for the test replies


def summary_reply(frames: AreaFrames, per_frame: Sequence[FrameDots]) -> dict[str, Any]:
    spec = frames.spec
    covered = [c for c in frames.coverage if c.polygon]
    return {
        "area_id": spec.id,
        "ra": spec.ra,
        "dec": spec.dec,
        "width_deg": spec.width_deg,
        "height_deg": spec.height_deg,
        "data_release": spec.data_release,
        "n_frames": len(frames.frames),
        "n_visits": len({f.visit for f in frames.frames}),
        "frames": [
            {
                "frame_id": f.frame_id,
                "detector": f.detector,
                "visit": f.visit,
                "exposure": f.exposure,
                "time": f.time,
                "wavelength_min_um": f.wavelength_min_um,
                "wavelength_max_um": f.wavelength_max_um,
                "s_region": f.s_region,
            }
            for f in frames.frames
        ],
        "coverage": [{"visit": c.visit, "polygon": [list(p) for p in c.polygon]} for c in covered],
        "steps": {
            "n_dots": sum(len(fd.dots) for fd in per_frame),
            "n_glitches": 0,
            "n_stars": 0,
            "n_fixed": 0,
            "n_static_one_visit": 0,
            "n_tracks": 0,
            "n_possible": 0,
            "n_found_blind": 0,
            "n_unexplained": 0,
            "n_unchecked": 0,
        },
        "method": {"settings": method_settings()},
        "cached_at": COMPUTED_AT,
        "computed_at": COMPUTED_AT,
        "missing": list(frames.missing),
        "provenance": {
            "frames": {"tag": "measured", "source": "IRSA SIA, SPHEREx QR2 frame list"},
            "coverage": {
                "tag": "derived",
                "source": "frame footprints and cutouts",
                "formula": "COVERAGE_FORMULA of app/core/area/config.py (A17.1, Q-400)",
            },
            "steps": {
                "tag": "derived",
                "source": "counts of the area's dots",
                "formula": "dots counted per label (A17.2 to A17.5)",
            },
        },
    }


def dots_reply(frames: AreaFrames, per_frame: Sequence[FrameDots]) -> dict[str, Any]:
    visit_of = {f.frame_id: f.visit for f in frames.frames}
    blocks: dict[int, list[dict[str, Any]]] = {c.visit: [] for c in frames.coverage if c.polygon}
    for fd in per_frame:
        for d in fd.dots:
            blocks[visit_of[d.frame_id]].append(
                {
                    "dot_id": d.dot_id,
                    "frame_id": d.frame_id,
                    "detector": d.detector,
                    "exposure": d.exposure,
                    "time": d.time,
                    "x": d.x,
                    "y": d.y,
                    "ra": d.ra,
                    "dec": d.dec,
                    "flux_uJy": d.flux_uJy,
                    "flux_err": d.flux_err,
                    "snr": d.snr,
                    "wavelength_um": d.wavelength_um,
                    "bandwidth_um": d.bandwidth_um,
                    "flags": list(d.flags),
                    "label": "mover",
                }
            )
    return {
        "visits": [{"visit": v, "dots": ds} for v, ds in blocks.items()],
        "cached_at": COMPUTED_AT,
        "computed_at": COMPUTED_AT,
        "missing": [],
        "provenance": {
            "position": {
                "tag": "derived",
                "source": "SPHEREx cutout WCS",
                "formula": "RA/Dec = the measured centroid (x, y) through the frame WCS (A17.2)",
            },
            "photometry": {"tag": "measured", "source": "Stage 2 aperture photometry (A4.2)"},
            "wavelength": {"tag": "measured", "source": "WCS-WAVE at the centroid"},
            "label": {
                "tag": "derived",
                "source": "test adapter: every dot labelled mover until P4",
                "formula": "label = mover (P4 adds glitch, star and fixed, A17.3)",
            },
        },
    }
