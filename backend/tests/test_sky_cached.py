"""``GET /v1/sky/cached``: positions whose frame list is complete in the derived cache."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.cache.store import LiveResponse, ReadThroughCache
from app.context import Context, make_context
from app.core.find.frames import frames_key
from app.core.find.ids import coord_id
from app.core.find.resolver import ResolvedObject, registry_key, save_object
from app.main import create_app
from app.settings import Settings
from tests.conftest import make_settings

CACHED_AT = "2026-11-07T10:00:00Z"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return make_settings(tmp_path / "cache")


@pytest.fixture
def ctx(settings: Settings) -> Context:
    return make_context(settings)


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as c:
        yield c


def store_frames(ctx: Context, object_id: str, n: int, **key_overrides: Any) -> None:
    """A stored frame list as ``FrameService._store`` writes it (records shortened: the endpoint
    only counts them)."""
    doc = {
        "frames": [{"frame_id": f"f{i}"} for i in range(n)],
        "missing": [],
        "sources_earliest_fetched_at": CACHED_AT,
    }
    c = ctx
    if key_overrides:
        c = make_context(ctx.settings.model_copy(update=key_overrides))
    c.cache.put(
        frames_key(c, object_id),
        LiveResponse(json.dumps(doc).encode(), "derived:frames", 200, "application/json"),
    )


def simbad_object(slug: str, ra: float, dec: float, *, moving: bool = False) -> ResolvedObject:
    src = {"tag": "measured", "source": f"SIMBAD {slug}, ICRS epoch J2000"}
    return ResolvedObject(
        id=f"simbad-{slug}",
        name=slug.upper(),
        ra=ra,
        dec=dec,
        moving=moving,
        resolver="simbad",
        provenance={"ra": src, "dec": src},
        query=f"query {slug}",
    )


def test_empty_cache_lists_nothing(client: TestClient) -> None:
    r = client.get("/v1/sky/cached")
    assert r.status_code == 200
    body = r.json()
    assert body["objects"] == []
    assert body["data_release"] == "spherex_qr2"
    assert body["provenance"]["frames"]["tag"] == "derived"
    assert body["provenance"]["frames"]["formula"]


def test_lists_a_named_object_and_a_coordinate_spot(client: TestClient, ctx: Context) -> None:
    obj = simbad_object("twa-27", 181.889, -39.548)
    save_object(ctx, obj, [])
    store_frames(ctx, obj.id, 12)
    spot = coord_id(285.78828, 4.982152)
    store_frames(ctx, spot, 5)

    objects = client.get("/v1/sky/cached").json()["objects"]
    assert [o["id"] for o in objects] == sorted([obj.id, spot])
    named = next(o for o in objects if o["id"] == obj.id)
    assert named == {
        "id": obj.id,
        "name": "TWA-27",
        "query": "query twa-27",
        "ra": 181.889,
        "dec": -39.548,
        "resolver": "simbad",
        "frames": 12,
        "provenance": {"ra": obj.provenance["ra"], "dec": obj.provenance["dec"]},
    }
    coords = next(o for o in objects if o["id"] == spot)
    # The position is the one the id encodes (5 decimals), tagged as typed coordinates (Q-25).
    assert (coords["ra"], coords["dec"]) == (285.78828, 4.98215)
    assert coords["name"] is None and coords["query"] is None
    assert coords["resolver"] == "coords" and coords["frames"] == 5
    assert coords["provenance"]["ra"]["tag"] == "derived"


def test_skips_entries_it_cannot_place_or_use(client: TestClient, ctx: Context) -> None:
    save_object(ctx, simbad_object("empty", 10.0, 10.0), [])
    store_frames(ctx, "simbad-empty", 0)  # complete, but nothing to show
    store_frames(ctx, "simbad-unregistered", 4)  # no registry entry: no position
    mover = simbad_object("mover", 20.0, 20.0, moving=True)
    save_object(ctx, mover, [])
    store_frames(ctx, mover.id, 4)
    other = simbad_object("other-size", 30.0, 30.0)
    save_object(ctx, other, [])
    store_frames(ctx, other.id, 4, cutout_size_arcsec=120.0)  # made with other settings
    assert client.get("/v1/sky/cached").json()["objects"] == []


def test_another_data_release_is_not_listed(client: TestClient, ctx: Context) -> None:
    obj = simbad_object("qr1", 40.0, 40.0)
    save_object(ctx, obj, [])
    store_frames(ctx, obj.id, 3, data_release="spherex_qr1")
    assert client.get("/v1/sky/cached").json()["objects"] == []


def test_corrupt_or_torn_entries_are_skipped_not_a_500(client: TestClient, ctx: Context) -> None:
    good = simbad_object("good", 50.0, 50.0)
    save_object(ctx, good, [])
    store_frames(ctx, good.id, 2)
    bad = simbad_object("bad", 60.0, 60.0)
    save_object(ctx, bad, [])
    store_frames(ctx, bad.id, 2)
    torn = simbad_object("torn", 70.0, 70.0)
    save_object(ctx, torn, [])
    store_frames(ctx, torn.id, 2)

    cache: ReadThroughCache = ctx.cache
    bad_meta = cache._paths(frames_key(ctx, bad.id))[1]
    bad_meta.write_text("{not json", encoding="utf-8")
    torn_body = cache._paths(frames_key(ctx, torn.id))[0]
    torn_body.write_bytes(b'{"frames": []')  # body no longer matches its SHA-256
    # A stray file in the folder is ignored too.
    (bad_meta.parent / "stray.json").write_text("[]", encoding="utf-8")

    objects = client.get("/v1/sky/cached").json()["objects"]
    assert [o["id"] for o in objects] == [good.id]


def test_a_registry_entry_of_another_shape_is_skipped_not_a_500(
    client: TestClient, ctx: Context
) -> None:
    good = simbad_object("fine", 80.0, 10.0)
    save_object(ctx, good, [])
    store_frames(ctx, good.id, 2)
    odd_id = "simbad-odd"
    store_frames(ctx, odd_id, 2)
    # Intact on disk (its SHA-256 matches), but not a ResolvedObject: an unknown field.
    body = json.dumps({"object": {"id": odd_id, "not_a_field": 1}}).encode()
    ctx.cache.put(
        registry_key(odd_id), LiveResponse(body, "derived:resolve", 200, "application/json")
    )
    no_object = "simbad-no-object"
    store_frames(ctx, no_object, 2)
    ctx.cache.put(
        registry_key(no_object),
        LiveResponse(b'{"sources": []}', "derived:resolve", 200, "application/json"),
    )

    r = client.get("/v1/sky/cached")
    assert r.status_code == 200
    assert [o["id"] for o in r.json()["objects"]] == [good.id]


def test_never_calls_upstream(tmp_path: Path) -> None:
    # Online settings: the endpoint still reads only the cache (the network guard would raise).
    s = make_settings(tmp_path / "cache", offline=False)
    with TestClient(create_app(s)) as c:
        assert c.get("/v1/sky/cached").status_code == 200
