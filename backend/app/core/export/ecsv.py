"""The shared ECSV writer (A19.9; Area search adds its own columns, A17.7).

Built on astropy's ``ascii.ecsv`` writer (astropy 8.0.2, pinned). Each column carries its unit and
description; the metadata holds each column's provenance tag (``column_tags``) and whatever the
caller adds. Same columns, rows and metadata give the same bytes: the metadata keeps the
caller's order, floats are written by astropy's fixed ``repr`` rule, and line ends are ``\n``.
"""

from __future__ import annotations

import io
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
from astropy.table import Table

Kind = Literal["str", "int", "float", "bool"]
Tag = Literal["measured", "derived", "model_dependent", "inferred_from_analog", "artistic"]


@dataclass(frozen=True)
class EcsvColumn:
    name: str
    kind: Kind
    tag: Tag | None  # None: a code or an id, not a value (A19.9 ``refusal``)
    unit: str | None = None
    description: str = ""


_DTYPES = {"str": "str", "int": "int64", "float": "float64", "bool": "bool"}


def write_ecsv(
    columns: Sequence[EcsvColumn], rows: Sequence[Mapping[str, Any]], meta: Mapping[str, Any]
) -> bytes:
    """One ECSV document. ``rows`` hold a value for every column (``None`` is not allowed: a
    caller that has no value leaves the column out, A19.9's refused rows use empty strings)."""
    data: dict[str, list[Any]] = {c.name: [] for c in columns}
    for row in rows:
        for c in columns:
            value = row[c.name]
            if value is None:
                raise ValueError(f"ECSV column {c.name}: no value")
            data[c.name].append(value)
    table = Table()
    for c in columns:
        table[c.name] = np.array(data[c.name], dtype=_DTYPES[c.kind])
        if c.unit:
            table[c.name].unit = c.unit
        if c.description:
            table[c.name].description = c.description
    table.meta.update(
        {
            **dict(meta),
            "column_tags": {c.name: c.tag for c in columns if c.tag is not None},
        }
    )
    buf = io.StringIO(newline="\n")
    table.write(buf, format="ascii.ecsv")
    return buf.getvalue().replace("\r\n", "\n").encode("utf-8")
