"""Pipeline stage 5 (A4.5): build the ObjectCard (R3.2) from catalogue facts and the spectrum.

Every value is a tagged value with its source. A value the pipeline has no source for is
``null`` with the reason in ``source`` (never a guess). Only fields that the object's type uses
(R7) are written, so the card does not fill up with nulls that nothing reads.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

from app.adapters import horizons
from app.adapters.exoplanet_archive import ref_text
from app.core.card.catalogue import CatalogueData
from app.core.classify import Classification
from app.core.find.resolver import ResolvedObject
from app.core.render.spherex_rgb import CHANNELS_BY_TYPE, spherex_rgb, window_median
from app.core.render.spherex_rgb import formula as spherex_formula
from app.timefmt import iso_utc_z, parse_utc

MJD_EPOCH = datetime(1858, 11, 17, tzinfo=UTC)  # MJD 0 (UTC; the SIA midpoint is UTC)
FLUX_45UM_CENTRE = 4.5  # um, the R5.2 brown-dwarf R channel, used for flux_45um (ASSUMPTION)

# R7.4: "sphere of radius ~ 1 Jupiter radius (tag model_dependent, assumption: brown dwarf
# radii ~ 1 Jupiter radius)". The spec states the value and its tag.
BROWN_DWARF_RADIUS_RJUP = 1.0
BROWN_DWARF_RADIUS_ASSUMPTION = "brown dwarf radii are about 1 Jupiter radius (R7.4)"

NO_SOURCE = "not available: no source in the pipeline yet"


def _null(source: str, tag: str = "measured") -> dict[str, Any]:
    return {"value": None, "tag": tag, "source": source}


def _measured(value: Any, source: str, err: float | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"value": value, "tag": "measured", "source": source}
    if err is not None:
        out["err"] = err
    return out


def _finite(text: Any) -> float | None:
    try:
        x = float(text)
    except (TypeError, ValueError, OverflowError):
        return None
    return x if math.isfinite(x) else None


def _sbdb_value(data: CatalogueData, name: str, *, positive: bool = True) -> dict[str, Any]:
    row = data.sbdb_phys.get(name)
    if row is None:
        return _null(f"not available: JPL SBDB has no {name} for this object")
    value = _finite(row.get("value"))
    if value is None or (positive and value <= 0):
        return _null(f"not available: JPL SBDB {name} is not a single number")
    err = _finite(row.get("sigma"))
    ref = row.get("ref") or "no reference given"
    return _measured(value, f"JPL SBDB {name} ({ref})", err if err and err > 0 else None)


def _spectral_class(cls: Classification) -> dict[str, Any]:
    if cls.class_label is None:
        return _null("not available: no catalogue class; spectrum matching is not built (A4.3)")
    return _measured(cls.class_label, cls.class_label_source or "catalogue")


def _points(spectrum: Mapping[str, Any] | None) -> list[Mapping[str, Any]]:
    pts = spectrum.get("spectrum") if spectrum else None
    return [p for p in pts if isinstance(p, Mapping)] if isinstance(pts, list) else []


def _spherex_source(spectrum: Mapping[str, Any] | None) -> str:
    release = (spectrum or {}).get("data_release") or "SPHEREx"
    return f"SPHEREx {release} (this tool, A4.2 spectrum)"


def _spherex_rgb(kind: str, spectrum: Mapping[str, Any] | None) -> dict[str, Any] | None:
    channels = CHANNELS_BY_TYPE.get(kind)
    if channels is None:
        return None
    if spectrum is None:
        return _null("not available: no SPHEREx spectrum for this object")
    rgb = spherex_rgb(_points(spectrum), channels)
    if rgb is None:
        return _null(
            f"{_spherex_source(spectrum)}: fewer than 2 unflagged points in a channel window (R5.2)"
        )
    out = _measured(list(rgb), _spherex_source(spectrum))
    out["formula"] = spherex_formula(channels)  # R5.2 tags it measured (Q-27); formula for clarity
    return out


def _flux_45um(spectrum: Mapping[str, Any] | None) -> dict[str, Any]:
    if spectrum is None:
        return _null("not available: no SPHEREx spectrum for this object")
    value = window_median(_points(spectrum), FLUX_45UM_CENTRE)
    if value is None:
        return _null(f"{_spherex_source(spectrum)}: fewer than 2 unflagged points at 4.5 um")
    unit = spectrum.get("flux_unit", "uJy")
    out = _measured(value, f"{_spherex_source(spectrum)}, flux density in {unit}")
    out["formula"] = "median unflagged flux within +/-0.05 um of 4.5 um (R5.2 window)"
    return out


def _lightcurve(spectrum: Mapping[str, Any] | None) -> list[dict[str, float]]:
    """Stage 2 light curve -> R3.2 points (Q-41).

    ASSUMPTION: ``flags`` is 1 for a point stage 2 marked ``flagged`` and 0 otherwise (stage 2
    has no bitmask), so the viewer's "exclude non-zero flags" rule (R12 #17) drops it. Points
    without a wavelength are left out, because ``lambda_um`` is required.
    """
    pts = spectrum.get("light_curve") if spectrum else None
    out: list[dict[str, float]] = []
    for p in pts if isinstance(pts, list) else []:
        lam, flux, err = (_finite(p.get(k)) for k in ("wavelength_um", "flux", "error"))
        if lam is None or flux is None or err is None or not isinstance(p.get("time"), str):
            continue
        t_mjd = (parse_utc(p["time"]) - MJD_EPOCH).total_seconds() / 86400.0
        out.append(
            {
                "t_mjd": round(t_mjd, 8),
                "flux": flux,
                "sigma": err,
                "lambda_um": lam,
                "flags": 1 if p.get("flagged") else 0,
            }
        )
    return out


def _pm(obj: ResolvedObject) -> dict[str, Any] | None:
    pmra, pmdec = _finite(obj.pm_ra_mas_yr), _finite(obj.pm_dec_mas_yr)
    if pmra is None or pmdec is None:
        return None  # absent or NaN: no motion trail (a NaN would also break the JSON reply)
    prov = obj.provenance.get("pm_ra_mas_yr", {})
    source = prov.get("source", "SIMBAD") + " (pmra = mu_alpha * cos(delta), pmdec)"
    return _measured([pmra, pmdec], source)


def _phase_angle(data: CatalogueData) -> dict[str, Any]:
    g = data.geometry
    if g is None:
        return _null(f"not available: {data.geometry_reason or 'no Horizons geometry'}")
    where = (
        "observer SPHEREx 500@-163182"
        if g.observer == horizons.OBSERVER_SPHEREX
        else "geocentre 500@399 (no SPHEREx ephemeris at this epoch)"
    )
    return {
        "value": g.phase_angle_deg,
        "tag": "measured",  # R5.1; A3.4 says model_dependent for positions, rendering wins (Q-62)
        "source": f"JPL Horizons quantity 24 (Sun-Target-Observer), {where}, "
        f"at {iso_utc_z(g.time)}",
    }


def _sun_vector(data: CatalogueData) -> dict[str, Any]:
    g = data.geometry
    if g is None:
        out = _null(f"not available: {data.geometry_reason or 'no Horizons geometry'}", "derived")
        out["formula"] = "-r/|r| from JPL Horizons VECTORS (not computed)"
        return out
    when = iso_utc_z(g.time)
    return {
        "value": [round(c, 9) for c in g.sun_vector],
        "tag": "derived",
        "source": f"JPL Horizons VECTORS, CENTER 500@10, at {when}",
        "formula": "-r/|r|, r = heliocentric ICRF position from JPL Horizons VECTORS "
        f"(CENTER 500@10) at {when}; frame ICRF (equatorial J2000), direction target to Sun",
    }


def _planet_fields(card: dict[str, Any], row: Mapping[str, Any] | None) -> None:
    """R7.7 size and D-12 temperature from the Exoplanet Archive row (A3.8). Mass, orbit and host
    star stay in the row: R12 #12 defines no card field for them (Q-63 proposes some)."""
    row = row or {}
    radius = _finite(row.get("pl_radj"))
    if radius is None or radius <= 0:
        card["radius_rjup"] = _null("not available: the Exoplanet Archive has no pl_radj")
    else:
        errs = [abs(e) for e in (_finite(row.get(k)) for k in ("pl_radjerr1", "pl_radjerr2")) if e]
        card["radius_rjup"] = _measured(
            radius,
            f"NASA Exoplanet Archive PSCompPars pl_radj ({ref_text(row, 'pl_radj')})",
            max(errs) if errs else None,
        )
    teq = _finite(row.get("pl_eqt"))
    if teq is not None and teq > 0:
        card["teq_K"] = _measured(
            teq, f"NASA Exoplanet Archive PSCompPars pl_eqt ({ref_text(row, 'pl_eqt')})"
        )
    else:
        card["teq_K"] = {
            "value": None,
            "tag": "derived",
            "source": "not available: pl_eqt is empty and no albedo is given to apply A7.1",
            "formula": "Teq = T_star * sqrt(R_star / (2a)) * (1 - A)^(1/4) (A7.1)",
        }


def build_card(
    obj: ResolvedObject,
    data: CatalogueData,
    cls: Classification,
    spectrum: Mapping[str, Any] | None,
) -> dict[str, Any]:
    kind = cls.type
    card: dict[str, Any] = {"id": obj.id, "name": obj.name or obj.id, "type": kind}

    if kind in ("asteroid_shape", "asteroid_procedural"):
        card["diameter_km"] = _sbdb_value(data, "diameter")
        if kind == "asteroid_shape":
            src = data.facts.shape_model
            card["shape_source"] = (
                _measured(src, data.shape.source if data.shape else "shape-model registry")
                if src
                else _null(NO_SOURCE)
            )
        card["rot_period_h"] = _sbdb_value(data, "rot_per")
        card["lightcurve_amp_mag"] = _null("not available: JPL SBDB gives no light-curve amplitude")
        card["albedo"] = _sbdb_value(data, "albedo")
        card["gaia_rgb"] = _null("not available: the Gaia adapter is not built (A3.2)", "derived")
        card["gaia_rgb"]["formula"] = "Gaia DR3 colours to RGB (not computed)"
        card["spectral_class"] = _spectral_class(cls)
        card["band_depth_3um"] = _null(NO_SOURCE + " (no band-depth rule in the specs)")
        card["slope_075_25"] = _null(NO_SOURCE + " (no slope-fit rule in the specs)")
        card["phase_angle_deg"] = _phase_angle(data)
        card["sun_vector"] = _sun_vector(data)
    elif kind == "comet":
        # R7.3: gas_Q and coma radius come from the published papers with citations; none are
        # loaded, so they are null and the shells are refused.
        card["coma_radius_km"] = _null("not available: published values not loaded (R7.3)")
        card["nucleus_radius_km_max"] = _null("not available: published values not loaded (R7.3)")
        card["phase_angle_deg"] = _phase_angle(data)
        card["sun_vector"] = _sun_vector(data)
    elif kind in ("brown_dwarf", "brown_dwarf_binary"):
        card["radius_rjup"] = {
            "value": BROWN_DWARF_RADIUS_RJUP,
            "tag": "model_dependent",
            "source": "R7.4 model assumption, not a measurement of this object",
            "assumption": BROWN_DWARF_RADIUS_ASSUMPTION,
        }
        card["spectral_class"] = _spectral_class(cls)
        card["flux_45um"] = _flux_45um(spectrum)
        card["ch4_depth_33"] = _null(NO_SOURCE + " (no CH4 band-depth rule in the specs)")
    elif kind in ("planet_rocky", "planet_water", "gas_giant"):
        _planet_fields(card, data.facts.exoplanet)
    elif kind in ("star", "star_mira", "star_ttauri"):
        card["spectral_class"] = _spectral_class(cls)
        card["teff_K"] = _null("not available: the SIMBAD query has no Teff column")
        card["radius_rsun"] = _null(NO_SOURCE)
        if kind == "star_mira":
            card["period_var_d"] = _null("not available: the SIMBAD query has no period column")
        if kind in ("star_mira", "star_ttauri"):
            card["lightcurve"] = _lightcurve(spectrum)

    rgb = _spherex_rgb(kind, spectrum)
    if rgb is not None:
        card["spherex_rgb"] = rgb
    pm = _pm(obj)
    if pm is not None and kind != "candidate":
        card["pm_mas_yr"] = pm
    return card
