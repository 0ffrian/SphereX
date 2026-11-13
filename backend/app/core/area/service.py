"""A17.7 to A17.10 (P7): the served replies, the ECSV export and the ``derived.area`` entries.

``run_area`` runs P4 to P6 on P3's records (labels, join, known check). ``build_replies`` turns
the result into the plain-dict replies of ``shared/schemas/area-*.schema.json`` (Q-208 (18): built
as dicts and checked with the jsonschema validator, never by serialising the generated models).
``store_area`` writes them as ``derived.area`` entries (A17.10); ``store.AreaStore`` reads them
back for the API (which imports only ``store``, ``config`` and ``stamps``, never this module).

Determinism (A17.10): replies are canonical JSON (sorted keys, no spaces), floats are rounded at
fixed places, ids follow Q-208 (14) and A17.4, and the two times are taken from the inputs:
``cached_at`` = the earliest and ``computed_at`` = the latest ``fetched_at`` of the cache entries
the run read after the dots step (star cones, SPHEREx vectors, SkyBoT, Horizons). ASSUMPTION
(Q-420): A17.10 asks for byte-identical entries from the same cache, which a wall-clock
``computed_at`` would break.
"""

from __future__ import annotations

import base64
import hashlib
import math
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from app.cache.store import LiveResponse, ReadThroughCache, Served
from app.context import Context
from app.core.area import clean, join, match
from app.core.area.config import (
    AREA_VERSION,
    COVERAGE_FORMULA,
    DEFAULT_AREA_CONFIG,
    KNOWN_FORMULA,
    PAIR_FORMULA,
    STAR_FORMULA,
    AreaConfig,
    Setting,
    area_key,
    method_settings,
    params_hash,
)
from app.core.area.records import AreaFrames, Dot, FrameDots
from app.core.area.stamps import StampUnavailable, StretchedCutout
from app.core.area.store import (
    HEAD,
    STAGES,
    AreaStore,
    canonical,
    head_key,
    index_entry,
    index_reply,
    settings_sha,
)
from app.core.area.track import TrackCheck
from app.core.area.track import check as track_check
from app.core.card.validate import check
from app.core.export.ecsv import EcsvColumn, write_ecsv
from app.core.find.stars import StarCone
from app.core.measure.config import MEASURE_VERSION
from app.timefmt import MJD_OFFSET, iso_utc_z, parse_utc, utc_to_jd

REPLY_SCHEMAS = {
    "summary": "area-summary.schema.json",
    "known": "area-known.schema.json",
    "dots": "area-dots.schema.json",
    "tracks": "area-tracks.schema.json",
}
LINKER = "pairs"  # A17.12 (D7) is cut (Q-203 gate); the pair rule is the only linker
CHECKS_NOT_RUN = "checks:not_run"  # D4 and D5 are cut: /checks is not served (Q-203 gate)
RATE_GRID_VISITS = "rate_grid:visits"
OBSERVER = "500@-163182"
KNOWN_ASSUMPTION = (
    "orbit solutions from SkyBoT (candidates) and JPL Horizons (positions) as of fetched_at, "
    f"seen from SPHEREx ({OBSERVER})"
)
STEPS_FORMULA = "labels counted in /dots, statuses and verdicts counted in /tracks (A17.3 to A17.5)"
TRACKS_FORMULA = (
    "tracklets and visit pairs of A17.4 with the thresholds in method.settings: " + PAIR_FORMULA
)
LABEL_FORMULA = "glitch, star and fixed rules of A17.3 with the thresholds in method.settings: " + (
    STAR_FORMULA
)
POSITION_FORMULA = "RA/Dec = the measured centroid (x, y) through the frame WCS (A17.2)"


def _r(value: float, dp: int) -> float:
    v = round(float(value), dp)
    return 0.0 if v == 0.0 else v


def _pa(east: float, north: float) -> float:
    pa = _r(math.degrees(math.atan2(east, north)) % 360.0, 2)
    return 0.0 if pa >= 360.0 else pa


# --- running P4 to P6 --------------------------------------------------------------------------


ObjectIds = Callable[[match.Candidate], str | None]


@dataclass
class AreaResult:
    frames: AreaFrames
    per_frame: Sequence[FrameDots]
    labels: clean.Labels
    joined: join.Join
    known: match.KnownStep
    verdicts: list[match.Verdict]
    known_objects: list[match.KnownObject]
    object_ids: dict[str, str | None]
    settings: dict[str, Setting]
    cutouts: Mapping[str, bytes]  # frame_id -> cutout body (for the stamps stage)
    served: list[Served] = field(default_factory=list)
    sources: dict[str, str] = field(default_factory=dict)
    # designation -> A19.12 check (``with_track``); absent means not checked, so false.
    track: dict[str, TrackCheck] = field(default_factory=dict)

    @property
    def missing_dots(self) -> list[str]:
        return sorted({*self.frames.missing, *self.labels.missing})

    @property
    def missing_known(self) -> list[str]:
        return list(self.known.missing)

    @property
    def missing_tracks(self) -> list[str]:
        extra = [RATE_GRID_VISITS] if len(self.frames.coverage) < 3 else []
        return sorted({*self.known.missing, *extra})

    def input_digests(self) -> list[str]:
        """A17.10: every input body. The Track entries (frames, path, spectrum) of an object
        with ``track_available`` true are inputs of ``/known``, so they count too; an area
        whose Known objects all lack them keeps the hash it had before issue #129."""
        mine = [hashlib.sha256(s.entry.body).hexdigest() for s in self.served]
        tracked = [d for c in self.track.values() if c.available for d in c.digests]
        return sorted({*self.frames.input_digests, *mine, *tracked})

    def track_available(self, designation: str) -> bool:
        c = self.track.get(designation)
        return c is not None and c.available

    def params_hash(self) -> str:
        return params_hash(self.settings, self.input_digests())

    def settings_sha(self) -> str:
        """The head's ``settings_sha``: the method settings this run used (A17.10), never the
        defaults, so an entry made with other settings is not served as the running code's."""
        return settings_sha({k: self.settings[k] for k in method_settings()})

    def times(self) -> tuple[str, str]:
        """``(cached_at, computed_at)`` from the inputs read after the dots step. When none was
        read (every star cone, vector, SkyBoT and Horizons call failed or missed the offline
        cache; each is listed in ``missing``), the dates of the frame cones the dots came from,
        which every stored run has read (Q-420 (9)). Never the wall clock (A17.10)."""
        when = [iso_utc_z(t) for t in sorted(s.entry.fetched_at for s in self.served)]
        when = when or list(self.frames.sia_fetched)
        if not when:
            raise ValueError("no input with a fetched_at: the run has no date to report")
        return when[0], when[-1]


DEFAULT_SOURCES = {
    "frames": "IRSA SIA, SPHEREx QR2 frame list",
    "cutouts": "IRSA SPHEREx QR2 cutouts (IMAGE, FLAGS, VARIANCE, WCS-WAVE)",
    "stars": "Gaia DR3 and CatWISE2020 area cones (A19.6)",
}


def run_area(
    ctx: Context,
    frames: AreaFrames,
    bodies: Mapping[str, bytes],
    per_frame: Sequence[FrameDots],
    cfg: AreaConfig = DEFAULT_AREA_CONFIG,
    *,
    star_cones: Mapping[int, StarCone] | None = None,
    object_ids: ObjectIds = match.no_ids,
    inputs: str = "area_cones",
    sources: Mapping[str, str] | None = None,
    refresh: bool = False,
    on_step: Callable[[str], None] | None = None,
) -> AreaResult:
    """P4 to P6 on P3's records. ``star_cones`` replaces the area cone (the recorded area uses
    Track's recorded visit cones); ``inputs`` names where the frames came from and is written
    into ``method.settings`` (and so ``params_hash``). ``on_step`` is told ``labels``, ``join``
    and ``known`` as each step starts (live area progress, Q-462); it never changes a result."""
    step = on_step or (lambda _name: None)
    step("labels")
    geo = clean.area_geometry(frames, cfg)
    cones = dict(star_cones) if star_cones is not None else clean.star_cones(frames)
    st = clean.star_lists(ctx, cones, refresh=refresh)
    labels = clean.label_dots(
        frames, bodies, per_frame, st.lists, cfg, star_missing=st.missing, geo=geo
    )
    step("join")
    w, w_served = join.spherex_w(ctx, frames, geo, refresh=refresh)
    joined = join.join(labels, frames, geo, w, cfg)
    step("known")
    known = match.known_step(ctx, frames, geo, cfg, refresh=refresh)
    verdicts = match.verdicts(joined.tracks, known, geo, cfg)
    objects = match.known_list(frames, known, geo, cfg)
    ids = {o.candidate.designation: object_ids(o.candidate) for o in objects}
    for v in verdicts:
        if v.match is not None and v.match.designation not in ids:
            c = next(c for c in known.candidates if c.designation == v.match.designation)
            ids[c.designation] = object_ids(c)
    served = [s for lst in st.lists.values() for s in lst.served] + w_served + known.served
    settings: dict[str, Setting] = {
        **method_settings(cfg),
        "inputs": inputs,
        "star_cones": ",".join(f"{c.kind}:{c.visit}" for _, c in sorted(cones.items())),
        "pair_test": joined.pair_test,
        "linker": LINKER,
    }
    return AreaResult(
        frames,
        per_frame,
        labels,
        joined,
        known,
        verdicts,
        objects,
        ids,
        settings,
        dict(bodies),
        served,
        {**DEFAULT_SOURCES, **(sources or {})},
    )


def with_track(ctx: Context, result: AreaResult) -> AreaResult:
    """Fill ``result.track`` for every Known object with an ``object_id`` (A17.5 step 4, A19.12).
    Reads the cache only (``track.check``); an object without an id stays false."""
    for o in result.known_objects:
        oid = result.object_ids.get(o.candidate.designation)
        if oid is not None:
            result.track[o.candidate.designation] = track_check(ctx, oid)
    return result


# --- replies ------------------------------------------------------------------------------------


def _dot_reply(d: Dot, label: str) -> dict[str, Any]:
    return {
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
        "label": label,
    }


def _skybot_reply(known: match.KnownStep) -> list[dict[str, Any]]:
    return [{"visit": v, "fetched_at": at} for v, at in sorted(known.skybot.items())]


def track_rate_fields(t: join.JoinedTrack) -> dict[str, float | None]:
    """``rate_deg_day``, ``pa_deg`` and ``u_inv_au`` of one ``/tracks`` entry: null for a
    possible and for a track served without a rate (``fit == "none"``, or ``u`` when the track's
    ``u`` was not fitted over all its legs)."""
    return {
        "rate_deg_day": _r(math.hypot(*t.v_ab), 4) if t.v_ab is not None else None,
        "pa_deg": _pa(*t.v_ab) if t.v_ab is not None else None,
        "u_inv_au": _r(t.u, 3) if t.u is not None else None,
    }


def _tracklet_reply(lg: join.Leg) -> dict[str, Any]:
    ve, vn = lg.v
    return {
        "visit": lg.visit,
        "dot_ids": [m.dot.dot_id for m in lg.tracklet.members],
        "v_in_deg_day": _r(math.hypot(ve, vn), 4),
        "pa_in_deg": _pa(ve, vn),
        "rms_px": _r(lg.tracklet.fit.rms, 3),
    }


def build_replies(result: AreaResult) -> dict[str, dict[str, Any]]:
    """The four served replies of one area (summary, known, dots, tracks)."""
    frames = result.frames
    spec = frames.spec
    cached_at, computed_at = result.times()
    covered = [c for c in frames.coverage if c.polygon]
    label_of = {p.dot.dot_id: result.labels.label[p.index] for p in result.labels.points}

    # /dots, per visit (Q-208 (3)), in frame order then n.
    blocks: dict[int, list[dict[str, Any]]] = {c.visit: [] for c in covered}
    for p in result.labels.points:
        blocks.setdefault(p.dot.visit, []).append(_dot_reply(p.dot, label_of[p.dot.dot_id]))
    dots: dict[str, Any] = {
        "visits": [{"visit": v, "dots": ds} for v, ds in sorted(blocks.items())],
        "cached_at": cached_at,
        "computed_at": computed_at,
        "missing": result.missing_dots,
        "provenance": {
            "position": {
                "tag": "derived",
                "source": result.sources["cutouts"],
                "formula": POSITION_FORMULA,
            },
            "photometry": {"tag": "measured", "source": "Stage 2 aperture photometry (A4.2)"},
            "wavelength": {"tag": "measured", "source": "WCS-WAVE at the centroid"},
            "label": {
                "tag": "derived",
                "source": result.sources["stars"],
                "formula": LABEL_FORMULA,
            },
        },
    }

    # /tracks: tracks and possibles, T1... by first dot (A17.4).
    tracks_out: list[dict[str, Any]] = []
    for i, (t, v) in enumerate(zip(result.joined.tracks, result.verdicts, strict=True), start=1):
        m = v.match
        tracks_out.append(
            {
                "track_id": f"T{i}",
                "visits": sorted({lg.visit for lg in t.legs}),
                "tracklets": [_tracklet_reply(lg) for lg in t.legs],
                **track_rate_fields(t),
                "status": t.status,
                "reason": t.reason,
                "verdict": v.verdict,
                "match": None
                if m is None
                else {
                    "designation": m.designation,
                    "number": m.number,
                    "object_id": result.object_ids.get(m.designation),
                    "v_mag": m.v_mag,
                    "median_sep_px": m.median_sep_px,
                    "fetched_at": m.fetched_at,
                },
                "linker": LINKER,
                "unchecked_by": list(v.unchecked_by),
            }
        )
    tracks: dict[str, Any] = {
        "tracks": tracks_out,
        "skybot": _skybot_reply(result.known),
        "cached_at": cached_at,
        "computed_at": computed_at,
        "missing": result.missing_tracks,
        "provenance": {
            "tracks": {
                "tag": "derived",
                "source": "the movers-to-be of /dots",
                "formula": TRACKS_FORMULA,
            },
            "match": {
                "tag": "model_dependent",
                "source": "IMCCE SkyBoT and JPL Horizons",
                "formula": KNOWN_FORMULA,
                "assumption": KNOWN_ASSUMPTION,
            },
        },
    }

    known: dict[str, Any] = {
        "known": [
            {
                "designation": o.candidate.designation,
                "number": o.candidate.number,
                "object_id": result.object_ids.get(o.candidate.designation),
                "kind": o.candidate.kind,
                "v_mag": o.candidate.v_mag,
                "n_frames": len(o.positions),
                "n_visits": o.n_visits,
                "positions": [
                    {"frame_id": p.frame_id, "time": p.time, "ra": p.ra, "dec": p.dec}
                    for p in o.positions
                ],
                # A19.12: frames, path and spectrum final in the cache (``with_track``).
                "track_available": result.track_available(o.candidate.designation),
            }
            for o in result.known_objects
        ],
        "skybot": _skybot_reply(result.known),
        "cached_at": cached_at,
        "computed_at": computed_at,
        "missing": result.missing_known,
        "provenance": {
            "positions": {
                "tag": "model_dependent",
                "source": f"JPL Horizons TLIST from {OBSERVER}",
                "assumption": KNOWN_ASSUMPTION,
            },
            "skybot": {"tag": "measured", "source": "IMCCE SkyBoT cone search answer dates"},
        },
    }

    labels = result.labels
    status = [t.status for t in result.joined.tracks]
    verdict = [v.verdict for v in result.verdicts]
    union = sorted(
        {*result.missing_dots, *result.missing_known, *result.missing_tracks, CHECKS_NOT_RUN}
    )
    summary: dict[str, Any] = {
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
            "n_dots": len(labels.points),
            "n_glitches": labels.count(clean.GLITCH),
            "n_stars": labels.count(clean.STAR),
            "n_fixed": labels.count(clean.FIXED),
            "n_static_one_visit": result.joined.n_static_one_visit,
            "n_tracks": status.count("track"),
            "n_possible": status.count("possible"),
            "n_found_blind": verdict.count("found_blind"),
            "n_unexplained": verdict.count("unexplained"),
            "n_unchecked": verdict.count("unchecked"),
        },
        "method": {"settings": dict(result.settings)},
        "cached_at": cached_at,
        "computed_at": computed_at,
        "missing": union,
        "provenance": {
            "frames": {"tag": "measured", "source": result.sources["frames"]},
            "coverage": {
                "tag": "derived",
                "source": result.sources["cutouts"],
                "formula": COVERAGE_FORMULA,
            },
            "steps": {
                "tag": "derived",
                "source": "counts of the area's dots and tracks",
                "formula": STEPS_FORMULA,
            },
        },
    }
    out: dict[str, dict[str, Any]] = {
        "summary": summary,
        "known": known,
        "dots": dots,
        "tracks": tracks,
    }
    for name, reply in out.items():
        check(reply, REPLY_SCHEMAS[name])
        _no_padding(reply["missing"])
    return out


def _no_padding(codes: Iterable[str]) -> None:
    """Q-208 (24): Python jsonschema lets ``$`` match before a trailing newline."""
    for code in codes:
        if code != code.strip():
            raise ValueError(f"missing code with whitespace: {code!r}")


def checks_not_run(summary: Mapping[str, Any]) -> dict[str, Any]:
    """What ``/checks`` would answer for an area prepared without D4 to D7 (Q-208 (12)). Not
    served: the route is cut with the checks (Q-203 gate); the code is in ``summary.missing``."""
    return {
        "method": {"settings": summary["method"]["settings"]},
        "cached_at": summary["cached_at"],
        "computed_at": summary["computed_at"],
        "missing": [CHECKS_NOT_RUN],
        "provenance": {},
    }


# --- export (A17.7 on A19.9) ------------------------------------------------------------------

EXPORT_COLUMNS: tuple[EcsvColumn, ...] = (
    EcsvColumn("track_id", "str", None, None, "T1... (A17.4)"),
    EcsvColumn("dot_id", "str", None, None, "<frame_id>:<n> (Q-208 (14))"),
    EcsvColumn("status", "str", "derived", None, "track or possible (A17.4)"),
    EcsvColumn("verdict", "str", "model_dependent", None, "A17.5 known-object check"),
    EcsvColumn("match_designation", "str", "model_dependent", None, "empty when no match"),
    EcsvColumn("frame_id", "str", "measured", None, "SPHEREx frame"),
    EcsvColumn("detector", "int", "measured"),
    EcsvColumn("time_utc", "str", "measured", None, "exposure time, ISO-8601 UTC"),
    EcsvColumn("mjd_utc", "float", "measured", "d", "exposure time, MJD (UTC)"),
    EcsvColumn("ra_deg", "float", "derived", "deg", "centroid through the frame WCS"),
    EcsvColumn("dec_deg", "float", "derived", "deg", "centroid through the frame WCS"),
    EcsvColumn("x_px", "float", "measured", "pix", "centroid, PNG convention of /frames"),
    EcsvColumn("y_px", "float", "measured", "pix", "centroid, PNG convention of /frames"),
    EcsvColumn("wavelength_um", "float", "measured", "um", "WCS-WAVE at the centroid"),
    EcsvColumn("bandwidth_um", "float", "measured", "um", "WCS-WAVE at the centroid"),
    EcsvColumn("flux_ujy", "float", "measured", "uJy", "Stage 2 aperture photometry"),
    EcsvColumn("flux_err_ujy", "float", "measured", "uJy", "Stage 2 error"),
    EcsvColumn("flagged", "bool", "measured", None, "true when flags is not empty"),
    EcsvColumn("flags", "str", "measured", None, "comma-separated flag names (OUTLIER kept)"),
)
# ASSUMPTION (A19.9 base columns an area dot has no value for; left out, never filled):
NOT_APPLICABLE = (
    "exptime_s, ra_3sigma_arcsec, dec_3sigma_arcsec, flag_reasons, contamination, refusal"
)


def export_ecsv(replies: Mapping[str, Mapping[str, Any]], params: str) -> bytes:
    """One row per dot of each track or possible (A17.7). Planted data never reaches it: the
    checks are not run (Q-203)."""
    summary, tracks, dots = replies["summary"], replies["tracks"], replies["dots"]
    by_id = {d["dot_id"]: d for v in dots["visits"] for d in v["dots"]}
    rows: list[dict[str, Any]] = []
    for t in tracks["tracks"]:
        for tl in t["tracklets"]:
            for dot_id in tl["dot_ids"]:
                d = by_id[dot_id]
                when = parse_utc(d["time"])
                rows.append(
                    {
                        "track_id": t["track_id"],
                        "dot_id": dot_id,
                        "status": t["status"],
                        "verdict": t["verdict"],
                        "match_designation": t["match"]["designation"] if t["match"] else "",
                        "frame_id": d["frame_id"],
                        "detector": d["detector"],
                        "time_utc": d["time"],
                        "mjd_utc": _r(utc_to_jd(when) - MJD_OFFSET, 8),
                        "ra_deg": d["ra"],
                        "dec_deg": d["dec"],
                        "x_px": d["x"],
                        "y_px": d["y"],
                        "wavelength_um": d["wavelength_um"],
                        "bandwidth_um": d["bandwidth_um"],
                        "flux_ujy": d["flux_uJy"],
                        "flux_err_ujy": d["flux_err"],
                        "flagged": bool(d["flags"]),
                        "flags": ",".join(d["flags"]),
                    }
                )
    meta = {
        "area_id": summary["area_id"],
        "data_release": summary["data_release"],
        "observer": OBSERVER,
        "assumption": KNOWN_ASSUMPTION,
        "area_version": AREA_VERSION,
        "measure_version": MEASURE_VERSION,
        "params_hash": params,
        "linker": LINKER,
        "generated_at": summary["computed_at"],
        "cached_at": summary["cached_at"],
        "missing": list(summary["missing"]),
        "columns_not_applicable": NOT_APPLICABLE,
        "ades": "phase 2 (no SPHEREx MPC observatory code, Q-145)",
        "wording": "an unexplained track is a lead for follow-up, not a discovery (A16.5)",
        "method": {"settings": summary["method"]["settings"]},
    }
    return write_ecsv(EXPORT_COLUMNS, rows, meta)


# --- derived.area entries (A17.10) ------------------------------------------------------------


def _stamps(dots_reply: Mapping[str, Any], cutouts: Mapping[str, bytes]) -> dict[str, str]:
    """Internal stage for ``/stamps``: every dot's 15 x 15 px raw uint8 pixels (base64, row 0 at
    the top; the API encodes the PNG when serving, so the stored bytes do not depend on the zlib
    build), made from the cutout
    at prepare time, so the pack serves stamps under ``SX_OFFLINE=1`` without the cutouts. A dot
    whose cutout is absent or cannot be stretched has no entry (503 ``stamp_unavailable``)."""
    images: dict[str, StretchedCutout | None] = {}
    out: dict[str, str] = {}
    for visit in dots_reply["visits"]:
        for d in visit["dots"]:
            fid = str(d["frame_id"])
            if fid not in images:
                body = cutouts.get(fid)
                try:
                    images[fid] = StretchedCutout.of(body) if body is not None else None
                except StampUnavailable:
                    images[fid] = None
            img = images[fid]
            if img is not None:
                pixels = img.stamp(float(d["x"]), float(d["y"]))
                out[str(d["dot_id"])] = base64.b64encode(pixels).decode("ascii")
    return out


@dataclass(frozen=True)
class Prepared:
    params_hash: str
    bodies: dict[str, bytes]  # stage -> bytes
    computed_at: str


def prepare(result: AreaResult) -> Prepared:
    replies = build_replies(result)
    p = result.params_hash()
    bodies = {name: canonical(r) for name, r in replies.items()}
    bodies["export"] = export_ecsv(replies, p)
    bodies["stamps"] = canonical(_stamps(replies["dots"], result.cutouts))
    return Prepared(p, bodies, replies["summary"]["computed_at"])


def store_area(cache: ReadThroughCache, result: AreaResult, prepared: Prepared) -> None:
    """Write every stage, then the head (last, so a reader never finds a head without its
    stages). ``fetched_at`` is the run's ``computed_at``, so the metas are byte-stable too."""
    spec = result.frames.spec
    when = parse_utc(prepared.computed_at)
    for stage in STAGES:
        body = prepared.bodies[stage]
        ctype = "text/x-ecsv" if stage == "export" else "application/json"
        cache.put(
            area_key(spec.data_release, spec.id, stage, prepared.params_hash),
            LiveResponse(body, f"derived:area:{stage}", 200, ctype),
            fetched_at=when,
        )
    head = {
        "area_id": spec.id,
        "params_hash": prepared.params_hash,
        "settings_sha": result.settings_sha(),
    }
    cache.put(
        head_key(spec.data_release, spec.id),
        LiveResponse(canonical(head), "derived:area:head", 200, "application/json"),
        fetched_at=when,
    )


__all__ = [
    "HEAD",
    "STAGES",
    "AreaResult",
    "AreaStore",
    "canonical",
    "checks_not_run",
    "export_ecsv",
    "head_key",
    "index_entry",
    "index_reply",
    "prepare",
    "run_area",
    "settings_sha",
    "store_area",
]
