"""Issue #142 (Q-468): Track on demand for one object, ``POST /v1/objects/{id}/track``.

Offline on the recorded 433 Eros answers (PR #53); the autouse guard blocks the network. The
window test uses fake Horizons and SIA answers so it can count every request.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.adapters import horizons, irsa_sia
from app.adapters.horizons import EphemPoint
from app.api.models import JobStatus
from app.cache.keys import CacheKey
from app.cache.store import CacheEntry, LiveResponse, Served
from app.context import Context, make_context
from app.core.area import track
from app.core.card.service import ObjectPipeline
from app.core.find import moving
from app.core.find.frames import FrameService
from app.core.find.resolver import load_object
from app.core.measure.config import DEFAULT_CONFIG, config_for
from app.core.measure.spectrum import cached_spectrum_key
from app.main import create_app
from tests.conftest import make_settings

EROS = "sbdb-20000433"
EROS_SPKID = "20000433"
# Inside the recorded visits (20 Mar 2026 00:00 to 21 Mar 12:00 UTC, the Eros targets.toml window).
VISIT = "2026-03-20T18:00:00Z"
JOB_TIMEOUT_S = 300.0
UTC0 = datetime(2026, 3, 20, tzinfo=UTC)


def _resolve(c: TestClient, q: str) -> str:
    r = c.get("/v1/resolve", params={"q": q})
    assert r.status_code == 200, r.text
    return str(r.json()["id"])


def _pipeline(c: TestClient) -> ObjectPipeline:
    pipeline = c.app.state.pipeline  # type: ignore[attr-defined]
    assert isinstance(pipeline, ObjectPipeline)
    return pipeline


def _wait(c: TestClient, object_id: str) -> None:
    job = _pipeline(c).jobs.get(object_id)
    assert job is not None
    job.wait_final(JOB_TIMEOUT_S)
    assert job.state == "done", job.snapshot()


# --- acceptance: the recorded Eros fixture ends with track_available ---------------------------


def test_a_track_job_on_the_eros_fixture_ends_with_track_available(fixture_cache: Path) -> None:
    ctx = make_context(make_settings(fixture_cache))
    with TestClient(create_app(make_settings(fixture_cache))) as c:
        assert _resolve(c, "433 Eros") == EROS
        assert not track.check(ctx, EROS).available
        r = c.post(f"/v1/objects/{EROS}/track", json={"around": VISIT})
        assert r.status_code == 202, r.text
        # The reply is the /job JSON (JobStatus), nothing more.
        snap = JobStatus.model_validate(r.json())
        assert snap.id == EROS and snap.state in ("running", "done")
        assert set(r.json()) == set(JobStatus.model_fields)
        _wait(c, EROS)
        assert c.get(f"/v1/objects/{EROS}/job").json()["state"] == "done"
        got = track.check(ctx, EROS)
        assert got.available and got.reason == "", got
        # Track reads the same entries: 16 frames, and the path of the clipped window.
        frames = c.get(f"/v1/objects/{EROS}/frames").json()
        assert len(frames["frames"]) == 16
        path = c.get(f"/v1/objects/{EROS}/path").json()
        assert path["windows"] == [
            {"start": "2026-03-20T00:00:00.000Z", "end": "2026-03-21T12:00:00.000Z"}
        ]


def test_the_saved_card_job_still_stores_a_movers_spectrum(fixture_cache: Path) -> None:
    """A mover whose card is saved: the job's saved branch stores Track's spectrum too."""
    with TestClient(create_app(make_settings(fixture_cache))) as c:
        _resolve(c, "433 Eros")
        assert c.post(f"/v1/objects/{EROS}/track", json={"around": VISIT}).status_code == 202
        _wait(c, EROS)
        pipeline = _pipeline(c)
        ctx = pipeline.ctx
        obj = load_object(ctx, EROS)
        assert obj is not None and pipeline.saved(obj) is not None  # the card is saved now
        fs = FrameService(ctx)
        try:
            fr = fs.get_frames(obj)
        finally:
            fs.close()
        key = cached_spectrum_key(ctx, obj.id, fr, config_for(obj.moving, DEFAULT_CONFIG))
        assert key is not None and ctx.cache.get(key) is not None
        ctx.cache.delete(key)
        assert not track.check(ctx, EROS).available
        assert c.post(f"/v1/objects/{EROS}/track", json={"around": VISIT}).status_code == 202
        _wait(c, EROS)
        assert ctx.cache.get(key) is not None
        assert track.check(ctx, EROS).available


# --- the request and its refusals --------------------------------------------------------------


@pytest.mark.parametrize(
    ("body", "status", "code"),
    [
        ({"around": "not a time"}, 400, "bad_request"),
        ({}, 400, "bad_request"),
        ({"around": VISIT, "days": 0}, 400, "bad_request"),
        ({"around": VISIT, "days": moving.TRACK_WINDOW_MAX_DAYS + 0.5}, 400, "bad_request"),
        ({"around": VISIT, "radius": 1}, 400, "bad_request"),
        ({"around": "2020-01-01T00:00:00Z"}, 400, "track_window_outside"),
        # Past year 1 or 9999 (an OverflowError, not a 500).
        ({"around": "0001-01-01T00:00:00Z"}, 400, "track_window_outside"),
        ({"around": "9999-12-31T23:00:00Z"}, 400, "track_window_outside"),
        ({"around": "0001-01-01T00:00:00+05:00"}, 400, "bad_request"),
    ],
)
def test_bad_requests_are_refused_and_store_nothing(
    fixture_cache: Path, body: dict[str, Any], status: int, code: str
) -> None:
    with TestClient(create_app(make_settings(fixture_cache))) as c:
        _resolve(c, "433 Eros")
        r = c.post(f"/v1/objects/{EROS}/track", json=body)
        assert r.status_code == status and r.json()["error"] == code, r.text
        assert _pipeline(c).jobs.get(EROS) is None  # no job started
        ctx = _pipeline(c).ctx
        assert ctx.cache.get(moving.track_window_key(ctx, EROS_SPKID)) is None


def test_unknown_and_fixed_objects_are_404(fixture_cache: Path) -> None:
    with TestClient(create_app(make_settings(fixture_cache))) as c:
        r = c.post("/v1/objects/sbdb-99999999/track", json={"around": VISIT})
        assert r.status_code == 404 and r.json()["error"] == "not_found"
        sid = _resolve(c, "SIMP J013656.5+093347.3")
        r = c.post(f"/v1/objects/{sid}/track", json={"around": VISIT})
        assert r.status_code == 404 and r.json()["error"] == "not_moving"


def test_a_repeated_request_leaves_the_record_untouched(fixture_cache: Path) -> None:
    with TestClient(create_app(make_settings(fixture_cache))) as c:
        _resolve(c, "433 Eros")
        ctx = _pipeline(c).ctx
        key = moving.track_window_key(ctx, EROS_SPKID)
        assert c.post(f"/v1/objects/{EROS}/track", json={"around": VISIT}).status_code == 202
        _wait(c, EROS)
        first = ctx.cache.get(key)
        assert first is not None
        assert c.post(f"/v1/objects/{EROS}/track", json={"around": VISIT}).status_code == 202
        _wait(c, EROS)
        again = ctx.cache.get(key)
        assert again is not None and again.meta == first.meta and again.body == first.body


# --- the window record --------------------------------------------------------------------------


def _w(a_h: float, b_h: float) -> moving.Window:
    return UTC0 + timedelta(hours=a_h), UTC0 + timedelta(hours=b_h)


def test_windows_merge_and_clip() -> None:
    assert moving.merge_windows([_w(5, 8), _w(0, 2), _w(1, 3), _w(3, 4)]) == (_w(0, 4), _w(5, 8))
    base = (_w(0, 10), _w(20, 30))
    assert moving.clip_windows(base, (_w(-5, 25),)) == (_w(0, 10), _w(20, 25))
    assert moving.clip_windows(base, (_w(10, 20),)) == ()  # a touch is not an overlap
    assert moving.track_window(UTC0, 3) == (UTC0 - timedelta(days=3), UTC0 + timedelta(days=3))


def _release_ctx(tmp_path: Path) -> Context:
    """An object with no targets.toml windows: its base window is the release window."""
    return make_context(
        make_settings(
            tmp_path / "cache",
            moving_window_start="2026-03-01T00:00:00Z",
            moving_window_end="2026-04-01T00:00:00Z",
        )
    )


def test_the_record_is_the_union_and_does_not_depend_on_order(tmp_path: Path) -> None:
    a, b = _w(0, 24), _w(48, 72)

    def run(root: Path, order: list[moving.Window]) -> bytes:
        ctx = _release_ctx(root)
        for w in order:
            assert moving.add_track_window(ctx, "999", w) is not None
        entry = ctx.cache.get(moving.track_window_key(ctx, "999"))
        assert entry is not None
        return entry.body

    assert run(tmp_path / "1", [a, b]) == run(tmp_path / "2", [b, a])
    ctx = _release_ctx(tmp_path / "1")
    assert moving.requested_windows(ctx, "999") == (a, b)
    assert moving.MovingConfig.from_context(ctx, "999").windows == (a, b)
    # Another object keeps the release window.
    other = moving.MovingConfig.from_context(ctx, "998").windows
    assert other == ((datetime(2026, 3, 1, tzinfo=UTC), datetime(2026, 4, 1, tzinfo=UTC)),)


def test_the_window_is_clipped_to_the_targets_own_windows(fixture_cache: Path) -> None:
    ctx = make_context(make_settings(fixture_cache))
    base = moving.base_windows(ctx, EROS_SPKID)
    assert moving.add_track_window(ctx, EROS_SPKID, _w(30, 100)) == (
        (UTC0 + timedelta(hours=30), base[0][1]),
    )
    assert moving.MovingConfig.from_context(ctx, EROS_SPKID).windows == (
        (UTC0 + timedelta(hours=30), base[0][1]),
    )
    assert moving.add_track_window(ctx, EROS_SPKID, _w(-500, -400)) is None  # outside: refused


def test_a_sub_millisecond_window_reads_back_equal_and_is_not_rewritten(tmp_path: Path) -> None:
    """The record keeps milliseconds: a window with microseconds is truncated before it is
    stored, so a repeated request finds the same union and leaves the entry untouched."""
    ctx = _release_ctx(tmp_path)
    w = moving.track_window(UTC0 + timedelta(days=5, microseconds=123_456), 0.1234567)
    assert w[0].microsecond % 1000 == 0 and w[1].microsecond % 1000 == 0
    assert moving.add_track_window(ctx, "999", w) == (w,)
    key = moving.track_window_key(ctx, "999")
    first = ctx.cache.get(key)
    assert first is not None and moving.requested_windows(ctx, "999") == (w,)
    assert moving.add_track_window(ctx, "999", w) == (w,)
    again = ctx.cache.get(key)
    assert again is not None and again.meta == first.meta


def test_a_bad_record_is_ignored(tmp_path: Path) -> None:
    ctx = _release_ctx(tmp_path)
    key = moving.track_window_key(ctx, "999")
    ctx.cache.put(key, LiveResponse(b'{"windows": [["x", "y"]]}', "t", 200, "application/json"))
    assert moving.requested_windows(ctx, "999") == ()
    assert moving.MovingConfig.from_context(ctx, "999").windows == moving.base_windows(ctx, "999")


# --- acceptance: the path search asks only for cones inside the window -------------------------

RATE_DEG_H = 0.02  # fake mover: RA grows linearly with time, so a cone's RA gives its time
RA0 = 100.0
T0 = datetime(2026, 3, 1, tzinfo=UTC)


def _ra_at(t: datetime) -> float:
    return RA0 + RATE_DEG_H * (t - T0).total_seconds() / 3600.0


def _time_of(ra: float) -> datetime:
    return T0 + timedelta(hours=(ra - RA0) / RATE_DEG_H)


def _served() -> Served:
    key = CacheKey.make("fake", "-", q="x")
    return Served(CacheEntry(key, b"", {"fetched_at": "2026-11-13T00:00:00Z"}), from_cache=True)


def test_the_path_search_uses_only_cones_inside_the_window(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ranges: list[tuple[datetime, datetime]] = []
    cones: list[datetime] = []

    def fake_range(
        ctx: Context, spkid: str, start: datetime, stop: datetime, step_min: int, **_: Any
    ) -> tuple[list[EphemPoint], Served]:
        ranges.append((start, stop))
        n = int((stop - start).total_seconds() // (step_min * 60))
        times = [start + timedelta(minutes=step_min * i) for i in range(n + 1)]
        return [EphemPoint(t, _ra_at(t), 0.0) for t in times], _served()

    def fake_cone(ctx: Context, ra: float, dec: float, **_: Any) -> irsa_sia.SiaResult:
        cones.append(_time_of(ra))
        return irsa_sia.SiaResult([], False, _served())

    monkeypatch.setattr(horizons, "ephemeris_range", fake_range)
    monkeypatch.setattr(irsa_sia, "search", fake_cone)

    ctx = _release_ctx(tmp_path)
    around = datetime(2026, 3, 15, 12, tzinfo=UTC)
    lo, hi = moving.track_window(around, moving.TRACK_WINDOW_DAYS)
    assert moving.add_track_window(ctx, "999", (lo, hi)) == ((lo, hi),)
    result = moving.search_path(ctx, "999")
    assert result.cones == len(cones) > 0
    slack = timedelta(seconds=1)  # the RA -> time inversion's float error
    assert all(lo - slack <= t <= hi + slack for t in cones), (min(cones), max(cones))
    assert ranges and all(lo <= a and b <= hi for a, b in ranges)

    # Without the record the same object searches the whole release window.
    ranges.clear()
    cones.clear()
    ctx.cache.delete(moving.track_window_key(ctx, "999"))
    moving.search_path(ctx, "999")
    assert min(cones) < lo - timedelta(days=1) and max(cones) > hi + timedelta(days=1)
