"""Gas-giant rules of A7.2 as the backend states them for the layers of ``card_to_params`` (#62).

Python twin of ``frontend/src/physics/gasGiants.ts`` (``spinRateRadS``, ``bandCount``,
``flattening``) and of the typical-value constants in
``frontend/src/viewer/renderers/shaderSpec.ts``.
The viewer computes the drawn numbers; this module gives the backend the same arithmetic, so a
layer's tag, formula and ``assumed`` input describe what the viewer draws (D-32). Keep the two in
step: ``tests/test_gas_giant_layers.py`` pins the numbers that both sides use.

A gas giant card has no spin, wind or mass field a measurement fills in the common case, so the
typical values below stand in for the missing input and are stated in ``assumed`` (tier 3).
"""

from __future__ import annotations

import math

R_JUP_M = 6.9911e7  # Jupiter volumetric mean radius (NASA Jupiter fact sheet)
HOUR_S = 3600.0

# [verify] Jupiter's sidereal rotation period, hours (NASA Planetary Fact Sheet, 9.9250 h). The
# class-typical spin of a giant planet, used only when the card has no `rot_period_h`.
TYPICAL_SPIN_H: float | None = 9.925
# [verify] Peak zonal wind, m/s. A7.2 states 50 m/s as its Jupiter example. The card has no wind
# field, so the Rhines rule always uses this typical value and says so in `assumed`.
TYPICAL_ZONAL_WIND_MS: float | None = 50.0
# [verify] Jupiter's flattening (NASA fact sheet, 0.06487), the analogue of the spin rule below.
JUPITER_FLATTENING: float | None = 0.06487
FLATTENING_COEFFICIENT = 0.7  # A7.2: f = 0.7 q, rule of thumb calibrated on Jupiter and Saturn

# A7.2 "Colour family": the temperatures (K) at which the palette changes family.
COLOUR_STOPS_K = (60, 100, 130, 200, 600, 1100, 1800)

BANDS_FORMULA = (
    "bands ~ sqrt(2 Omega R / U), Omega = 2 pi / P (Rhines scale, order of magnitude only)"
)
FLATTENING_FORMULA = "f = f_J (P_J / P)^2, from f = 0.7 q with q proportional to Omega^2"
COLOUR_FORMULA = (
    "palette family chosen by teq_K between the stops 60, 100, 130, 200, 600, 1100, 1800 K"
)


def spin_rate_rad_s(period_h: float) -> float | None:
    if not (period_h > 0) or not math.isfinite(period_h):
        return None
    return 2 * math.pi / (period_h * HOUR_S)


def band_count(omega_rad_s: float, radius_m: float, wind_ms: float) -> float | None:
    """A7.2 `N ~ sqrt(2 Omega R / U)`: bands pole to pole."""
    if not (omega_rad_s > 0 and radius_m > 0 and wind_ms > 0):
        return None
    return math.sqrt(2 * omega_rad_s * radius_m / wind_ms)


def flattening_from_spin(period_h: float) -> float | None:
    """Flattening with Jupiter's mean density assumed, `f = f_J (P_J / P)^2`."""
    if TYPICAL_SPIN_H is None or JUPITER_FLATTENING is None:
        return None
    if not (period_h > 0) or not math.isfinite(period_h):
        return None
    return JUPITER_FLATTENING * (TYPICAL_SPIN_H / period_h) ** 2
