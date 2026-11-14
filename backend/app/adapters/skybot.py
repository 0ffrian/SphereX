"""IMCCE SkyBoT cone search: known solar-system bodies in a field (A3.5).

The epoch ``-ep`` must be a Julian day; a calendar date returned an empty 204 answer.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime

from app.adapters.http import UpstreamError
from app.cache.keys import CacheKey, norm_dec, norm_float, norm_ra
from app.cache.store import LiveResponse, Served
from app.context import Context
from app.timefmt import utc_to_jd

SOURCE = "skybot"


@dataclass(frozen=True)
class SkybotBody:
    name: str
    number: int | None
    ra: float  # deg
    dec: float  # deg
    v_mag: float | None
    sso_class: str | None
    # A17.5 (Q-180): SkyBoT's position error ("Err (arcsec)"), None when not given. The motion
    # rates are not in the ``-output object`` answer this adapter asks for (its cache key does not
    # carry the output mode), so they are not read.
    pos_err_arcsec: float | None = None


def skybot_key(ra: float, dec: float, radius_deg: float, jd: str) -> CacheKey:
    return CacheKey.make(
        SOURCE, None, ra=norm_ra(ra), dec=norm_dec(dec), radius=norm_float(radius_deg, 6), ep=jd
    )


def _hms_to_deg(text: str) -> float:
    h, m, s = (float(x) for x in text.split())
    return 15.0 * (h + m / 60.0 + s / 3600.0)


def _dms_to_deg(text: str) -> float:
    t = text.strip()
    sign = -1.0 if t.startswith("-") else 1.0
    d, m, s = (abs(float(x)) for x in t.lstrip("+-").split())
    return sign * (d + m / 60.0 + s / 3600.0)


def _opt_float(value: object) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        v = float(str(value))
    except ValueError:
        return None
    return v if math.isfinite(v) and v >= 0.0 else None


def parse(status: int, body: bytes) -> list[SkybotBody]:
    if status == 204 or not body.strip():
        return []
    doc = json.loads(body)
    items = doc if isinstance(doc, list) else doc.get("data", [])
    out: list[SkybotBody] = []
    for it in items:
        num = it.get("Num")
        out.append(
            SkybotBody(
                name=str(it.get("Name", "")),
                number=int(num) if isinstance(num, int | str) and str(num).isdigit() else None,
                ra=_hms_to_deg(str(it["RA (hms)"])),
                dec=_dms_to_deg(str(it["DEC (dms)"])),
                v_mag=float(it["VMag (mag)"]) if it.get("VMag (mag)") is not None else None,
                sso_class=str(it["Class"]) if it.get("Class") else None,
                pos_err_arcsec=_opt_float(it.get("Err (arcsec)")),
            )
        )
    return out


def conesearch(
    ctx: Context, ra: float, dec: float, radius_deg: float, when: datetime, *, refresh: bool = False
) -> tuple[list[SkybotBody], Served]:
    jd = f"{utc_to_jd(when):.6f}"
    key = skybot_key(ra, dec, radius_deg, jd)
    q = dict(key.query)

    def live() -> LiveResponse:
        params = {
            "-ep": jd,
            "-ra": q["ra"],
            "-dec": q["dec"],
            "-rd": q["radius"],
            "-mime": "json",
            "-output": "object",
            "-loc": "500",
            "-filter": "0",
            "-objFilter": "111",
            "-from": "ShiftSpectrum",
        }
        resp = ctx.http.get(ctx.settings.skybot_url, params, accept=frozenset({200, 204}))
        # Read it before it is cached: an error page answered with 200 would otherwise be kept
        # for good and fail every later read of this cone (as Horizons' `_fetch` checks).
        try:
            parse(resp.status, resp.body)
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            raise UpstreamError(f"SkyBoT answer could not be read: {exc}") from exc
        return resp

    served = ctx.cache.fetch(key, live, refresh=refresh)
    return parse(served.entry.status, served.entry.body), served
