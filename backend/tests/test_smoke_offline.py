"""Issue #93 C2: the offline smoke check fails on render-parameter data gaps."""

from __future__ import annotations

from app.core.card.service import CATALOGUE_GAPS
from app.core.render.card_to_params import MEASURING_PREFIX
from scripts import smoke_offline
from scripts.smoke_offline import data_gaps


def test_catalogue_gaps_fail() -> None:
    assert data_gaps(["catalogue", "star_catalogue", "exoplanet_archive"], False) == [
        "catalogue",
        "star_catalogue",
        "exoplanet_archive",
    ]


def test_measuring_ids_fail() -> None:
    assert data_gaps(["measuring:spectrum", "measuring:frames"], False) == [
        "measuring:spectrum",
        "measuring:frames",
    ]


def test_spectrum_fails_only_when_frames_are_expected() -> None:
    assert data_gaps(["spectrum"], True) == ["spectrum"]
    assert data_gaps(["spectrum"], False) == []


def test_honest_layer_refusals_pass() -> None:
    assert data_gaps(["emissive", "flux_pulse", "rotation"], True) == []
    assert data_gaps([], True) == []


def test_ids_match_the_backend() -> None:
    assert smoke_offline.DATA_GAP_IDS == CATALOGUE_GAPS
    assert smoke_offline.MEASURING_PREFIX == MEASURING_PREFIX


def test_group_can_be_repeated() -> None:
    assert smoke_offline.parse_args(["--group", "test", "--group", "demo"]).group == [
        "test",
        "demo",
    ]
    assert smoke_offline.parse_args([]).group is None
