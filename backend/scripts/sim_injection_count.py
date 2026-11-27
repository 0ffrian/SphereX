"""How many injections does a 3-parameter completeness curve need? (V36, A22.10.2, R-29)

    uv run python -m scripts.sim_injection_count        # prints the table in A22.14

A true curve is chosen, ``N`` found-or-missed injections are drawn from it, the curve is fitted by
binomial maximum likelihood and bootstrapped, and this is repeated. The curve is

    completeness = plateau / (1 + exp(-(log10(S/N) - x50) / width))

A band width is the 84th minus the 16th percentile of the bootstrap curves, in completeness units,
read at the true midpoint (half the plateau) and where the true completeness is 0.90.

Assumptions (not fixed by the spec):

- The true curve is the A22.10.4 example, plus a steeper, a shallower and a higher-plateau one.
- 80% of injections are uniform within 3 widths of the midpoint (the rise) and 20% uniform from
  3 to 6 widths above it (the plateau).

Limit: the injections are placed using the true midpoint and width. A real calibration only has an
estimate of them, so its bands are likely wider than these.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

Array = npt.NDArray[np.float64]

SEED = 36
COUNTS = (150, 200, 300, 500)
REPEATS = 200
BOOTSTRAPS = 1000
RISE_SHARE = 0.8
TARGET = 0.90

WIDTH_BOUNDS = (0.005, 2.0)
PLATEAU_BOUNDS = (0.01, 1.0)


@dataclass(frozen=True)
class Curve:
    name: str
    x50: float
    width: float
    plateau: float


CURVES = (
    Curve("spec example", 1.02, 0.11, 0.94),
    Curve("steeper", 1.02, 0.06, 0.94),
    Curve("shallower", 1.02, 0.20, 0.94),
    Curve("higher plateau", 1.02, 0.11, 0.99),
)


def completeness(x: Array, theta: Array) -> Array:
    """Curve values at ``x`` (N,) for parameters ``theta`` (B, 3) = x50, width, plateau."""
    x50, width, plateau = theta[:, 0:1], theta[:, 1:2], theta[:, 2:3]
    z = np.clip((x - x50) / width, -50.0, 50.0)
    out: Array = plateau / (1.0 + np.exp(-z))
    return out


def draw(curve: Curve, n: int, rng: np.random.Generator) -> tuple[Array, Array]:
    """``n`` injections: their log10 S/N and whether each was recovered (1.0) or not (0.0)."""
    n_rise = round(RISE_SHARE * n)
    lo, mid, hi = (curve.x50 + k * curve.width for k in (-3.0, 3.0, 6.0))
    x = np.concatenate([rng.uniform(lo, mid, n_rise), rng.uniform(mid, hi, n - n_rise)])
    truth = np.array([[curve.x50, curve.width, curve.plateau]])
    y = (rng.random(n) < completeness(x, truth)[0]).astype(np.float64)
    return x, y


def _log_likelihood(x: Array, y: Array, w: Array, theta: Array) -> Array:
    p = np.clip(completeness(x, theta), 1e-10, 1.0 - 1e-10)
    out: Array = np.sum(w * (y * np.log(p) + (1.0 - y) * np.log1p(-p)), axis=1)
    return out


def _start(x: Array, y: Array, w: Array) -> Array:
    """Best point of a coarse grid for each row of weights; it never looks at the true curve."""
    # Fixed starting widths spanning the true widths in CURVES (0.06 to 0.20); the fit itself may
    # move anywhere inside WIDTH_BOUNDS, which is far wider on purpose.
    grid = np.array(
        [
            (x50, width, plateau)
            for x50 in np.quantile(x, np.linspace(0.05, 0.95, 13))
            for width in (0.03, 0.06, 0.12, 0.25)
            for plateau in (0.7, 0.85, 0.95, 0.995)
        ]
    )
    p = np.clip(completeness(x, grid), 1e-10, 1.0 - 1e-10)
    scores = (w * y) @ np.log(p).T + (w * (1.0 - y)) @ np.log1p(-p).T
    out: Array = grid[np.argmax(scores, axis=1)]
    return out


def fit(x: Array, y: Array, w: Array, iterations: int = 60) -> Array:
    """Binomial maximum likelihood, one fit per row of weights ``w`` (B, N). Returns (B, 3).

    Damped Fisher scoring inside the bounds, all rows at once; a row stops once a step no longer
    moves it.
    """
    lower = np.array([x.min() - 0.5, WIDTH_BOUNDS[0], PLATEAU_BOUNDS[0]])
    upper = np.array([x.max() + 0.5, WIDTH_BOUNDS[1], PLATEAU_BOUNDS[1]])
    theta = np.clip(_start(x, y, w), lower, upper)
    score = _log_likelihood(x, y, w, theta)
    damping = np.full(len(w), 1e-3)
    rows = np.arange(len(w))
    for _ in range(iterations):
        at, wr = theta[rows], w[rows]
        z = np.clip((x - at[:, 0:1]) / at[:, 1:2], -50.0, 50.0)
        s = 1.0 / (1.0 + np.exp(-z))
        p = np.clip(at[:, 2:3] * s, 1e-10, 1.0 - 1e-10)
        slope = at[:, 2:3] * s * (1.0 - s) / at[:, 1:2]
        jac = np.stack([-slope, -slope * z, s], axis=2)
        variance = p * (1.0 - p)
        grad = np.einsum("bn,bnk->bk", wr * (y - p) / variance, jac)
        info = np.matmul((jac * (wr / variance)[:, :, None]).transpose(0, 2, 1), jac)
        # A parameter sitting on a bound and pushing outwards is held there for this step.
        held = ((at <= lower) & (grad < 0)) | ((at >= upper) & (grad > 0))
        grad = np.where(held, 0.0, grad)
        free = ~held
        info = info * (free[:, :, None] & free[:, None, :])
        diagonal = np.einsum("bkk->bk", info)
        ridge = damping[rows, None] * (diagonal + 1.0) + held
        step = np.linalg.solve(info + ridge[:, :, None] * np.eye(3), grad[:, :, None])[:, :, 0]
        trial = np.clip(at + step, lower, upper)
        trial_score = _log_likelihood(x, y, wr, trial)
        better = trial_score > score[rows]
        theta[rows] = np.where(better[:, None], trial, at)
        score[rows] = np.where(better, trial_score, score[rows])
        damping[rows] = np.clip(
            np.where(better, damping[rows] / 3.0, damping[rows] * 5.0), 1e-9, 1e9
        )
        rows = rows[np.abs(trial - at).max(axis=1) > 1e-5]
        if rows.size == 0:
            break
    return theta


@dataclass(frozen=True)
class Result:
    midpoint_median: float
    midpoint_p90: float
    midpoint_coverage: float
    target_median: float
    target_p90: float
    target_coverage: float


def simulate(curve: Curve, n: int, repeats: int, bootstraps: int, seed: int = SEED) -> Result:
    """Band widths over ``repeats`` independent sets of ``n`` injections.

    ``coverage`` is the share of repeats whose 16 to 84% band holds the true value (nominally 0.68).
    """
    share = TARGET / curve.plateau
    x_target = curve.x50 + curve.width * np.log(share / (1.0 - share))
    at = np.array([curve.x50, x_target])
    truth = np.array([curve.plateau / 2.0, TARGET])
    widths = np.empty((repeats, 2))
    holds = np.empty((repeats, 2))
    key = [seed, *(round(v * 1000) for v in (curve.x50, curve.width, curve.plateau)), n]
    for r in range(repeats):
        rng = np.random.default_rng([*key, r])
        x, y = draw(curve, n, rng)
        # Resampling the injections with replacement, written as how often each one is picked.
        w = rng.multinomial(n, np.full(n, 1.0 / n), size=bootstraps).astype(np.float64)
        lo, hi = np.quantile(completeness(at, fit(x, y, w)), [0.16, 0.84], axis=0)
        widths[r] = hi - lo
        holds[r] = (lo <= truth) & (truth <= hi)
    median = np.median(widths, axis=0)
    p90 = np.quantile(widths, 0.9, axis=0)
    coverage = holds.mean(axis=0)
    return Result(
        float(median[0]),
        float(p90[0]),
        float(coverage[0]),
        float(median[1]),
        float(p90[1]),
        float(coverage[1]),
    )


def table(repeats: int = REPEATS, bootstraps: int = BOOTSTRAPS) -> str:
    lines = [
        "| True curve (x50, width, plateau) | Injections | Band at midpoint: median / "
        "90th percentile | Holds truth | Band at 0.90: median / 90th percentile | Holds truth |",
        "|---|---|---|---|---|---|",
    ]
    for curve in CURVES:
        for n in COUNTS:
            res = simulate(curve, n, repeats, bootstraps)
            lines.append(
                f"| {curve.name} ({curve.x50}, {curve.width}, {curve.plateau}) | {n} "
                f"| {res.midpoint_median:.3f} / {res.midpoint_p90:.3f} "
                f"| {res.midpoint_coverage:.2f} "
                f"| {res.target_median:.3f} / {res.target_p90:.3f} "
                f"| {res.target_coverage:.2f} |"
            )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else None)
    parser.add_argument("--repeats", type=int, default=REPEATS)
    parser.add_argument("--bootstraps", type=int, default=BOOTSTRAPS)
    args = parser.parse_args()
    print(table(args.repeats, args.bootstraps))


if __name__ == "__main__":
    main()
