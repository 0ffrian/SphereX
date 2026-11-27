"""The V36 injection-count simulation (A22.10.2): its fit and its determinism."""

import numpy as np
import pytest

from scripts import sim_injection_count
from scripts.sim_injection_count import CURVES, Curve, draw, fit, simulate, table


@pytest.mark.parametrize("curve", CURVES, ids=lambda c: c.name)
def test_fit_recovers_the_true_curve_on_a_large_sample(curve: Curve) -> None:
    x, y = draw(curve, 100_000, np.random.default_rng(1))
    x50, width, plateau = fit(x, y, np.ones((1, len(x))))[0]
    assert x50 == pytest.approx(curve.x50, abs=0.005)
    assert width == pytest.approx(curve.width, rel=0.05)
    assert plateau == pytest.approx(curve.plateau, abs=0.005)


def test_same_seed_gives_the_same_result() -> None:
    first = simulate(CURVES[0], 150, repeats=3, bootstraps=50)
    assert first == simulate(CURVES[0], 150, repeats=3, bootstraps=50)
    assert first != simulate(CURVES[0], 150, repeats=3, bootstraps=50, seed=1)


def test_more_injections_give_a_narrower_band() -> None:
    few = simulate(CURVES[0], 150, repeats=20, bootstraps=200)
    middle = simulate(CURVES[0], 300, repeats=20, bootstraps=200)
    many = simulate(CURVES[0], 1500, repeats=20, bootstraps=200)
    assert many.midpoint_median < middle.midpoint_median < few.midpoint_median
    assert many.target_median < middle.target_median < few.target_median


def test_table_row_matches_the_golden_output(monkeypatch: pytest.MonkeyPatch) -> None:
    """Guards the A22.14 table: if this changes, regenerate the table in the doc too."""
    monkeypatch.setattr(sim_injection_count, "CURVES", CURVES[:1])
    monkeypatch.setattr(sim_injection_count, "COUNTS", (150,))
    assert table(repeats=2, bootstraps=20).splitlines()[-1] == (
        "| spec example (1.02, 0.11, 0.94) | 150 | 0.111 / 0.117 | 1.00 | 0.069 / 0.085 | 0.50 |"
    )
