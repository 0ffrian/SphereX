"""Issue #156 (Q-470, Q-471): scans and runs. The split into squares, the scan job on the live
area worker (done, skipped, failed, reused, pause and resume, stop, queue, one worker), the run
records and their timeline, the merged results, the routes, and one scan end to end on the
recorded Eros frames (offline; the autouse guard blocks the network)."""

from __future__ import annotations

import json
import os
import threading
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.context import Context, make_context
from app.core.area import clean as area_clean
from app.core.area import frames as area_frames
from app.core.area import live, runs, scan
from app.core.area.live import Box, LiveAreaError, Plan
from app.core.area.live_jobs import LiveJobs, Progress, QueueFull, RunConflict
from app.core.area.store import AreaStore
from app.core.card.validate import check
from app.main import create_app
from app.timefmt import parse_utc
from tests.area_recorded import EROS_AREA, recorded_frames, recorded_star_cones
from tests.conftest import make_settings

T0 = datetime(2026, 6, 12, 11, 11, tzinfo=UTC)
RELEASE = "spherex_qr2"


def _times(start: datetime, n: int, step_min: float = 2.15) -> list[datetime]:
    return [start + timedelta(minutes=step_min * i) for i in range(n)]


def _two_visits() -> list[datetime]:
    a = _times(T0, 4)
    return a + _times(a[-1] + timedelta(hours=1.5), 4)


def _plan_of(box: Box) -> Plan:
    return live.plan_from_times(RELEASE, box, _two_visits())


def _ctx(tmp_path: Path, **kw: Any) -> Context:
    return make_context(make_settings(tmp_path / "cache", data_release=RELEASE, **kw))


# --- squares ------------------------------------------------------------------------------


def test_a_3_by_3_region_is_four_squares_of_1_5_and_4_by_2_is_six() -> None:
    p = scan.plan_scan(180.0, 0.0, 3.0, 3.0)
    assert (p.cols, p.rows) == (2, 2)
    # 1.5 deg parts, + 0.05 a side, + the snapped centre's offset, rounded up to the grid.
    assert {(s.box.width_deg, s.box.height_deg) for s in p.squares} == {(1.65, 1.65)}
    # Q-470: a 2 degree part cannot be padded under the 2 degree live cap, so 4 x 2 degrees
    # takes one more column and one more row (the ticket's 2 x 1 left gaps between squares).
    p = scan.plan_scan(180.0, 0.0, 4.0, 2.0)
    assert (p.cols, p.rows, len(p.squares)) == (3, 2, 6)
    assert all(max(s.box.width_deg, s.box.height_deg) <= 2.0 for s in p.squares)


def test_squares_go_top_row_first_left_to_right() -> None:
    p = scan.plan_scan(180.0, 10.0, 3.0, 3.0)
    assert [(s.index, s.row, s.col) for s in p.squares] == [
        (1, 0, 0),
        (2, 0, 1),
        (3, 1, 0),
        (4, 1, 1),
    ]
    one, two, three, _ = (s.box for s in p.squares)
    assert one.ra > two.ra  # left on screen is east: RA grows to the left
    assert one.dec > three.dec  # the top row is north
    assert one.dec == two.dec  # a row shares its Dec (symmetric about the centre)


def test_squares_are_live_boxes_with_the_same_area_id() -> None:
    p = scan.plan_scan(91.2, 13.4, 3.0, 1.0)
    for s in p.squares:
        b = s.box
        assert live.snap_box(b.ra, b.dec, b.width_deg, b.height_deg) == b
        same = live.plan_from_times(RELEASE, live.snap_box(**b.reply()), _two_visits())
        assert _plan_of(b).area_id == same.area_id


@pytest.mark.parametrize(
    "region",
    [
        (180.0, 0.0, 4.0, 2.0),
        (10.0, -30.0, 5.0, 3.0),
        (200.0, 40.0, 4.0, 4.0),
        (100.0, 60.0, 10.0, 10.0),
        (359.9, -70.0, 6.0, 6.0),
        (91.2, 13.4, 1.05, 0.65),
    ],
)
def test_squares_cover_the_whole_region_with_overlap(region: tuple[float, ...]) -> None:
    """Review #1: every point of the region lies inside some square, at least ``PAD_DEG`` from
    its edge, on that square's own tangent plane (as the pipeline's ``AreaBox`` tests it)."""
    p = scan.plan_scan(*region)
    r = p.region
    n = 24
    for i in range(n + 1):
        for j in range(n + 1):
            xi = -r.width_deg / 2 + r.width_deg * i / n
            eta = -r.height_deg / 2 + r.height_deg * j / n
            ra, dec = scan.deproject(r.ra, r.dec, xi, eta)
            margins = []
            for sq in p.squares:
                q = scan.project(sq.box.ra, sq.box.dec, ra, dec)
                assert q is not None
                margins.append(
                    min(sq.box.width_deg / 2 - abs(q[0]), sq.box.height_deg / 2 - abs(q[1]))
                )
            assert max(margins) >= scan.PAD_DEG - 1e-6, (region, xi, eta)


@pytest.mark.parametrize(
    ("args", "code"),
    [
        ((10.0, 0.0, 12.5, 1.0), "scan:too_large"),
        ((10.0, 0.0, 1.0, 12.5), "scan:too_large"),
        ((10.0, 80.0, 2.0, 20.0), "scan:too_large"),
        ((100.0, 0.0, 12.0, 12.0), "scan:too_large"),  # 7 x 7 squares with the overlap
        ((10.0, 84.0, 2.0, 10.0), "area:bad_box"),
        ((10.0, 0.0, 0.0, 1.0), "area:bad_box"),
        ((float("inf"), 0.0, 1.0, 1.0), "area:bad_box"),
    ],
)
def test_a_bad_region_is_refused(args: tuple[float, float, float, float], code: str) -> None:
    with pytest.raises(LiveAreaError) as err:
        scan.plan_scan(*args)
    assert err.value.code == code


def test_ten_degrees_is_thirty_six_squares_and_twelve_by_two_is_fourteen() -> None:
    p = scan.plan_scan(100.0, 0.0, 10.0, 10.0)
    assert (p.cols, p.rows, len(p.squares)) == (6, 6, 36)
    assert [s.index for s in p.squares] == list(range(1, 37))
    p = scan.plan_scan(100.0, 0.0, 12.0, 2.0)
    assert (p.cols, p.rows) == (7, 2)
    check(p.reply(RELEASE, "known", {}), "scan-plan.schema.json")  # cols may pass 6


def test_the_plan_reply_without_stored_squares() -> None:
    p = scan.plan_scan(180.0, 0.0, 3.0, 1.0)
    assert len(p.squares) == 2
    reply = p.reply(RELEASE, "discovery", {2: "live-000000000002"})
    check(reply, "scan-plan.schema.json")
    assert [s["area_id"] for s in reply["squares"]] == [None, "live-000000000002"]
    assert reply["estimate_s"] == live.estimate_seconds(p.squares[0].box)


# --- fake replies and store ---------------------------------------------------------------


def _iso(minutes: float) -> str:
    return (T0 + timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _replies(
    area: str,
    *,
    eros_at: float | None = None,
    mover_at: float | None = None,
    extra_known: str | None = None,
    unchecked_at: float | None = None,
    missing: tuple[str, ...] = (),
) -> dict[str, dict[str, Any]]:
    """Hand-made stored replies of one area: 433 Eros found at RA ``eros_at``, an unexplained
    mover at ``mover_at`` and a mover the known-object check could not judge at
    ``unchecked_at`` (``unchecked`` by ``skybot:1``; all on frame ``f1`` of the shared visit).
    ``missing`` is the summary's list."""
    known: list[dict[str, Any]] = []
    tracks: list[dict[str, Any]] = []
    dots: list[dict[str, Any]] = []

    def kn(des: str, ra: float) -> dict[str, Any]:
        return {
            "designation": des,
            "number": None,
            "object_id": None,
            "kind": "asteroid",
            "v_mag": 15.0,
            "n_frames": 1,
            "n_visits": 1,
            "positions": [{"frame_id": "f1", "time": _iso(0), "ra": ra, "dec": 0.0}],
            "track_available": False,
        }

    if eros_at is not None:
        known.append(kn("433 Eros", eros_at))
        dots.append(
            {"dot_id": f"{area}:1", "frame_id": "f1", "time": _iso(0), "ra": eros_at, "dec": 0.0}
        )
        tracks.append(
            {
                "track_id": "T1",
                "verdict": "found_blind",
                "match": {"designation": "433 Eros"},
                "tracklets": [{"dot_ids": [f"{area}:1"]}],
            }
        )
    if mover_at is not None:
        dots.append(
            {"dot_id": f"{area}:2", "frame_id": "f1", "time": _iso(0), "ra": mover_at, "dec": 0.0}
        )
        tracks.append(
            {
                "track_id": "T2",
                "verdict": "unexplained",
                "match": None,
                "tracklets": [{"dot_ids": [f"{area}:2"]}],
            }
        )
    if unchecked_at is not None:
        dots.append(
            {
                "dot_id": f"{area}:3",
                "frame_id": "f1",
                "time": _iso(0),
                "ra": unchecked_at,
                "dec": 0.0,
            }
        )
        tracks.append(
            {
                "track_id": "T3",
                "verdict": "unchecked",
                "match": None,
                "unchecked_by": ["skybot:1"],
                "tracklets": [{"dot_ids": [f"{area}:3"]}],
            }
        )
    if extra_known is not None:
        known.append(kn(extra_known, 1.0))
    frames = [{"visit": 1, "time": _iso(0)}, {"visit": 2, "time": _iso(90)}]
    return {
        "summary": {"frames": frames, "missing": list(missing)},
        "known": {"known": known},
        "tracks": {"tracks": tracks},
        "dots": {"visits": [{"visit": 1, "dots": dots}]},
    }


class FakeStore:
    def __init__(self) -> None:
        self.areas: dict[str, dict[str, dict[str, Any]]] = {}

    def entry(self, area_id: str, stage: str) -> Any:
        got = self.areas.get(area_id, {}).get(stage)
        return None if got is None else SimpleNamespace(body=json.dumps(got).encode())

    def spectra_entry(self, area_id: str) -> Any:
        return self.entry(area_id, "spectra")

    def heads(self, area_id: str) -> list[Any]:
        return []  # no cache roots: ensure_spectra has nothing to fill


# --- the scan job -------------------------------------------------------------------------


def _scan_jobs(
    tmp_path: Path,
    runner: Any,
    *,
    planner: Any = None,
    store: FakeStore | None = None,
) -> LiveJobs:
    return LiveJobs(
        _ctx(tmp_path),
        runner,
        planner=planner or (lambda ctx, box: _plan_of(box)),
        store=store or FakeStore(),
    )


def _run(jobs: LiveJobs, run_id: str) -> dict[str, Any]:
    reply = jobs.run_reply(run_id)
    check(reply, "run.schema.json")
    return reply


def test_a_scan_runs_done_skipped_failed_and_reused_squares(tmp_path: Path) -> None:
    p = scan.plan_scan(180.0, 0.0, 3.0, 3.0)  # 2 x 2
    index_of = {s.box: s.index for s in p.squares}
    store = FakeStore()
    reused = _plan_of(p.squares[3].box).area_id
    store.areas[reused] = _replies(reused, extra_known="(1) Ceres")
    ran: list[int] = []

    def planner(ctx: Context, box: Box) -> Plan:
        if index_of[box] == 2:
            raise LiveAreaError("area:no_visit_pair", "not seen twice")
        return _plan_of(box)

    def runner(ctx: Context, plan: Plan, prog: Progress) -> None:
        i = index_of[plan.box]
        ran.append(i)
        prog.step("frames")
        if i == 3:
            raise RuntimeError("boom")
        store.areas[plan.area_id] = _replies(plan.area_id, eros_at=180.5, mover_at=180.7)

    jobs = _scan_jobs(tmp_path, runner, planner=planner, store=store)
    run_id = jobs.submit_scan(p, "discovery", RELEASE)
    assert jobs.wait(10)
    run = _run(jobs, run_id)
    assert run["state"] == "done"
    assert [s["state"] for s in run["squares"]] == ["done", "skipped", "failed", "done"]
    assert run["squares"][1]["error"]["code"] == "area:no_visit_pair"
    assert run["squares"][2]["error"]["code"] == "internal"
    assert run["squares"][3]["area_id"] == reused
    assert ran == [1, 3]  # square 4 was stored: reused, not run
    assert run["totals"] == {
        "known": 2,
        "found": 1,
        "unexplained": 1,
        "unchecked": 0,
        "squares_done": 2,
        "squares_skipped": 1,
        "squares_failed": 1,
    }
    types = [(e["type"], e.get("square")) for e in run["events"] if e["type"] != "found"]
    assert types == [
        ("run_started", None),
        ("square_started", 1),
        ("square_done", 1),
        ("square_started", 2),
        ("square_skipped", 2),
        ("square_started", 3),
        ("square_failed", 3),
        ("square_started", 4),
        ("square_done", 4),
        ("run_done", None),
    ]
    ts = [e["t"] for e in run["events"]]
    assert ts == sorted(ts)


def test_found_events_follow_square_done_with_positions(tmp_path: Path) -> None:
    p = scan.plan_scan(180.0, 0.0, 1.5, 1.5)  # one square
    store = FakeStore()

    def runner(ctx: Context, plan: Plan, prog: Progress) -> None:
        store.areas[plan.area_id] = _replies(
            plan.area_id, eros_at=180.1, mover_at=180.2, extra_known="(1) Ceres"
        )

    jobs = _scan_jobs(tmp_path, runner, store=store)
    run_id = jobs.submit_scan(p, "known", RELEASE)
    assert jobs.wait(10)
    run = _run(jobs, run_id)
    types = [e["type"] for e in run["events"]]
    done = types.index("square_done")
    found = [e for e in run["events"] if e["type"] == "found"]
    assert all(run["events"].index(e) > done for e in found)
    kinds = {(f["object"]["kind"], f["object"].get("designation")) for f in found}
    assert kinds == {("known", "433 Eros"), ("unexplained", None), ("predicted", "(1) Ceres")}
    assert all(f["object"]["positions"] and f["square"] == 1 for f in found)
    # Review #10: every object names the provenance of its positions.
    tags = {f["object"]["kind"]: f["object"]["positions_tag"] for f in found}
    assert tags == {
        "known": "model_dependent",
        "unexplained": "measured",
        "predicted": "model_dependent",
    }
    assert run["provenance"]["known_positions"]["tag"] == "model_dependent"
    assert run["provenance"]["track_positions"]["tag"] == "measured"


def test_a_scan_pauses_after_its_square_and_resumes(tmp_path: Path) -> None:
    p = scan.plan_scan(180.0, 0.0, 3.0, 1.0)  # 2 squares
    gate, started = threading.Event(), threading.Event()

    def runner(ctx: Context, plan: Plan, prog: Progress) -> None:
        prog.step("frames")
        started.set()
        while not gate.wait(0.01):
            prog.check()

    jobs = _scan_jobs(tmp_path, runner)
    run_id = jobs.submit_scan(p, "discovery", RELEASE)
    assert started.wait(5)
    assert _run(jobs, run_id)["progress"]["square"] == 1
    jobs.pause(run_id)
    gate.set()
    assert jobs.wait(10)  # the paused scan left the worker
    run = _run(jobs, run_id)
    assert run["state"] == "paused"
    assert [s["state"] for s in run["squares"]] == ["done", "todo"]
    with pytest.raises(RunConflict):
        jobs.pause(run_id)
    jobs.resume(run_id)
    assert jobs.wait(10)
    run = _run(jobs, run_id)
    assert run["state"] == "done"
    assert [s["state"] for s in run["squares"]] == ["done", "done"]
    types = [e["type"] for e in run["events"]]
    assert types.index("run_paused") < types.index("run_resumed") < types.index("run_done")
    with pytest.raises(RunConflict):
        jobs.resume(run_id)


def test_a_stopped_scan_keeps_its_finished_squares(tmp_path: Path) -> None:
    p = scan.plan_scan(180.0, 0.0, 4.5, 1.0)  # 3 squares
    index_of = {s.box: s.index for s in p.squares}
    store = FakeStore()
    started = threading.Event()

    def runner(ctx: Context, plan: Plan, prog: Progress) -> None:
        if index_of[plan.box] == 1:
            store.areas[plan.area_id] = _replies(plan.area_id, eros_at=180.0)
            return
        started.set()
        while True:
            prog.check()
            threading.Event().wait(0.01)

    jobs = _scan_jobs(tmp_path, runner, store=store)
    run_id = jobs.submit_scan(p, "discovery", RELEASE)
    assert started.wait(5)
    jobs.stop(run_id)
    assert jobs.wait(10)
    run = _run(jobs, run_id)
    assert run["state"] == "stopped" and run["finished_at"] is not None
    assert [s["state"] for s in run["squares"]] == ["done", "todo", "todo"]
    assert run["events"][-1]["type"] == "run_stopped"
    assert store.entry(run["squares"][0]["area_id"], "summary") is not None
    with pytest.raises(RunConflict):
        jobs.stop(run_id)


def test_a_scan_takes_one_queue_slot_on_the_one_worker(tmp_path: Path) -> None:
    gate, started = threading.Event(), threading.Event()
    active, peak = [0], [0]
    lock = threading.Lock()

    def runner(ctx: Context, plan: Plan, prog: Progress) -> None:
        with lock:
            active[0] += 1
            peak[0] = max(peak[0], active[0])
        started.set()
        gate.wait(5)
        with lock:
            active[0] -= 1

    jobs = _scan_jobs(tmp_path, runner)
    first = jobs.submit(_plan_of(live.snap_box(10.0, 10.0, 0.5, 0.5)), kind="known")
    assert started.wait(5)
    run_id = jobs.submit_scan(scan.plan_scan(180.0, 0.0, 4.0, 2.0), "discovery", RELEASE)
    queued = _run(jobs, run_id)
    assert (queued["state"], queued["queue_position"]) == ("queued", 1)
    assert jobs.reply(first)["state"] == "running"
    gate.set()
    assert jobs.wait(10)
    assert peak[0] == 1
    assert _run(jobs, run_id)["state"] == "done"


def test_a_queued_scan_stops_at_once(tmp_path: Path) -> None:
    gate, started = threading.Event(), threading.Event()

    def runner(ctx: Context, plan: Plan, prog: Progress) -> None:
        started.set()
        gate.wait(5)

    jobs = _scan_jobs(tmp_path, runner)
    jobs.submit(_plan_of(live.snap_box(10.0, 10.0, 0.5, 0.5)))
    assert started.wait(5)
    run_id = jobs.submit_scan(scan.plan_scan(180.0, 0.0, 2.0, 2.0), "discovery", RELEASE)
    with pytest.raises(RunConflict):
        jobs.pause(run_id)  # only a running scan pauses
    jobs.stop(run_id)
    assert _run(jobs, run_id)["state"] == "stopped"
    gate.set()
    assert jobs.wait(10)
    assert _run(jobs, run_id)["state"] == "stopped"


def test_close_stops_the_running_scan_and_everything_waiting(tmp_path: Path) -> None:
    """Server shutdown (the gap analysis of 14 Nov): the worker ends at its next check, the
    queued items are dropped, and every run is recorded stopped."""
    started = threading.Event()

    def runner(ctx: Context, plan: Plan, prog: Progress) -> None:
        started.set()
        while True:  # a square that would never end by itself: only a stop ends it
            prog.check()
            threading.Event().wait(0.01)

    jobs = _scan_jobs(tmp_path, runner)
    running = jobs.submit_scan(scan.plan_scan(180.0, 0.0, 2.0, 2.0), "discovery", RELEASE)
    assert started.wait(5)
    waiting = jobs.submit_scan(scan.plan_scan(190.0, 0.0, 2.0, 2.0), "known", RELEASE)
    single = jobs.submit(_plan_of(live.snap_box(10.0, 10.0, 0.5, 0.5)), kind="discovery")
    assert jobs.close(timeout=10)
    assert _run(jobs, running)["state"] == "stopped"
    assert _run(jobs, waiting)["state"] == "stopped"
    assert single.run_id is not None and _run(jobs, single.run_id)["state"] == "stopped"
    assert jobs.reply(single)["error"]["code"] == "cancelled"
    assert jobs.close(timeout=1)  # nothing left: closing again is harmless
    # A request racing the shutdown queues nothing and does not start the worker again.
    with pytest.raises(QueueFull):
        jobs.submit_scan(scan.plan_scan(200.0, 0.0, 2.0, 2.0), "discovery", RELEASE)
    with pytest.raises(QueueFull):
        jobs.submit(_plan_of(live.snap_box(12.0, 10.0, 0.5, 0.5)), kind="discovery")
    assert jobs._thread is None or not jobs._thread.is_alive()


def test_a_single_live_job_with_a_kind_is_a_run_of_one_square(tmp_path: Path) -> None:
    store = FakeStore()

    def runner(ctx: Context, plan: Plan, prog: Progress) -> None:
        store.areas[plan.area_id] = _replies(plan.area_id, eros_at=10.0)

    jobs = _scan_jobs(tmp_path, runner, store=store)
    plan = _plan_of(live.snap_box(10.0, 10.0, 0.5, 0.5))
    job = jobs.submit(plan, kind="known")
    assert jobs.wait(10)
    assert job.run_id is not None
    run = _run(jobs, job.run_id)
    assert (run["kind"], run["state"], run["region"]) == ("known", "done", plan.box.reply())
    assert run["squares"] == [
        {
            "index": 1,
            "box": plan.box.reply(),
            "area_id": plan.area_id,
            "state": "done",
            "missing": [],  # Q-480: its known-object check did not fail
        }
    ]
    assert run["totals"]["found"] == 1
    # Without a kind (the #141 callers), nothing is recorded.
    jobs.submit(_plan_of(live.snap_box(11.0, 10.0, 0.5, 0.5)))
    assert jobs.wait(10)
    assert len(jobs.runs.ids()) == 1


# --- run records --------------------------------------------------------------------------


def test_run_records_persist_and_a_running_one_loads_stopped(tmp_path: Path) -> None:
    jobs = _scan_jobs(tmp_path, lambda ctx, plan, p: None)
    done_id = jobs.submit_scan(scan.plan_scan(180.0, 0.0, 2.0, 2.0), "discovery", RELEASE)
    assert jobs.wait(10)
    root = jobs.runs.root
    assert sorted(p.name for p in root.iterdir()) == [f"{done_id}.json"]  # no temp files left
    # A run the server was running when it stopped.
    rec = json.loads((root / f"{done_id}.json").read_text())
    rec["run_id"] = live_id = "run-20261113T120000-abcdef"
    rec["state"] = "running"
    rec["finished_at"] = None
    rec["squares"][0]["state"] = "running"
    rec["events"] = rec["events"][:2]
    (root / f"{live_id}.json").write_text(json.dumps(rec))
    (root / "run-20261113T120000-zzzzzz.json").write_text("{not json")  # skipped
    again = _scan_jobs(tmp_path, lambda ctx, plan, p: None)
    assert {r["run_id"] for r in again.runs.summaries()} == {done_id, live_id}
    loaded = _run(again, live_id)
    assert loaded["state"] == "stopped" and loaded["finished_at"] is not None
    assert loaded["squares"][0]["state"] == "todo"
    assert loaded["events"][-1]["type"] == "run_stopped"
    assert json.loads((root / f"{live_id}.json").read_text())["state"] == "stopped"
    lst = {"runs": again.runs.summaries()}
    check(lst, "run-list.schema.json")


def test_runs_are_listed_newest_first(tmp_path: Path) -> None:
    store = runs.RunStore(tmp_path / "runs")
    box = live.snap_box(1.0, 1.0, 1.0, 1.0)
    ids = [store.create("known", RELEASE, box, [(1, box, None)]) for _ in range(3)]
    for i, run_id in enumerate(ids):  # force distinct creation times
        store._runs[run_id]["created_at"] = f"2026-11-13T10:00:0{i}.000Z"
    assert [r["run_id"] for r in store.summaries()] == ids[::-1]
    assert store.summaries()[0]["duration_s"] is None


def test_a_run_record_write_is_atomic(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "runs" / "run-20261113T120000-abcdef.json"
    runs.write_atomic(path, b'{"a":1}')

    def broken(src: Any, dst: Any) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(os, "replace", broken)
    with pytest.raises(OSError):
        runs.write_atomic(path, b'{"a":2}')
    assert path.read_bytes() == b'{"a":1}'  # the old record is intact
    assert sorted(p.name for p in path.parent.iterdir()) == [path.name]  # temp file removed


def test_the_run_id_format() -> None:
    assert runs.RUN_ID.match(runs.new_run_id())


# --- merged results -----------------------------------------------------------------------


def _row_of_three() -> tuple[dict[str, Any], dict[int, dict[str, Any]]]:
    p = scan.plan_scan(180.0, 0.0, 4.5, 1.0)  # 3 squares in a row, about 1.6 deg apart
    assert len(p.squares) == 3
    return p.region.reply(), {s.index: s.box.reply() for s in p.squares}


def test_an_object_in_squares_2_and_3_is_one_row() -> None:
    region, boxes = _row_of_three()
    sq = [
        runs.SquareReplies(i, f"live-00000000000{i}", **_stages(r))
        for i, r in (
            (1, _replies("a1", mover_at=181.4)),
            (2, _replies("a2", eros_at=180.0, mover_at=180.3)),
            # the same mover 10 arcsec away on the same frame, and Eros again
            (3, _replies("a3", eros_at=180.0, mover_at=180.3 + 10 / 3600)),
        )
    ]
    merged = runs.merge(boxes, sq)
    found = [t for t in merged["tracks"] if t["kind"] == "found"]
    unexplained = [t for t in merged["tracks"] if t["kind"] == "unexplained"]
    assert len(found) == 1 and found[0]["squares"] == [2, 3]
    assert found[0]["designation"] == "433 Eros"
    assert sorted(t["squares"] for t in unexplained) == [[1], [2, 3]]
    eros = [k for k in merged["known"] if k["designation"] == "433 Eros"]
    assert len(eros) == 1 and eros[0]["squares"] == [2, 3] and eros[0]["detected"]
    assert eros[0]["visits"] == [_iso(0), _iso(90)]
    reply = runs.results_reply(
        {
            "run_id": "run-20261113T120000-abcdef",
            "kind": "discovery",
            "release": RELEASE,
            "region": region,
            "state": "done",
            "squares": [
                {"index": i, "area_id": f"live-00000000000{i}", "state": "done"} for i in (1, 2, 3)
            ],
        },
        merged,
    )
    check(reply, "run-results.schema.json")


def test_far_apart_or_non_neighbour_movers_stay_apart() -> None:
    _, boxes = _row_of_three()
    sq = [
        runs.SquareReplies(1, "live-000000000001", **_stages(_replies("a1", mover_at=180.0))),
        runs.SquareReplies(3, "live-000000000003", **_stages(_replies("a3", mover_at=180.0))),
        runs.SquareReplies(2, "live-000000000002", **_stages(_replies("a2", mover_at=180.1))),
    ]
    merged = runs.merge(boxes, sq)
    # 1 and 3 are not neighbours; 2 is 360 arcsec from both.
    assert sorted(t["squares"] for t in merged["tracks"]) == [[1], [2], [3]]


def _stages(r: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return {"summary": r["summary"], "known": r["known"], "tracks": r["tracks"], "dots": r["dots"]}


# --- the routes ---------------------------------------------------------------------------


@pytest.fixture
def client(tmp_path: Path) -> Any:
    app = create_app(make_settings(tmp_path / "cache", offline=False, data_release=RELEASE))
    with TestClient(app) as c:
        gate = threading.Event()
        app.state.gate = gate

        def runner(ctx: Context, plan: Plan, prog: Progress) -> None:
            prog.step("frames")
            while not gate.wait(0.01):
                prog.check()

        app.state.live_jobs = LiveJobs(
            app.state.ctx,
            runner,
            planner=lambda ctx, box: _plan_of(box),
            store=AreaStore(app.state.ctx, None),
        )
        yield c
        gate.set()
        app.state.live_jobs.wait(10)


REGION = {"ra": 180.0, "dec": 0.0, "width_deg": 3.0, "height_deg": 1.0}  # 2 squares


def test_the_plan_route_needs_no_network(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def no_sia(*a: Any, **k: Any) -> Any:
        raise AssertionError("no SIA call in a plan")

    monkeypatch.setattr(live, "plan_area", no_sia)
    client.app.state.live_jobs._planner = no_sia  # type: ignore[attr-defined]
    r = client.post("/v1/scans", json=REGION)
    assert r.status_code == 200
    body = r.json()
    check(body, "scan-plan.schema.json")
    assert (body["cols"], body["rows"], body["kind"]) == (2, 1, "discovery")
    assert [s["area_id"] for s in body["squares"]] == [None, None]


def test_server_shutdown_stops_a_scan_that_is_running(tmp_path: Path) -> None:
    """The lifespan closes the live jobs: the process exits without waiting for the scan, and
    the run is recorded stopped (not left for the next start to find)."""
    app = create_app(make_settings(tmp_path / "cache", offline=False, data_release=RELEASE))
    started = threading.Event()

    def runner(ctx: Context, plan: Plan, prog: Progress) -> None:
        started.set()
        while True:  # never ends by itself
            prog.check()
            threading.Event().wait(0.01)

    with TestClient(app) as c:
        app.state.live_jobs = LiveJobs(
            app.state.ctx,
            runner,
            planner=lambda ctx, box: _plan_of(box),
            store=AreaStore(app.state.ctx, None),
        )
        r = c.post("/v1/scans", json={**REGION, "kind": "discovery", "start": True})
        assert r.status_code == 202
        run_id = r.json()["run_id"]
        assert started.wait(5)
    jobs: LiveJobs = app.state.live_jobs
    assert jobs.wait(1)  # the worker has ended
    assert _run(jobs, run_id)["state"] == "stopped"


def test_scan_routes_start_pause_resume_stop(client: TestClient) -> None:
    r = client.post("/v1/scans", json={**REGION, "kind": "known", "start": True})
    assert r.status_code == 202
    run = r.json()
    check(run, "run.schema.json")
    run_id = run["run_id"]
    assert client.post(f"/v1/runs/{run_id}/resume").status_code == 409  # not paused
    for _ in range(500):  # wait until the worker runs it
        if client.get(f"/v1/runs/{run_id}").json()["state"] == "running":
            break
        threading.Event().wait(0.01)
    p = client.post(f"/v1/runs/{run_id}/pause")
    assert p.status_code == 200
    assert client.post(f"/v1/runs/{run_id}/resume").status_code == 200  # pending pause dropped
    listed = client.get("/v1/runs").json()
    check(listed, "run-list.schema.json")
    assert [x["run_id"] for x in listed["runs"]] == [run_id]
    assert listed["runs"][0]["squares_total"] == 2
    assert client.delete(f"/v1/runs/{run_id}").status_code == 204
    client.app.state.live_jobs.wait(10)  # type: ignore[attr-defined]
    got = client.get(f"/v1/runs/{run_id}").json()
    assert got["state"] == "stopped"
    assert client.delete(f"/v1/runs/{run_id}").status_code == 409
    res = client.get(f"/v1/runs/{run_id}/results")
    assert res.status_code == 200
    check(res.json(), "run-results.schema.json")
    assert res.json()["known"] == [] and res.json()["tracks"] == []


def test_run_routes_refuse(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    missing = "run-20261113T120000-abcdef"
    for method, path in (
        ("get", f"/v1/runs/{missing}"),
        ("get", f"/v1/runs/{missing}/results"),
        ("post", f"/v1/runs/{missing}/pause"),
        ("delete", f"/v1/runs/{missing}"),
    ):
        r = getattr(client, method)(path)
        assert (r.status_code, r.json()["error"]) == (404, "run_not_found"), path
    assert client.get("/v1/runs/not-a-run").status_code == 400  # request validation
    r = client.post("/v1/scans", json={**REGION, "width_deg": 12.5})
    assert (r.status_code, r.json()["error"]) == (422, "scan:too_large")
    r = client.post("/v1/scans", json={**REGION, "dec": 88.8})
    assert (r.status_code, r.json()["error"]) == (422, "area:bad_box")
    assert client.post("/v1/scans", json={**REGION, "kind": "other"}).status_code == 400

    from app.core.area import live_jobs

    monkeypatch.setattr(live_jobs, "MAX_WAITING", 0)
    r = client.post("/v1/scans", json={**REGION, "start": True})
    assert (r.status_code, r.json()["error"]) == (429, "queue_full")


def test_a_single_area_run_cannot_pause(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api import areas as areas_api

    monkeypatch.setattr(areas_api, "plan_area", lambda ctx, box, pair=None: _plan_of(box))
    box = {"ra": 10.0, "dec": 10.0, "width_deg": 0.5, "height_deg": 0.5, "start": True}
    r = client.post("/v1/areas/live", json={**box, "kind": "discovery"})
    assert r.status_code == 202
    run_id = r.json()["run_id"]  # the reply names its run (PR #160 review)
    assert client.get(f"/v1/runs/{run_id}").json()["kind"] == "discovery"
    r = client.post(f"/v1/runs/{run_id}/pause")
    assert (r.status_code, r.json()["error"]) == (409, "run_not_pausable")
    assert client.delete(f"/v1/runs/{run_id}").status_code == 204


def test_a_live_area_without_kind_records_no_run(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """PR #160 review: a client that does not say which tool it is (the #144 card) records no
    run, rather than one listed under the wrong tool."""
    from app.api import areas as areas_api

    monkeypatch.setattr(areas_api, "plan_area", lambda ctx, box, pair=None: _plan_of(box))
    box = {"ra": 20.0, "dec": 10.0, "width_deg": 0.5, "height_deg": 0.5, "start": True}
    r = client.post("/v1/areas/live", json=box)
    assert r.status_code == 202 and "run_id" not in r.json()
    assert client.get("/v1/runs").json()["runs"] == []


def test_offline_refuses_to_start_a_scan(tmp_path: Path) -> None:
    with TestClient(create_app(make_settings(tmp_path / "cache"))) as c:
        assert c.post("/v1/scans", json=REGION).status_code == 200  # the plan works offline
        r = c.post("/v1/scans", json={**REGION, "start": True})
    assert (r.status_code, r.json()["error"]) == (503, "offline")


# --- one scan end to end, on the recorded Eros frames -------------------------------------


def test_a_one_square_scan_runs_the_pipeline_and_is_served(
    fixture_cache: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The real ``run_live_area`` on the recorded Eros frames (as
    ``test_area_live.py::test_a_live_job_runs_the_pipeline_and_its_area_is_served``), run as a
    one-square scan; then ``/v1/runs/{id}`` and ``/results`` are read."""
    frames, bodies = recorded_frames()
    times = sorted(parse_utc(f.time) for f in frames.frames)
    a, b = live.group_visits(times, 1.0)

    def recorded_find(ctx: Context, spec: Any, cfg: Any, **_: Any) -> Any:
        return replace(frames, spec=spec), bodies

    def planner(ctx: Context, box: Box) -> Plan:
        # The recorded visits are a day apart (beyond the 6 h rule): the plan is built directly.
        return Plan(live.area_id("spherex_qr2", box, (a, b)), "spherex_qr2", box, (a, b), ())

    monkeypatch.setattr(area_frames, "find_frames", recorded_find)
    monkeypatch.setattr(area_clean, "star_cones", lambda _frames: recorded_star_cones())
    settings = make_settings(fixture_cache)
    # One square with the recorded box itself: a padded square would be larger than the
    # recorded cutouts, which were cut for this box.
    box = Box(EROS_AREA.ra, EROS_AREA.dec, EROS_AREA.width_deg, EROS_AREA.height_deg)
    p = scan.ScanPlan(box, 1, 1, (scan.Square(1, 0, 0, box),))
    with TestClient(create_app(settings)) as c:
        jobs = LiveJobs(c.app.state.ctx, planner=planner, store=AreaStore(c.app.state.ctx, None))
        c.app.state.live_jobs = jobs  # type: ignore[attr-defined]
        run_id = jobs.submit_scan(p, "discovery", "spherex_qr2")
        assert jobs.wait(600)
        run = c.get(f"/v1/runs/{run_id}").json()
        check(run, "run.schema.json")
        assert run["state"] == "done" and run["squares"][0]["state"] == "done"
        found = [e["object"] for e in run["events"] if e["type"] == "found"]
        assert any(o["kind"] == "known" and o["designation"] == "433 Eros" for o in found)
        results = c.get(f"/v1/runs/{run_id}/results").json()
        check(results, "run-results.schema.json")
        eros = [k for k in results["known"] if k["designation"] == "433 Eros"]
        assert len(eros) == 1 and eros[0]["detected"] and eros[0]["squares"] == [1]
        assert len(eros[0]["visits"]) == 2
        area_id = run["squares"][0]["area_id"]
        assert c.get(f"/v1/areas/{area_id}/known").status_code == 200


# --- review fixes (#156 code review) -------------------------------------------------------


def test_a_stored_square_needs_no_sia_call(tmp_path: Path) -> None:
    """Review #3: a square the plan found stored is done without the planner, even when the
    archive is down; a square not stored still fails with the archive's code."""
    from app.cache.store import UpstreamUnavailable

    p = scan.plan_scan(180.0, 0.0, 3.0, 1.0)  # 2 squares
    store = FakeStore()
    store.areas["live-aaaaaaaaaaaa"] = _replies("live-aaaaaaaaaaaa", eros_at=180.0)
    asked: list[Box] = []

    def planner(ctx: Context, box: Box) -> Plan:
        asked.append(box)
        raise UpstreamUnavailable("IRSA down")

    jobs = _scan_jobs(tmp_path, lambda ctx, plan, prog: None, planner=planner, store=store)
    run_id = jobs.submit_scan(p, "discovery", RELEASE, {1: "live-aaaaaaaaaaaa"})
    assert jobs.wait(10)
    run = _run(jobs, run_id)
    assert [s["state"] for s in run["squares"]] == ["done", "failed"]
    assert run["squares"][1]["error"]["code"] == "upstream_unavailable"
    assert asked == [p.squares[1].box]  # only the square not stored asked SIA


def test_a_scan_square_is_listed_and_a_request_for_it_queues_its_own_job(
    tmp_path: Path,
) -> None:
    """Review #4 and PR #160: while a scan computes a square, ``get`` shows its job, and
    ``submit`` of the same area does not join it but queues a job of its own (with its own
    run), which is done at once when the square is stored, without running the pipeline
    again."""
    p = scan.plan_scan(180.0, 0.0, 1.5, 1.5)  # one square
    plan = _plan_of(p.squares[0].box)
    store = FakeStore()
    gate, started = threading.Event(), threading.Event()
    ran: list[str] = []

    def runner(ctx: Context, pl: Plan, prog: Progress) -> None:
        ran.append(pl.area_id)
        prog.step("frames")
        started.set()
        while not gate.wait(0.01):
            prog.check()
        store.areas[pl.area_id] = _replies(pl.area_id, eros_at=180.0)

    jobs = _scan_jobs(tmp_path, runner, store=store)
    jobs.submit_scan(p, "discovery", RELEASE)
    assert started.wait(5)
    inner = jobs.get(plan.area_id)
    assert inner is not None and inner.state == "running"
    assert jobs.reply(inner)["step"] == "frames"
    own = jobs.submit(plan, kind="known")
    assert own is not inner and own.state == "queued" and own.run_id is not None
    assert jobs.get(plan.area_id) is own
    assert jobs.submit(plan) is own  # a second request joins the single job
    gate.set()
    assert jobs.wait(10)
    assert ran == [plan.area_id] and inner.state == "done"
    assert own.state == "done"  # stored by the square meanwhile: not rerun
    assert _run(jobs, own.run_id)["state"] == "done"


def test_stopping_a_scan_never_loses_a_request_for_its_square(tmp_path: Path) -> None:
    """PR #160 review: a single request for the box a scan is computing has its own job and
    run, so stopping the scan cancels only the scan's square; the request computes the area."""
    p = scan.plan_scan(180.0, 0.0, 1.5, 1.5)  # one square
    plan = _plan_of(p.squares[0].box)
    store = FakeStore()
    started = threading.Event()
    ran: list[str] = []

    def runner(ctx: Context, pl: Plan, prog: Progress) -> None:
        ran.append(pl.area_id)
        if len(ran) == 1:  # the scan's square: runs until stopped
            prog.step("frames")
            started.set()
            while True:
                prog.check()
                threading.Event().wait(0.01)
        store.areas[pl.area_id] = _replies(pl.area_id, eros_at=180.0)

    jobs = _scan_jobs(tmp_path, runner, store=store)
    run_id = jobs.submit_scan(p, "discovery", RELEASE)
    assert started.wait(5)
    own = jobs.submit(plan, kind="known")
    jobs.stop(run_id)
    assert jobs.wait(10)
    assert _run(jobs, run_id)["state"] == "stopped"
    assert own.state == "done" and ran == [plan.area_id, plan.area_id]
    assert own.run_id is not None and _run(jobs, own.run_id)["state"] == "done"
    assert plan.area_id in store.areas


def test_stopping_a_scan_square_from_the_live_route_fails_only_that_square(
    tmp_path: Path,
) -> None:
    p = scan.plan_scan(180.0, 0.0, 3.0, 1.0)  # 2 squares
    first = _plan_of(p.squares[0].box)
    started = threading.Event()

    def runner(ctx: Context, pl: Plan, prog: Progress) -> None:
        if pl.area_id != first.area_id:
            return
        started.set()
        while True:
            prog.check()
            threading.Event().wait(0.01)

    jobs = _scan_jobs(tmp_path, runner)
    run_id = jobs.submit_scan(p, "discovery", RELEASE)
    assert started.wait(5)
    assert jobs.cancel(first.area_id)  # DELETE /v1/areas/live/{id} on the square's job
    assert jobs.wait(10)
    run = _run(jobs, run_id)
    assert run["state"] == "done"
    assert [s["state"] for s in run["squares"]] == ["failed", "done"]
    assert run["squares"][0]["error"]["code"] == "cancelled"


def test_a_failed_single_area_run_is_failed(tmp_path: Path) -> None:
    """Review #5: the run of one square whose job failed is ``failed``, not ``done``."""

    def runner(ctx: Context, plan: Plan, prog: Progress) -> None:
        raise LiveAreaError("area:frames_incomplete", "Some frames could not be read.")

    jobs = _scan_jobs(tmp_path, runner)
    job = jobs.submit(_plan_of(live.snap_box(10.0, 10.0, 0.5, 0.5)), kind="known")
    assert jobs.wait(10)
    assert job.run_id is not None
    run = _run(jobs, job.run_id)
    assert run["state"] == "failed"
    assert run["squares"][0]["state"] == "failed"
    assert run["squares"][0]["error"]["code"] == "area:frames_incomplete"


def test_stopping_a_single_run_that_just_finished_is_a_conflict(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Review #6: ``stop`` answers ``run_finished`` when the job ended between the check and
    the cancel, instead of a silent success."""
    gate, started = threading.Event(), threading.Event()

    def runner(ctx: Context, plan: Plan, prog: Progress) -> None:
        started.set()
        gate.wait(5)

    jobs = _scan_jobs(tmp_path, runner)
    job = jobs.submit(_plan_of(live.snap_box(10.0, 10.0, 0.5, 0.5)), kind="known")
    assert started.wait(5) and job.run_id is not None
    monkeypatch.setattr(jobs, "cancel", lambda area_id: False)  # it finished in between
    with pytest.raises(RunConflict) as err:
        jobs.stop(job.run_id)
    assert err.value.code == "run_finished"
    gate.set()
    assert jobs.wait(10)


def test_resume_counts_towards_the_queue_limit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Review #7: a resumed scan is queued at the back like a new job, and a full queue
    refuses it."""
    from app.core.area import live_jobs

    p = scan.plan_scan(180.0, 0.0, 3.0, 1.0)  # 2 squares
    gate, started = threading.Event(), threading.Event()

    def runner(ctx: Context, plan: Plan, prog: Progress) -> None:
        started.set()
        gate.wait(5)

    jobs = _scan_jobs(tmp_path, runner)
    run_id = jobs.submit_scan(p, "discovery", RELEASE)
    assert started.wait(5)
    jobs.pause(run_id)
    gate.set()
    assert jobs.wait(10)
    assert _run(jobs, run_id)["state"] == "paused"
    monkeypatch.setattr(live_jobs, "MAX_WAITING", 0)
    with pytest.raises(live_jobs.QueueFull):
        jobs.resume(run_id)
    assert _run(jobs, run_id)["state"] == "paused"
    monkeypatch.setattr(live_jobs, "MAX_WAITING", 5)
    gate.clear()
    started.clear()
    other = jobs.submit(_plan_of(live.snap_box(10.0, 10.0, 0.5, 0.5)))
    assert started.wait(5)
    jobs.resume(run_id)
    assert _run(jobs, run_id)["queue_position"] == 1  # behind nothing waiting, after `other`
    gate.set()
    assert jobs.wait(10)
    assert other.state == "done" and _run(jobs, run_id)["state"] == "done"


def test_a_job_behind_a_scan_waits_for_its_squares_left(tmp_path: Path) -> None:
    """Review #2: the wait behind a running scan is the squares not started plus what is
    left of the current one, not the whole scan less the time since it first started."""
    p = scan.plan_scan(180.0, 0.0, 4.5, 1.0)  # 3 squares
    gate, started = threading.Event(), threading.Event()

    def runner(ctx: Context, plan: Plan, prog: Progress) -> None:
        if plan.box == p.squares[0].box:
            return
        started.set()
        gate.wait(5)

    jobs = _scan_jobs(tmp_path, runner)
    jobs.submit_scan(p, "discovery", RELEASE)
    assert started.wait(5)
    job = jobs.submit(_plan_of(live.snap_box(10.0, 10.0, 0.5, 0.5)))
    left = sum(live.estimate_seconds(s.box) for s in p.squares[1:])
    eta = jobs.reply(job)["eta_s"]
    assert left - 5 <= eta - job.plan.estimate_s() <= left
    gate.set()
    assert jobs.wait(10)


def test_the_duration_leaves_out_pauses() -> None:
    run = {
        "started_at": "2026-11-13T10:00:00.000Z",
        "finished_at": "2026-11-13T10:10:00.000Z",
        "events": [
            {"t": 0.0, "type": "run_started"},
            {"t": 60.0, "type": "run_paused"},
            {"t": 360.0, "type": "run_resumed"},
            {"t": 420.0, "type": "square_started"},  # after a minute queued behind others
            {"t": 600.0, "type": "run_done"},
        ],
    }
    # PR #160 review: the queue wait after a resume is not running time either.
    assert runs.duration_s(run) == 240.0
    stopped_while_paused = {
        **run,
        "events": [*run["events"][:2], {"t": 600.0, "type": "run_stopped"}],
    }
    assert runs.duration_s(stopped_while_paused) == 60.0


def test_run_record_writes_never_hold_the_read_lock(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Review #8: a slow disk write does not block readers of the run store."""
    store = runs.RunStore(tmp_path / "runs")
    box = live.snap_box(1.0, 1.0, 1.0, 1.0)
    run_id = store.create("known", RELEASE, box, [(1, box, None)])
    writing, release = threading.Event(), threading.Event()
    real = runs.write_atomic

    def slow(path: Path, body: bytes) -> None:
        writing.set()
        release.wait(5)
        real(path, body)

    monkeypatch.setattr(runs, "write_atomic", slow)
    t = threading.Thread(target=store.start, args=(run_id,))
    t.start()
    assert writing.wait(5)
    assert store.get(run_id)["state"] == "running"  # read while the write is still going
    release.set()
    t.join(5)
    on_disk = json.loads((tmp_path / "runs" / f"{run_id}.json").read_text())
    assert on_disk["state"] == "running" and on_disk["provenance"] == runs.RUN_PROVENANCE


def test_a_square_s_replies_are_kept_small(tmp_path: Path) -> None:
    """Review #9: a finished square keeps only its tracks' dots and its frame times."""
    r = _replies("a1", eros_at=180.0)
    r["dots"]["visits"][0]["dots"].append(
        {"dot_id": "a1:99", "frame_id": "f1", "time": _iso(0), "ra": 1.0, "dec": 0.0}
    )
    r["summary"]["frames"][0]["s_region"] = "POLYGON ..."
    sq = runs.read_square(1, "live-aaaaaaaaaaaa", lambda a, st: r[st])
    assert sq.dots is not None and sq.summary is not None
    assert [d["dot_id"] for d in sq.dots["visits"][0]["dots"]] == ["a1:1"]
    assert sq.summary["frames"][0] == {"visit": 1, "time": _iso(0)}


def test_the_store_reads_each_summary_once(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Review nit: ``areas_by_box`` reads every stored summary once."""
    settings = make_settings(tmp_path / "cache")
    store = AreaStore(make_context(settings), settings.area_pack_dir)
    calls: list[str] = []
    real = store.entry

    def counted(area_id: str, stage: str) -> Any:
        if stage == "summary":
            calls.append(area_id)
        return real(area_id, stage)

    monkeypatch.setattr(store, "entry", counted)
    by_box = store.areas_by_box("spherex_qr2")
    assert "eros-2026-03" in by_box.values()
    assert sorted(calls) == sorted(set(calls))


# --- PR #160 code review ------------------------------------------------------------------


def test_a_bad_run_record_never_stops_the_live_routes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Review #1: a record with a bad or missing field is skipped (and left on disk); one that
    cannot be written back is kept in memory; the store, and so ``LiveJobs``, still loads."""
    jobs = _scan_jobs(tmp_path, lambda ctx, plan, p: None)
    good = jobs.submit_scan(scan.plan_scan(180.0, 0.0, 2.0, 2.0), "discovery", RELEASE)
    assert jobs.wait(10)
    root = jobs.runs.root
    rec = json.loads((root / f"{good}.json").read_text())
    bad: dict[str, Any] = {
        "run-20261113T120000-aaaaaa": {**rec, "events": [{"type": "run_started"}]},  # no t
        "run-20261113T120000-bbbbbb": {**rec, "started_at": "not a time"},
        "run-20261113T120000-cccccc": {k: v for k, v in rec.items() if k != "created_at"},
        "run-20261113T120000-dddddd": {**rec, "squares": [{"index": 1}]},
        "run-20261113T120000-eeeeee": [],
    }
    for run_id, body in bad.items():
        if isinstance(body, dict):
            body = {**body, "run_id": run_id}
        (root / f"{run_id}.json").write_text(json.dumps(body))
    live_id = "run-20261113T120000-ffffff"
    (root / f"{live_id}.json").write_text(
        json.dumps({**rec, "run_id": live_id, "state": "running", "finished_at": None})
    )

    def no_disk(path: Path, body: bytes) -> None:
        raise OSError("read-only file system")

    monkeypatch.setattr(runs, "write_atomic", no_disk)
    again = _scan_jobs(tmp_path, lambda ctx, plan, p: None)
    assert {r["run_id"] for r in again.runs.summaries()} == {good, live_id}
    assert _run(again, live_id)["state"] == "stopped"  # kept in memory, not written
    for run_id in bad:
        assert (root / f"{run_id}.json").exists()  # left as it was


def test_a_scan_whose_padded_squares_reach_a_pole_is_refused() -> None:
    """Review #2: the region edge (88.9) is under the limit but the padded top squares pass
    it: refused with the scan's message, not the single live area's."""
    for dec in (87.85, 87.9, 87.95, -87.9):
        with pytest.raises(LiveAreaError) as err:
            scan.plan_scan(10.0, dec, 2.0, 2.0)
        assert err.value.code == "area:bad_box" and "Scans" in err.value.detail
    assert scan.plan_scan(10.0, 87.5, 2.0, 2.0).rows == 2


def test_a_pause_while_the_last_square_runs_is_refused(tmp_path: Path) -> None:
    """Review #5: with no square after the running one, a pause could never take effect."""
    p = scan.plan_scan(180.0, 0.0, 3.0, 1.0)  # 2 squares
    last = _plan_of(p.squares[1].box)
    gates = {last.area_id: threading.Event()}
    started = threading.Event()

    def runner(ctx: Context, pl: Plan, prog: Progress) -> None:
        gate = gates.get(pl.area_id)
        if gate is None:
            return
        started.set()
        while not gate.wait(0.01):
            prog.check()

    jobs = _scan_jobs(tmp_path, runner)
    run_id = jobs.submit_scan(p, "discovery", RELEASE)
    assert started.wait(5)
    with pytest.raises(RunConflict) as err:
        jobs.pause(run_id)
    assert err.value.code == "run_not_pausable"
    gates[last.area_id].set()
    assert jobs.wait(10)
    assert _run(jobs, run_id)["state"] == "done"


def test_a_square_starting_is_written_with_the_next_change(tmp_path: Path) -> None:
    """Review #8: one record write per square. The API, which reads memory, still shows the
    running square."""
    p = scan.plan_scan(180.0, 0.0, 1.5, 1.5)  # one square
    gate, started = threading.Event(), threading.Event()

    def runner(ctx: Context, pl: Plan, prog: Progress) -> None:
        started.set()
        while not gate.wait(0.01):
            prog.check()

    jobs = _scan_jobs(tmp_path, runner)
    run_id = jobs.submit_scan(p, "discovery", RELEASE)
    assert started.wait(5)
    on_disk = json.loads((jobs.runs.root / f"{run_id}.json").read_text())
    assert [e["type"] for e in on_disk["events"]] == ["run_started"]
    assert _run(jobs, run_id)["events"][-1]["type"] == "square_started"
    gate.set()
    assert jobs.wait(10)
    on_disk = json.loads((jobs.runs.root / f"{run_id}.json").read_text())
    types = [e["type"] for e in on_disk["events"]]
    assert types[:2] == ["run_started", "square_started"] and types[-1] == "run_done"


class CountingStore(FakeStore):
    def __init__(self) -> None:
        super().__init__()
        self.reads = 0

    def entry(self, area_id: str, stage: str) -> Any:
        self.reads += 1
        return super().entry(area_id, stage)


def test_results_are_merged_once_per_finished_square(tmp_path: Path) -> None:
    """Review #9: polling the results of a run re-reads nothing until another square is done."""
    p = scan.plan_scan(180.0, 0.0, 1.5, 1.5)  # one square
    plan = _plan_of(p.squares[0].box)
    store = CountingStore()

    def runner(ctx: Context, pl: Plan, prog: Progress) -> None:
        store.areas[pl.area_id] = _replies(pl.area_id, eros_at=180.0)

    jobs = _scan_jobs(tmp_path, runner, store=store)
    run_id = jobs.submit_scan(p, "discovery", RELEASE)
    assert jobs.wait(10)
    run, merged = jobs.results(run_id)
    reads = store.reads
    check(runs.results_reply(run, merged), "run-results.schema.json")
    again_run, again = jobs.results(run_id)
    assert store.reads == reads and again is merged
    assert again_run["squares"][0]["area_id"] == plan.area_id


def test_run_records_never_share_a_provenance_dict(tmp_path: Path) -> None:
    store = runs.RunStore(tmp_path / "runs")
    box = live.snap_box(1.0, 1.0, 1.0, 1.0)
    a, b = (store.create("known", RELEASE, box, [(1, box, None)]) for _ in range(2))
    pa, pb = store._runs[a]["provenance"], store._runs[b]["provenance"]
    assert pa == pb == runs.RUN_PROVENANCE
    assert pa is not pb and pa["known_positions"] is not runs.RUN_PROVENANCE["known_positions"]


# --- runs report failures honestly (issue #169: Q-480, Q-481, Q-482) -------------------------


def test_an_unchecked_track_is_counted_listed_and_its_codes_kept(tmp_path: Path) -> None:
    """Q-480: a SkyBoT cone that failed leaves a track ``unchecked``; the run counts it, lists
    it with its codes, and each square carries the summary's skybot: and horizons: codes."""
    p = scan.plan_scan(180.0, 0.0, 1.5, 1.5)  # one square
    store = FakeStore()

    def runner(ctx: Context, plan: Plan, prog: Progress) -> None:
        store.areas[plan.area_id] = _replies(
            plan.area_id,
            eros_at=180.1,
            unchecked_at=180.3,
            missing=("checks:not_run", "horizons:2024 AB", "skybot:1"),
        )

    jobs = _scan_jobs(tmp_path, runner, store=store)
    run_id = jobs.submit_scan(p, "discovery", RELEASE)
    assert jobs.wait(10)
    run = _run(jobs, run_id)
    assert run["state"] == "done"
    assert run["totals"]["unchecked"] == 1 and run["totals"]["found"] == 1
    assert run["totals"]["unexplained"] == 0
    assert run["squares"][0]["missing"] == ["horizons:2024 AB", "skybot:1"]
    # No found event for the unchecked track: the replay is unchanged (Q-480).
    found = [e["object"] for e in run["events"] if e["type"] == "found"]
    assert {o.get("track_id") for o in found} == {"T1"}
    got, merged = jobs.results(run_id)
    reply = runs.results_reply(got, merged)
    check(reply, "run-results.schema.json")
    rows = {t["kind"]: t for t in reply["tracks"]}
    assert rows["unchecked"]["unchecked_by"] == ["skybot:1"]
    assert rows["unchecked"]["designation"] is None
    assert "unchecked_by" not in rows["found"]
    assert reply["squares"][0]["missing"] == ["horizons:2024 AB", "skybot:1"]


def test_the_merged_kind_is_found_then_unexplained_then_unchecked() -> None:
    """Q-480: a merged track is found when any member matched, else unexplained when any
    member was checked, else unchecked; the unchecked members' codes stay on the row."""
    _, boxes = _row_of_three()
    mover = 180.3

    def merged_of(a: dict[str, Any], b: dict[str, Any]) -> list[dict[str, Any]]:
        sq = [
            runs.SquareReplies(2, "live-000000000002", **_stages(a)),
            runs.SquareReplies(3, "live-000000000003", **_stages(b)),
        ]
        tracks: list[dict[str, Any]] = runs.merge(boxes, sq)["tracks"]
        return tracks

    # unchecked + unchecked (the same mover in squares 2 and 3) -> unchecked
    both = merged_of(_replies("a2", unchecked_at=mover), _replies("a3", unchecked_at=mover))
    assert [(t["kind"], t["squares"], t["unchecked_by"]) for t in both] == [
        ("unchecked", [2, 3], ["skybot:1"])
    ]
    # unchecked + unexplained -> unexplained, the failed check still named
    mixed = merged_of(_replies("a2", unchecked_at=mover), _replies("a3", mover_at=mover))
    assert [(t["kind"], t.get("unchecked_by")) for t in mixed] == [("unexplained", ["skybot:1"])]
    # unchecked + found (same frame, 10 arcsec apart) -> found, no codes
    near = mover + 10 / 3600
    found = merged_of(_replies("a2", unchecked_at=mover), _replies("a3", eros_at=near))
    assert [(t["kind"], t["designation"], t.get("unchecked_by")) for t in found] == [
        ("found", "433 Eros", None)
    ]


def test_a_scan_whose_every_square_failed_ends_failed(tmp_path: Path) -> None:
    """Q-481: not stopped, no square done, at least one failed -> failed."""
    p = scan.plan_scan(180.0, 0.0, 3.0, 1.0)  # 2 squares

    def planner(ctx: Context, box: Box) -> Plan:
        raise RuntimeError("the frame search failed")

    jobs = _scan_jobs(tmp_path, lambda ctx, plan, prog: None, planner=planner)
    run_id = jobs.submit_scan(p, "discovery", RELEASE)
    assert jobs.wait(10)
    run = _run(jobs, run_id)
    assert run["state"] == "failed"
    assert [s["state"] for s in run["squares"]] == ["failed", "failed"]
    assert run["totals"]["squares_failed"] == 2 and run["totals"]["squares_done"] == 0
    assert run["events"][-1]["type"] == "run_done"


def test_a_scan_with_a_square_done_and_one_failed_is_done(tmp_path: Path) -> None:
    p = scan.plan_scan(180.0, 0.0, 3.0, 1.0)  # 2 squares
    store = FakeStore()

    def runner(ctx: Context, plan: Plan, prog: Progress) -> None:
        if plan.box == p.squares[1].box:
            raise LiveAreaError("area:frames_incomplete", "a cutout failed")
        store.areas[plan.area_id] = _replies(plan.area_id, mover_at=180.0)

    jobs = _scan_jobs(tmp_path, runner, store=store)
    run_id = jobs.submit_scan(p, "discovery", RELEASE)
    assert jobs.wait(10)
    run = _run(jobs, run_id)
    assert run["state"] == "done"
    assert (run["totals"]["squares_done"], run["totals"]["squares_failed"]) == (1, 1)


def test_a_scan_whose_every_square_was_skipped_is_done(tmp_path: Path) -> None:
    p = scan.plan_scan(180.0, 0.0, 3.0, 1.0)  # 2 squares

    def planner(ctx: Context, box: Box) -> Plan:
        raise LiveAreaError("area:no_visit_pair", "not seen twice")

    jobs = _scan_jobs(tmp_path, lambda ctx, plan, prog: None, planner=planner)
    run_id = jobs.submit_scan(p, "discovery", RELEASE)
    assert jobs.wait(10)
    run = _run(jobs, run_id)
    assert run["state"] == "done" and run["totals"]["squares_skipped"] == 2
    assert run["totals"]["squares_failed"] == 0


def test_a_run_recorded_before_q479_reads_unchecked_null(tmp_path: Path) -> None:
    """An old record has no ``unchecked``: it reads null (never an invented 0), its
    ``squares_failed`` is counted from its squares, and ``/v1/runs`` still passes its schema."""
    root = tmp_path / "cache" / "runs"
    store = runs.RunStore(root)
    box = live.snap_box(180.0, 0.0, 1.0, 1.0)
    run_id = store.create("discovery", RELEASE, box, [(1, box, None), (2, box, None)])
    rec = store.get(run_id)
    rec["state"] = "done"
    rec["squares"][1]["state"] = "failed"
    for k in ("unchecked", "squares_failed"):
        rec["totals"].pop(k)
    (root / f"{run_id}.json").write_text(json.dumps(rec))
    app = create_app(make_settings(tmp_path / "cache", data_release=RELEASE))
    with TestClient(app) as c:
        listed = c.get("/v1/runs")
        assert listed.status_code == 200
        check(listed.json(), "run-list.schema.json")
        totals = listed.json()["runs"][0]["totals"]
        assert totals["unchecked"] is None and totals["squares_failed"] == 1
        got = c.get(f"/v1/runs/{run_id}").json()
        check(got, "run.schema.json")
    on_disk = json.loads((root / f"{run_id}.json").read_text())
    assert on_disk["totals"]["unchecked"] is None  # written back once


def test_a_stored_area_whose_check_failed_is_computed_again_once(tmp_path: Path) -> None:
    """Q-482: a stored area whose summary lists a skybot: code is computed again on the next
    start; within the cooldown it is reused, as it is offline."""
    store = FakeStore()
    plan = _plan_of(live.snap_box(10.0, 10.0, 0.5, 0.5))
    store.areas[plan.area_id] = _replies(plan.area_id, unchecked_at=10.0, missing=("skybot:1",))
    ran: list[str] = []

    def runner(ctx: Context, pl: Plan, prog: Progress) -> None:  # SkyBoT fails again
        ran.append(pl.area_id)

    jobs = LiveJobs(_ctx(tmp_path, offline=False), runner, store=store)
    assert not jobs.reusable(plan.area_id)
    jobs.submit(plan, kind="discovery")
    assert jobs.wait(10)
    assert ran == [plan.area_id]
    assert jobs.reusable(plan.area_id)  # rechecked: the cooldown holds
    jobs.submit(plan, kind="discovery")
    assert jobs.wait(10)
    assert ran == [plan.area_id]  # not repeated within the cooldown
    offline = LiveJobs(_ctx(tmp_path), runner, store=store)
    assert offline.reusable(plan.area_id)  # offline a recheck could only fail again


def test_a_recheck_loses_the_codes_when_skybot_answers(tmp_path: Path) -> None:
    p = scan.plan_scan(180.0, 0.0, 1.5, 1.5)  # one square
    store = FakeStore()
    area_id = _plan_of(p.squares[0].box).area_id
    store.areas[area_id] = _replies(area_id, unchecked_at=180.3, missing=("skybot:1",))
    ran: list[int] = []

    def runner(ctx: Context, plan: Plan, prog: Progress) -> None:  # SkyBoT answers this time
        ran.append(1)
        store.areas[plan.area_id] = _replies(plan.area_id, mover_at=180.3)

    jobs = LiveJobs(
        _ctx(tmp_path, offline=False),
        runner,
        planner=lambda ctx, box: _plan_of(box),
        store=store,
    )
    run_id = jobs.submit_scan(p, "discovery", RELEASE, stored={1: area_id})
    assert jobs.wait(10)
    run = _run(jobs, run_id)
    assert ran == [1]
    assert run["squares"][0]["missing"] == []
    assert (run["totals"]["unchecked"], run["totals"]["unexplained"]) == (0, 1)


def test_results_are_merged_again_after_an_area_is_stored_again(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Q-482: a recompute stores an area again; every kept merge is dropped, so a run's
    ``/results`` show the area's current result."""
    from app.core.area import live_jobs

    store = FakeStore()
    plan = _plan_of(live.snap_box(10.0, 10.0, 0.5, 0.5))
    first_pass = [True]

    def runner(ctx: Context, pl: Plan, prog: Progress) -> None:
        if first_pass[0]:  # SkyBoT fails: stored with the code
            first_pass[0] = False
            missing = ("skybot:1",)
            store.areas[pl.area_id] = _replies(pl.area_id, unchecked_at=10.0, missing=missing)
        else:  # the recheck: SkyBoT answers
            store.areas[pl.area_id] = _replies(pl.area_id, mover_at=10.0)

    jobs = LiveJobs(_ctx(tmp_path, offline=False), runner, store=store)
    first = jobs.submit(plan, kind="discovery")
    assert jobs.wait(10) and first.run_id is not None
    assert [t["kind"] for t in jobs.results(first.run_id)[1]["tracks"]] == ["unchecked"]
    monkeypatch.setattr(live_jobs, "RECHECK_COOLDOWN_S", 0.0)  # the cooldown has passed
    jobs.submit(plan, kind="discovery")  # the recheck
    assert jobs.wait(10)
    assert [t["kind"] for t in jobs.results(first.run_id)[1]["tracks"]] == ["unexplained"]


# --- issue #169 code review: a recheck in a scan ---------------------------------------------


def _stored_scan(tmp_path: Path, runner: Any, **kw: Any) -> tuple[LiveJobs, Any, str, FakeStore]:
    """One square whose area is stored with a ``skybot:`` code (so it is rechecked)."""
    p = scan.plan_scan(180.0, 0.0, 1.5, 1.5)  # one square
    store = FakeStore()
    area_id = _plan_of(p.squares[0].box).area_id
    store.areas[area_id] = _replies(area_id, unchecked_at=180.3, missing=("skybot:1",))
    jobs = LiveJobs(
        _ctx(tmp_path, offline=False),
        runner,
        planner=kw.get("planner") or (lambda ctx, box: _plan_of(box)),
        store=store,
    )
    return jobs, p, area_id, store


@pytest.mark.parametrize("where", ["runner", "planner"])
def test_a_failed_recheck_in_a_scan_keeps_the_stored_result(tmp_path: Path, where: str) -> None:
    """Review #2: a stored square whose recheck fails (or cannot be planned) is done with its
    stored result, which is still served; the scan is done, not failed (Q-482 (3))."""

    def boom(*_: Any) -> Any:
        raise LiveAreaError("area:frames_incomplete", "a cutout failed")

    runner = boom if where == "runner" else (lambda ctx, plan, prog: None)
    planner = boom if where == "planner" else None
    jobs, p, area_id, _ = _stored_scan(tmp_path, runner, planner=planner)
    run_id = jobs.submit_scan(p, "discovery", RELEASE, stored={1: area_id})
    assert jobs.wait(10)
    run = _run(jobs, run_id)
    assert run["state"] == "done"
    sq = run["squares"][0]
    assert (sq["state"], sq["area_id"], sq.get("error")) == ("done", area_id, None)
    assert sq["missing"] == ["skybot:1"]  # the stored result still says its check failed
    assert run["totals"]["unchecked"] == 1


def test_a_scan_stopped_during_a_recheck_puts_the_square_back_to_todo(tmp_path: Path) -> None:
    """Review #2: Stop still stops the scan; the square did not finish in this run, so it is
    ``todo`` like any square not reached (its stored result is still served by the area
    routes), and the stopped recheck leaves no cooldown."""
    started, gate = threading.Event(), threading.Event()

    def runner(ctx: Context, plan: Plan, prog: Progress) -> None:
        started.set()
        gate.wait(10)
        prog.check()

    jobs, p, area_id, _ = _stored_scan(tmp_path, runner)
    run_id = jobs.submit_scan(p, "discovery", RELEASE, stored={1: area_id})
    assert started.wait(10)
    jobs.stop(run_id)
    gate.set()
    assert jobs.wait(10)
    run = _run(jobs, run_id)
    assert run["state"] == "stopped" and run["squares"][0]["state"] == "todo"
    assert not jobs.reusable(area_id)


def test_a_job_behind_a_square_that_stored_a_failed_check_is_not_computed_again(
    tmp_path: Path,
) -> None:
    """Review #1: a square's first compute stores its area with a ``skybot:`` code; a job for
    the same box queued behind it (PR #160 rule) is done at once, as ``submit`` says, since the
    first compute started the cooldown."""
    p = scan.plan_scan(180.0, 0.0, 1.5, 1.5)  # one square
    plan = _plan_of(p.squares[0].box)
    store = FakeStore()
    ran: list[str] = []

    def runner(ctx: Context, pl: Plan, prog: Progress) -> None:
        ran.append(pl.area_id)
        store.areas[pl.area_id] = _replies(pl.area_id, unchecked_at=180.3, missing=("skybot:1",))

    jobs = LiveJobs(
        _ctx(tmp_path, offline=False), runner, planner=lambda c, b: _plan_of(b), store=store
    )
    run_id = jobs.submit_scan(p, "discovery", RELEASE)
    job = jobs.submit(plan, kind="discovery")
    assert jobs.wait(10)
    assert ran == [plan.area_id]
    assert job.state == "done"
    assert _run(jobs, run_id)["state"] == "done"


def test_a_merge_read_before_an_area_is_stored_again_is_not_kept(tmp_path: Path) -> None:
    """Review #5: a merge read from the store while a job stores an area again is answered but
    not kept, so the next read merges the area's current result."""
    store = FakeStore()
    plan = _plan_of(live.snap_box(10.0, 10.0, 0.5, 0.5))
    store.areas[plan.area_id] = _replies(plan.area_id, unchecked_at=10.0)
    jobs = LiveJobs(_ctx(tmp_path), lambda ctx, pl, prog: None, store=store)
    job = jobs.submit(plan, kind="discovery")
    assert jobs.wait(10) and job.run_id is not None
    real_entry = store.entry

    def entry(area_id: str, stage: str) -> Any:
        got = real_entry(area_id, stage)
        if stage == "tracks":  # the worker stores the area again while this read goes on
            store.areas[plan.area_id] = _replies(plan.area_id, mover_at=10.0)
            jobs._forget_results()
        return got

    store.entry = entry  # type: ignore[method-assign]
    assert [t["kind"] for t in jobs.results(job.run_id)[1]["tracks"]] == ["unchecked"]
    store.entry = real_entry  # type: ignore[method-assign]
    assert [t["kind"] for t in jobs.results(job.run_id)[1]["tracks"]] == ["unexplained"]
