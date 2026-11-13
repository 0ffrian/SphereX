"""The spectrum check (A17.13, Q-474, Q-475): does a track's light behave like sunlight off a rock?

Run once when an area is stored, on the stored replies only (``summary``, ``dots``, ``tracks``)
and the committed solar table; nothing is fetched and nothing runs in a web request (A16.2).
Imported lazily by the producers (``live_jobs.run_live_area``, ``scripts/area_discovery.py``,
``scripts/area_spectra.py``); ``app.main`` never loads it (``AREA_READ_SIDE``).

Two rules:

1. **Colour.** SPHEREx bands below the 2.42 um dichroic (short arm) and above it (long arm) see
   the same sky at the same instant, so ``rho = (F_L / F_S) / (F_sun(L) / F_sun(S))`` within
   one exposure does not depend on spin, distance or phase. Reflected sunlight keeps ``rho`` in
   ``[r_min, r_max]``; heat glow only raises the long arm, by at most ``G(lambda_L, r)``
   (NEATM, Harris 1998), so ``rho_max(r) = r_max (1 + G)``. Colours are never taken across
   exposures (Eros changed by 2.4 times between visits).
2. **Steadiness.** A body above about 200 m spins no faster than once per 2.2 h, so its
   brightness can change only a little between consecutive exposures of one detector.

It never removes, reorders or re-labels a track, and never changes its ``verdict`` (A17.5).
Determinism: canonical JSON, fixed rounding, both times taken from the area's summary.
"""

from __future__ import annotations

import hashlib
import json
import math
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from itertools import pairwise
from pathlib import Path
from statistics import median
from typing import Any

import numpy as np

from app.cache.store import LiveResponse, ReadThroughCache
from app.core.area.config import (
    DEFAULT_SPECTRUM_CONFIG,
    SPECTRUM_VERSION,
    SUN_TABLE,
    SpectrumConfig,
    spectra_key,
    spectra_settings_sha,
    spectrum_settings,
)
from app.core.area.store import canonical
from app.core.card.validate import check
from app.timefmt import iso_utc_z, parse_utc, utc_to_jd

SCHEMA = "area-spectra.schema.json"
CALIBRATION_DEFAULT = "spectra:calibration_default"

# Physical constants (SI; CODATA 2018 and IAU 2015).
H = 6.62607015e-34
C = 2.99792458e8
K_B = 1.380649e-23
SIGMA_SB = 5.670374419e-8
S0 = 1361.0  # W m^-2 at 1 au (IAU 2015 B3)
T_SUN = 5778.0  # K: only for the absolute scale of the reflected term of G (Q-475)
R_SUN_M = 6.957e8
AU_M = 1.495978707e11
MAD_SCALE = 1.4826
MAG_TO_FRAC = 0.4 * math.log(10.0)  # 0.921: d(flux)/flux per magnitude

# NEATM quadrature: midpoint rule on the lit hemisphere, about the subsolar point.
N_THETA = 180
N_PHI = 360

FORMULAS = {
    "points": "a dot of the track with snr >= snr_min is a point; arm = short if wavelength_um "
    "< dichroic_um, else long",
    "calibration": "per visit and detector: stars (label star, snr >= star_snr_min) matched "
    "within star_match_arcsec between consecutive exposures; sigma_sys = 1.4826 MAD(F_b / F_a "
    "- 1); fewer than star_pairs_min pairs: sigma_sys_default",
    "colour": "per exposure, every short-arm point with every long-arm point: rho = (F_L / F_S) "
    "/ (F_sun(L) / F_sun(S)); (sigma_rho / rho)^2 = (s_L / F_L)^2 + (s_S / F_S)^2 + "
    "sigma_sys_S^2 + sigma_sys_L^2; lower limit when F_S < snr_min s_S and F_L >= "
    "limit_snr_min s_L: rho > F_L / (max(F_S, 0) + limit_sigma s_S) / (F_sun ratio); upper "
    "limit the reverse",
    "distance": "u_inv_au > 0: Delta = 1/u, r = |S + Delta s|, S = minus the geocentric Sun "
    "(Astronomical Almanac low-precision formula) at the middle of the track's times, s the "
    "unit vector to its mean RA/Dec; otherwise r = R_earth sin(elongation) for an elongation "
    "below 90 deg, else R_earth (the closest the line of sight comes to the Sun)",
    "bounds": "rho_max(r) = r_max (1 + G(lambda_L, r)); G = largest NEATM thermal / reflected "
    "flux at lambda_L over p_V in [pv_min, pv_max] and eta in [eta_min, eta_max]; NEATM with "
    "emissivity, A = phase_integral p_V, the same phase angle in both terms, HG phase function "
    "(G = hg_g) for the reflected term, F_sun = pi B_nu(5778 K) (R_sun / au)^2 / r^2",
    "steps": "per visit and detector, consecutive points in time: c = F_b / F_a - 1; allowed = "
    "spin + sqrt(2) sigma_sys + slope_arm |ln(lambda_b / lambda_a)| + step_sigma sigma_c, spin "
    "= 0.921 2 pi a_max_mag dt / p_min_h; ok when |c| <= allowed",
    "verdict": "first that applies: flickers (a step not ok); too_blue (a pair with rho + "
    "pair_sigma sigma_rho < r_min, or an upper limit below r_min); too_red (parallax, a pair "
    "with rho - pair_sigma sigma_rho > rho_max, or a lower limit above rho_max); very_red "
    "(worst case, a pair with rho - pair_sigma sigma_rho > r_max, or a lower limit above "
    "r_max); rock (a pair with rho / sigma_rho >= informative_snr); too_faint (pairs, none "
    "informative); one_colour (no pair). heat_glow: parallax rock with a pair rho > r_max",
    "rel": "(F / F_sun(lambda)) / median over the visit's short-arm points of (F / F_sun); null "
    "for a visit with no short-arm point",
}


# --- solar table -------------------------------------------------------------------------


@dataclass(frozen=True)
class Sun:
    ln_lambda: np.ndarray
    ln_fnu: np.ndarray
    sha256: str
    join_um: float
    source: str

    def fnu(self, lambda_um: float) -> float:
        """Relative solar F_nu, interpolated linearly in ln lambda (and ln F)."""
        x = math.log(lambda_um)
        if not self.ln_lambda[0] <= x <= self.ln_lambda[-1]:
            raise ValueError(f"{lambda_um} um is outside the solar table")
        return math.exp(float(np.interp(x, self.ln_lambda, self.ln_fnu)))


@lru_cache(maxsize=2)
def load_sun(path: Path = SUN_TABLE) -> Sun:
    raw = path.read_bytes()
    t = json.loads(raw)
    source = "; ".join(f"{s['file']} ({s['url']})" for s in t["sources"])
    return Sun(
        np.log(np.asarray(t["lambda_um"], dtype=np.float64)),
        np.log(np.asarray(t["f_nu"], dtype=np.float64)),
        hashlib.sha256(raw).hexdigest(),
        float(t["join_um"]),
        source,
    )


# --- geometry ----------------------------------------------------------------------------

Vec = tuple[float, float, float]


def sun_ecliptic(when: datetime) -> tuple[float, float, float]:
    """Apparent ecliptic longitude (deg), distance (au) and obliquity (deg) of the Sun, of date:
    the low-precision formula of the Astronomical Almanac (section C; about 0.01 deg from 1950
    to 2050). No network, no ephemeris file."""
    n = utc_to_jd(when) - 2451545.0
    lon_mean = (280.460 + 0.9856474 * n) % 360.0
    g = math.radians((357.528 + 0.9856003 * n) % 360.0)
    lam = (lon_mean + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g)) % 360.0
    dist = 1.00014 - 0.01671 * math.cos(g) - 0.00014 * math.cos(2 * g)
    return lam, dist, 23.439 - 0.0000004 * n


def sun_geocentric(when: datetime) -> Vec:
    """Geocentric equatorial Sun vector in au (equator and equinox of date). ASSUMPTION: used
    with ICRS track directions without precession (0.36 deg in 2026), which moves r by under
    0.01 au at the distances of A17.4."""
    lam_deg, dist, eps_deg = sun_ecliptic(when)
    lam, eps = math.radians(lam_deg), math.radians(eps_deg)
    return (
        dist * math.cos(lam),
        dist * math.cos(eps) * math.sin(lam),
        dist * math.sin(eps) * math.sin(lam),
    )


def radec_unit(ra_deg: float, dec_deg: float) -> Vec:
    ra, dec = math.radians(ra_deg), math.radians(dec_deg)
    return (math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec))


def _dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _norm(a: Vec) -> float:
    return math.sqrt(_dot(a, a))


@dataclass(frozen=True)
class Distance:
    r_au: float
    source: str  # parallax | worst_case
    phase_deg: float


def distance(u_inv_au: float | None, when: datetime, s_hat: Vec) -> Distance:
    """Step 4. ``s_hat`` is the unit vector to the track's mean RA/Dec, seen from SPHEREx
    (taken at the geocentre: SPHEREx is 1e-4 au from it)."""
    sun = sun_geocentric(when)
    obs = (-sun[0], -sun[1], -sun[2])  # heliocentric observer
    r_earth = _norm(obs)
    if u_inv_au is not None and u_inv_au > 0:
        delta = 1.0 / u_inv_au
        p = (obs[0] + delta * s_hat[0], obs[1] + delta * s_hat[1], obs[2] + delta * s_hat[2])
        r = _norm(p)
        cos_a = max(-1.0, min(1.0, _dot(p, s_hat) / r))
        return Distance(r, "parallax", math.degrees(math.acos(cos_a)))
    cos_elong = max(-1.0, min(1.0, _dot(sun, s_hat) / r_earth))
    elong = math.degrees(math.acos(cos_elong))
    if elong < 90.0:
        # The closest point: Sun-object line perpendicular to the line of sight (phase 90 deg).
        return Distance(r_earth * math.sin(math.radians(elong)), "worst_case", 90.0)
    return Distance(r_earth, "worst_case", 180.0 - elong)


# --- NEATM heat glow ---------------------------------------------------------------------


def planck_nu(lambda_um: float, temp: np.ndarray | float) -> np.ndarray:
    """B_nu(T) in W m^-2 Hz^-1 sr^-1 (0 where T is 0)."""
    nu = C / (lambda_um * 1e-6)
    t = np.asarray(temp, dtype=np.float64)
    out = np.zeros_like(t)
    hot = t > 0
    x = H * nu / (K_B * t[hot])
    out[hot] = 2.0 * H * nu**3 / C**2 / np.expm1(np.minimum(x, 700.0))
    return out


def hg_phase(alpha_deg: float, g: float) -> float:
    """The HG phase function (Bowell et al. 1989)."""
    t = math.tan(math.radians(alpha_deg) / 2.0)
    phi1 = math.exp(-3.33 * t**0.63)
    phi2 = math.exp(-1.87 * t**1.22)
    return (1.0 - g) * phi1 + g * phi2


@lru_cache(maxsize=1)
def _hemisphere() -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Midpoint grid of the lit hemisphere: cos(i), the normal's x and z, and dOmega."""
    d_t = (math.pi / 2.0) / N_THETA
    d_p = (2.0 * math.pi) / N_PHI
    theta = (np.arange(N_THETA) + 0.5) * d_t
    phi = (np.arange(N_PHI) + 0.5) * d_p
    th, ph = np.meshgrid(theta, phi, indexing="ij")
    return np.cos(th), np.sin(th) * np.cos(ph), np.cos(th), np.sin(th) * d_t * d_p


def neatm_thermal(
    lambda_um: float, r_au: float, alpha_deg: float, p_v: float, eta: float, cfg: SpectrumConfig
) -> float:
    """NEATM thermal F_nu per unit (R / Delta)^2, W m^-2 Hz^-1: eps * integral over the lit and
    visible surface of B_nu(T) cos(e) dOmega, T = T_ss cos(i)^(1/4)."""
    bond = cfg.phase_integral * p_v
    t_ss = ((1.0 - bond) * S0 / (eta * cfg.emissivity * SIGMA_SB * r_au**2)) ** 0.25
    cos_i, nx, nz, d_omega = _hemisphere()
    a = math.radians(alpha_deg)
    cos_e = nx * math.sin(a) + nz * math.cos(a)  # observer in the x-z plane, alpha from the Sun
    vis = cos_e > 0
    temp = t_ss * cos_i[vis] ** 0.25
    return float(cfg.emissivity * np.sum(planck_nu(lambda_um, temp) * cos_e[vis] * d_omega[vis]))


def reflected(lambda_um: float, r_au: float, alpha_deg: float, p_v: float, g: float) -> float:
    """Reflected F_nu per unit (R / Delta)^2 at solar colour: p_V Phi(alpha) F_sun(r)."""
    f_sun = math.pi * float(planck_nu(lambda_um, T_SUN)) * (R_SUN_M / AU_M) ** 2 / r_au**2
    return p_v * hg_phase(alpha_deg, g) * f_sun


def heat_ratio(
    lambda_um: float, r_au: float, alpha_deg: float, p_v: float, eta: float, cfg: SpectrumConfig
) -> float:
    """Thermal over reflected flux at ``lambda_um``; the diameter and Delta cancel."""
    return neatm_thermal(lambda_um, r_au, alpha_deg, p_v, eta, cfg) / reflected(
        lambda_um, r_au, alpha_deg, p_v, cfg.hg_g
    )


def heat_allowance(
    lambda_um: float, r_au: float, alpha_deg: float, cfg: SpectrumConfig = DEFAULT_SPECTRUM_CONFIG
) -> float:
    """G of step 5: the largest ratio over the p_V and eta corners (the ratio is monotone in
    both: darker and lower eta are hotter)."""
    return max(
        heat_ratio(lambda_um, r_au, alpha_deg, pv, eta, cfg)
        for pv in (cfg.pv_min, cfg.pv_max)
        for eta in (cfg.eta_min, cfg.eta_max)
    )


# --- the check ---------------------------------------------------------------------------


def _r(v: float, dp: int) -> float:
    out = round(float(v), dp)
    return 0.0 if out == 0.0 else out


def _sig(v: float, digits: int = 4) -> float:
    """Round to significant digits (rho_max spans 3 to thousands)."""
    return float(f"{v:.{digits}g}")


@dataclass(frozen=True)
class DotRow:
    dot_id: str
    visit: int
    detector: int
    exposure: int
    time: datetime
    lam: float
    flux: float
    err: float
    snr: float
    label: str
    ra: float
    dec: float


def _dots(dots_reply: Mapping[str, Any]) -> dict[str, DotRow]:
    out: dict[str, DotRow] = {}
    for v in dots_reply["visits"]:
        for d in v["dots"]:
            out[str(d["dot_id"])] = DotRow(
                str(d["dot_id"]),
                int(v["visit"]),
                int(d["detector"]),
                int(d["exposure"]),
                parse_utc(str(d["time"])),
                float(d["wavelength_um"]),
                float(d["flux_uJy"]),
                float(d["flux_err"]),
                float(d["snr"]),
                str(d["label"]),
                float(d["ra"]),
                float(d["dec"]),
            )
    return out


def _sep_arcsec(a: DotRow, b: DotRow) -> float:
    ua, ub = radec_unit(a.ra, a.dec), radec_unit(b.ra, b.dec)
    return math.degrees(math.acos(max(-1.0, min(1.0, _dot(ua, ub))))) * 3600.0


def calibration(
    dots: Mapping[str, DotRow], cfg: SpectrumConfig
) -> tuple[list[dict[str, Any]], dict[tuple[int, int], float]]:
    """Step 2: sigma_sys per visit and detector, from stars between consecutive exposures."""
    groups: dict[tuple[int, int], dict[int, list[DotRow]]] = defaultdict(lambda: defaultdict(list))
    seen: set[tuple[int, int]] = set()
    for d in dots.values():
        seen.add((d.visit, d.detector))
        if d.label == "star" and d.snr >= cfg.star_snr_min and d.flux > 0:
            groups[(d.visit, d.detector)][d.exposure].append(d)
    rows: list[dict[str, Any]] = []
    sigma: dict[tuple[int, int], float] = {}
    for key in sorted(seen):
        by_exp = groups.get(key, {})
        exps = sorted(by_exp)
        steps: list[float] = []
        for ea, eb in pairwise(exps):
            for a in sorted(by_exp[ea], key=lambda d: d.dot_id):
                near = [
                    (_sep_arcsec(a, b), b.dot_id, b)
                    for b in by_exp[eb]
                    if _sep_arcsec(a, b) <= cfg.star_match_arcsec
                ]
                if len(near) == 1:  # ASSUMPTION: an ambiguous match is skipped, not guessed
                    steps.append(near[0][2].flux / a.flux - 1.0)
        if len(steps) >= cfg.star_pairs_min:
            mid = median(steps)
            s = MAD_SCALE * median(abs(x - mid) for x in steps)
            source = "stars"
        else:
            s = cfg.sigma_sys_default
            source = "default"
        sigma[key] = s
        rows.append(
            {
                "visit": key[0],
                "detector": key[1],
                "sigma_sys": _r(s, 4),
                "n_pairs": len(steps),
                "source": source,
            }
        )
    return rows, sigma


def _arm(lam: float, cfg: SpectrumConfig) -> str:
    return "short" if lam < cfg.dichroic_um else "long"


def _pair(
    s: DotRow,
    lo: DotRow,
    sun: Sun,
    sig: Mapping[tuple[int, int], float],
    cfg: SpectrumConfig,
) -> dict[str, Any] | None:
    """Step 3: one colour pair (a value, a lower or an upper limit), or None."""
    sun_ratio = sun.fnu(lo.lam) / sun.fnu(s.lam)
    s_ok, l_ok = s.snr >= cfg.snr_min, lo.snr >= cfg.snr_min
    sys2 = sig[(s.visit, s.detector)] ** 2 + sig[(lo.visit, lo.detector)] ** 2
    if s_ok and l_ok and s.flux > 0 and lo.flux > 0:
        rho = (lo.flux / s.flux) / sun_ratio
        rel = math.sqrt((lo.err / lo.flux) ** 2 + (s.err / s.flux) ** 2 + sys2)
        return {"rho": rho, "rho_err": rho * rel, "limit": None}
    if not s_ok and lo.snr >= cfg.limit_snr_min:
        rho = lo.flux / (max(s.flux, 0.0) + cfg.limit_sigma * s.err) / sun_ratio
        return {"rho": rho, "rho_err": None, "limit": "lower"}
    if not l_ok and s.snr >= cfg.limit_snr_min:
        rho = (max(lo.flux, 0.0) + cfg.limit_sigma * lo.err) / s.flux / sun_ratio
        return {"rho": rho, "rho_err": None, "limit": "upper"}
    return None


def _steps(
    rows: Sequence[DotRow], sig: Mapping[tuple[int, int], float], cfg: SpectrumConfig
) -> list[dict[str, Any]]:
    """Step 6: consecutive points in time of one visit and one detector."""
    by: dict[tuple[int, int], list[DotRow]] = defaultdict(list)
    for d in rows:
        if d.snr >= cfg.snr_min and d.flux > 0:
            by[(d.visit, d.detector)].append(d)
    out: list[dict[str, Any]] = []
    for key in sorted(by):
        pts = sorted(by[key], key=lambda d: (d.time, d.dot_id))
        for a, b in pairwise(pts):
            dt_h = (b.time - a.time).total_seconds() / 3600.0
            c = b.flux / a.flux - 1.0
            sigma_c = math.sqrt((b.err / a.flux) ** 2 + (b.flux * a.err / a.flux**2) ** 2)
            spin = MAG_TO_FRAC * 2.0 * math.pi * cfg.a_max_mag * dt_h / cfg.p_min_h
            slope = cfg.slope_short if _arm(a.lam, cfg) == "short" else cfg.slope_long
            allowed = (
                spin
                + math.sqrt(2.0) * sig[key]
                + slope * abs(math.log(b.lam / a.lam))
                + cfg.step_sigma * sigma_c
            )
            out.append(
                {
                    "visit": key[0],
                    "detector": key[1],
                    "dot_id_a": a.dot_id,
                    "dot_id_b": b.dot_id,
                    "time_a": iso_utc_z(a.time),
                    "time_b": iso_utc_z(b.time),
                    "change": _r(c, 4),
                    "allowed": _r(allowed, 4),
                    "ok": abs(c) <= allowed,
                }
            )
    return out


def _mean_direction(rows: Sequence[DotRow]) -> Vec:
    vs = [radec_unit(d.ra, d.dec) for d in rows]
    x, y, z = (sum(v[i] for v in vs) for i in range(3))
    n = math.sqrt(x * x + y * y + z * z)
    return (x / n, y / n, z / n)


def _verdict(
    pairs: Sequence[dict[str, Any]],
    steps: Sequence[dict[str, Any]],
    dist: Distance,
    cfg: SpectrumConfig,
) -> tuple[str, bool | None]:
    parallax = dist.source == "parallax"
    values = [p for p in pairs if p["limit"] is None]
    lowers = [p for p in pairs if p["limit"] == "lower"]
    uppers = [p for p in pairs if p["limit"] == "upper"]
    k = cfg.pair_sigma
    if any(not s["ok"] for s in steps):
        verdict = "flickers"
    elif any(p["rho"] + k * p["rho_err"] < cfg.r_min for p in values) or any(
        p["rho"] < cfg.r_min for p in uppers
    ):
        verdict = "too_blue"
    elif parallax and (
        any(p["rho"] - k * p["rho_err"] > p["rho_max"] for p in values)
        or any(p["rho"] > p["rho_max"] for p in lowers)
    ):
        verdict = "too_red"
    elif not parallax and (
        any(p["rho"] - k * p["rho_err"] > cfg.r_max for p in values)
        or any(p["rho"] > cfg.r_max for p in lowers)
    ):
        verdict = "very_red"
    elif any(p["rho"] >= cfg.informative_snr * p["rho_err"] for p in values):
        verdict = "rock"
    elif pairs:
        verdict = "too_faint"
    else:
        verdict = "one_colour"
    heat: bool | None = None  # unknown distance: worst case
    if parallax:
        heat = verdict == "rock" and any(p["rho"] > cfg.r_max for p in values)
    return verdict, heat


def check_track(
    track: Mapping[str, Any],
    dots: Mapping[str, DotRow],
    sig: Mapping[tuple[int, int], float],
    sun: Sun,
    cfg: SpectrumConfig,
) -> dict[str, Any]:
    ids = sorted({i for tl in track["tracklets"] for i in tl["dot_ids"]})
    rows = sorted((dots[i] for i in ids), key=lambda d: (d.time, d.detector, d.dot_id))
    times = [d.time for d in rows]
    mid = times[0] + (times[-1] - times[0]) / 2
    dist = distance(track.get("u_inv_au"), mid, _mean_direction(rows))

    by_exp: dict[tuple[int, int], list[DotRow]] = defaultdict(list)
    for d in rows:
        by_exp[(d.visit, d.exposure)].append(d)
    pairs: list[dict[str, Any]] = []
    used: set[str] = set()
    glow: dict[float, float] = {}
    for (visit, exposure), group in sorted(by_exp.items()):
        shorts = sorted((d for d in group if _arm(d.lam, cfg) == "short"), key=lambda d: d.dot_id)
        longs = sorted((d for d in group if _arm(d.lam, cfg) == "long"), key=lambda d: d.dot_id)
        for s in shorts:
            for lo in longs:
                got = _pair(s, lo, sun, sig, cfg)
                if got is None:
                    continue
                if lo.lam not in glow:
                    glow[lo.lam] = heat_allowance(lo.lam, dist.r_au, dist.phase_deg, cfg)
                used.update((s.dot_id, lo.dot_id))
                pairs.append(
                    {
                        "visit": visit,
                        "exposure": exposure,
                        "time": iso_utc_z(s.time),
                        "short_dot_id": s.dot_id,
                        "long_dot_id": lo.dot_id,
                        "lambda_short_um": _r(s.lam, 5),
                        "lambda_long_um": _r(lo.lam, 5),
                        "rho": got["rho"],
                        "rho_err": got["rho_err"],
                        "limit": got["limit"],
                        "rho_max": cfg.r_max * (1.0 + glow[lo.lam]),
                    }
                )
    steps = _steps(rows, sig, cfg)
    for step in steps:
        used.update((step["dot_id_a"], step["dot_id_b"]))
    verdict, heat = _verdict(pairs, steps, dist, cfg)

    norm: dict[int, float | None] = {}
    for visit in sorted({d.visit for d in rows}):
        vals = [
            d.flux / sun.fnu(d.lam)
            for d in rows
            if d.visit == visit and d.snr >= cfg.snr_min and _arm(d.lam, cfg) == "short"
        ]
        norm[visit] = median(vals) if vals and median(vals) > 0 else None
    points = []
    for d in rows:
        n = norm[d.visit]
        points.append(
            {
                "dot_id": d.dot_id,
                "visit": d.visit,
                "detector": d.detector,
                "exposure": d.exposure,
                "time": iso_utc_z(d.time),
                "lambda_um": _r(d.lam, 5),
                "flux_uJy": d.flux,
                "flux_err": d.err,
                "snr": d.snr,
                "arm": _arm(d.lam, cfg),
                "point": d.snr >= cfg.snr_min,
                "rel": None if n is None else _r(d.flux / sun.fnu(d.lam) / n, 4),
                "used": d.dot_id in used,
            }
        )
    return {
        "track_id": track["track_id"],
        "verdict": verdict,
        "heat_glow": heat,
        "r_au": _r(dist.r_au, 4),
        "r_source": dist.source,
        "phase_deg": _r(dist.phase_deg, 2),
        "pairs": [
            {
                **p,
                "rho": _r(p["rho"], 4),
                "rho_err": None if p["rho_err"] is None else _r(p["rho_err"], 4),
                "rho_max": _sig(p["rho_max"]),
            }
            for p in pairs
        ],
        "steps": steps,
        "points": points,
    }


PROVENANCE_SOURCE = "the area's stored /dots and /tracks (A17.8) and the solar table"


def provenance(sun: Sun) -> dict[str, Any]:
    return {
        "points": {
            "tag": "measured",
            "source": "Stage 2 photometry of the area's dots (/dots): flux_uJy, flux_err, snr, "
            "lambda_um",
        },
        "rel": {"tag": "derived", "source": PROVENANCE_SOURCE, "formula": FORMULAS["rel"]},
        "calibration": {
            "tag": "derived",
            "source": "stars of the area's /dots",
            "formula": FORMULAS["calibration"],
        },
        "colour": {
            "tag": "model_dependent",
            "source": PROVENANCE_SOURCE,
            "assumption": "the solar colour of the CALSPEC table, a Kurucz model beyond "
            f"{sun.join_um} um; no aperture correction per band (Q-23)",
        },
        "distance": {
            "tag": "derived",
            "source": "u_inv_au of /tracks (A17.4, Q-179) and the Astronomical Almanac Sun",
            "formula": FORMULAS["distance"],
        },
        "distance_worst_case": {
            "tag": "model_dependent",
            "source": "the Astronomical Almanac Sun and the track's direction",
            "assumption": "no parallax: the body is taken at the point of the line of sight "
            "closest to the Sun, the hottest it could be",
        },
        "verdict": {
            "tag": "model_dependent",
            "source": PROVENANCE_SOURCE,
            "assumption": "reflectance ratios within [r_min, r_max]; heat glow bounded by NEATM "
            "over the p_V and eta ranges; a body larger than about 200 m spins no faster than "
            "the 2.2 h barrier (Pravec and Harris 2000)",
        },
        "sun": {
            "tag": "model_dependent",
            "source": sun.source,
            "assumption": f"observed solar spectrum below {sun.join_um} um, the Kurucz model "
            "above it, scaled to the observed one",
        },
    }


def compute_spectra(
    summary: Mapping[str, Any],
    dots_reply: Mapping[str, Any],
    tracks_reply: Mapping[str, Any],
    cfg: SpectrumConfig = DEFAULT_SPECTRUM_CONFIG,
    sun: Sun | None = None,
) -> dict[str, Any]:
    """The ``/spectra`` reply of one stored area, checked against the schema."""
    sun = sun or load_sun()
    dots = _dots(dots_reply)
    calib, sig = calibration(dots, cfg)
    tracks = [check_track(t, dots, sig, sun, cfg) for t in tracks_reply["tracks"]]
    missing = [CALIBRATION_DEFAULT] if any(c["source"] == "default" for c in calib) else []
    reply = {
        "area_id": summary["area_id"],
        "cached_at": summary["cached_at"],
        "computed_at": summary["computed_at"],
        "missing": missing,
        "provenance": provenance(sun),
        "method": {
            "spectrum_version": SPECTRUM_VERSION,
            "settings": spectrum_settings(cfg),
            "formulas": dict(FORMULAS),
            "sun": {"source": sun.source, "sha256": sun.sha256, "join_um": sun.join_um},
        },
        "calibration": calib,
        "tracks": tracks,
    }
    check(reply, SCHEMA)
    return reply


def store_spectra(
    cache: ReadThroughCache,
    release: str,
    params_hash: str,
    reply: Mapping[str, Any],
    cfg: SpectrumConfig = DEFAULT_SPECTRUM_CONFIG,
) -> bool:
    """Write the ``spectra`` stage after ``store_area`` (Q-474); the area head is untouched.
    Returns True when the entry was written, False when the same bytes were already there."""
    key = spectra_key(release, str(reply["area_id"]), params_hash, spectra_settings_sha(cfg))
    body = canonical(dict(reply))
    existing = cache.get(key)
    if existing is not None and existing.body == body:
        return False
    cache.put(
        key,
        LiveResponse(body, "derived:area:spectra", 200, "application/json"),
        fetched_at=parse_utc(str(reply["computed_at"])),
    )
    return True


def spectra_from_bodies(
    summary: bytes, dots: bytes, tracks: bytes, cfg: SpectrumConfig = DEFAULT_SPECTRUM_CONFIG
) -> dict[str, Any]:
    return compute_spectra(json.loads(summary), json.loads(dots), json.loads(tracks), cfg)


def store_prepared(
    cache: ReadThroughCache,
    release: str,
    params_hash: str,
    bodies: Mapping[str, bytes],
    cfg: SpectrumConfig = DEFAULT_SPECTRUM_CONFIG,
) -> dict[str, Any]:
    """The producers' call, right after ``service.store_area``: the check on the bodies just
    stored (``Prepared.bodies``), written as the area's ``spectra`` stage."""
    reply = spectra_from_bodies(bodies["summary"], bodies["dots"], bodies["tracks"], cfg)
    store_spectra(cache, release, params_hash, reply, cfg)
    return reply


__all__ = [
    "CALIBRATION_DEFAULT",
    "Distance",
    "compute_spectra",
    "distance",
    "heat_allowance",
    "heat_ratio",
    "load_sun",
    "neatm_thermal",
    "spectra_from_bodies",
    "store_prepared",
    "store_spectra",
    "sun_geocentric",
]
