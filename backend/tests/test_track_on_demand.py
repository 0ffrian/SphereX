"""Issue #142 (Q-468): Track on demand for one object, ``POST /v1/objects/{id}/track``.

The window is a parameter of each call (``around``/``days``), never stored: readers without it,
the card and the areas keep the base windows (PR #150 review, blocking 1 and 2).

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
from app.cache.store import CacheEntry, Served
from app.context import Context, make_context
from app.core.area import track
from app.core.card import service as card_service
from app.core.card.service import ObjectPipeline, track_job_key
from app.core.find import moving
from app.core.find.frames import FrameService
from app.core.find.resolver import load_object
from app.core.measure.config import DEFAULT_CONFIG, config_for
from app.core.measure.spectrum import cached_spectrum_key
from app.main import create_app
from app.timefmt import parse_utc
from tests.conftest import make_settings

EROS = "sbdb-20000433"
EROS_SPKID = "20000433"
# Inside the recorded visits (20 Mar 2026 00:00 to 21 Mar 12:00 UTC, the Eros targets.toml window).
VISIT = "2026-03-20T18:00:00Z"
# A window that cuts the Eros window: [20 Mar 12:00, 22 Mar 12:00] clipped to [20 Mar 12:00,
# 21 Mar 12:00]. Its Horizons ranges are not in the fixture, so offline it cannot be filled.
LATE = "2026-03-21T12:00:00Z"
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


def _window(around: str, days: float = moving.TRACK_WINDOW_DAYS) -> moving.Window:
    return moving.track_window(parse_utc(around), days)


def _wait_track(c: TestClient, object_id: str, window: moving.Window) -> track.TrackCheck:
    job = _pipeline(c).track_jobs.get(track_job_key(object_id, window))
    assert job is not None
    got = job.wait_final(JOB_TIMEOUT_S)
    assert job.state == "done" and got is not None, job.snapshot()
    return got


# --- acceptance: the recorded Eros fixture ends with track_available ---------------------------


def test_a_track_job_on_the_eros_fixture_ends_with_track_available(fixture_cache: Path) -> None:
    ctx = make_context(make_settings(fixture_cache))
    w = _window(VISIT)
    with TestClient(create_app(make_settings(fixture_cache))) as c:
        assert _resolve(c, "433 Eros") == EROS
        assert not track.check(ctx, EROS, window=w).available
        r = c.post(f"/v1/objects/{EROS}/track", json={"around": VISIT})
        assert r.status_code == 202, r.text
        snap = JobStatus.model_validate(r.json())
        assert snap.id == EROS and snap.state in ("running", "done")
        assert snap.track_window == ["2026-03-17T18:00:00.000Z", "2026-03-23T18:00:00.000Z"]
        assert _wait_track(c, EROS, w).available
        assert _pipeline(c).jobs.get(EROS) is None  # no card job: Track builds no card

        q = {"around": VISIT}
        job = c.get(f"/v1/objects/{EROS}/job", params=q).json()
        assert job["state"] == "done" and job["track_available"] is True, job
        assert job["reason"] is None and job["id"] == EROS
        events = c.get(f"/v1/objects/{EROS}/job/events", params=q).text
        assert '"track_available": true' in events
        got = track.check(ctx, EROS, window=w)
        assert got.available and got.reason == "", got

        # The Track readers with the same parameters read the window's entries.
        frames = c.get(f"/v1/objects/{EROS}/frames", params=q).json()
        assert len(frames["frames"]) == 16
        assert frames["track_window"] == snap.track_window
        assert all("around=" in f["cutout_url"] for f in frames["frames"])
        png = c.get(frames["frames"][0]["cutout_url"])
        assert png.status_code == 200 and png.headers["content-type"] == "image/png"
        path = c.get(f"/v1/objects/{EROS}/path", params=q).json()
        assert path["windows"] == [
            {"start": "2026-03-20T00:00:00.000Z", "end": "2026-03-21T12:00:00.000Z"}
        ]
        spectrum = c.get(f"/v1/objects/{EROS}/spectrum", params=q).json()
        assert spectrum["track_window"] == snap.track_window and spectrum["spectrum"]
        overlays = c.get(f"/v1/objects/{EROS}/overlays", params=q)
        assert overlays.status_code == 200, overlays.text


def test_the_saved_card_job_still_stores_a_movers_spectrum(fixture_cache: Path) -> None:
    """A mover whose card is saved: the object job's saved branch stores the spectrum too, so
    the base-window Track (areas, Q-461) can become available."""
    with TestClient(create_app(make_settings(fixture_cache))) as c:
        _resolve(c, "433 Eros")
        pipeline = _pipeline(c)
        ctx = pipeline.ctx
        obj = load_object(ctx, EROS)
        assert obj is not None
        pipeline.ensure_job(obj).wait_final(JOB_TIMEOUT_S)
        assert pipeline.saved(obj) is not None  # the card is saved now
        fs = FrameService(ctx)
        try:
            fr = fs.get_frames(obj)
        finally:
            fs.close()
        key = cached_spectrum_key(ctx, obj.id, fr, config_for(obj.moving, DEFAULT_CONFIG))
        assert key is not None and ctx.cache.get(key) is not None
        ctx.cache.delete(key)
        assert not track.check(ctx, EROS).available
        pipeline.ensure_job(obj, restart_finished=True).wait_final(JOB_TIMEOUT_S)
        assert ctx.cache.get(key) is not None
        assert track.check(ctx, EROS).available


# --- PR #150 review: a request never changes what other callers read ---------------------------


def _base_replies(c: TestClient) -> tuple[Any, Any, Any]:
    frames = c.get(f"/v1/objects/{EROS}/frames").json()
    frames.pop("cached_at", None)
    return frames, c.get(f"/v1/objects/{EROS}/path").json(), track.check(_pipeline(c).ctx, EROS)


def test_a_narrow_first_request_leaves_every_other_reader_alone(fixture_cache: Path) -> None:
    """Blocking 1: the narrowest window allowed, posted first on an empty job registry, changes
    nothing for a reader without ``around`` (frames, path, ``track.check``, the area input)."""
    with TestClient(create_app(make_settings(fixture_cache))) as c:
        _resolve(c, "433 Eros")
        before = _base_replies(c)
        assert len(before[0]["frames"]) == 16
        body = {"around": LATE, "days": moving.TRACK_WINDOW_MIN_DAYS}
        r = c.post(f"/v1/objects/{EROS}/track", json=body)
        assert r.status_code == 202, r.text
        w = _window(LATE, moving.TRACK_WINDOW_MIN_DAYS)
        got = _wait_track(c, EROS, w)
        # Offline, this window's Horizons ranges are not cached: refused honestly, not guessed.
        assert not got.available and got.reason, got
        job = c.get(f"/v1/objects/{EROS}/job", params=body).json()
        assert job["track_available"] is False and job["reason"] == got.reason
        assert _base_replies(c) == before


def test_track_builds_no_card_and_the_card_key_has_no_window(fixture_cache: Path) -> None:
    """Blocking 2: the Track job saves no asset, so no card can carry a window's spectrum."""
    with TestClient(create_app(make_settings(fixture_cache))) as c:
        _resolve(c, "433 Eros")
        pipeline = _pipeline(c)
        obj = load_object(pipeline.ctx, EROS)
        assert obj is not None
        assert c.post(f"/v1/objects/{EROS}/track", json={"around": VISIT}).status_code == 202
        _wait_track(c, EROS, _window(VISIT))
        assert pipeline.jobs.get(EROS) is None
        assert all(f.prebuilt for f in pipeline.assets.layers(EROS))  # nothing generated


def test_two_windows_have_two_jobs(fixture_cache: Path) -> None:
    with TestClient(create_app(make_settings(fixture_cache))) as c:
        _resolve(c, "433 Eros")
        a = c.post(f"/v1/objects/{EROS}/track", json={"around": VISIT}).json()
        b = c.post(f"/v1/objects/{EROS}/track", json={"around": LATE, "days": 1}).json()
        assert a["track_window"] != b["track_window"]
        _wait_track(c, EROS, _window(VISIT))
        _wait_track(c, EROS, _window(LATE, 1))


def test_too_many_running_track_jobs_answer_429(
    fixture_cache: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(card_service, "MAX_TRACK_JOBS", 0)
    with TestClient(create_app(make_settings(fixture_cache))) as c:
        _resolve(c, "433 Eros")
        r = c.post(f"/v1/objects/{EROS}/track", json={"around": VISIT})
        assert r.status_code == 429 and r.json()["error"] == "queue_full", r.text


# --- the request and its refusals --------------------------------------------------------------


@pytest.mark.parametrize(
    ("body", "status", "code"),
    [
        ({"around": "not a time"}, 400, "bad_request"),
        ({}, 400, "bad_request"),
        ({"around": VISIT, "days": 0}, 400, "bad_request"),
        ({"around": VISIT, "days": 0.0001}, 400, "bad_request"),  # under the 1-day minimum
        ({"around": VISIT, "days": moving.TRACK_WINDOW_MAX_DAYS + 0.5}, 400, "bad_request"),
        ({"around": VISIT, "days": True}, 400, "bad_request"),  # strict: no bool
        ({"around": VISIT, "days": "3"}, 400, "bad_request"),  # strict: no string
        ({"around": VISIT, "radius": 1}, 400, "bad_request"),
        ({"around": "2020-01-01T00:00:00Z"}, 400, "track_window_outside"),
        # Past year 1 or 9999 (an OverflowError, not a 500).
        ({"around": "0001-01-01T00:00:00Z"}, 400, "track_window_outside"),
        ({"around": "9999-12-31T23:00:00Z"}, 400, "track_window_outside"),
        ({"around": "0001-01-01T00:00:00+05:00"}, 400, "bad_request"),
    ],
)
def test_bad_requests_are_refused_and_start_nothing(
    fixture_cache: Path, body: dict[str, Any], status: int, code: str
) -> None:
    with TestClient(create_app(make_settings(fixture_cache))) as c:
        _resolve(c, "433 Eros")
        r = c.post(f"/v1/objects/{EROS}/track", json=body)
        assert r.status_code == status and r.json()["error"] == code, r.text
        pipeline = _pipeline(c)
        assert pipeline.jobs.get(EROS) is None
        assert pipeline.track_jobs.get(track_job_key(EROS, _window(VISIT))) is None


def test_an_integer_days_is_accepted(fixture_cache: Path) -> None:
    with TestClient(create_app(make_settings(fixture_cache))) as c:
        _resolve(c, "433 Eros")
        r = c.post(f"/v1/objects/{EROS}/track", json={"around": VISIT, "days": 3})
        assert r.status_code == 202, r.text
        _wait_track(c, EROS, _window(VISIT))


def test_unknown_and_fixed_objects_are_404(fixture_cache: Path) -> None:
    with TestClient(create_app(make_settings(fixture_cache))) as c:
        r = c.post("/v1/objects/sbdb-99999999/track", json={"around": VISIT})
        assert r.status_code == 404 and r.json()["error"] == "not_found"
        sid = _resolve(c, "SIMP J013656.5+093347.3")
        r = c.post(f"/v1/objects/{sid}/track", json={"around": VISIT})
        assert r.status_code == 404 and r.json()["error"] == "not_moving"
        r = c.get(f"/v1/objects/{sid}/frames", params={"around": VISIT})
        assert r.status_code == 404 and r.json()["error"] == "not_moving"


@pytest.mark.parametrize("route", ["frames", "path", "spectrum", "job", "overlays"])
def test_the_readers_check_the_window_parameters(fixture_cache: Path, route: str) -> None:
    with TestClient(create_app(make_settings(fixture_cache))) as c:
        _resolve(c, "433 Eros")
        url = f"/v1/objects/{EROS}/{route}"
        r = c.get(url, params={"days": 3})
        assert r.status_code == 400 and r.json()["error"] == "bad_request", r.text
        r = c.get(url, params={"around": VISIT, "days": 0.5})
        assert r.status_code == 400 and r.json()["error"] == "bad_request", r.text
        r = c.get(url, params={"around": "2020-01-01T00:00:00Z"})
        assert r.status_code == 400 and r.json()["error"] == "track_window_outside", r.text


def test_a_job_with_no_track_job_is_idle(fixture_cache: Path) -> None:
    with TestClient(create_app(make_settings(fixture_cache))) as c:
        _resolve(c, "433 Eros")
        r = c.get(f"/v1/objects/{EROS}/job", params={"around": VISIT})
        assert r.json() == {
            "id": EROS,
            "state": "idle",
            "track_window": ["2026-03-17T18:00:00.000Z", "2026-03-23T18:00:00.000Z"],
        }


# --- the window ---------------------------------------------------------------------------------


def _w(a_h: float, b_h: float) -> moving.Window:
    return UTC0 + timedelta(hours=a_h), UTC0 + timedelta(hours=b_h)


def test_windows_clip() -> None:
    base = (_w(0, 10), _w(20, 30))
    assert moving.clip_windows(base, (_w(-5, 25),)) == (_w(0, 10), _w(20, 25))
    assert moving.clip_windows(base, (_w(10, 20),)) == ()  # a touch is not an overlap
    assert moving.track_window(UTC0, 3) == (UTC0 - timedelta(days=3), UTC0 + timedelta(days=3))
    w = moving.track_window(UTC0 + timedelta(microseconds=123_456), 1.0000001)
    assert w[0].microsecond % 1000 == 0 and w[1].microsecond % 1000 == 0


def _release_ctx(tmp_path: Path) -> Context:
    """An object with no targets.toml windows: its base window is the release window."""
    return make_context(
        make_settings(
            tmp_path / "cache",
            moving_window_start="2026-03-01T00:00:00Z",
            moving_window_end="2026-04-01T00:00:00Z",
        )
    )


def test_the_window_is_clipped_and_only_where_asked(fixture_cache: Path, tmp_path: Path) -> None:
    ctx = make_context(make_settings(fixture_cache))
    base = moving.base_windows(ctx, EROS_SPKID)
    clipped = ((UTC0 + timedelta(hours=30), base[0][1]),)
    assert moving.track_windows(ctx, EROS_SPKID, _w(30, 100)) == clipped
    assert moving.MovingConfig.from_context(ctx, EROS_SPKID, _w(30, 100)).windows == clipped
    assert moving.MovingConfig.from_context(ctx, EROS_SPKID).windows == base  # no window: base
    assert moving.track_windows(ctx, EROS_SPKID, _w(-500, -400)) == ()
    rel = _release_ctx(tmp_path)
    release = ((datetime(2026, 3, 1, tzinfo=UTC), datetime(2026, 4, 1, tzinfo=UTC)),)
    assert moving.MovingConfig.from_context(rel, "999").windows == release


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
    cfg = moving.MovingConfig.from_context(ctx, "999", (lo, hi))
    assert cfg.windows == ((lo, hi),)
    result = moving.search_path(ctx, "999", cfg=cfg)
    assert result.cones == len(cones) > 0
    slack = timedelta(seconds=1)  # the RA -> time inversion's float error
    assert all(lo - slack <= t <= hi + slack for t in cones), (min(cones), max(cones))
    assert ranges and all(lo <= a and b <= hi for a, b in ranges)

    # Without the window the same object searches the whole release window.
    ranges.clear()
    cones.clear()
    moving.search_path(ctx, "999")
    assert min(cones) < lo - timedelta(days=1) and max(cones) > hi + timedelta(days=1)


def test_an_empty_window_list_is_refused_not_searched(tmp_path: Path) -> None:
    ctx = _release_ctx(tmp_path)
    cfg = moving.MovingConfig.from_context(ctx, "999", _w(-9000, -8000))
    assert cfg.windows == ()
    assert moving.search_path(ctx, "999", cfg=cfg).missing == [moving.WINDOW]
