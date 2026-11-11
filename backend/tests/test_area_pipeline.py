"""P3 records through the served contract (A17.8, Q-208) and determinism (A17.10).

Runs on the recorded-fixture Eros area (``tests/area_recorded.py``); network blocked.
"""

from __future__ import annotations

from typing import Any

import jsonschema
import pytest
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT7

from app.core.area.dots import find_dots, run_dots
from app.core.area.frames import assemble
from app.core.area.geometry import AreaBox
from app.core.area.records import canonical, dots_jsonable, frames_jsonable
from app.settings import BACKEND_DIR
from tests import area_consistency as ac
from tests.area_adapter import dots_reply, summary_reply
from tests.area_recorded import (
    EROS_AREA,
    recorded_dots,
    recorded_fetch,
    recorded_frames,
    recorded_sia,
)

SCHEMAS = BACKEND_DIR.parent / "shared" / "schemas"


def _validator(name: str) -> jsonschema.Draft7Validator:
    import json

    loaded = {p.name: json.loads(p.read_text("utf-8")) for p in SCHEMAS.glob("area-*.schema.json")}
    registry: Registry[Any] = Registry().with_resources(
        (s["$id"], Resource.from_contents(s, default_specification=DRAFT7)) for s in loaded.values()
    )
    return jsonschema.Draft7Validator(loaded[f"area-{name}.schema.json"], registry=registry)


def test_p3_records_pass_the_schemas_and_the_contract_rules() -> None:
    frames, _ = recorded_frames()
    per_frame = recorded_dots()
    summary = summary_reply(frames, per_frame)
    dots = dots_reply(frames, per_frame)
    _validator("summary").validate(summary)
    _validator("dots").validate(dots)
    ac.check_missing_lists(summary, dots)
    ac.check_provenance_rules(summary, dots)
    ac.check_summary(summary)
    ac.check_dots(summary, dots)
    assert summary["steps"]["n_dots"] == sum(len(v["dots"]) for v in dots["visits"]) > 300


def _fresh_run(workers: int) -> bytes:
    rows, digests = recorded_sia()
    frames, bodies = assemble(EROS_AREA, rows, recorded_fetch, workers=1, sia_digests=digests)
    per_frame = run_dots(frames, bodies, workers=workers)
    return canonical({"frames": frames_jsonable(frames), "dots": dots_jsonable(per_frame)})


def test_same_inputs_give_byte_identical_records() -> None:
    # In-thread and on a spawn process pool (as the overnight script runs it): same bytes.
    assert _fresh_run(2) == _fresh_run(0)


@pytest.mark.parametrize("index", [0, 9])
def test_the_same_frame_gives_the_same_dot_ids_twice(index: int) -> None:
    """Q-208 (14): ids follow the rounded centroid row, then column, so a rerun of one frame
    gives the same ids for the same dots."""
    frames, bodies = recorded_frames()
    f = [f for f in frames.frames if f.cutout_sha256][index]
    box = AreaBox.of(frames.spec)
    cov = {c.visit: c for c in frames.coverage}[f.visit]
    a = find_dots(bodies[f.frame_id], f, box, cov)
    b = find_dots(bodies[f.frame_id], f, box, cov)
    assert [d.dot_id for d in a.dots] == [d.dot_id for d in b.dots]
    assert a.dots == b.dots and len(a.dots) > 10
