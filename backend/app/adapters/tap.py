"""Synchronous TAP queries returning CSV (Gaia and CatWISE cones, issue #12; A3.2, A3.3).

The answer must be CSV whose header row is exactly the requested columns. A TAP error comes
back as VOTable XML (sometimes with HTTP 200); that is a failed call, never a cached value.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Callable, Sequence

from app.adapters.http import UpstreamError
from app.cache.store import LiveResponse
from app.context import Context


def cone_adql(
    table: str,
    columns: Sequence[str],
    ra: str,
    dec: str,
    radius_deg: str,
    *,
    where: str = "",
    order_by: str,
    top: int,
    ra_col: str = "ra",
    dec_col: str = "dec",
) -> str:
    extra = f" AND {where}" if where else ""
    return (
        f"SELECT TOP {top} {', '.join(columns)} FROM {table} "
        f"WHERE 1=CONTAINS(POINT('ICRS',{ra_col},{dec_col}),CIRCLE('ICRS',{ra},{dec},{radius_deg}))"
        f"{extra} ORDER BY {order_by}"
    )


def read_csv(body: bytes, columns: Sequence[str]) -> list[dict[str, str]]:
    """Rows as dicts. Raises ``ValueError`` when the header is not exactly ``columns``."""
    text = body.decode("utf-8-sig")
    reader = csv.reader(io.StringIO(text))
    header = next(reader, None)
    if header is None or [h.strip() for h in header] != list(columns):
        raise ValueError(f"unexpected TAP header: {header!r}")
    return [dict(zip(columns, (v.strip() for v in rec), strict=True)) for rec in reader if rec]


def query_csv(
    ctx: Context,
    mirrors: Sequence[tuple[str, str]],
    build_adql: Callable[[str], str],
    columns: Sequence[str],
    *,
    read_timeout_s: float | None,
    parse: Callable[[bytes], object] | None = None,
) -> LiveResponse:
    """Try each ``(url, table)`` mirror in order; the first valid CSV wins. ``build_adql`` maps
    a table name to the ADQL text. The table used is stored in the meta as ``table``.

    ``parse`` is the adapter's full row parser. It runs on every row before the reply is
    returned (and so cached): a body with one unparsable number is a failed call, never a cached
    value that is refused on every later request. Without it only the header is checked."""
    errors: list[str] = []
    for i, (url, table) in enumerate(mirrors):
        params = {
            "REQUEST": "doQuery",
            "LANG": "ADQL",
            "FORMAT": "csv",
            "QUERY": build_adql(table),
        }
        try:
            resp = ctx.http.get(
                url, params, read_timeout_s=read_timeout_s, retry_connect=i == len(mirrors) - 1
            )
        except UpstreamError as exc:
            errors.append(str(exc))
            continue
        try:
            if parse is None:
                read_csv(resp.body, columns)
            else:
                parse(resp.body)
        except (ValueError, KeyError, UnicodeDecodeError, csv.Error) as exc:
            errors.append(f"{url}: not the expected CSV ({exc})")
            continue
        extra = {"table": table, "adql": params["QUERY"]}
        return LiveResponse(resp.body, resp.url, resp.status, resp.content_type, extra)
    raise UpstreamError("; ".join(errors) or "no TAP URL configured")


def opt_float(text: str) -> float | None:
    t = text.strip()
    if not t or t.lower() in ("nan", "null", "none"):
        return None
    v = float(t)
    return v if v == v else None
