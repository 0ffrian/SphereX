"""A17.5 (P6): the known-object check. Verdicts, the ``unchecked`` rules, the known list and the
adapter parts it needs (SkyBoT ``Err``, Horizons 3-sigma, SPHEREx velocity). Offline: the SkyBoT,
Horizons and vector answers are recorded cache entries (issue #108), and a failure is made by
removing one from a copy of the cache."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from app.adapters import horizons, skybot
from app.core.area import match
from app.core.area.join import JoinedTrack
from app.core.area.match import KnownStep
from app.core.area.service import AreaResult
from tests.area_recorded import recorded_frames
from tests.conftest import FIXTURE_CACHE, purge_derived
from tests.helpers import entries
from tests.test_area_join import eros_dot_ids, run_recorded


def _copy(tmp_path: Path) -> Path:
    dst = tmp_path / "cache"
    shutil.copytree(FIXTURE_CACHE, dst)
    purge_derived(dst)
    return dst


def _drop(cache: Path, source: str, pred: object) -> int:
    n = 0
    for meta_path in sorted((cache / "v1" / source).glob("*/*/*.json")):
        q = json.loads(meta_path.read_text("utf-8"))["key"]["query"]
        if pred(q):  # type: ignore[operator]
            meta_path.unlink()
            meta_path.with_suffix(".body").unlink()
            n += 1
    return n


def _track(r: AreaResult) -> tuple[JoinedTrack, match.Verdict]:
    return next(
        (t, v) for t, v in zip(r.joined.tracks, r.verdicts, strict=True) if t.status == "track"
    )


# --- adapters -----------------------------------------------------------------------------------


def test_skybot_answer_keeps_the_position_error() -> None:
    meta, body = next((m, b) for m, b in entries("skybot") if m["key"]["query"]["ra"] == "91.23046")
    bodies = skybot.parse(meta["status"], body)
    eros = next(b for b in bodies if b.number == 433)
    assert eros.name == "Eros" and eros.pos_err_arcsec is not None and eros.pos_err_arcsec >= 0
    assert match.designation_of(eros) == "433 Eros" and match.kind_of(eros) == "asteroid"


def test_horizons_sigma_and_velocity_parse() -> None:
    sig = [b for m, b in entries("horizons") if m["key"]["query"].get("quantities") == "1,36"]
    vel = [b for m, b in entries("horizons") if m["key"]["query"].get("vec_table") == "2"]
    assert sig and len(vel) == 2
    pts = horizons.parse_sigma(sig[0])
    assert pts and all(p.ra_3sigma_arcsec is not None for p in pts)
    vx, vy, vz = horizons.parse_velocity(vel[0])
    speed_km_s = (vx * vx + vy * vy + vz * vz) ** 0.5 * 1.495978707e8 / 86400.0
    assert 7.0 < speed_km_s < 8.0  # low Earth orbit


def test_kind_skips_planets_and_names_comets() -> None:
    def body(cls: str) -> skybot.SkybotBody:
        return skybot.SkybotBody("X", None, 0.0, 0.0, 10.0, cls)

    assert match.kind_of(body("Comet")) == "comet"
    assert match.kind_of(body("Planet")) is None
    assert match.kind_of(body("MB>Inner")) == "asteroid"


# --- verdicts -----------------------------------------------------------------------------------


def test_known_list_and_match_on_the_recorded_area(tmp_path: Path) -> None:
    r = run_recorded(_copy(tmp_path))
    assert r.known.missing == [] and all(r.known.skybot.values())
    names = [o.candidate.designation for o in r.known_objects]
    assert names == ["433 Eros"]
    eros = r.known_objects[0]
    assert len(eros.positions) == len(recorded_frames()[0].frames) and eros.n_visits == 2
    _t, v = _track(r)
    assert v.verdict == "found_blind" and v.match is not None
    assert v.match.fetched_at == r.known.skybot[1]


def test_a_failed_skybot_cone_makes_the_track_unchecked(tmp_path: Path) -> None:
    cache = _copy(tmp_path)
    jd2 = sorted(m["key"]["query"]["ep"] for m, _ in entries("skybot", cache)
                 if m["key"]["query"]["ra"] == "91.23046")[-1]  # fmt: skip
    assert _drop(cache, "skybot", lambda q: q.get("ep") == jd2) == 1
    r = run_recorded(cache)
    assert r.known.skybot[2] is None and "skybot:2" in r.known.missing
    _t, v = _track(r)
    # Eros still matches on its dots (the cone of visit 1 listed it): found_blind wins.
    assert v.verdict == "found_blind"


def test_a_failed_horizons_call_makes_the_track_unchecked_never_unexplained(
    tmp_path: Path,
) -> None:
    cache = _copy(tmp_path)
    n = _drop(
        cache, "horizons", lambda q: q.get("quantities") == "1,36" and "20000433" in q["command"]
    )
    assert n == 1
    r = run_recorded(cache)
    assert r.known.failed == ["433 Eros"] and "horizons:433 Eros" in r.known.missing
    _t, v = _track(r)
    assert v.verdict == "unchecked" and v.match is None
    assert v.unchecked_by == ("horizons:433 Eros",)
    assert [o.candidate.designation for o in r.known_objects] == []


def test_no_candidate_and_a_complete_check_is_unexplained(tmp_path: Path) -> None:
    r = run_recorded(_copy(tmp_path))
    t, _ = _track(r)
    empty = KnownStep(dict(r.known.skybot), [], {}, [], [])
    from app.core.area.clean import area_geometry

    v = match.verdicts([t], empty, area_geometry(recorded_frames()[0]))[0]
    assert v.verdict == "unexplained" and v.unchecked_by == ()
    no_skybot = KnownStep({1: None, 2: None}, [], {}, [], ["skybot:1", "skybot:2"])
    v = match.verdicts([t], no_skybot, area_geometry(recorded_frames()[0]))[0]
    assert v.verdict == "unchecked" and v.unchecked_by == ("skybot:1", "skybot:2")


def test_a_match_needs_two_thirds_of_the_dots(tmp_path: Path) -> None:
    r = run_recorded(_copy(tmp_path))
    t, _ = _track(r)
    pos = r.known.positions["433 Eros"]
    ids = {m.dot.frame_id for lg in t.legs for m in lg.tracklet.members}
    assert {m.dot.dot_id for lg in t.legs for m in lg.tracklet.members} == eros_dot_ids()
    # Move Eros's predicted position 10 px off in every frame of visit 2 (7 of 14 dots).
    shifted = [
        match.Position(p.frame_id, p.time, p.ra, p.dec + (10 * 6.15 / 3600 if p.frame_id.startswith(
            "2026W12_2A_034") else 0.0), p.sigma3_px)
        for p in pos
    ]  # fmt: skip
    step = KnownStep(r.known.skybot, r.known.candidates, {"433 Eros": shifted}, [], [])
    assert ids and match.match_track(t, step) is None
