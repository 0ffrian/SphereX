"""The six Horizons requests send the same parameters, in the same order, under the same cache
keys as before they shared one builder (issue #128 (3)). The expected values are written out
literally so a change to the shared helpers cannot move them; a changed key would stop matching
the recorded fixtures under ``tests/fixtures/cache/v1/horizons/``. Network blocked: a mock
transport answers."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from app.adapters import horizons
from app.adapters.http import UpstreamError
from app.cache.keys import CacheKey
from app.cache.store import UpstreamUnavailable
from app.context import Context, make_context
from tests.conftest import make_settings

WHEN = datetime(2026, 3, 20, 8, 33, 43, 200000, tzinfo=UTC)
JD = "2461119.856750"
OBS_ROW = "2026-Mar-20 08:33:43.200, , , 120.1, 10.2, 30.5, 0.1"
VEC_ROW = "2461119.856750000, A.D. 2026-Mar-20 08:34:52.3, 1.0, 2.0, 3.0, 0.1, 0.2, 0.3"


def _body(row: str) -> bytes:
    return json.dumps({"result": f"header\n$$SOE\n{row}\n$$EOE\n"}).encode()


def _ctx(tmp_path: Path, seen: list[list[tuple[str, str]]], body: bytes | None = None) -> Context:
    def handler(request: httpx.Request) -> httpx.Response:
        items = list(request.url.params.multi_items())
        seen.append(items)
        if body is not None:
            return httpx.Response(200, content=body)
        vectors = ("EPHEM_TYPE", "VECTORS") in items
        return httpx.Response(200, content=_body(VEC_ROW if vectors else OBS_ROW))

    settings = make_settings(
        tmp_path, offline=False, http_retries=0, horizons_url="https://horizons.example/api"
    )
    return make_context(settings, transport=httpx.MockTransport(handler))


def _observer(cmd: str, center: str, times: list[tuple[str, str]], q: str) -> list[tuple[str, str]]:
    return [
        ("format", "json"),
        ("COMMAND", f"'{cmd}'"),
        ("OBJ_DATA", "NO"),
        ("MAKE_EPHEM", "YES"),
        ("EPHEM_TYPE", "OBSERVER"),
        ("CENTER", f"'{center}'"),
        *times,
        ("QUANTITIES", f"'{q}'"),
        ("ANG_FORMAT", "DEG"),
        ("CSV_FORMAT", "YES"),
        ("EXTRA_PREC", "YES"),
    ]


def _vectors(cmd: str, center: str, table: str) -> list[tuple[str, str]]:
    return [
        ("format", "json"),
        ("COMMAND", f"'{cmd}'"),
        ("OBJ_DATA", "NO"),
        ("MAKE_EPHEM", "YES"),
        ("EPHEM_TYPE", "VECTORS"),
        ("CENTER", f"'{center}'"),
        ("TLIST_TYPE", "JD"),
        ("TLIST", f"'{JD}'"),
        ("VEC_TABLE", table),
        ("REF_PLANE", "FRAME"),
        ("OUT_UNITS", "AU-D"),
        ("CSV_FORMAT", "YES"),
    ]


TLIST = [("TLIST_TYPE", "JD"), ("TIME_TYPE", "UT"), ("TLIST", f"'{JD}'")]


def _key(**query: str) -> CacheKey:
    return CacheKey.make("horizons", None, **query)


def test_ephemeris_request_and_key(tmp_path: Path) -> None:
    seen: list[list[tuple[str, str]]] = []
    pts, srv = horizons.ephemeris(_ctx(tmp_path, seen), "20000433", [WHEN], center="500@-163182")
    assert seen == [_observer("DES=20000433;", "500@-163182", TLIST, "1")]
    assert srv.entry.key == _key(command="DES=20000433;", center="500@-163182", tlist=JD)
    assert [(p.ra, p.dec) for p in pts] == [(120.1, 10.2)]


def test_comet_ephemeris_keeps_its_cap_command(tmp_path: Path) -> None:
    seen: list[list[tuple[str, str]]] = []
    horizons.ephemeris(_ctx(tmp_path, seen), "1000012", [WHEN], comet=True)
    assert seen == [_observer("DES=1000012;CAP<2461119;", "500@399", TLIST, "1")]
    assert horizons.horizons_key("1000012", [JD], comet=True) == _key(
        command="DES=1000012;CAP<2461119;", center="500@399", tlist=JD
    )


def test_geometry_requests_and_keys(tmp_path: Path) -> None:
    seen: list[list[tuple[str, str]]] = []
    geo, served = horizons.geometry(_ctx(tmp_path, seen), "20000433", WHEN)
    assert seen == [
        _observer("DES=20000433;", "500@-163182", TLIST, "1,24"),
        _vectors("DES=20000433;", "500@10", "1"),
    ]
    assert [s.entry.key for s in served] == [
        _key(command="DES=20000433;", center="500@-163182", tlist=JD, quantities="1,24"),
        _key(command="DES=20000433;", center="500@10", tlist=JD, ephem_type="VECTORS"),
    ]
    assert geo.phase_angle_deg == 30.5 and geo.observer == "500@-163182"


def test_range_request_and_key(tmp_path: Path) -> None:
    seen: list[list[tuple[str, str]]] = []
    stop = datetime(2026, 3, 21, 8, 33, 43, tzinfo=UTC)
    _, srv = horizons.ephemeris_range(_ctx(tmp_path, seen), "20000433", WHEN, stop, 10)
    times = [
        ("START_TIME", "'2026-03-20 08:33:43'"),
        ("STOP_TIME", "'2026-03-21 08:33:43'"),
        ("STEP_SIZE", "'10 m'"),
        ("TIME_TYPE", "UT"),
        ("TIME_DIGITS", "FRACSEC"),
    ]
    assert seen == [_observer("DES=20000433;", "500@-163182", times, "1")]
    assert srv.entry.key == _key(
        command="DES=20000433;",
        center="500@-163182",
        start="2026-03-20 08:33:43",
        stop="2026-03-21 08:33:43",
        step="10m",
    )


def test_sigma_request_and_key(tmp_path: Path) -> None:
    seen: list[list[tuple[str, str]]] = []
    pts, srv = horizons.ephemeris_sigma(_ctx(tmp_path, seen), "20000433", [WHEN])
    assert seen == [_observer("DES=20000433;", "500@-163182", TLIST, "1,36")]
    assert srv.entry.key == _key(
        command="DES=20000433;", center="500@-163182", tlist=JD, quantities="1,36"
    )
    assert pts[0].ra_3sigma_arcsec == 30.5 and pts[0].dec_3sigma_arcsec == 0.1


def test_spherex_velocity_request_and_key(tmp_path: Path) -> None:
    seen: list[list[tuple[str, str]]] = []
    v, srv = horizons.spherex_velocity(_ctx(tmp_path, seen), WHEN)
    assert seen == [_vectors("-163182", "500@399", "2")]
    assert srv.entry.key == _key(
        command="-163182", center="500@399", tlist=JD, ephem_type="VECTORS", vec_table="2"
    )
    assert v == (0.1, 0.2, 0.3)


def test_an_empty_or_bad_answer_is_never_cached(tmp_path: Path) -> None:
    empty = _body("")
    for call in (
        lambda c: horizons.ephemeris_sigma(c, "20000433", [WHEN]),
        lambda c: horizons.spherex_velocity(c, WHEN),
    ):
        with pytest.raises((UpstreamError, UpstreamUnavailable)):
            call(_ctx(tmp_path, [], empty))
