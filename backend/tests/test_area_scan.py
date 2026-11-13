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
from app.core.area.live_jobs import LiveJobs, Progress, RunConflict
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


def test_a_4_by_2_region_is_two_squares_and_3_by_3_is_four_of_1_5() -> None:
    p = scan.plan_scan(180.0, 0.0, 4.0, 2.0)
    assert (p.cols, p.rows, len(p.squares)) == (2, 1, 2)
    # 2 degree squares: padding would pass the 2 degree live cap, so that axis is not padded.
    assert {(s.box.width_deg, s.box.height_deg) for s in p.squares} == {(2.0, 2.0)}
    p = scan.plan_scan(180.0, 0.0, 3.0, 3.0)
    assert (p.cols, p.rows) == (2, 2)
    assert {(s.box.width_deg, s.box.height_deg) for s in p.squares} == {(1.6, 1.6)}  # 1.5 + 2 pads


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
    assert one.dec == two.dec and one.ra == three.ra


def test_squares_are_live_boxes_with_the_same_area_id() -> None:
    p = scan.plan_scan(91.2, 13.4, 3.0, 1.0)
    for s in p.squares:
        b = s.box
        assert live.snap_box(b.ra, b.dec, b.width_deg, b.height_deg) == b
        same = live.plan_from_times(RELEASE, live.snap_box(**b.reply()), _two_visits())
        assert _plan_of(b).area_id == same.area_id


def test_squares_cover_the_region_with_overlap() -> None:
    p = scan.plan_scan(10.0, -30.0, 5.0, 3.0)
    left, mid = p.squares[0].box, p.squares[1].box
    gap = (left.ra - mid.ra) * 0.866  # cos(30 deg): RA degrees to sky degrees
    assert gap < (left.width_deg + mid.width_deg) / 2  # neighbours overlap


@pytest.mark.parametrize(
    ("args", "code"),
    [
        ((10.0, 0.0, 12.5, 1.0), "scan:too_large"),
        ((10.0, 0.0, 1.0, 12.5), "scan:too_large"),
        ((10.0, 80.0, 2.0, 20.0), "scan:too_large"),
        ((10.0, 84.0, 2.0, 10.0), "area:bad_box"),
        ((10.0, 0.0, 0.0, 1.0), "area:bad_box"),
        ((float("inf"), 0.0, 1.0, 1.0), "area:bad_box"),
    ],
)
def test_a_bad_region_is_refused(args: tuple[float, float, float, float], code: str) -> None:
    with pytest.raises(LiveAreaError) as err:
        scan.plan_scan(*args)
    assert err.value.code == code


def test_twelve_degrees_is_thirty_six_squares() -> None:
    p = scan.plan_scan(100.0, 0.0, 12.0, 12.0)
    assert (p.cols, p.rows, len(p.squares)) == (6, 6, 36)
    assert [s.index for s in p.squares] == list(range(1, 37))


def test_the_plan_reply_without_stored_squares() -> None:
    p = scan.plan_scan(180.0, 0.0, 4.0, 2.0)
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
) -> dict[str, dict[str, Any]]:
    """Hand-made stored replies of one area: 433 Eros found at RA ``eros_at`` and an
    unexplained mover at ``mover_at`` (both on frame ``f1`` of the shared visit)."""
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
    if extra_known is not None:
        known.append(kn(extra_known, 1.0))
    return {
        "summary": {"frames": [{"visit": 1, "time": _iso(0)}, {"visit": 2, "time": _iso(90)}]},
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
    p = scan.plan_scan(180.0, 0.0, 4.0, 4.0)  # 2 x 2
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
        "squares_done": 2,
        "squares_skipped": 1,
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
    p = scan.plan_scan(180.0, 0.0, 2.0, 2.0)
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


def test_a_scan_pauses_after_its_square_and_resumes(tmp_path: Path) -> None:
    p = scan.plan_scan(180.0, 0.0, 4.0, 2.0)
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
    p = scan.plan_scan(180.0, 0.0, 6.0, 2.0)  # 3 squares
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
        {"index": 1, "box": plan.box.reply(), "area_id": plan.area_id, "state": "done"}
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


def test_an_object_in_squares_2_and_3_is_one_row() -> None:
    region = scan.plan_scan(180.0, 0.0, 6.0, 2.0).region.reply()  # 3 squares in a row
    sq = [
        runs.SquareReplies(i, f"live-00000000000{i}", **_stages(r))
        for i, r in (
            (1, _replies("a1", mover_at=181.9)),
            (2, _replies("a2", eros_at=180.0, mover_at=180.3)),
            # the same mover 10 arcsec away on the same frame, and Eros again
            (3, _replies("a3", eros_at=180.0, mover_at=180.3 + 10 / 3600)),
        )
    ]
    merged = runs.merge(region, sq)
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
    region = scan.plan_scan(180.0, 0.0, 6.0, 2.0).region.reply()
    sq = [
        runs.SquareReplies(1, "live-000000000001", **_stages(_replies("a1", mover_at=180.0))),
        runs.SquareReplies(3, "live-000000000003", **_stages(_replies("a3", mover_at=180.0))),
        runs.SquareReplies(2, "live-000000000002", **_stages(_replies("a2", mover_at=180.1))),
    ]
    merged = runs.merge(region, sq)
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


REGION = {"ra": 180.0, "dec": 0.0, "width_deg": 4.0, "height_deg": 2.0}


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
    r = client.post("/v1/scans", json={**REGION, "dec": 88.0})
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
    r = client.post(
        "/v1/areas/live",
        json={"ra": 10.0, "dec": 10.0, "width_deg": 0.5, "height_deg": 0.5, "start": True},
    )
    assert r.status_code == 202
    run_id = client.get("/v1/runs").json()["runs"][0]["run_id"]
    assert client.get(f"/v1/runs/{run_id}").json()["kind"] == "known"  # the default
    r = client.post(f"/v1/runs/{run_id}/pause")
    assert (r.status_code, r.json()["error"]) == (409, "run_not_pausable")
    assert client.delete(f"/v1/runs/{run_id}").status_code == 204


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
