"""``scripts/area_discovery.py``: stages, exit codes, the Day 0 report; offline only."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.adapters import irsa_cutout, irsa_sia
from app.cache.store import LiveResponse
from app.context import make_context
from app.core.area.frames import plan_cutout, select_frames
from app.core.area.geometry import AreaBox, cone_grid
from scripts import area_discovery
from tests.area_recorded import EROS_AREA, recorded_cutouts, recorded_sia
from tests.conftest import make_settings
from tests.helpers import entries

# The grid cones all answer with the recorded cone 1 (visit 1 and the 0340_1 exposure of
# visit 2): 10 frames, 8 recorded cutouts, 0340_1's two frames unusable.
N_FRAMES = 10
N_USABLE = 8
MISSING = ["cutout:2026W12_2A_0340_1_D1", "cutout:2026W12_2A_0340_1_D4"]


def _derived_area(cache: Path) -> list[Path]:
    return list((cache / "v1").glob("derived.area*"))


def test_unknown_area_and_bad_steps_exit_2(tmp_path: Path) -> None:
    s = make_settings(tmp_path)
    assert area_discovery.main(["--area", "nowhere"], settings=s) == 2
    assert area_discovery.main(["--area", "eros-2026-03", "--steps", "dots"], settings=s) == 2
    assert area_discovery.main(["--steps", "frames"], settings=s) == 2


def test_failed_cones_exit_1_and_store_nothing(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    s = make_settings(tmp_path / "cache")  # offline, empty: every cone is a cache miss
    out = tmp_path / "day0.json"
    assert area_discovery.main(["--area", "eros-2026-03", "--day0", str(out)], settings=s) == 1
    rep = json.loads(out.read_text("utf-8"))
    assert rep["complete"] is False and rep["missing"] == ["frames:cone_failed:15"]
    assert "INCOMPLETE" in capsys.readouterr().err
    assert _derived_area(tmp_path / "cache") == []


def _cones_only(cache: Path) -> None:
    ctx = make_context(make_settings(cache))
    _, cone_body = next(
        (m, b) for m, b in entries("irsa_sia") if m["key"]["query"]["ra"] == "90.40961"
    )
    for ra, dec in cone_grid(AreaBox.of(EROS_AREA), 0.25):
        key = irsa_sia.sia_key("spherex_qr2", ra, dec, 0.001)
        ctx.cache.put(key, LiveResponse(cone_body, "https://x", 200, "text/xml", {"maxrec": 500}))


def test_cones_without_cutouts_exit_1_and_store_nothing(tmp_path: Path) -> None:
    """Cones cached, cutouts not (offline): every download fails, so the run is incomplete."""
    cache = tmp_path / "cache"
    _cones_only(cache)
    out = tmp_path / "day0.json"
    s = make_settings(cache)
    assert area_discovery.main(["--area", "eros-2026-03", "--day0", str(out)], settings=s) == 1
    rep = json.loads(out.read_text("utf-8"))
    assert rep["complete"] is False and rep["cutouts"]["n_usable"] == 0
    assert any(m.startswith("frames:cutout_failed:") for m in rep["missing"])
    assert _derived_area(cache) == []


def test_full_offline_run_with_day0(fixture_cache: Path) -> None:
    """The recorded Eros data placed under the area's own cache keys (grid cones answer with
    the recorded cone; each frame's planned cutout is its recorded 0.1 deg cutout)."""
    s = make_settings(fixture_cache)
    ctx = make_context(s)
    _, cone_body = next(
        (m, b) for m, b in entries("irsa_sia") if m["key"]["query"]["ra"] == "90.40961"
    )
    for ra, dec in cone_grid(AreaBox.of(EROS_AREA), 0.25):
        key = irsa_sia.sia_key("spherex_qr2", ra, dec, 0.001)
        ctx.cache.put(key, LiveResponse(cone_body, "https://x", 200, "text/xml", {"maxrec": 500}))
    rows, _ = recorded_sia()
    kept, _ = select_frames(rows, EROS_AREA)
    cuts = recorded_cutouts()
    box = AreaBox.of(EROS_AREA)
    for r in kept:
        plan = plan_cutout(box, r)
        assert plan is not None
        key = irsa_cutout.key_for(ctx, r, plan.ra, plan.dec, plan.size_arcsec)
        # A frame without a recorded cutout (0340_1) gets a body that is not FITS: it arrived
        # but is unusable, so the run stays complete with cutout:<frame_id>.
        body = cuts[r.frame_id][1] if r.frame_id in cuts else b"not FITS"
        ctx.cache.put(key, LiveResponse(body, "https://x", 200, "application/fits"))
    out = fixture_cache.parent / "day0.json"
    code = area_discovery.main(
        ["--area", "eros-2026-03", "--day0", str(out), "--day0-object", "20000433"], settings=s
    )
    assert code == 0
    rep = json.loads(out.read_text("utf-8"))
    assert rep["complete"] is True and rep["cones"]["n"] == 15
    assert rep["frames"]["n"] == N_FRAMES and rep["cutouts"]["n_usable"] == N_USABLE
    assert rep["missing"] == MISSING
    assert rep["dots"]["n"] > 0
    obj = rep["object"]
    assert obj["frames_found"] <= obj["frames_predicted"]
    assert _derived_area(fixture_cache) == []


def test_failures_refuse_maxrec_and_no_dots() -> None:
    from app.core.area.records import AreaFrames, FrameDots

    ok = AreaFrames(EROS_AREA, (), (), (), True, 15, ())
    assert area_discovery.failures(ok, {"F": b"x"}, None) == []
    maxrec = AreaFrames(EROS_AREA, (), (), ("frames:cone_maxrec:1",), True, 15, ())
    assert len(area_discovery.failures(maxrec, {"F": b"x"}, None)) == 1
    no_dots = [FrameDots("F", (), (), (), 0)]
    assert len(area_discovery.failures(ok, {"F": b"x"}, no_dots)) == 1
    assert len(area_discovery.failures(ok, {"F": b"x"}, [])) == 1


def test_another_data_release_exits_2(tmp_path: Path) -> None:
    s = make_settings(tmp_path, data_release="spherex_qr1")
    assert area_discovery.main(["--area", "eros-2026-03"], settings=s) == 2
