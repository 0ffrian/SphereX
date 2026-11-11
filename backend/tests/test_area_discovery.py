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
        if plan is None or r.frame_id not in cuts:
            continue
        key = irsa_cutout.key_for(ctx, r, plan.ra, plan.dec, plan.size_arcsec)
        ctx.cache.put(key, LiveResponse(cuts[r.frame_id][1], "https://x", 200, "application/fits"))
    out = fixture_cache.parent / "day0.json"
    code = area_discovery.main(
        ["--area", "eros-2026-03", "--day0", str(out), "--day0-object", "20000433"], settings=s
    )
    assert code == 0
    rep = json.loads(out.read_text("utf-8"))
    assert rep["complete"] is True and rep["cones"]["n"] == 15
    assert rep["dots"]["n"] > 0 and rep["cutouts"]["n_usable"] >= 8
    obj = rep["object"]
    assert obj["frames_found"] <= obj["frames_predicted"]
    assert _derived_area(fixture_cache) == []
