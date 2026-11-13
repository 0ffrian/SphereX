"""A17.5 (P6): the known-object check. SkyBoT lists candidates; Horizons from SPHEREx places them
(Q-138, Q-180). Tracks get ``found_blind``, ``unexplained`` or ``unchecked``; possibles stay
``possible``.

1. **Candidates:** one SkyBoT cone per visit at its mid-time, centred on the area, radius = half
   diagonal + ``rate_max * visit span / 2`` + ``p_max``; ``V <= v_lim`` (a body with no V is
   kept). SkyBoT answers for the geocentre (``-loc 500``, Q-145), which ``p_max`` pads.
   ASSUMPTION (A17.5 does not say how to bound the Horizons calls): only candidates whose SkyBoT
   position lies within ``p_max + rate_max * span / 2 + SkyBoT Err`` of a covered cell of that
   visit get a TLIST; a body farther out can be neither listed (step 4) nor matched (step 3).
   ASSUMPTION: bodies whose SkyBoT class is a planet or a satellite are skipped (``kind`` is
   ``asteroid | comet``).
2. **Positions:** one Horizons TLIST per candidate at every exposure time of the area, observer
   ``500@-163182``, with the RA/Dec 3-sigma (QUANTITIES 1,36), through the cache.
3. **Match:** at least ``known_min_frac`` of a track's dots within ``max(r_known_min_px,
   3 sigma_c + ephemeris 3 sigma)`` of the candidate at the dot's frame; ties: smallest median
   separation, then designation.
4. **Known list:** candidates inside a visit's coverage at one frame time or more.

A failed SkyBoT cone makes the tracks of that visit ``unchecked`` (``skybot:<visit>``); a failed
Horizons call makes ``unchecked`` the tracks it could match: ASSUMPTION (Q-208 (11) leaves the
rule to us) a track with a dot in that visit within the step 1 reach of the body's SkyBoT
position (``horizons:<designation>``).
"""

from __future__ import annotations

import math
import statistics
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import timedelta

import numpy as np

from app.adapters import horizons, skybot
from app.adapters.http import UpstreamError
from app.cache.store import CacheMissOffline, Served, UpstreamUnavailable
from app.context import Context
from app.core.area.clean import AreaGeometry, covered_by
from app.core.area.config import DEFAULT_AREA_CONFIG, PIXEL_ARCSEC, AreaConfig
from app.core.area.geometry import AreaBox, cell_grid, radec_inside
from app.core.area.join import JoinedTrack
from app.core.area.records import AreaFrames, Dot
from app.timefmt import iso_utc_z, parse_utc

TLIST_TOLERANCE_S = 1.0  # same as moving.TLIST_TIME_TOLERANCE_S
SKIP_CLASSES = ("Planet", "Satellite")
# ASSUMPTION (SPK-ID scheme of the recorded fixtures, "DES=20000433;" for 433 Eros): a numbered
# asteroid's Horizons id is 20000000 + number. The offset is for asteroids only: a comet's SPK-ID
# is not 20000000 + n (67P is 1000012), so a comet, and any unnumbered body, is asked by its
# SkyBoT designation [verify] (PR #110 review). A name Horizons does not resolve fails the call,
# so the tracks it could match are ``unchecked``, never matched to another body.
NUMBERED_SPK_OFFSET = 20_000_000


def sep_px(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    """Small-angle separation in SPHEREx pixels (the served check's formula)."""
    dra = ((ra1 - ra2 + 180.0) % 360.0 - 180.0) * math.cos(math.radians((dec1 + dec2) / 2))
    return math.hypot(dra, dec1 - dec2) * 3600.0 / PIXEL_ARCSEC


@dataclass(frozen=True)
class Candidate:
    designation: str  # "433 Eros", or the provisional designation
    number: int | None
    kind: str  # asteroid | comet
    v_mag: float | None
    horizons_id: str
    listed: tuple[tuple[int, float, float, float], ...]  # (visit, ra, dec, err_arcsec) by visit


def designation_of(body: skybot.SkybotBody) -> str:
    return f"{body.number} {body.name}" if body.number is not None else body.name


def horizons_id(body: skybot.SkybotBody, kind: str) -> str:
    """The Horizons small-body id: ``20000000 + number`` for a numbered asteroid, else the
    designation (comets, unnumbered bodies)."""
    if kind == "asteroid" and body.number is not None:
        return str(NUMBERED_SPK_OFFSET + body.number)
    return body.name


def kind_of(body: skybot.SkybotBody) -> str | None:
    cls = body.sso_class or ""
    if "Comet" in cls:
        return "comet"
    if cls.startswith(SKIP_CLASSES):
        return None
    return "asteroid"


@dataclass(frozen=True)
class Position:
    frame_id: str
    time: str
    ra: float
    dec: float
    sigma3_px: float  # combined RA/Dec 3-sigma in px; 0 when Horizons gave none


@dataclass
class KnownStep:
    skybot: dict[int, str | None]  # visit -> SkyBoT fetched_at (ISO Z) or None (failed)
    candidates: list[Candidate]
    positions: dict[str, list[Position]]  # designation -> one per frame, in frame order
    failed: list[str]  # designations whose Horizons call failed
    missing: list[str]
    served: list[Served] = field(default_factory=list)


def cone_radius_deg(frames: AreaFrames, geo: AreaGeometry, visit: int, cfg: AreaConfig) -> float:
    s = frames.spec
    half_diag = 0.5 * math.hypot(s.width_deg, s.height_deg)
    return (
        half_diag + geo.rate_max_deg_day * geo.visit_span_d[visit] / 2.0 + cfg.p_max_arcsec / 3600.0
    )


def _reach_deg(geo: AreaGeometry, visit: int, err_arcsec: float, cfg: AreaConfig) -> float:
    return (cfg.p_max_arcsec + err_arcsec) / 3600.0 + geo.rate_max_deg_day * geo.visit_span_d[
        visit
    ] / 2.0


def _near_coverage(
    covered: tuple[np.ndarray, np.ndarray],
    box: AreaBox,
    ra: float,
    dec: float,
    reach: float,
    cell_deg: float,
) -> bool:
    """True when a covered cell centre (``covered``: the visit's masked centres on ``box``'s
    plane, built once per visit) lies within ``reach`` plus half a cell diagonal of
    ``(ra, dec)``."""
    gx, gy = covered
    if gx.size == 0:
        return False
    p = box.project(ra, dec)
    if p is None:
        return False
    d = np.hypot(gx - p[0], gy - p[1])
    return bool(np.any(d <= reach + cell_deg * math.sqrt(0.5)))


def known_candidates(
    ctx: Context,
    frames: AreaFrames,
    geo: AreaGeometry,
    cfg: AreaConfig = DEFAULT_AREA_CONFIG,
    *,
    refresh: bool = False,
) -> tuple[dict[int, str | None], list[Candidate], list[Served]]:
    """Step 1: SkyBoT per visit, the magnitude cut and the coverage prefilter."""
    answers: dict[int, str | None] = {}
    served: list[Served] = []
    found: dict[str, tuple[skybot.SkybotBody, list[tuple[int, float, float, float]]]] = {}
    grid = cell_grid(geo.box, cfg.coverage_cell_arcsec)
    for c in frames.coverage:
        visit = c.visit
        when = geo.t0 + timedelta(days=geo.visit_mid_d[visit])
        radius = cone_radius_deg(frames, geo, visit, cfg)
        try:
            bodies, srv = skybot.conesearch(
                ctx, frames.spec.ra, frames.spec.dec, radius, when, refresh=refresh
            )
        except (CacheMissOffline, UpstreamUnavailable, UpstreamError, ValueError, KeyError):
            answers[visit] = None
            continue
        served.append(srv)
        answers[visit] = iso_utc_z(srv.entry.fetched_at)
        covered = grid.masked_centres(c.mask)  # only once SkyBoT answered this visit
        for b in sorted(bodies, key=lambda b: (designation_of(b), b.ra, b.dec)):
            if kind_of(b) is None or (b.v_mag is not None and b.v_mag > cfg.v_lim):
                continue
            err = b.pos_err_arcsec or 0.0
            if not _near_coverage(
                covered, geo.box, b.ra, b.dec, _reach_deg(geo, visit, err, cfg), grid.cell_deg
            ):
                continue
            name = designation_of(b)
            entry = found.setdefault(name, (b, []))
            entry[1].append((visit, b.ra, b.dec, err))
    out: list[Candidate] = []
    for name, (b, listed) in sorted(found.items()):
        kind = kind_of(b) or "asteroid"
        out.append(
            Candidate(name, b.number, kind, b.v_mag, horizons_id(b, kind), tuple(sorted(listed)))
        )
    return answers, out, served


def candidate_positions(
    ctx: Context,
    frames: AreaFrames,
    cand: Candidate,
    *,
    refresh: bool = False,
) -> tuple[list[Position], Served] | None:
    """Step 2: one TLIST at every exposure time; ``None`` when it fails or the rows disagree."""
    times = sorted({f.time for f in frames.frames})
    when = [parse_utc(t) for t in times]
    try:
        pts, srv = horizons.ephemeris_sigma(
            ctx, cand.horizons_id, when, comet=cand.kind == "comet", refresh=refresh
        )
    except (CacheMissOffline, UpstreamUnavailable, UpstreamError, ValueError):
        return None
    if len(pts) != len(when) or any(
        abs((p.time - t).total_seconds()) > TLIST_TOLERANCE_S
        for p, t in zip(pts, when, strict=True)
    ):
        return None
    at = dict(zip(times, pts, strict=True))
    out: list[Position] = []
    for f in frames.frames:
        p = at[f.time]
        s3 = math.hypot(p.ra_3sigma_arcsec or 0.0, p.dec_3sigma_arcsec or 0.0) / PIXEL_ARCSEC
        out.append(Position(f.frame_id, f.time, round(p.ra, 7) % 360.0, round(p.dec, 7), s3))
    return out, srv


def known_step(
    ctx: Context,
    frames: AreaFrames,
    geo: AreaGeometry,
    cfg: AreaConfig = DEFAULT_AREA_CONFIG,
    *,
    refresh: bool = False,
) -> KnownStep:
    answers, cands, served = known_candidates(ctx, frames, geo, cfg, refresh=refresh)
    positions: dict[str, list[Position]] = {}
    failed: list[str] = []
    for c in cands:
        got = candidate_positions(ctx, frames, c, refresh=refresh)
        if got is None:
            failed.append(c.designation)
            continue
        positions[c.designation] = got[0]
        served.append(got[1])
    missing = [f"skybot:{v}" for v, at in sorted(answers.items()) if at is None]
    missing += [f"horizons:{d}" for d in failed]
    return KnownStep(answers, cands, positions, sorted(failed), sorted(set(missing)), served)


# --- step 3: match ----------------------------------------------------------------------------


@dataclass(frozen=True)
class Match:
    designation: str
    number: int | None
    v_mag: float | None
    median_sep_px: float
    fetched_at: str


@dataclass(frozen=True)
class Verdict:
    verdict: str  # found_blind | unexplained | unchecked | possible
    match: Match | None
    unchecked_by: tuple[str, ...]


def _median(values: Sequence[float]) -> float:
    return float(statistics.median(values))


def positions_by_frame(known: KnownStep) -> dict[str, dict[str, Position]]:
    """Designation -> frame id -> position, sorted by designation; built once per run."""
    return {name: {p.frame_id: p for p in pos} for name, pos in sorted(known.positions.items())}


def match_track(
    track: JoinedTrack,
    known: KnownStep,
    cfg: AreaConfig = DEFAULT_AREA_CONFIG,
    *,
    by_frame: Mapping[str, Mapping[str, Position]],
    by_name: Mapping[str, Candidate],
) -> Match | None:
    """``by_frame`` is ``positions_by_frame(known)`` and ``by_name`` the candidates by
    designation, both built once by the caller for all tracks (issue #128 (2))."""
    dots = [m.dot for lg in track.legs for m in lg.tracklet.members]
    best: tuple[float, str, Match] | None = None
    for name, at in by_frame.items():
        seps: list[float] = []
        near = 0
        for d in dots:
            p = at.get(d.frame_id)
            if p is None:
                continue
            s = sep_px(d.ra, d.dec, p.ra, p.dec)
            seps.append(s)
            if s <= max(cfg.r_known_min_px, 3.0 * d.sigma_c_px + p.sigma3_px):
                near += 1
        if not seps or near < cfg.known_min_frac * len(dots) - 1e-9:
            continue
        med = round(_median(seps), 3)
        c = by_name[name]
        fetched = [at_v for v, *_ in c.listed if (at_v := known.skybot.get(v)) is not None]
        m = Match(name, c.number, c.v_mag, med, min(fetched))
        if best is None or (med, name) < best[:2]:
            best = (med, name, m)
    return best[2] if best else None


def verdicts(
    tracks: Sequence[JoinedTrack],
    known: KnownStep,
    geo: AreaGeometry,
    cfg: AreaConfig = DEFAULT_AREA_CONFIG,
) -> list[Verdict]:
    by_name = {c.designation: c for c in known.candidates}
    by_frame = positions_by_frame(known)
    out: list[Verdict] = []
    for t in tracks:
        if t.status != "track":
            out.append(Verdict("possible", None, ()))
            continue
        m = match_track(t, known, cfg, by_frame=by_frame, by_name=by_name)
        if m is not None:
            out.append(Verdict("found_blind", m, ()))
            continue
        visits = {lg.visit for lg in t.legs}
        codes = {f"skybot:{v}" for v in visits if known.skybot.get(v) is None}
        dots_of: dict[int, list[Dot]] = {}
        for lg in t.legs:
            dots_of.setdefault(lg.visit, []).extend(m2.dot for m2 in lg.tracklet.members)
        for name in known.failed:
            c = by_name[name]
            for v, ra, dec, err in c.listed:
                if v not in visits:
                    continue
                reach_px = _reach_deg(geo, v, err, cfg) * 3600.0 / PIXEL_ARCSEC
                if any(sep_px(d.ra, d.dec, ra, dec) <= reach_px for d in dots_of[v]):
                    codes.add(f"horizons:{name}")
        if codes:
            out.append(Verdict("unchecked", None, tuple(sorted(codes))))
        else:
            out.append(Verdict("unexplained", None, ()))
    return out


# --- step 4: the known list ---------------------------------------------------------------------


@dataclass(frozen=True)
class KnownObject:
    candidate: Candidate
    positions: tuple[Position, ...]  # inside its visit's coverage only
    n_visits: int


def known_list(
    frames: AreaFrames,
    known: KnownStep,
    geo: AreaGeometry,
    cfg: AreaConfig = DEFAULT_AREA_CONFIG,
) -> list[KnownObject]:
    grid = cell_grid(geo.box, cfg.coverage_cell_arcsec)
    cov = {c.visit: c for c in frames.coverage}
    visit_of = {f.frame_id: f.visit for f in frames.frames}
    by_name = {c.designation: c for c in known.candidates}
    out: list[KnownObject] = []
    for name, pos in sorted(known.positions.items()):
        inside: list[Position] = []
        for p in pos:
            c = cov.get(visit_of[p.frame_id])
            if c is None or not c.polygon:
                continue
            if covered_by(c, grid, geo.box, p.ra, p.dec) and radec_inside(c.polygon, p.ra, p.dec):
                inside.append(p)
        if inside:
            n_v = len({visit_of[p.frame_id] for p in inside})
            out.append(KnownObject(by_name[name], tuple(inside), n_v))
    return out


ObjectIds = Callable[[Candidate], str | None]


def no_ids(_: Candidate) -> str | None:
    return None
