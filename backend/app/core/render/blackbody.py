"""Teff -> display colour (R7.5): Planck spectrum through the CIE 1931 2-degree observer.

Deterministic, no lookup file. The colour-matching functions use the published multi-lobe
Gaussian fit of Wyman, Sloan & Shirley 2013 (JCGT 2(2)), not the tabulated CIE data that R7.5
names as an example (Mitchell Charity's table) [verify: differences against the table should be
well under one 8-bit step]. XYZ goes to linear sRGB (IEC 61966-2-1, D65), negatives are clipped
and the brightest channel is scaled to 1, so the result is a chromaticity, not a brightness.
"""

from __future__ import annotations

import math

FORMULA = (
    "Planck(Teff) integrated 380-780 nm against the CIE 1931 2-degree colour-matching functions "
    "(Wyman, Sloan & Shirley 2013 fit), XYZ -> linear sRGB (D65), clipped at 0, "
    "brightest channel = 1 (R7.5)"
)

_H = 6.62607015e-34  # Planck constant, J s (SI 2019, exact)
_C = 299792458.0  # speed of light, m/s (exact)
_K = 1.380649e-23  # Boltzmann constant, J/K (SI 2019, exact)

# (weight, mean nm, sigma below mean, sigma above mean), Wyman et al. 2013, eq. 2.
_XBAR = ((1.056, 599.8, 37.9, 31.0), (0.362, 442.0, 16.0, 26.7), (-0.065, 501.1, 20.4, 26.2))
_YBAR = ((0.821, 568.8, 46.9, 40.5), (0.286, 530.9, 16.3, 31.1))
_ZBAR = ((1.217, 437.0, 11.8, 36.0), (0.681, 459.0, 26.0, 13.8))

# XYZ (D65) -> linear sRGB, IEC 61966-2-1.
_M = (
    (3.2406, -1.5372, -0.4986),
    (-0.9689, 1.8758, 0.0415),
    (0.0557, -0.2040, 1.0570),
)


def _lobe(nm: float, lobes: tuple[tuple[float, float, float, float], ...]) -> float:
    out = 0.0
    for w, mu, s1, s2 in lobes:
        s = s1 if nm < mu else s2
        out += w * math.exp(-0.5 * ((nm - mu) / s) ** 2)
    return out


def _planck(nm: float, teff_k: float) -> float:
    lam = nm * 1e-9
    x = _H * _C / (lam * _K * teff_k)
    if x > 700.0:  # exp overflow: the radiance is 0 to double precision
        return 0.0
    return 1.0 / (lam**5 * math.expm1(x))


def teff_to_rgb(teff_k: float) -> tuple[float, float, float] | None:
    """Linear sRGB in [0, 1] with max channel 1, rounded to 4 decimals; None if not computable."""
    if not math.isfinite(teff_k) or teff_k <= 0:
        return None
    x = y = z = 0.0
    for nm in range(380, 781):  # 1 nm steps
        b = _planck(float(nm), teff_k)
        x += b * _lobe(nm, _XBAR)
        y += b * _lobe(nm, _YBAR)
        z += b * _lobe(nm, _ZBAR)
    rgb = [max(0.0, r[0] * x + r[1] * y + r[2] * z) for r in _M]
    peak = max(rgb)
    if peak <= 0.0 or not math.isfinite(peak):
        return None
    r, g, b2 = (round(c / peak, 4) for c in rgb)
    return (r, g, b2)
