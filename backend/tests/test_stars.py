"""Star list for movers (issue #95, A19.6, Q-143, Q-403): adapter keys, the library and its
refusals, offline. ``/overlays`` for movers is tested in ``test_overlays.py``."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.adapters import gaia, wise

# Every Gaia and CatWISE cone recorded before issue #95, with its stored digest. The default keys
# must not change, or the recorded fixed-target cones stop hitting (plan v2, row 24).
RECORDED_GAIA = {
    (
        76.95659,
        30.40129,
        0.07917,
    ): "0674379845000f07853ea66d32a43f91e91019ba50b30cf69f4720c7db2ba735",
    (
        331.09664,
        -56.80066,
        0.07944,
    ): "61570637c15dcbc91253d85a4965f7e07fac2262277a98ced2a571cbfc108573",
    (
        248.16723,
        66.75502,
        0.07917,
    ): "6caa00ac8590a2be644d271d58f755940ca9432a2cd5c9d49c31da485a036960",
    (
        269.44627,
        4.76820,
        0.07972,
    ): "9679915e6485d2306e9947a659a640414a9f2e578dbf6fa0784c291a9e15c0db",
    (
        133.75976,
        -7.24219,
        0.08000,
    ): "9f48ed0d8bfc55e28723dd2b98ccd0d29bd17497e555a4ee32a542f75982eaf7",
}
RECORDED_WISE = {
    (
        269.44627,
        4.76820,
        0.07972,
    ): "8457628f8de19c1dd7ca29432f18f09000cbdd6548e5940799692b3b2c49e1dd",
    (
        133.75976,
        -7.24219,
        0.08000,
    ): "a609602caee188b531e42e173771dd6255481df5c286e9d0db97c35d23f1f72e",
    (
        331.09664,
        -56.80066,
        0.07944,
    ): "abc02f394a52ef5d8533c77095fdf768ce05b42817a0597ffc4aaa2e79a9d19a",
    (
        248.16723,
        66.75502,
        0.07917,
    ): "ba464a0c936f42e57f761204b9958bd97e84c3850a49af49d6c9e771a2aa082c",
    (
        76.95659,
        30.40129,
        0.07917,
    ): "c7c89344fb722f40f6f22218023ef125671892d01307cecabbcc2de756614676",
}


# --- Adapter keys and queries ------------------------------------------------------------------


@pytest.mark.parametrize(("cone", "digest"), sorted(RECORDED_GAIA.items()))
def test_gaia_default_key_is_unchanged(cone: tuple[float, float, float], digest: str) -> None:
    assert gaia.gaia_key(*cone).digest == digest
    assert gaia.gaia_key(*cone, max_rows=gaia.MAX_ROWS).digest == digest


@pytest.mark.parametrize(("cone", "digest"), sorted(RECORDED_WISE.items()))
def test_wise_default_key_is_unchanged(cone: tuple[float, float, float], digest: str) -> None:
    assert wise.wise_key(*cone).digest == digest
    assert wise.wise_key(*cone, w1_lt=None, max_rows=wise.MAX_ROWS).digest == digest


def test_options_change_the_keys() -> None:
    cone = (90.75032, 13.55949, 0.08361)
    assert wise.wise_key(*cone, w1_lt=16.5).canonical() == (
        '{"query":{"dec":"13.55949","ra":"90.75032","radius":"0.08361","top":"5000",'
        '"w1_lt":"16.50"},"release":"catwise2020","source":"wise"}'
    )
    assert wise.wise_key(*cone, w1_lt=16.5).digest != wise.wise_key(*cone).digest
    assert dict(gaia.gaia_key(*cone, max_rows=50000).query)["top"] == "50000"
    assert dict(wise.wise_key(*cone, max_rows=50000).query)["top"] == "50000"


class _Captured(Exception):
    pass


def _capture_adql(monkeypatch: pytest.MonkeyPatch, module: Any) -> list[str]:
    """Run ``module.cone`` until its live call and keep the ADQL it would send (no network)."""
    seen: list[str] = []

    def fake_query_csv(ctx: Any, mirrors: Any, adql: Any, *a: Any, **kw: Any) -> Any:
        seen.append(adql(mirrors[0][1]))
        raise _Captured

    monkeypatch.setattr(module.tap, "query_csv", fake_query_csv)
    return seen


def _ctx() -> Any:
    """A context whose cache always calls ``live`` (the patched TAP call above)."""

    class _Cache:
        def fetch(self, key: Any, live: Any, refresh: bool = False) -> Any:
            return live()

    settings = SimpleNamespace(
        gaia_mirrors=[("u", "gaia_dr3_source")], wise_tap_url="u", catalog_read_timeout_s=1.0
    )
    return SimpleNamespace(settings=settings, cache=_Cache())


def test_wise_adql_adds_the_w1_cut_only_when_asked(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = _capture_adql(monkeypatch, wise)
    with pytest.raises(_Captured):
        wise.cone(_ctx(), 90.75032, 13.55949, 0.08361, w1_lt=16.5)
    with pytest.raises(_Captured):
        wise.cone(_ctx(), 90.75032, 13.55949, 0.08361)
    with pytest.raises(_Captured):
        wise.cone(_ctx(), 90.75032, 13.55949, 0.62083, w1_lt=16.5, max_rows=50000)
    assert "AND w1mpro_pm < 16.50 ORDER BY w1mpro_pm, source_name" in seen[0]
    assert seen[0].startswith("SELECT TOP 5000 ")
    assert "w1mpro_pm <" not in seen[1]
    assert seen[2].startswith("SELECT TOP 50000 ")


def test_gaia_adql_row_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = _capture_adql(monkeypatch, gaia)
    with pytest.raises(_Captured):
        gaia.cone(_ctx(), 90.75032, 13.55949, 0.62083, max_rows=50000)
    assert seen[0].startswith("SELECT TOP 50000 ")
    assert "AND phot_g_mean_mag < 20.00 ORDER BY" in seen[0]
