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
from app.core.card import stars
from app.core.card.catalogue import CatalogueData
from app.core.classify import Classification, is_calculated
from app.core.find.resolver import ResolvedObject
from app.core.render.card_to_params import MEASURING_PREFIX
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
# Issue #41 two-stage answer: what a field filled from the SPHEREx spectrum says while the spectrum
# is still being measured. The prefix is what the API and the UI test for.
MEASURING = MEASURING_PREFIX + " the SPHEREx spectrum is still being measured"
# Card fields filled from the spectrum (A4.5): spherex_rgb (R5.2), flux_45um (R7.4), lightcurve.
SPECTRUM_FIELDS = frozenset({"spherex_rgb", "flux_45um", "lightcurve"})


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


def _no_spectrum(pending: bool) -> dict[str, Any]:
    return _null(MEASURING if pending else "not available: no SPHEREx spectrum for this object")


def _spherex_rgb(
    kind: str, spectrum: Mapping[str, Any] | None, pending: bool = False
) -> dict[str, Any] | None:
    channels = CHANNELS_BY_TYPE.get(kind)
    if channels is None:
        return None
    if spectrum is None:
        return _no_spectrum(pending)
    rgb = spherex_rgb(_points(spectrum), channels)
    if rgb is None:
        return _null(
            f"{_spherex_source(spectrum)}: fewer than 2 unflagged points in a channel window (R5.2)"
        )
    out = _measured(list(rgb), _spherex_source(spectrum))
    out["formula"] = spherex_formula(channels)  # R5.2 tags it measured (Q-27); formula for clarity
    return out


def _flux_45um(spectrum: Mapping[str, Any] | None, pending: bool = False) -> dict[str, Any]:
    if spectrum is None:
        return _no_spectrum(pending)
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


# PSCompPars "Calculated Value" methods (https://exoplanetarchive.ipac.caltech.edu/docs/pscp_calc.html).
ARCHIVE_CALC = "NASA Exoplanet Archive PSCompPars calculated value (pscp_calc.html)"
ARCHIVE_RADIUS_ASSUMPTION = (
    "radius from the Chen & Kipping 2017 mass-radius relation applied by the archive to the "
    "planet's mass (often a minimum mass, Msini); not a measured radius"
)
ARCHIVE_TEQ_FORMULA = (
    "Teq = T_star * sqrt(R_star / a) * (1/4)^(1/4) (archive calculation: zero albedo, full "
    "heat redistribution)"
)


def _archive_errs(row: Mapping[str, Any], column: str) -> float | None:
    """Largest absolute archive uncertainty of ``column`` (``<column>err1`` and ``err2``)."""
    errs = [abs(e) for e in (_finite(row.get(f"{column}err{i}")) for i in (1, 2)) if e]
    return max(errs) if errs else None


def _archive_value(row: Mapping[str, Any], column: str, label: str) -> dict[str, Any]:
    """One archive column as a tagged value (Q-150). Measured values cite ``<column>_reflink``.
    A ``CALCULATED_VALUE`` is never ``measured``: the archive computed it. Its method is
    documented (pscp_calc.html) only for the radius, mass and Teq handled by name, so any other
    calculated column is ``model_dependent`` and says so."""
    x = _finite(row.get(column))
    if x is None or x <= 0:
        return _null(f"not available: the Exoplanet Archive has no {column} ({label})")
    if is_calculated(row, column):
        return {
            "value": x,
            "tag": "model_dependent",
            "source": f"{ARCHIVE_CALC}, {column}",
            "assumption": (
                f"the archive calculated {column} itself (refstr CALCULATED_VALUE); its method "
                "for this column is not documented here, so it is not a measurement"
            ),
        }
    return _measured(
        x,
        f"NASA Exoplanet Archive PSCompPars {column} ({ref_text(row, column)})",
        _archive_errs(row, column),
    )


ARCHIVE_MASS_MR_ASSUMPTION = (
    "mass estimated from the planet's radius with the Chen & Kipping 2017 mass-radius relation "
    "(archive pl_bmassprov = 'M-R relationship', pscp_calc.html); not a measured mass"
)
ARCHIVE_MSINI_ASSUMPTION = (
    "minimum mass (M sin i) from radial velocity: the true mass is larger by 1/sin(i) and the "
    "inclination is unknown, so this is a lower limit, not the planet's mass"
)
ARCHIVE_MSINI_FORMULA = (
    "M = (M sin i) / sin i, with the inclination from the same reference (archive "
    "pl_bmassprov = 'Msin(i)/sin(i)')"
)


def _mass_field(row: Mapping[str, Any]) -> dict[str, Any]:
    """``mass_mearth`` from ``pl_bmasse``, tagged by ``pl_bmassprov`` (Q-150). Only a true
    "Mass" is ``measured``. An unknown provenance is refused: the kind of mass is not known."""
    x = _finite(row.get("pl_bmasse"))
    if x is None or x <= 0:
        return _null("not available: the Exoplanet Archive has no pl_bmasse")
    prov = row.get("pl_bmassprov")
    source = f"NASA Exoplanet Archive PSCompPars pl_bmasse ({ref_text(row, 'pl_bmasse')})"
    err = _archive_errs(row, "pl_bmasse")
    out: dict[str, Any]
    if prov == "M-R relationship" or is_calculated(row, "pl_bmasse"):
        out = {
            "value": x,
            "tag": "model_dependent",
            "source": f"{ARCHIVE_CALC}, pl_bmasse",
            "assumption": ARCHIVE_MASS_MR_ASSUMPTION,
        }
        err = None  # the archive reports no uncertainty for a calculated value
    elif prov == "Mass":
        out = _measured(x, source)
    elif prov == "Msini":
        out = {
            "value": x,
            "tag": "model_dependent",
            "source": source,
            "assumption": ARCHIVE_MSINI_ASSUMPTION,
        }
    elif prov == "Msin(i)/sin(i)":
        out = {"value": x, "tag": "derived", "source": source, "formula": ARCHIVE_MSINI_FORMULA}
    else:
        return _null(
            f"not available: pl_bmassprov is {prov!r}, so the kind of mass (true, minimum or "
            "estimated) is not known"
        )
    if err is not None:
        out["err"] = err
    return out


def _planet_fields(card: dict[str, Any], row: Mapping[str, Any] | None) -> None:
    """R7.7 size, D-12 temperature, and (Q-150) mass, orbit and host star from the Exoplanet
    Archive row (A3.8).

    A value the archive calculated itself (``refstr=CALCULATED_VALUE``) is not ``measured``:
    the radius is ``model_dependent`` (a mass-radius relation) and Teq ``derived`` (Q-63)."""
    row = row or {}
    radius = _finite(row.get("pl_radj"))
    if radius is None or radius <= 0:
        card["radius_rjup"] = _null("not available: the Exoplanet Archive has no pl_radj")
    elif is_calculated(row, "pl_radj"):
        card["radius_rjup"] = {
            "value": radius,
            "tag": "model_dependent",
            "source": f"{ARCHIVE_CALC}, pl_radj",
            "assumption": ARCHIVE_RADIUS_ASSUMPTION,
        }
    else:
        errs = [abs(e) for e in (_finite(row.get(k)) for k in ("pl_radjerr1", "pl_radjerr2")) if e]
        card["radius_rjup"] = _measured(
            radius,
            f"NASA Exoplanet Archive PSCompPars pl_radj ({ref_text(row, 'pl_radj')})",
            max(errs) if errs else None,
        )
    teq = _finite(row.get("pl_eqt"))
    if teq is not None and teq > 0 and is_calculated(row, "pl_eqt"):
        card["teq_K"] = {
            "value": teq,
            "tag": "derived",
            "source": f"{ARCHIVE_CALC}, pl_eqt",
            "formula": ARCHIVE_TEQ_FORMULA,
        }
    elif teq is not None and teq > 0:
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
    card["mass_mearth"] = _mass_field(row)
    card["orbit_au"] = _archive_value(row, "pl_orbsmax", "semi-major axis in au")
    card["orbital_period_d"] = _archive_value(row, "pl_orbper", "orbital period in days")
    card["host_teff_K"] = _archive_value(row, "st_teff", "host star effective temperature in K")
    card["host_radius_rsun"] = _archive_value(row, "st_rad", "host star radius in solar radii")
    card["host_mass_msun"] = _archive_value(row, "st_mass", "host star mass in solar masses")
    card["host_age_gyr"] = _archive_value(row, "st_age", "host star age in Gyr")


def _literature_fill(card: dict[str, Any], data: CatalogueData) -> None:
    """Q-153: a field the catalogues left null takes the literature registry's value, with the
    registry's own tag and a ``literature:`` source. A field with a catalogue value is never
    touched, and a field the type does not use is not added. A registry refusal replaces the
    generic reason of a still-null field."""
    for name, tv in list(card.items()):
        if not isinstance(tv, dict) or tv.get("value", 0) is not None:
            continue
        filled = data.literature.tv(name)
        if filled is not None:
            card[name] = filled
        elif name in data.literature.refusals:
            card[name] = {**tv, "source": f"not available: {data.literature.refusals[name]}"}


def _star_fields(card: dict[str, Any], kind: str, data: CatalogueData) -> None:
    """``teff_K``, ``radius_rsun`` and (Mira) ``period_var_d`` by the Q-152 source order. A
    literature radius (an interferometric one) goes before Gaia FLAME; every other literature
    value waits for the generic fill, which runs only when this left the field null."""
    card["teff_K"] = stars.teff_field(data.star, kind, data.dwarf_table)
    card["radius_rsun"] = data.literature.tv("radius_rsun") or stars.radius_field(data.star)
    if kind == "star_mira":
        card["period_var_d"] = stars.period_field(data.star)


def build_card(
    obj: ResolvedObject,
    data: CatalogueData,
    cls: Classification,
    spectrum: Mapping[str, Any] | None,
    *,
    spectrum_pending: bool = False,
) -> dict[str, Any]:
    """``spectrum_pending``: the first-stage card of issue #41. The spectrum is still being
    measured, so the fields it fills (``SPECTRUM_FIELDS``) are null with a ``measuring:`` reason
    instead of a refusal. They are never guessed."""
    kind = cls.type
    name = obj.name or obj.id
    planet = data.facts.exoplanet
    if planet and isinstance(planet.get("pl_name"), str) and planet["pl_name"].strip():
        # The archive's planet name ("GJ 1214 b"), not SIMBAD's main_id ("NAME G 139-21b").
        name = planet["pl_name"].strip()
    card: dict[str, Any] = {"id": obj.id, "name": name, "type": kind}

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
        card["flux_45um"] = _flux_45um(spectrum, spectrum_pending)
        card["ch4_depth_33"] = _null(NO_SOURCE + " (no CH4 band-depth rule in the specs)")
        if kind == "brown_dwarf_binary":
            card["component_teff_K"] = _null(
                "not available: no published Teff for the two components in the literature "
                "registry (Q-154)"
            )
    elif kind in ("planet_rocky", "planet_water", "gas_giant"):
        _planet_fields(card, data.facts.exoplanet)
    elif kind in ("star", "star_mira", "star_ttauri"):
        card["spectral_class"] = _spectral_class(cls)
        _star_fields(card, kind, data)
        if kind in ("star_mira", "star_ttauri"):
            card["lightcurve"] = _lightcurve(spectrum)

    _literature_fill(card, data)

    rgb = _spherex_rgb(kind, spectrum, spectrum_pending)
    if rgb is not None:
        card["spherex_rgb"] = rgb
    pm = _pm(obj)
    if pm is not None and kind != "candidate":
        card["pm_mas_yr"] = pm
    return card
