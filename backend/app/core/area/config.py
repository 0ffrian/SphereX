"""Area search settings (A17, Q-400): the configured areas and every starting value of P3.

Every number in ``AreaConfig`` is a **starting value** (A17 intro), not a physical fact. Each one
is written into the reply's ``method.settings`` (Q-208 (5)) through ``frames_method`` and
``dots_method``, and so into ``params_hash`` (A17.10). Values marked [verify] wait on the Day 0
count (A16.6, Q-401).
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import tomllib
from collections.abc import Iterable
from dataclasses import dataclass, field, fields, replace
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from app.cache.keys import CacheKey
from app.context import Context
from app.core.measure.config import (
    DEFAULT_CONFIG,
    MEASURE_VERSION,
    REJECT_FLAGS,
    MeasureConfig,
    method_sha,
)
from app.timefmt import parse_utc

log = logging.getLogger("shift_spectrum")

# Bump when the area code changes in a way that changes results (A17.10).
AREA_VERSION = "area-2"  # area-2: labels, join, known check, served entries (P4 to P7)

# SPHEREx pixel (A17 "Units and symbols"): used only to turn pixel settings into sky distances.
PIXEL_ARCSEC = 6.15

AREA_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9:_.-]*$")  # AreaId in area-index.schema.json
# ASSUMPTION: a box larger than this is refused by the loader (the gnomonic box and the cone
# grid are meant for areas of about a degree, A17.11; a typo like 105 would ask for 210 000 cones).
MAX_SIDE_DEG = 10.0

# Hardware flags: Stage 2's reject list without OUTLIER (A17.2 step 2, Q-178 Proposed, Q-139).
HARDWARE_FLAGS: tuple[str, ...] = tuple(f for f in REJECT_FLAGS if f != "OUTLIER")
AREA_MEASURE_CONFIG: MeasureConfig = replace(DEFAULT_CONFIG, reject_flags=HARDWARE_FLAGS)

CENTROID_FORMULA = (
    "first moment of D = I - B over the centroid box at the peak, positive unmasked pixels only: "
    "x_c = sum x_i D_i / F, F = sum D_i; sigma_x^2 = sum (x_i - x_c)^2 V_i / F^2 (same for y); "
    "sigma_c = sqrt((sigma_x^2 + sigma_y^2) / 2). Noise only: no pixel-phase or PSF term"
)
DETECT_FORMULA = (
    "peak = unmasked pixel with I - B > k_detect * sqrt(VARIANCE) that is the maximum of its "
    "peak box; B = bilinear mesh of sigma-clipped box means; greedy minimum separation by "
    "(-D, row, column), on the peaks and again on the centroids"
)
COVERAGE_FORMULA = (
    "per visit: 30 arcsec cells on the gnomonic plane of the area; a cell is covered when its "
    "centre is inside the area box, at least coverage_erode_px inside the s_region of a frame "
    "of the visit that has a cutout, and at least coverage_erode_px inside that cutout's pixels; "
    "the largest 4-connected piece is kept (ties: lowest cell index); polygon = its outline"
)

Window = tuple[datetime, datetime]


@dataclass(frozen=True)
class AreaSpec:
    """One ``[[area]]`` table of ``targets.toml`` (A16.4, A17.1). The box is a rectangle on the
    gnomonic plane about ``(ra, dec)``, north up, ``width_deg`` along RA (Q-400 (1))."""

    id: str
    ra: float
    dec: float
    width_deg: float
    height_deg: float
    data_release: str
    windows: tuple[Window, ...]


@dataclass(frozen=True)
class AreaConfig:
    # --- frames (A17.1) ---
    grid_step_deg: float = 0.25  # [verify] A17.1: largest spacing of the cone grid
    cone_radius_deg: float = 0.001  # A17.1
    cone_maxrec: int = 500  # A17.1 (= SX_SIA_MAXREC)
    margin_deg: float = 0.02  # A17.1 size rule; also the cutout margin (Q-400 (3))
    visit_gap_h: float = 1.0  # A17.1
    exposure_tol_s: float = 1.0  # same as moving.TLIST_TIME_TOLERANCE_S
    coverage_cell_arcsec: float = 30.0  # A17.1
    # Starting value (Q-400 (6)): annulus_outer_px + 1, so a covered cell can hold a measured dot.
    coverage_erode_px: float = 10.0
    # Tie rule, not a physical value: a footprint touching the box only at an edge or a corner
    # (clipped area at most this, deg^2) does not overlap it.
    overlap_eps_deg2: float = 1e-12
    # --- dots (A17.2) ---
    bg_box_px: int = 32  # A17.2 step 1
    bg_sigma: float = 3.0  # A17.2 step 1
    bg_iters: int = 5  # A17.2 step 1
    bg_min_frac: float = 0.5  # starting value (Q-400): a box needs this share of usable pixels
    k_detect: float = 5.0  # A17.2 step 3
    peak_box_px: int = 3  # starting value: a peak is the maximum of its 3 x 3 box
    min_sep_px: float = 3.0  # A17.2 step 3
    centroid_box_px: int = 5  # starting value (Q-400): first-moment box at the peak
    # Stamp half-size for Stage 2 (Q-400): ceil(annulus_outer_px) + 2, so the stamp holds the
    # whole annulus; measuring on it gives the same outcome as on the whole cutout (tested).
    stamp_half_px: int = 11
    measure: MeasureConfig = field(default=AREA_MEASURE_CONFIG)
    # --- labels (A17.3, P4) ---
    r_match_min_px: float = 2.0  # A17.3: r_match = max(2 px, 3 sigma_c)
    r_match_sigma: float = 3.0  # A17.3
    k_visit_max: int = 3  # A17.3: k_visit = min(3, frames of the visit that cover the dot)
    # ASSUMPTION ([verify], A17.3 names no flag list): core-pixel flags of a bright-star artefact.
    # The names are read from the MP_* keywords (wcs.flag_names), never assumed as bits.
    star_artefact_flags: str = "BLOOM,HALO"
    # --- join (A17.4, P5) ---
    rms_max_px: float = 1.0  # A17.4 step 1
    rate_max_deg_day: float = 1.2  # A17.4 step 2 (strong-trailing limit), before the size rule
    v_tol_min_deg_day: float = 0.1  # [verify] A17.4 step 3 (Q-179)
    v_tol_sigma: float = 3.0  # [verify] A17.4 step 3: v_tol = max(0.1 deg/day, 3 sigma_v)
    delta_min_au: float = 0.05  # A17.4 step 3: u <= 1 / delta_min
    ambiguity_ratio: float = 0.5  # A17.4 step 4
    min_motion_px: float = 1.0  # A17.4 step 4: static one-visit tracklets
    # --- known-object check (A17.5, P6) ---
    p_max_arcsec: float = 60.0  # [verify] A17.5 step 1 (parallax and orbit error)
    v_lim: float = 22.0  # [verify] A17.5 step 1
    r_known_min_px: float = 3.0  # A17.5 step 3
    known_min_frac: float = 2.0 / 3.0  # A17.5 step 3: at least two thirds of the dots

    @property
    def artefact_flags(self) -> tuple[str, ...]:
        return tuple(sorted(f for f in self.star_artefact_flags.split(",") if f))

    @property
    def coverage_erode_deg(self) -> float:
        return self.coverage_erode_px * PIXEL_ARCSEC / 3600.0


DEFAULT_AREA_CONFIG = AreaConfig()

Setting = int | float | str


def frames_method(cfg: AreaConfig = DEFAULT_AREA_CONFIG) -> dict[str, Setting]:
    """Flat ``method.settings`` entries of the frames step (Q-208 (5))."""
    return {
        "grid_step_deg": cfg.grid_step_deg,
        "cone_radius_deg": cfg.cone_radius_deg,
        "cone_maxrec": cfg.cone_maxrec,
        "margin_deg": cfg.margin_deg,
        "visit_gap_h": cfg.visit_gap_h,
        "exposure_tol_s": cfg.exposure_tol_s,
        "coverage_cell_arcsec": cfg.coverage_cell_arcsec,
        "coverage_erode_px": cfg.coverage_erode_px,
        "overlap_eps_deg2": cfg.overlap_eps_deg2,
        "coverage_rule": "largest_4_connected_piece",
        "cutout_rule": "bbox_of_frame_in_box_plus_2_margin",
    }


def dots_method(cfg: AreaConfig = DEFAULT_AREA_CONFIG) -> dict[str, Setting]:
    """Flat ``method.settings`` entries of the dots step (Q-208 (5)); names shared with the
    fixture's settings where they overlap (``scripts/area_fixtures.py``)."""
    m = cfg.measure
    return {
        "bg_box_px": cfg.bg_box_px,
        "bg_sigma": cfg.bg_sigma,
        "bg_iters": cfg.bg_iters,
        "bg_min_frac": cfg.bg_min_frac,
        "k_detect": cfg.k_detect,
        "peak_box_px": cfg.peak_box_px,
        "min_sep_px": cfg.min_sep_px,
        "centroid_box_px": cfg.centroid_box_px,
        "stamp_half_px": cfg.stamp_half_px,
        "aperture_px": m.aperture_radius_px,
        "annulus_in_px": m.annulus_inner_px,
        "annulus_out_px": m.annulus_outer_px,
        "hardware_flags": ",".join(m.reject_flags),
        "measure_method_sha": method_sha(m),
        "centroid_formula": CENTROID_FORMULA,
        "detect_formula": DETECT_FORMULA,
    }


GLITCH_FORMULA = (
    "a dot is kept when it has a counterpart within r_match + rate_max * |dt| (px) in at least "
    "k_visit - 1 other frames of its visit, both detectors counting; r_match = max(r_match_min_px,"
    " r_match_sigma * sigma_c) of the larger of the two dots; k_visit = min(k_visit_max, frames of "
    "the visit whose cutout holds the dot at least coverage_erode_px inside its edge)"
)
TRACKLET_FORMULA = (
    "per visit, greedy best-first over seed pairs within the glitch radius: the line through the "
    "pair predicts each frame, the nearest unused dot within r_match joins; least-squares line "
    "x(t), y(t) on the area plane; kept when rms <= rms_max_px and the dots span 2 or more times;"
    " best = most dots, then smallest rms, then the earliest dot; sigma_v from the fit residuals"
)
STAR_FORMULA = (
    "a tracklet is star when every dot lies within max(r_match, r_px) of the same Gaia DR3 or "
    "CatWISE2020 source of the visit's star list, propagated to the dot time (r_px: the A19.6 "
    "mask radius); a dot whose flags hold a star_artefact_flags name is star too"
)
FIXED_FORMULA = (
    "a dot that is not star with a dot of another visit within r_match at the same RA/Dec, where "
    "that visit's coverage holds it"
)
PAIR_FORMULA = (
    "rate window rate_min = r_match_min_px / dt_v to rate_max = min(rate_max_deg_day, (diagonal - "
    "2 margin) / dt_v); v_in = v_AB - w u with w the SPHEREx velocity about the geocentre "
    "projected on the sky at the area centre (Horizons VECTORS, one per visit); u >= 0 fitted by "
    "least squares; residual = largest |v_in - v_AB + w u| perpendicular to w; pass when residual "
    "<= max(v_tol_min, v_tol_sigma * sigma_v) and u <= 1/delta_min; track when mutual best and "
    "best <= ambiguity_ratio * next"
)
KNOWN_FORMULA = (
    "SkyBoT cone per visit (area half-diagonal + rate_max * visit span / 2 + p_max), V <= v_lim; "
    "Horizons TLIST from 500@-163182 at every exposure time; a track matches when at least "
    "known_min_frac of its dots lie within max(r_known_min_px, 3 sigma_c + ephemeris 3 sigma)"
)


def labels_method(cfg: AreaConfig = DEFAULT_AREA_CONFIG) -> dict[str, Setting]:
    """``method.settings`` of the labels step (A17.3); names as the fixture's where they meet."""
    return {
        "r_match_min_px": cfg.r_match_min_px,
        "r_match_sigma": cfg.r_match_sigma,
        "k_visit_max": cfg.k_visit_max,
        "star_artefact_flags": ",".join(cfg.artefact_flags),
        "glitch_formula": GLITCH_FORMULA,
        "tracklet_formula": TRACKLET_FORMULA,
        "star_formula": STAR_FORMULA,
        "fixed_formula": FIXED_FORMULA,
    }


def join_method(cfg: AreaConfig = DEFAULT_AREA_CONFIG) -> dict[str, Setting]:
    return {
        "rms_max_px": cfg.rms_max_px,
        "rate_max_deg_day": cfg.rate_max_deg_day,
        "v_tol_min_deg_day": cfg.v_tol_min_deg_day,
        "v_tol_sigma": cfg.v_tol_sigma,
        "delta_min_au": cfg.delta_min_au,
        "ambiguity_ratio": cfg.ambiguity_ratio,
        "min_motion_px": cfg.min_motion_px,
        "pair_formula": PAIR_FORMULA,
    }


def known_method(cfg: AreaConfig = DEFAULT_AREA_CONFIG) -> dict[str, Setting]:
    return {
        "p_max_arcsec": cfg.p_max_arcsec,
        "v_lim": cfg.v_lim,
        "r_known_min_px": cfg.r_known_min_px,
        "known_min_frac": round(cfg.known_min_frac, 6),
        "known_formula": KNOWN_FORMULA,
    }


def method_settings(cfg: AreaConfig = DEFAULT_AREA_CONFIG) -> dict[str, Setting]:
    """Every starting value of the area pipeline in ``method.settings``, with the versions
    (A17.10)."""
    return {
        **frames_method(cfg),
        **dots_method(cfg),
        **labels_method(cfg),
        **join_method(cfg),
        **known_method(cfg),
        "area_version": AREA_VERSION,
        "measure_version": MEASURE_VERSION,
    }


def config_fields() -> list[str]:
    """Names of every ``AreaConfig`` field (a test checks each one reaches ``method``)."""
    return [f.name for f in fields(AreaConfig)]


def params_hash(settings: dict[str, Setting], input_digests: Iterable[str]) -> str:
    """``params_hash`` of A17.10: the settings and the sorted SHA-256 of every input body."""
    text = json.dumps(
        {"settings": settings, "inputs": sorted(input_digests)},
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(text.encode("ascii")).hexdigest()


AREA_SOURCE = "derived.area"


def area_key(release: str, area_id: str, stage: str, params: str) -> CacheKey:
    """Key of a ``derived.area`` entry (A17.10), modelled on ``spectrum_key``."""
    return CacheKey.make(AREA_SOURCE, release, id=area_id, v=AREA_VERSION, stage=stage, p=params)


# --- [[area]] loader -----------------------------------------------------------------------


def _spec(t: dict[str, object]) -> AreaSpec:
    area_id = str(t.get("id", "")).strip()
    if not AREA_ID.match(area_id):
        raise ValueError(f"bad id {area_id!r}")
    ra, dec = float(t["ra"]), float(t["dec"])  # type: ignore[arg-type]
    width, height = float(t["width_deg"]), float(t["height_deg"])  # type: ignore[arg-type]
    if not (0.0 <= ra < 360.0 and -90.0 <= dec <= 90.0):
        raise ValueError("ra or dec out of range")
    if not all(math.isfinite(v) and 0.0 < v <= MAX_SIDE_DEG for v in (width, height)):
        raise ValueError("width_deg and height_deg must be in (0, 10]")
    if abs(dec) + height / 2.0 >= 89.0:
        raise ValueError("the box reaches a pole")  # ASSUMPTION: no polar areas in P3
    release = str(t.get("data_release", "")).strip()
    if not release:
        raise ValueError("no data_release")
    raw = t.get("windows")
    if not isinstance(raw, list) or not raw:
        raise ValueError("no windows")
    wins: list[Window] = []
    for w in raw:
        if not isinstance(w, list) or len(w) != 2:
            raise ValueError("a window is [start, stop]")
        a, b = parse_utc(str(w[0])), parse_utc(str(w[1]))
        if not a < b:
            raise ValueError("a window ends before it starts")
        wins.append((a, b))
    return AreaSpec(area_id, ra, dec, width, height, release, tuple(sorted(wins)))


@lru_cache(maxsize=8)
def _areas_in(path: str, mtime_ns: int) -> dict[str, AreaSpec]:
    del mtime_ns  # memo key only: an edited file is read again
    doc = tomllib.loads(Path(path).read_text(encoding="utf-8"))
    out: dict[str, AreaSpec] = {}
    for t in doc.get("area", []):
        try:
            spec = _spec(t)
        except (KeyError, TypeError, ValueError) as exc:
            log.warning("targets.toml: ignoring bad [[area]] %r: %s", t.get("id"), exc)
            continue
        if spec.id in out:
            log.warning("targets.toml: duplicate [[area]] id %r, keeping the first", spec.id)
            continue
        out[spec.id] = spec
    return out


def load_areas(ctx: Context) -> dict[str, AreaSpec]:
    """Every valid ``[[area]]`` by id; a bad entry is logged and skipped; no file, no areas."""
    f = ctx.settings.targets_file
    try:
        mtime = f.stat().st_mtime_ns
    except OSError:
        return {}
    return dict(_areas_in(str(f), mtime))
