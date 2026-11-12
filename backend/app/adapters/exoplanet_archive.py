"""NASA Exoplanet Archive planet row through TAP (A3.8): table ``pscomppars``.

One composite row per planet (the archive's best-value set). Tested live on 2026-11-07 against
``https://exoplanetarchive.ipac.caltech.edu/TAP/sync`` with ``format=json``; ADQL ``lower()`` works.
``st_age``, the ``*err1/2`` columns and the host-star ``*_reflink`` columns were checked on
2026-11-09 (issue #68).
Names are matched case-insensitively against a short candidate list (see ``name_candidates``).
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from typing import Any

from app.adapters.http import UpstreamError
from app.cache.keys import CacheKey, norm_name
from app.cache.store import LiveResponse, Served
from app.context import Context

SOURCE = "exoplanet_archive"
TABLE = "pscomppars"
# Values copied to the row; each `*_reflink` column names the paper behind that value.
VALUE_COLUMNS = (
    "pl_name",
    "hostname",
    "pl_rade",
    "pl_radeerr1",
    "pl_radeerr2",
    "pl_radj",
    "pl_radjerr1",
    "pl_radjerr2",
    "pl_bmasse",
    "pl_bmasseerr1",
    "pl_bmasseerr2",
    "pl_bmassj",
    "pl_bmassprov",
    "pl_dens",
    "pl_eqt",
    "pl_orbsmax",
    "pl_orbsmaxerr1",
    "pl_orbsmaxerr2",
    "pl_orbper",
    "pl_orbpererr1",
    "pl_orbpererr2",
    "pl_orbeccen",
    "pl_orbeccenerr1",
    "pl_orbeccenerr2",
    "pl_orbeccenlim",
    "pl_insol",
    "pl_insolerr1",
    "pl_insolerr2",
    "st_teff",
    "st_tefferr1",
    "st_tefferr2",
    "st_rad",
    "st_raderr1",
    "st_raderr2",
    "st_mass",
    "st_masserr1",
    "st_masserr2",
    "st_age",
    "st_ageerr1",
    "st_ageerr2",
    "st_lum",
    "st_lumerr1",
    "st_lumerr2",
    "sy_dist",
)
REF_COLUMNS = (
    "pl_rade_reflink",
    "pl_radj_reflink",
    "pl_bmasse_reflink",
    "pl_eqt_reflink",
    "pl_orbsmax_reflink",
    "pl_orbper_reflink",
    "pl_orbeccen_reflink",
    "pl_insol_reflink",
    "st_teff_reflink",
    "st_rad_reflink",
    "st_mass_reflink",
    "st_age_reflink",
    "st_lum_reflink",
)
# Part of the cache key, so a reply recorded with fewer columns is never served for a card that
# needs st_age or the host-star references (issue #68, Q-150). Bump when COLUMNS changes.
# 3 (issue #93 section 5 A-B): the eccentricity errors and reference, pl_insol and st_lum (checked
# live against pscomppars on 2026-11-11: every column answers).
# 4 (issue #93 A6): pl_orbeccenlim, the limit flag (1 upper limit, -1 lower limit, 0 a value).
COLUMNS_VERSION = "4"
COLUMNS = VALUE_COLUMNS + REF_COLUMNS
_REF_TEXT = re.compile(r">([^<]+)</a>")
_PLANET_LETTER = re.compile(r"^(.*\S)([b-z])$")


def name_candidates(*names: str | None) -> list[str]:
    """Spellings to try, in order: each given name, then with a space before a trailing planet
    letter ("K2-18b" -> "K2-18 b"). Whitespace-normalised and de-duplicated, case-insensitive."""
    out: list[str] = []
    seen: set[str] = set()
    expanded: list[str] = []
    for n in names:
        if not n or not norm_name(n):
            continue
        n = norm_name(n)
        expanded.append(n)
    for n in list(expanded):
        m = _PLANET_LETTER.match(n)
        if m and not m.group(1).endswith(" ") and m.group(1)[-1].isalnum():
            expanded.append(f"{m.group(1)} {m.group(2)}")
    for n in expanded:
        if n.lower() not in seen:
            seen.add(n.lower())
            out.append(n)
    return out


def archive_key(candidates: Sequence[str]) -> CacheKey:
    return CacheKey.make(
        SOURCE, None, pl_name="|".join(c.lower() for c in candidates), cols=COLUMNS_VERSION
    )


def adql(candidates: Sequence[str]) -> str:
    lits = ", ".join("'" + c.lower().replace("'", "''") + "'" for c in candidates)
    return f"SELECT {', '.join(COLUMNS)} FROM {TABLE} WHERE lower(pl_name) IN ({lits})"


def parse(body: bytes, candidates: Sequence[str] = ()) -> dict[str, Any] | None:
    """The first row, preferring the earliest candidate name. None when there is no row."""
    doc = json.loads(body)
    if not isinstance(doc, list):
        raise ValueError("not a JSON array")
    rows = [r for r in doc if isinstance(r, dict) and r.get("pl_name")]
    if not rows:
        return None
    order = {c.lower(): i for i, c in enumerate(candidates)}
    rows.sort(key=lambda r: order.get(str(r["pl_name"]).lower(), len(order)))
    return rows[0]


def ref_text(row: Mapping[str, Any], column: str) -> str:
    """Reference text for a value column, e.g. "Sarkis et al. 2018"."""
    link = row.get(f"{column}_reflink")
    m = _REF_TEXT.search(link) if isinstance(link, str) else None
    return m.group(1).strip() if m else "no reference given"


def query(
    ctx: Context, names: Sequence[str | None], *, refresh: bool = False
) -> tuple[dict[str, Any] | None, Served | None]:
    """Archive row for the first matching name, or (None, None) when there is nothing to ask."""
    cands = name_candidates(*names)
    if not cands:
        return None, None
    params = {"query": adql(cands), "format": "json"}

    def live() -> LiveResponse:
        resp = ctx.http.get(ctx.settings.exoplanet_tap_url, params)
        try:
            if not isinstance(json.loads(resp.body), list):
                raise ValueError("not a list")
        except ValueError as exc:  # an ADQL error is not a row list
            raise UpstreamError(f"{ctx.settings.exoplanet_tap_url}: not a JSON row list") from exc
        return resp

    served = ctx.cache.fetch(archive_key(cands), live, refresh=refresh)
    return parse(served.entry.body, cands), served
