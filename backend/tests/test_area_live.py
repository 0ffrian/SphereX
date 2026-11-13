"""Issue #141 (Q-462, Q-463): live areas. The box rules, the visit pair, the job queue, the
``/v1/areas/live`` routes, the store across releases, and one job end to end on the recorded
Eros frames (offline; the autouse guard blocks the network)."""

from __future__ import annotations

import threading
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api import areas as areas_api
from app.cache.store import CacheMissOffline, UpstreamUnavailable
from app.context import Context, make_context
from app.core.area import clean as area_clean
from app.core.area import frames as area_frames
from app.core.area import live
from app.core.area.live import Box, LiveAreaError, Plan
from app.core.area.live_jobs import LiveJobs, Progress, run_live_area
from app.core.card.validate import check
from app.main import create_app
from app.timefmt import parse_utc
from tests.area_recorded import EROS_AREA, recorded_frames, recorded_star_cones
from tests.conftest import make_settings

T0 = datetime(2026, 6, 12, 11, 11, tzinfo=UTC)


def _times(start: datetime, n: int, step_min: float = 2.15) -> list[datetime]:
    return [start + timedelta(minutes=step_min * i) for i in range(n)]


def _three_visits() -> list[datetime]:
    """Visit A at T0, B 1.5 h after A ends, C 8 h later (too far to pair with B)."""
    a = _times(T0, 4)
    b = _times(a[-1] + timedelta(hours=1.5), 4)
    c = _times(b[-1] + timedelta(hours=8), 4)
    return a + b + c


# --- box ----------------------------------------------------------------------------------


def test_the_box_is_snapped_to_the_grid() -> None:
    b = live.snap_box(180.013, -0.032, 1.04, 0.611)
    assert b == Box(180.0, -0.05, 1.05, 0.6)
    assert live.snap_box(359.99, 10.0, 0.01, 2.0) == Box(0.0, 10.0, 0.05, 2.0)


@pytest.mark.parametrize(
    ("args", "code"),
    [
        ((10.0, 10.0, 2.2, 1.0), "area:too_large"),
        ((10.0, 10.0, 0.0, 1.0), "area:bad_box"),
        ((10.0, 95.0, 1.0, 1.0), "area:bad_box"),
        ((10.0, 88.8, 1.0, 1.0), "area:bad_box"),
        ((float("nan"), 0.0, 1.0, 1.0), "area:bad_box"),
    ],
)
def test_a_bad_box_is_refused(args: tuple[float, float, float, float], code: str) -> None:
    with pytest.raises(LiveAreaError) as err:
        live.snap_box(*args)
    assert err.value.code == code


# --- visits and the plan ------------------------------------------------------------------


def test_the_closest_visit_pair_within_six_hours_is_chosen() -> None:
    box = live.snap_box(180.0, 0.0, 1.0, 0.6)
    plan = live.plan_from_times("spherex_dr1", box, _three_visits())
    a, b = plan.visits
    assert (a.start, a.n_frames, b.n_frames) == (T0, 4, 4)
    assert round(live.gap_hours(a, b), 2) == 1.5
    assert plan.alternatives == ()  # B to C is 8 h apart
    assert plan.n_frames == 8
    assert plan.area_id.startswith("live-") and len(plan.area_id) == 17
    # The same box and visits: the same id. Another box: another id.
    assert live.plan_from_times("spherex_dr1", box, _three_visits()).area_id == plan.area_id
    other = live.snap_box(180.2, 0.0, 1.0, 0.6)
    assert live.plan_from_times("spherex_dr1", other, _three_visits()).area_id != plan.area_id


def test_a_visit_pair_can_be_picked_and_ties_go_to_the_earliest() -> None:
    a = _times(T0, 3)
    b = _times(a[-1] + timedelta(hours=2), 3)
    c = _times(b[-1] + timedelta(hours=2), 3)
    box = live.snap_box(10.0, 10.0, 0.5, 0.5)
    plan = live.plan_from_times("spherex_dr1", box, a + b + c)
    assert plan.visits[0].start == a[0]  # tie: earliest
    assert [p[0].start for p in plan.alternatives] == [b[0]]
    picked = live.plan_from_times("spherex_dr1", box, a + b + c, pair=(b[0], c[0]))
    assert picked.visits[0].start == b[0] and picked.area_id != plan.area_id
    with pytest.raises(LiveAreaError) as err:
        live.plan_from_times("spherex_dr1", box, a + b + c, pair=(a[0], c[0]))
    assert err.value.code == "area:no_visit_pair"


def test_no_pair_within_six_hours_is_refused() -> None:
    times = _times(T0, 4) + _times(T0 + timedelta(hours=9), 4)
    with pytest.raises(LiveAreaError) as err:
        live.plan_from_times("spherex_dr1", live.snap_box(1.0, 1.0, 1.0, 1.0), times)
    assert err.value.code == "area:no_visit_pair"


def test_the_plan_reply_and_spec() -> None:
    box = live.snap_box(180.0, 0.0, 1.0, 0.6)
    plan = live.plan_from_times("spherex_dr1", box, _three_visits())
    reply = plan.reply()
    check(reply, "area-live-plan.schema.json")
    assert reply["estimate_s"] == 540 + 360
    spec = plan.spec()
    assert spec.id == plan.area_id and spec.data_release == "spherex_dr1"
    assert [w[0] for w in spec.windows] == [v.start - timedelta(minutes=5) for v in plan.visits]


# --- the job queue ------------------------------------------------------------------------


def _plan(n: int = 0) -> Plan:
    box = live.snap_box(10.0 + n, 10.0, 0.5, 0.5)
    return live.plan_from_times("spherex_qr2", box, _three_visits())


def _ctx(tmp_path: Path, **kw: Any) -> Context:
    return make_context(make_settings(tmp_path / "cache", **kw))


def test_a_job_runs_its_steps_and_finishes(tmp_path: Path) -> None:
    seen: list[str] = []

    def runner(ctx: Context, plan: Plan, p: Progress) -> None:
        for s in ("frames", "dots", "labels", "join", "known"):
            p.step(s)
            seen.append(s)
        p.count(3, 5)

    jobs = LiveJobs(_ctx(tmp_path), runner)
    job = jobs.submit(_plan())
    assert jobs.wait(10)
    reply = jobs.reply(job)
    check(reply, "area-job.schema.json")
    assert reply["state"] == "done" and reply["eta_s"] is None
    assert [s["state"] for s in reply["steps"]] == ["done"] * 6
    assert seen == ["frames", "dots", "labels", "join", "known"]
    assert jobs.submit(_plan()) is not job  # done here means the store lost it: run again
    assert jobs.wait(10)


def test_jobs_queue_one_at_a_time_and_can_be_stopped(tmp_path: Path) -> None:
    gate = threading.Event()
    started = threading.Event()

    def runner(ctx: Context, plan: Plan, p: Progress) -> None:
        p.step("frames")
        started.set()
        while not gate.wait(0.01):
            p.check()

    jobs = LiveJobs(_ctx(tmp_path), runner)
    first, second, third = (jobs.submit(_plan(i)) for i in range(3))
    assert started.wait(5)
    r1, r2, r3 = (jobs.reply(j) for j in (first, second, third))
    assert r1["state"] == "running" and r1["step"] == "frames"
    assert (r2["state"], r2["queue_position"]) == ("queued", 1)
    assert r3["queue_position"] == 2 and r3["eta_s"] > r2["eta_s"]
    assert jobs.cancel(second.area_id)  # queued: dropped at once
    assert jobs.reply(second)["error"]["code"] == "cancelled"
    assert jobs.cancel(first.area_id)  # running: stops at its next check
    for _ in range(500):
        if jobs.reply(first)["state"] == "failed":
            break
        threading.Event().wait(0.01)
    gate.set()
    assert jobs.wait(10)
    assert jobs.reply(first)["error"]["code"] == "cancelled"
    assert jobs.reply(third)["state"] == "done"
    assert not jobs.cancel(third.area_id)


@pytest.mark.parametrize(
    ("exc", "code"),
    [
        (LiveAreaError("area:no_dots", "none"), "area:no_dots"),
        (CacheMissOffline("x"), "offline"),
        (UpstreamUnavailable("x"), "upstream_unavailable"),
        (RuntimeError("boom"), "internal"),
    ],
)
def test_a_failed_job_says_why(tmp_path: Path, exc: Exception, code: str) -> None:
    def runner(ctx: Context, plan: Plan, p: Progress) -> None:
        raise exc

    jobs = LiveJobs(_ctx(tmp_path), runner)
    job = jobs.submit(_plan())
    assert jobs.wait(10)
    reply = jobs.reply(job)
    check(reply, "area-job.schema.json")
    assert reply["state"] == "failed" and reply["error"]["code"] == code
    assert jobs.submit(_plan()) is not job  # a failed job can be asked for again


# --- the routes ---------------------------------------------------------------------------


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Any:
    def fake_plan(ctx: Context, box: Box, *, pair: Any = None) -> Plan:
        return live.plan_from_times(ctx.settings.data_release, box, _three_visits(), pair=pair)

    monkeypatch.setattr(areas_api, "plan_area", fake_plan)
    app = create_app(make_settings(tmp_path / "cache", offline=False))
    with TestClient(app) as c:
        app.state.live_jobs = LiveJobs(app.state.ctx, lambda ctx, plan, p: p.step("known"))
        yield c


BOX = {"ra": 180.0, "dec": 0.0, "width_deg": 1.0, "height_deg": 0.6}


def test_post_without_start_answers_the_plan(client: TestClient) -> None:
    r = client.post("/v1/areas/live", json=BOX)
    assert r.status_code == 200
    body = r.json()
    check(body, "area-live-plan.schema.json")
    assert body["box"] == BOX and len(body["visits"]) == 2


def test_post_with_start_queues_a_job_then_get_and_delete(client: TestClient) -> None:
    r = client.post("/v1/areas/live", json={**BOX, "start": True})
    assert r.status_code == 202
    area_id = r.json()["area_id"]
    client.app.state.live_jobs.wait(10)  # type: ignore[attr-defined]
    got = client.get(f"/v1/areas/live/{area_id}")
    assert got.status_code == 200 and got.json()["state"] == "done"
    check(got.json(), "area-job.schema.json")
    assert client.delete(f"/v1/areas/live/{area_id}").status_code == 404  # done: nothing to stop
    assert client.get("/v1/areas/live/live-000000000000").status_code == 404


def test_bad_requests(client: TestClient) -> None:
    r = client.post("/v1/areas/live", json={**BOX, "width_deg": 2.5})
    assert (r.status_code, r.json()["error"]) == (422, "area:too_large")
    r = client.post("/v1/areas/live", json={**BOX, "visits": ["not a time", "x"]})
    assert (r.status_code, r.json()["error"]) == (422, "area:bad_box")
    assert client.delete("/v1/areas/live/nope").status_code == 404


def test_offline_refuses_to_start_a_job(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def offline_plan(ctx: Context, box: Box, *, pair: Any = None) -> Plan:
        raise CacheMissOffline("no SIA answer cached")

    monkeypatch.setattr(areas_api, "plan_area", offline_plan)
    with TestClient(create_app(make_settings(tmp_path / "cache"))) as c:
        r = c.post("/v1/areas/live", json={**BOX, "start": True})
    assert (r.status_code, r.json()["error"]) == (503, "offline")


def test_the_qr2_eros_pack_is_served_on_a_dr1_server(tmp_path: Path) -> None:
    """Q-463: the store reads every release present, the running one first."""
    settings = make_settings(tmp_path / "cache", data_release="spherex_dr1")
    with TestClient(create_app(settings)) as c:
        index = c.get("/v1/areas").json()
        assert "eros-2026-03" in {a["area_id"] for a in index["areas"]}
        assert c.get("/v1/areas/eros-2026-03/known").status_code == 200


# --- one job end to end, on the recorded Eros frames --------------------------------------


def test_a_live_job_runs_the_pipeline_and_its_area_is_served(
    fixture_cache: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The real ``run_live_area`` with only the frame search replaced by the recorded Eros
    frames (and their recorded star cones): the stored area is then served by the area routes
    under its live id, with 433 Eros in the Known list."""
    frames, bodies = recorded_frames()
    times = sorted(parse_utc(f.time) for f in frames.frames)
    a, b = live.group_visits(times, 1.0)
    box = Box(EROS_AREA.ra, EROS_AREA.dec, EROS_AREA.width_deg, EROS_AREA.height_deg)
    # The recorded visits are about a day apart, beyond the 6 h rule, so the plan is built from
    # them directly: this test is about running the pipeline in a job, not the visit choice.
    plan = Plan(live.area_id("spherex_qr2", box, (a, b)), "spherex_qr2", box, (a, b), ())

    def recorded_find(ctx: Context, spec: Any, cfg: Any, **_: Any) -> Any:
        return replace(frames, spec=spec), bodies

    monkeypatch.setattr(area_frames, "find_frames", recorded_find)
    monkeypatch.setattr(area_clean, "star_cones", lambda _frames: recorded_star_cones())
    settings = make_settings(fixture_cache)
    ctx = make_context(settings)
    steps: list[str] = []

    class Spy(Progress):
        def step(self, name: str) -> None:
            steps.append(name)

        def count(self, done: int, total: int | None = None) -> None:
            pass

        def check(self) -> None:
            pass

    run_live_area(ctx, plan, Spy.__new__(Spy))
    assert steps == ["frames", "dots", "labels", "join", "known"]
    with TestClient(create_app(settings)) as c:
        assert c.get(f"/v1/areas/live/{plan.area_id}").json()["state"] == "done"
        known = c.get(f"/v1/areas/{plan.area_id}/known").json()
        assert "433 Eros" in {k["designation"] for k in known["known"]}
        # The job stored the spectrum check after the area (Q-474), one entry per track.
        spectra = c.get(f"/v1/areas/{plan.area_id}/spectra")
        assert spectra.status_code == 200, spectra.text
        tracks = c.get(f"/v1/areas/{plan.area_id}/tracks").json()["tracks"]
        assert [t["track_id"] for t in spectra.json()["tracks"]] == [t["track_id"] for t in tracks]
        # The same box again: answered done at once from the store, nothing queued (#141).
        monkeypatch.setattr(areas_api, "plan_area", lambda ctx, box, pair=None: plan)
        again = c.post("/v1/areas/live", json={**box.reply(), "start": True})
        assert again.status_code == 200 and again.json()["state"] == "done"
        assert again.json()["area_id"] == plan.area_id
        assert c.app.state.live_jobs.get(plan.area_id) is None  # type: ignore[attr-defined]


# --- review follow-ups: stopping mid-download, refusals, the routes ------------------------


def test_a_stopped_job_is_replaced_by_a_fresh_one(tmp_path: Path) -> None:
    gate = threading.Event()
    started = threading.Event()

    def runner(ctx: Context, plan: Plan, p: Progress) -> None:
        p.step("frames")
        started.set()
        gate.wait(5)  # winding down: no check until the gate opens

    jobs = LiveJobs(_ctx(tmp_path), runner)
    first = jobs.submit(_plan())
    assert started.wait(5)
    assert jobs.cancel(first.area_id) and not first.active
    second = jobs.submit(_plan())  # the same area while the first is still winding down
    assert second is not first and second.state == "queued"
    gate.set()
    assert jobs.wait(10)
    assert first.state == "done" and second.state == "done"  # first passed no check after DELETE


def _job_progress(plan: Plan) -> tuple[Any, Progress]:
    from app.core.area.live_jobs import Job

    job = Job(plan)
    job.state = "running"
    return job, Progress(job, threading.Lock())


def test_a_stop_reaches_the_cutout_download(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``run_live_area``'s own fetch counts cutouts and raises ``Cancelled`` once stopped."""
    from app.core.area.live_jobs import Cancelled

    calls: list[int] = []

    def fake_live_fetch(ctx: Context, **_: Any) -> Any:
        return lambda row, cut: ("digest", b"body")

    def find(ctx: Context, spec: Any, cfg: Any, *, fetch: Any, **_: Any) -> Any:
        fetch("row", "cut")
        calls.append(1)
        job.cancel.set()
        fetch("row", "cut")  # stopped: raises
        calls.append(2)
        raise AssertionError("not reached")

    monkeypatch.setattr(area_frames, "live_fetch", fake_live_fetch)
    monkeypatch.setattr(area_frames, "find_frames", find)
    plan = _plan()
    job, progress = _job_progress(plan)
    with pytest.raises(Cancelled):
        run_live_area(_ctx(tmp_path), plan, progress)
    assert calls == [1]
    assert job.steps["frames"].done == 1 and job.steps["frames"].total == plan.n_frames


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ({"complete": False, "missing": ("frames:cone_failed:1",)}, "area:frames_incomplete"),
        ({"missing": ("frames:cone_maxrec:2",)}, "area:frames_incomplete"),
        ("no_bodies", "area:no_cutouts"),
        ("no_dots", "area:no_dots"),
    ],
)
def test_run_live_area_refuses_what_must_not_be_stored(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, change: Any, code: str
) -> None:
    from app.core.area import dots as area_dots

    frames, bodies = recorded_frames()
    out_frames = replace(frames, **change) if isinstance(change, dict) else frames
    out_bodies = {} if change == "no_bodies" else bodies
    monkeypatch.setattr(
        area_frames, "find_frames", lambda ctx, spec, cfg, **_: (out_frames, out_bodies)
    )
    if change == "no_dots":
        monkeypatch.setattr(area_dots, "run_dots", lambda *a, **k: [])
    plan = _plan()
    _, progress = _job_progress(plan)
    with pytest.raises(LiveAreaError) as err:
        run_live_area(_ctx(tmp_path), plan, progress)
    assert err.value.code == code


def test_the_routes_refuse_no_visit_pair(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def lonely(ctx: Context, box: Box, *, pair: Any = None) -> Plan:
        return live.plan_from_times("spherex_dr1", box, _times(T0, 4))

    monkeypatch.setattr(areas_api, "plan_area", lonely)
    with TestClient(create_app(make_settings(tmp_path / "cache", offline=False))) as c:
        r = c.post("/v1/areas/live", json=BOX)
    assert (r.status_code, r.json()["error"]) == (422, "area:no_visit_pair")


def test_the_same_box_twice_joins_the_same_job(client: TestClient) -> None:
    gate = threading.Event()

    def slow(ctx: Context, plan: Plan, p: Progress) -> None:
        p.step("frames")
        gate.wait(5)

    client.app.state.live_jobs = LiveJobs(client.app.state.ctx, slow)  # type: ignore[attr-defined]
    first = client.post("/v1/areas/live", json={**BOX, "start": True})
    again = client.post("/v1/areas/live", json={**BOX, "start": False})
    assert first.status_code == 202 and again.status_code == 200
    assert again.json()["area_id"] == first.json()["area_id"]
    assert again.json()["state"] in ("queued", "running")
    gate.set()
    client.app.state.live_jobs.wait(10)  # type: ignore[attr-defined]


# --- PR #147 review: queue cap, a crash never stalls the queue, pruning, eta -------------


class _Boom(BaseException):
    """Not an ``Exception``: the worker must still mark the job failed and go on."""


def test_a_base_exception_fails_one_job_and_the_queue_goes_on(tmp_path: Path) -> None:
    def runner(ctx: Context, plan: Plan, p: Progress) -> None:
        if plan.box.ra == 10.0:
            raise _Boom()
        p.step("known")

    jobs = LiveJobs(_ctx(tmp_path), runner)
    bad, good = jobs.submit(_plan(0)), jobs.submit(_plan(1))
    assert jobs.wait(10)
    assert jobs.reply(bad)["error"]["code"] == "internal"
    assert jobs.reply(good)["state"] == "done"  # the queued job ran: the worker went on
    again = jobs.submit(_plan(2))  # and a later submit starts a worker again
    assert jobs.wait(10) and again.state == "done"


def test_the_queue_is_capped(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core.area import live_jobs

    gate = threading.Event()
    started = threading.Event()

    def runner(ctx: Context, plan: Plan, p: Progress) -> None:
        started.set()
        gate.wait(5)

    monkeypatch.setattr(live_jobs, "MAX_WAITING", 2)
    jobs = LiveJobs(_ctx(tmp_path), runner)
    jobs.submit(_plan(0))
    assert started.wait(5)
    jobs.submit(_plan(1))
    jobs.submit(_plan(2))
    with pytest.raises(live_jobs.QueueFull):
        jobs.submit(_plan(3))
    assert jobs.submit(_plan(1)).state == "queued"  # joining a waiting job is still fine
    gate.set()
    assert jobs.wait(10)


def test_old_finished_jobs_are_forgotten(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core.area import live_jobs

    monkeypatch.setattr(live_jobs, "MAX_FINISHED", 2)
    jobs = LiveJobs(_ctx(tmp_path), lambda ctx, plan, p: None)
    first = jobs.submit(_plan(0))
    assert jobs.wait(10)
    for i in (1, 2, 3):
        jobs.submit(_plan(i))
        assert jobs.wait(10)
    assert jobs.get(first.area_id) is None
    assert jobs.get(_plan(3).area_id) is not None


def test_a_waiting_job_counts_a_stopped_job_still_winding_down(tmp_path: Path) -> None:
    gate = threading.Event()
    started = threading.Event()

    def runner(ctx: Context, plan: Plan, p: Progress) -> None:
        started.set()
        gate.wait(5)

    jobs = LiveJobs(_ctx(tmp_path), runner)
    first = jobs.submit(_plan(0))
    assert started.wait(5)
    jobs.cancel(first.area_id)
    fresh = jobs.submit(_plan(0))  # replaces the winding-down job in the job list
    reply = jobs.reply(fresh)
    assert reply["queue_position"] == 1
    assert reply["eta_s"] > fresh.plan.estimate_s()  # the stopping job is still counted
    gate.set()
    assert jobs.wait(10)


def test_a_full_queue_answers_429(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core.area import live_jobs

    def full(plan: Plan) -> Any:
        raise live_jobs.QueueFull()

    monkeypatch.setattr(client.app.state.live_jobs, "submit", full)  # type: ignore[attr-defined]
    r = client.post("/v1/areas/live", json={**BOX, "start": True})
    assert (r.status_code, r.json()["error"]) == (429, "queue_full")
