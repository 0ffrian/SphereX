"""D-19 resolver order, run offline on recorded SIMBAD / SBDB / Horizons answers."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.cache.store import CacheMissOffline
from app.context import make_context
from app.core.find.ids import BadQuery, looks_like_small_body
from app.core.find.resolver import NotFound, load_aliases, load_object, resolve
from tests.conftest import TARGETS_FILE, make_settings


@pytest.mark.parametrize(
    "name", ["433 Eros", "433", "2024 AB", "2024 AB12", "C/2025 N1", "3I/ATLAS", "1P/Halley"]
)
def test_small_body_shapes_go_to_sbdb_first(name: str) -> None:
    assert looks_like_small_body(name)


@pytest.mark.parametrize(
    "name", ["Barnard's star", "R Dra", "eps Ind B", "WISE 0855", "RW Aur", "2MASS J0523-1403"]
)
def test_other_names_go_to_simbad_first(name: str) -> None:
    assert not looks_like_small_body(name)


def test_routing_order_is_observable(fixture_cache: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core.find import resolver as r

    ctx = make_context(make_settings(fixture_cache))
    order: list[str] = []
    real_simbad, real_sbdb = r._from_simbad, r._from_sbdb

    def spy_simbad(c, n, refresh=False):  # type: ignore[no-untyped-def]
        order.append("simbad")
        return real_simbad(c, n, refresh)

    def spy_sbdb(c, n, refresh=False, **kw):  # type: ignore[no-untyped-def]
        order.append("sbdb")
        return real_sbdb(c, n, refresh, **kw)

    monkeypatch.setattr(r, "_from_simbad", spy_simbad)
    monkeypatch.setattr(r, "_from_sbdb", spy_sbdb)
    resolve(ctx, "433 Eros", {})
    assert order == ["sbdb"]
    order.clear()
    resolve(ctx, "R Dra", {})
    assert order == ["simbad"]


def test_simbad_target_resolves_with_pm(fixture_cache: Path) -> None:
    ctx = make_context(make_settings(fixture_cache))
    res = resolve(ctx, "Barnard's star", {})
    obj = res.obj
    assert obj.id == "simbad-name-barnard-s-star"
    assert obj.resolver == "simbad" and not obj.moving
    assert obj.pm_dec_mas_yr is not None and obj.pm_dec_mas_yr > 10000
    assert obj.provenance["ra"]["tag"] == "measured"
    assert res.cached_at is not None
    assert load_object(ctx, obj.id) == obj  # registry written


def test_alias_maps_short_name(fixture_cache: Path) -> None:
    ctx = make_context(make_settings(fixture_cache))
    aliases = load_aliases(TARGETS_FILE)
    assert aliases["wise 0855"] == "WISE J085510.83-071442.5"
    assert resolve(ctx, "WISE 0855", aliases).obj.name == "WISEA J085510.74-071442.5"


def test_small_body_is_moving_with_model_dependent_position(fixture_cache: Path) -> None:
    ctx = make_context(make_settings(fixture_cache))
    obj = resolve(ctx, "433 Eros", {}).obj
    assert obj.id == "sbdb-20000433" and obj.moving and obj.resolver == "sbdb"
    assert obj.provenance["ra"]["tag"] == "model_dependent"
    assert "Horizons" in obj.provenance["ra"]["assumption"]
    assert obj.epoch == "2026-11-14T00:00:00.000Z"


def test_coordinates_skip_name_resolution(tmp_path: Path) -> None:
    ctx = make_context(make_settings(tmp_path))  # empty cache, offline: no lookup possible
    obj = resolve(ctx, "269.452, 4.6933", {}).obj
    assert obj.resolver == "coords" and obj.id == "radec-269.45200+4.69330"


def test_offline_name_not_cached_refuses(tmp_path: Path) -> None:
    ctx = make_context(make_settings(tmp_path))
    with pytest.raises(CacheMissOffline):
        resolve(ctx, "Vega", {})


def test_bad_coordinates(tmp_path: Path) -> None:
    ctx = make_context(make_settings(tmp_path))
    with pytest.raises(BadQuery):
        resolve(ctx, "400, 95", {})


def test_both_services_miss_is_not_found(
    fixture_cache: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.core.find import resolver as r

    ctx = make_context(make_settings(fixture_cache))
    monkeypatch.setattr(r, "_from_simbad", lambda c, n, r=False: (None, []))
    monkeypatch.setattr(r, "_from_sbdb", lambda c, n, r=False, **kw: (None, [], False))
    with pytest.raises(NotFound):
        resolve(ctx, "Nothing At All", {})
