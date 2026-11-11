"""The synthetic Area search fixtures agree with themselves and stay synthetic (A17.9, Q-208).

The cross-reply rules live in ``area_consistency.py`` so the pipeline (P3) and API (P7) tests can
reuse them; here they run on ``shared/fixtures/area/`` and are shown to catch broken replies.
"""

from __future__ import annotations

import copy
import json
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from app.settings import BACKEND_DIR
from scripts import area_fixtures
from tests.area_consistency import all_dots, check_area

AREA = BACKEND_DIR.parent / "shared" / "fixtures" / "area"
REPLIES = ("summary", "known", "dots", "tracks", "checks")
DIRS = {"fixture:area-main": AREA, "fixture:area-multivisit": AREA / "multivisit"}
SYNTHETIC = "synthetic fixture"


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


INDEX = _load(AREA / "index.json")


def _area(area_id: str) -> dict[str, Any]:
    return {name: _load(DIRS[area_id] / f"{name}.json") for name in REPLIES}


def _entry(area_id: str) -> dict[str, Any]:
    return next(e for e in INDEX["areas"] if e["area_id"] == area_id)


def _run(area: dict[str, Any], entry: dict[str, Any] | None = None) -> None:
    check_area(*(area[name] for name in REPLIES), index_entry=entry)


def test_index_lists_both_fixture_areas_in_order() -> None:
    ids = [e["area_id"] for e in INDEX["areas"]]
    assert ids == sorted(DIRS)
    assert INDEX["cached_at"] == min(e["cached_at"] for e in INDEX["areas"])
    assert INDEX["computed_at"] == max(e["computed_at"] for e in INDEX["areas"])
    assert INDEX["missing"] == []


@pytest.mark.parametrize("area_id", sorted(DIRS))
def test_area_replies_agree(area_id: str) -> None:
    _run(_area(area_id), _entry(area_id))


def test_main_area_has_the_a179_shape() -> None:
    area = _area("fixture:area-main")
    summary, tracks = area["summary"], area["tracks"]
    assert summary["n_visits"] == 2
    assert len(summary["frames"]) == 16  # 2 visits x 4 exposures x 2 detectors
    assert {f["detector"] for f in summary["frames"]} == {1, 4}
    assert summary["steps"] == {
        "n_dots": 570,
        "n_glitches": 18,
        "n_stars": 480,
        "n_fixed": 16,
        "n_static_one_visit": 1,
        "n_tracks": 3,
        "n_possible": 1,
        "n_found_blind": 1,
        "n_unexplained": 1,
        "n_unchecked": 1,
    }
    by_id = {t["track_id"]: t for t in tracks["tracks"]}
    assert [by_id[f"T{i}"]["verdict"] for i in range(1, 5)] == [
        "found_blind",
        "unexplained",
        "unchecked",
        "possible",
    ]
    assert by_id["T3"]["unchecked_by"] == ["horizons:Synthetic fixture A2"]
    assert by_id["T4"]["reason"] == "one_visit"
    assert [by_id[f"T{i}"]["sed"]["label"] for i in range(1, 5)] == [
        "smooth",
        "rough",
        "smooth",
        "too_few",
    ]
    assert {t["linker"] for t in tracks["tracks"]} == {"pairs"}
    # One OUTLIER on the found-blind mover is kept and flagged (Q-139, Q-178).
    t1 = {i for tl in by_id["T1"]["tracklets"] for i in tl["dot_ids"]}
    flagged = [d for d in all_dots(area["dots"]) if "OUTLIER" in d["flags"]]
    assert len(flagged) == 1 and flagged[0]["dot_id"] in t1
    assert any(m.startswith("stamp:") for m in area["dots"]["missing"])


def test_main_area_checks_sample() -> None:
    checks = _area("fixture:area-main")["checks"]
    assert checks["test_mover"]["recovered"] is True
    assert len(checks["completeness"]["cells"]) == 16
    assert checks["control"]["n_runs"] == 20 and checks["control"]["max"] == 0
    assert checks["linker"] == "pairs"
    # No single catch-rate figure anywhere (A16.5, A17.6).
    text = json.dumps(checks)
    for word in ("catch_rate", "overall", "mean_frac", "completeness_total"):
        assert word not in text


def test_multivisit_area_is_for_d7_and_has_no_checks() -> None:
    area = _area("fixture:area-multivisit")
    assert area["summary"]["n_visits"] == 4
    [track] = area["tracks"]["tracks"]
    assert track["linker"] == "rate_grid" and len(track["visits"]) == 4
    assert area["checks"]["missing"] == ["checks:not_run"]
    assert "rate_grid:visits" not in area["summary"]["missing"]


# The rules bite: one broken fact per case must fail the check.

Mutation = Callable[[dict[str, Any]], None]


def _t(area: dict[str, Any], track_id: str) -> dict[str, Any]:
    return next(t for t in area["tracks"]["tracks"] if t["track_id"] == track_id)


def _first_dot(area: dict[str, Any], label: str) -> dict[str, Any]:
    return next(d for d in all_dots(area["dots"]) if d["label"] == label)


MUTATIONS: dict[str, Mutation] = {
    "step count": lambda a: a["summary"]["steps"].__setitem__("n_stars", 479),
    "dangling dot id": lambda a: _t(a, "T1")["tracklets"][0]["dot_ids"].__setitem__(
        0, "fixture-area-main-v1e1-D1:999"
    ),
    "star in a track": lambda a: _t(a, "T2")["tracklets"][0]["dot_ids"].__setitem__(
        0, _first_dot(a, "star")["dot_id"]
    ),
    "verdict without its code": lambda a: a["tracks"]["missing"].remove(
        "horizons:Synthetic fixture A2"
    ),
    "found blind without match": lambda a: _t(a, "T1").__setitem__("match", None),
    "possible with a reason-less track": lambda a: _t(a, "T4").__setitem__("reason", None),
    "unchecked without unchecked_by": lambda a: _t(a, "T3").__setitem__("unchecked_by", []),
    "track ids out of order": lambda a: a["tracks"]["tracks"].reverse(),
    "unsorted missing": lambda a: a["tracks"]["missing"].reverse(),
    "summary missing not the union": lambda a: a["summary"]["missing"].pop(),
    "smooth above the threshold": lambda a: _t(a, "T1")["sed"].__setitem__("chi2_red", 9.0),
    "checks partly run": lambda a: a["checks"].pop("control"),
    "wilson interval": lambda a: a["checks"]["completeness"]["cells"][0].__setitem__(
        "wilson95", [0.0, 1.0]
    ),
    "frac": lambda a: a["checks"]["completeness"]["cells"][0].__setitem__("frac", 0.9),
    "skybot date gone": lambda a: a["tracks"]["skybot"][0].__setitem__("fetched_at", None),
    "planted dot in the real dots": lambda a: a["checks"]["test_mover"]["dots"][0].update(
        {
            k: _first_dot(a, "star")[k]
            for k in ("frame_id", "x", "y", "detector", "exposure", "time")
        }
    ),
    "wavelength outside the band": lambda a: _first_dot(a, "glitch").__setitem__(
        "wavelength_um", 9.0
    ),
    "derived without formula": lambda a: a["summary"]["provenance"]["steps"].pop("formula"),
    "rate grid on two visits": lambda a: _t(a, "T2").__setitem__("linker", "rate_grid"),
}


@pytest.mark.parametrize("name", sorted(MUTATIONS))
def test_consistency_rules_catch(name: str) -> None:
    area = copy.deepcopy(_area("fixture:area-main"))
    MUTATIONS[name](area)
    with pytest.raises(AssertionError):
        _run(area, _entry("fixture:area-main"))


# Fixture honesty: nothing here may be mistaken for a real result (CLAUDE.md, A16.5, Q-32).


def _sources(node: Any) -> list[str]:
    if isinstance(node, list):
        return [s for item in node for s in _sources(item)]
    if isinstance(node, dict):
        own = [node["source"]] if isinstance(node.get("source"), str) else []
        return own + [s for v in node.values() for s in _sources(v)]
    return []


@pytest.mark.parametrize("area_id", sorted(DIRS))
def test_fixture_is_unmistakably_synthetic(area_id: str) -> None:
    area = _area(area_id)
    assert area_id.startswith("fixture:")
    assert area["summary"]["data_release"] == "synthetic_fixture"
    assert all(f["frame_id"].startswith("fixture-") for f in area["summary"]["frames"])
    for k in area["known"]["known"]:
        assert k["designation"].startswith("Synthetic fixture ")
    for t in area["tracks"]["tracks"]:
        if t["match"] is not None:
            assert t["match"]["designation"].startswith("Synthetic fixture ")
    sources = _sources([area, INDEX])
    assert sources and all(s.startswith(f"{SYNTHETIC}: ") for s in sources)
    ecsv = (DIRS[area_id] / "export.ecsv").read_text(encoding="utf-8")
    assert ecsv.startswith("# %ECSV 1.0\n") and SYNTHETIC in ecsv


def test_generator_reproduces_the_committed_bytes() -> None:
    """Determinism (A17.10): a fresh process writes exactly the committed files."""
    done = subprocess.run(
        [sys.executable, "-m", "scripts.area_fixtures", "--check"],
        cwd=BACKEND_DIR,
        capture_output=True,
        text=True,
        check=False,
    )
    assert done.returncode == 0, done.stderr
    committed = {p.relative_to(AREA).as_posix() for p in AREA.rglob("*") if p.is_file()}
    assert committed == set(area_fixtures.fixture_files())
    assert area_fixtures.fixture_files() == area_fixtures.fixture_files()
    for data in area_fixtures.fixture_files().values():
        assert b"\r\n" not in data
