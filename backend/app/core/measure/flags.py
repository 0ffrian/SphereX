"""FLAGS bits by name. Names come from the ``MP_*`` header keywords through Stage 1's
``wcs.flag_names`` (no second parser)."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

import numpy as np
from numpy.typing import NDArray

from app.core.find import wcs


def bits_by_name(header: Any) -> dict[str, int]:
    """Name -> bit number (e.g. ``HOT`` -> 10). Empty when the header names no bits (``wcs.flag_names``)."""
    return {name: bit for bit, name in wcs.flag_names(header).items()}


def mask_of(
    flags: NDArray[Any], names: Iterable[str], bits: dict[str, int]
) -> tuple[NDArray[np.bool_], list[str]]:
    """Pixels with any of ``names`` set, and the names that the header does not define."""
    value = 0
    absent: list[str] = []
    for name in names:
        if name in bits:
            value |= 1 << bits[name]
        else:
            absent.append(name)
    arr = np.asarray(flags).astype(np.int64)
    return np.asarray((arr & value) != 0, dtype=np.bool_), absent


def names_set(values: Iterable[int], names: Iterable[str], bits: dict[str, int]) -> list[str]:
    """Which of ``names`` are set in any of ``values`` (sorted)."""
    vals = [int(v) for v in values]
    found = {n for n in names if n in bits and any(v >> bits[n] & 1 for v in vals)}
    return sorted(found)
