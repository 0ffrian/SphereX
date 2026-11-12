"""Star temperature, radius and variability period for the card (issue #68 Part 8c, Q-152).

Source order for ``teff_K`` (the first source that answers wins; an unusable one is skipped with
its reason, never replaced by a guess):

1. SIMBAD ``mesFe_h``: the published spectroscopic Teff values. Median of the non-null rows; when
   two values sit in the middle the one from the most recent bibcode is taken. Tag ``derived``.
2. Gaia DR3 GSP-Phot ``teff_gspphot``. Skipped at or below ``GSPPHOT_COOL_STAR_LIMIT_K``. Tag
   ``model_dependent``.
3. Gaia DR3 Multiple Star Classifier ``teff_msc1`` (Q-220), tried when GSP-Phot gave nothing
   usable. The classifier models the source as an unresolved binary and reports the primary's
   Teff. Tag ``model_dependent``, with the binary assumption and, for a Mira, the variability
   caveat stated in ``assumption``.
4. Pecaut & Mamajek 2013 Table 5 mean dwarf Teff for the SIMBAD spectral type, dwarfs only
   (``V`` luminosity class, kind ``star``). Tag ``inferred_from_analog``. There is no verified
   table for giants, Miras or pre-main-sequence stars, so those are refused here.

``radius_rsun``: a registry (``literature.toml``) interferometric radius, else Gaia FLAME
``radius_flame`` (``model_dependent``), else refused. A spectral-class table never gives a radius.

``lum_lsun`` and ``mass_msun`` (issue #93 B): Gaia FLAME ``lum_flame`` and ``mass_flame``
(``model_dependent``, as ``radius_flame``), else refused. No table or relation fills them here; the
frontend's own tier chain answers when they are null.

``period_var_d`` (Mira only): median of the SIMBAD ``mesVar`` periods whose ``vartyp`` is LPV or M.
Tag ``measured``.
"""

from __future__ import annotations

import logging
import re
import tomllib
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.adapters.gaia import GaiaAstro
from app.adapters.simbad import TeffRow, VarRow

log = logging.getLogger("shift_spectrum")

STAR_TYPES = ("star", "star_mira", "star_ttauri")

# Gaia DR3 documentation, Sec 11.4.4 (astrophysical parameters validation): "The fluxes and
# spectra of cool stars (Teff ~ 4000 K and cooler) will show significant molecular absorption that
# are not modelled well." The page gives no quality flag, so this is a cut on the value itself.
GSPPHOT_COOL_STAR_LIMIT_K = 4000.0
GAIA_DOCS_NOTE = (
    "Gaia DR3 documentation Sec 11.4.4: cool stars (Teff about 4000 K and below) show molecular "
    "absorption that GSP-Phot does not model well"
)
# The MSC value is the primary of a modelled unresolved binary (Gaia DR3 documentation,
# astrophysical_parameters ``teff_msc1``). Gaia DR3 BP/RP spectra are means over the 34 months of
# DR3 observations, so a variable star's value is not a snapshot.
MSC_ASSUMPTION = (
    "Gaia's Multiple Star Classifier fits the BP/RP spectrum with an unresolved binary model and "
    "reports the primary's Teff: this assumes the source is a binary, which has not been "
    "established for this star. For cool stars (below about 3500 K) molecular absorption "
    "(TiO, VO) dominates the BP/RP spectrum and the fit can be biased. The spectrum is a mean "
    "over the 34 months of Gaia DR3 "
    "observations{mira}, and the 16th to 84th percentile range is the only uncertainty given"
)
MSC_MIRA_NOTE = (
    ", so for a Mira variable such as this the value is an average over its pulsation cycles "
    "and not the temperature at any one phase"
)
# Variability types of a pulsating long-period variable in SIMBAD ``mesVar.vartyp`` (Q-152).
MIRA_VARTYPES = frozenset({"LPV", "M"})

NO_MIRA_TABLE = (
    "no verified Teff table exists for M giants or Miras (Q-152), so the class table is not used"
)
NO_TTAURI_TABLE = (
    "no verified Teff table exists for pre-main-sequence stars (Q-152), so the class table is "
    "not used"
)
_DWARF = re.compile(r"^([OBAFGKM])(\d(?:\.5)?)V$")


@dataclass(frozen=True)
class StarCatalogue:
    """What the star-specific catalogue queries answered. A ``*_reason`` is why a list is empty
    because the call could not be made (an outage, offline, no position); an empty list with no
    reason means the catalogue answered with no rows."""

    teff_rows: tuple[TeffRow, ...] = ()
    teff_reason: str | None = None
    var_rows: tuple[VarRow, ...] = ()
    var_reason: str | None = None
    gaia: GaiaAstro | None = None
    gaia_sep_arcsec: float | None = None
    gaia_reason: str | None = None
    sp_type: str | None = None


def _bibcode_key(bibcode: str) -> tuple[int, str]:
    year = int(bibcode[:4]) if bibcode[:4].isdigit() else 0
    return (year, bibcode)


def median_pick[T](
    rows: Sequence[T], value: Callable[[T], float], bibcode: Callable[[T], str]
) -> tuple[T, int, float, float]:
    """The middle row of ``rows`` by value, with the count and the value range.

    Odd count: the middle value; among rows with that same value, the most recent bibcode. Even
    count: of the two middle values, the one from the more recent bibcode (equal bibcodes: the
    lower value). So the answer is always a published value, never an average. Deterministic.
    """
    ordered = sorted(rows, key=lambda r: (value(r), bibcode(r)))
    n = len(ordered)
    if n % 2:
        mid = value(ordered[n // 2])
        pool = [r for r in ordered if value(r) == mid]
    else:
        a, b = ordered[n // 2 - 1], ordered[n // 2]
        pool = [a, b] if value(a) != value(b) else [r for r in ordered if value(r) == value(a)]
    pick = max(pool, key=lambda r: (_bibcode_key(bibcode(r)), -value(r)))
    return pick, n, value(ordered[0]), value(ordered[-1])


def _null(source: str, tag: str) -> dict[str, Any]:
    """A refusal: value null, reason in ``source``. Tag measured, as every null in build.py."""
    return {"value": None, "tag": tag, "source": source}


# --- class table -----------------------------------------------------------------------------


@dataclass(frozen=True)
class DwarfTable:
    source: str
    teff_k: dict[str, float]


def load_dwarf_table(path: Path) -> DwarfTable | None:
    """``pm13_dwarf_teff.toml``. A missing or broken file means no class-table tier (warning)."""
    try:
        doc = tomllib.loads(path.read_text("utf-8"))
        rows = {str(k): float(v) for k, v in doc["teff_K"].items()}
        return DwarfTable(str(doc["source"]), rows)
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as e:
        log.warning("dwarf Teff table %s unreadable, no class-table tier: %s", path, e)
        return None


def dwarf_class(sp_type: str | None) -> str | None:
    """ "M4V" -> "M4V"; anything that is not exactly a main-sequence type -> None (a giant, a
    peculiar or composite type, a pre-main-sequence star)."""
    if not sp_type:
        return None
    s = sp_type.strip()
    return s if _DWARF.match(s) else None


# --- teff_K ----------------------------------------------------------------------------------


def teff_field(cat: StarCatalogue | None, kind: str, table: DwarfTable | None) -> dict[str, Any]:
    """The card's ``teff_K`` value, by the Q-152 source order."""
    if cat is None:
        return _null("not available: the star catalogues were not queried", "measured")
    skipped: list[str] = []
    if cat.teff_rows:
        row, n, lo, hi = median_pick(cat.teff_rows, lambda r: r.teff_k, lambda r: r.bibcode)
        return {
            "value": row.teff_k,
            "tag": "derived",
            "source": (
                f"SIMBAD mesFe_h: median of {n} published spectroscopic Teff values "
                f"({lo:g} to {hi:g} K); the middle value is from {row.bibcode}"
            ),
            "formula": (
                "median of the non-null Teff values in SIMBAD mesFe_h; of two middle values, "
                "the one from the most recent bibcode (Q-152)"
            ),
        }
    skipped.append(cat.teff_reason or "SIMBAD mesFe_h has no Teff for this object")

    g = cat.gaia
    if g is not None and g.teff_gspphot_k is not None:
        if g.teff_gspphot_k > GSPPHOT_COOL_STAR_LIMIT_K:
            out: dict[str, Any] = {
                "value": g.teff_gspphot_k,
                "tag": "model_dependent",
                "source": f"Gaia DR3 astrophysical_parameters teff_gspphot, source {g.source_id}"
                f"{_match_note(cat)}",
                "assumption": (
                    "GSP-Phot is a model fit to the Gaia BP/RP spectrum; its error against "
                    "literature values is typically 120 K (median absolute) and extinction "
                    "biases it (Gaia DR3 documentation Sec 11.4.4)"
                ),
            }
            lo_up = [
                abs(g.teff_gspphot_k - x)
                for x in (g.teff_gspphot_lower_k, g.teff_gspphot_upper_k)
                if x is not None
            ]
            if lo_up:
                out["err"] = max(lo_up)
            return out
        skipped.append(f"Gaia GSP-Phot Teff {g.teff_gspphot_k:g} K skipped ({GAIA_DOCS_NOTE})")
    elif cat.gaia_reason:
        skipped.append(cat.gaia_reason)
    else:
        skipped.append("Gaia DR3 has no GSP-Phot Teff for this star")

    if g is not None and g.teff_msc1_k is not None:
        out = {
            "value": g.teff_msc1_k,
            "tag": "model_dependent",
            "source": f"Gaia DR3 astrophysical_parameters teff_msc1 (Multiple Star Classifier), "
            f"source {g.source_id}{_match_note(cat)}",
            "assumption": MSC_ASSUMPTION.format(mira=MSC_MIRA_NOTE if kind == "star_mira" else ""),
        }
        spread = [
            abs(g.teff_msc1_k - x)
            for x in (g.teff_msc1_lower_k, g.teff_msc1_upper_k)
            if x is not None
        ]
        if spread:
            out["err"] = max(spread)
        return out
    if g is not None:
        skipped.append("Gaia DR3 has no Multiple Star Classifier Teff for this star")

    if kind == "star":
        cls = dwarf_class(cat.sp_type)
        if cls is None:
            skipped.append(
                f"spectral type {cat.sp_type or 'unknown'!r} is not a main-sequence (V) type, "
                "so the dwarf class table does not apply"
            )
        elif table is None or cls not in table.teff_k:
            skipped.append(f"the dwarf class table has no row for {cls}")
        else:
            return {
                "value": table.teff_k[cls],
                "tag": "inferred_from_analog",
                "source": f"{table.source}: mean dwarf of spectral type {cls}",
            }
    else:
        skipped.append(NO_TTAURI_TABLE if kind == "star_ttauri" else NO_MIRA_TABLE)
    return _null("not available: " + "; ".join(skipped), "measured")


def _match_note(cat: StarCatalogue) -> str:
    """How far the Gaia source sits from the SIMBAD position moved to the Gaia epoch (Q-152)."""
    if cat.gaia_sep_arcsec is None:
        return ""
    return (
        f", matched {cat.gaia_sep_arcsec:.2f} arcsec from the SIMBAD position "
        "moved to 2016.0 by its proper motion"
    )


# --- radius_rsun -----------------------------------------------------------------------------


def radius_field(cat: StarCatalogue | None) -> dict[str, Any]:
    """Gaia FLAME radius, else a refusal. (A registry radius is applied before this one.)"""
    why = "Gaia DR3 has no FLAME radius for this star"
    if cat is not None and cat.gaia is not None and cat.gaia.radius_flame_rsun is not None:
        g = cat.gaia
        r = g.radius_flame_rsun
        assert r is not None
        out: dict[str, Any] = {
            "value": r,
            "tag": "model_dependent",
            "source": f"Gaia DR3 astrophysical_parameters radius_flame, source {g.source_id}"
            f"{_match_note(cat)}",
            "assumption": (
                "FLAME radius from the GSP-Phot Teff and a model bolometric luminosity (Gaia DR3 "
                "radius_flame); a model value, not a measured radius, and it inherits GSP-Phot's "
                "weakness for cool stars"
            ),
        }
        errs = [
            abs(r - x)
            for x in (g.radius_flame_lower_rsun, g.radius_flame_upper_rsun)
            if x is not None
        ]
        if errs:
            out["err"] = max(errs)
        return out
    if cat is not None and cat.gaia_reason:
        why = cat.gaia_reason
    return _null(
        f"not available: {why}; no interferometric radius is in the literature registry, and a "
        "spectral-class table is never used for a radius (Q-152)",
        "measured",
    )


# --- lum_lsun, mass_msun (issue #93 B) -------------------------------------------------------

FLAME_LUM_ASSUMPTION = (
    "FLAME luminosity from the Gaia G magnitude, the GSP-Phot extinction, the parallax (or "
    "GSP-Phot distance) and a bolometric correction that depends on the GSP-Phot Teff, gravity "
    "and metallicity (Gaia DR3 datamodel, lum_flame); a model value, not a measured luminosity, "
    "and it inherits GSP-Phot's weakness for cool stars"
)
FLAME_MASS_ASSUMPTION = (
    "FLAME mass from comparing the GSP-Phot Teff and the FLAME luminosity with the BaSTI "
    "solar-metallicity stellar evolution models (Gaia DR3 datamodel, mass_flame); solar "
    "metallicity is assumed, and it is a model value, not a dynamical mass"
)


def _flame_field(
    cat: StarCatalogue | None,
    column: str,
    pick: Callable[[GaiaAstro], tuple[float | None, float | None, float | None]],
    assumption: str,
) -> dict[str, Any]:
    """One Gaia FLAME column as a ``model_dependent`` value with the larger half-width of its 16th
    to 84th percentile range as ``err``, else a refusal with the reason (the radius_flame rule)."""
    if cat is not None and cat.gaia is not None:
        g = cat.gaia
        x, lo, hi = pick(g)
        if x is not None and x > 0:
            out: dict[str, Any] = {
                "value": x,
                "tag": "model_dependent",
                "source": f"Gaia DR3 astrophysical_parameters {column}, source {g.source_id}"
                f"{_match_note(cat)}",
                "assumption": assumption,
            }
            errs = [abs(x - b) for b in (lo, hi) if b is not None]
            if errs and max(errs) > 0:  # a range rounded to nothing is not a zero error
                out["err"] = max(errs)
            return out
    why = f"Gaia DR3 has no FLAME {column} for this star"
    if cat is None:
        why = "the star catalogues were not queried"
    elif cat.gaia is None and cat.gaia_reason:
        why = cat.gaia_reason
    return _null(f"not available: {why}", "measured")


def luminosity_field(cat: StarCatalogue | None) -> dict[str, Any]:
    """``lum_lsun`` from Gaia FLAME ``lum_flame``, else a refusal (issue #93 B)."""
    return _flame_field(
        cat,
        "lum_flame",
        lambda g: (g.lum_flame_lsun, g.lum_flame_lower_lsun, g.lum_flame_upper_lsun),
        FLAME_LUM_ASSUMPTION,
    )


def mass_field(cat: StarCatalogue | None) -> dict[str, Any]:
    """``mass_msun`` from Gaia FLAME ``mass_flame``, else a refusal (issue #93 B)."""
    return _flame_field(
        cat,
        "mass_flame",
        lambda g: (g.mass_flame_msun, g.mass_flame_lower_msun, g.mass_flame_upper_msun),
        FLAME_MASS_ASSUMPTION,
    )


# --- period_var_d ----------------------------------------------------------------------------


def period_field(cat: StarCatalogue | None) -> dict[str, Any]:
    """Mira period from SIMBAD mesVar (rows typed LPV or M only), else a refusal."""
    rows = [r for r in (cat.var_rows if cat else ()) if (r.vartyp or "") in MIRA_VARTYPES]
    if rows:
        row, n, lo, hi = median_pick(rows, lambda r: r.period_d, lambda r: r.bibcode)
        out: dict[str, Any] = {
            "value": row.period_d,
            "tag": "measured",
            "source": (
                f"SIMBAD mesVar: median of {n} periods typed LPV or M ({lo:g} to {hi:g} d); "
                f"the middle value is from {row.bibcode}"
            ),
        }
        if n > 1:
            # Picked from several published values, like the Teff median above (Q-152): the choice
            # is a derivation. One row is that paper's measurement.
            out["tag"] = "derived"
            out["formula"] = (
                "median of the mesVar periods typed LPV or M; of two middle values, the one "
                "from the most recent bibcode (Q-152)"
            )
        return out
    if cat is not None and cat.var_reason:
        why = cat.var_reason
    elif cat is not None and cat.var_rows:
        why = "SIMBAD mesVar has periods only for other variability types, not LPV or M"
    else:
        why = "SIMBAD mesVar has no period for this object"
    return _null(f"not available: {why}", "measured")
