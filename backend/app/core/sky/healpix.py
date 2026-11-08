"""HEALPix NESTED scheme in numpy (Gorski et al. 2005, ApJ 622, 759; the HEALPix C++ library).

Only what the sky bake needs: angle -> nested pixel, nested pixel -> angle (pixel centre), and
the face/x/y bit (de)interleaving. Angles are colatitude ``theta`` in [0, pi] and longitude
``phi`` in radians; for an equatorial HiPS ``theta = pi/2 - Dec`` and ``phi = RA``.

Inside a base face, pixel ``(ix, iy)`` has nested index ``face * nside**2 + interleave(ix, iy)``
with ``ix`` in the even bits and ``iy`` in the odd bits. ``ix`` grows from the face's south
corner towards its east corner and ``iy`` from the south corner towards its west corner (the
HEALPix convention; see ``pix2ang`` below).
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray

IntArray = NDArray[np.int64]
FloatArray = NDArray[np.float64]

MAX_ORDER = 29

# Ring index (in units of nside) of each base face's southern corner, and its phi offset
# in units of pi/4 (HEALPix C++ jrll / jpll).
_JRLL = np.array([2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4], dtype=np.int64)
_JPLL = np.array([1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7], dtype=np.int64)


def _check_order(order: int) -> int:
    if not 0 <= order <= MAX_ORDER:
        raise ValueError(f"order must be 0..{MAX_ORDER}, got {order}")
    return 1 << order


def spread_bits(v: Any) -> IntArray:
    """Put bit i of ``v`` at bit 2i (v < 2**29)."""
    x = np.asarray(v, dtype=np.int64) & 0x3FFFFFFF
    x = (x | (x << 16)) & 0x0000FFFF0000FFFF
    x = (x | (x << 8)) & 0x00FF00FF00FF00FF
    x = (x | (x << 4)) & 0x0F0F0F0F0F0F0F0F
    x = (x | (x << 2)) & 0x3333333333333333
    x = (x | (x << 1)) & 0x5555555555555555
    return x


def compress_bits(v: Any) -> IntArray:
    """Inverse of ``spread_bits``: take the even bits of ``v``."""
    x = np.asarray(v, dtype=np.int64) & 0x5555555555555555
    x = (x | (x >> 1)) & 0x3333333333333333
    x = (x | (x >> 2)) & 0x0F0F0F0F0F0F0F0F
    x = (x | (x >> 4)) & 0x00FF00FF00FF00FF
    x = (x | (x >> 8)) & 0x0000FFFF0000FFFF
    x = (x | (x >> 16)) & 0x00000000FFFFFFFF
    return x


def xyf2nest(order: int, ix: Any, iy: Any, face: Any) -> IntArray:
    _check_order(order)
    f = np.asarray(face, dtype=np.int64)
    return (f << (2 * order)) + spread_bits(ix) + (spread_bits(iy) << 1)


def nest2xyf(order: int, pix: Any) -> tuple[IntArray, IntArray, IntArray]:
    _check_order(order)
    p = np.asarray(pix, dtype=np.int64)
    face = p >> (2 * order)
    local = p & ((1 << (2 * order)) - 1)
    return compress_bits(local), compress_bits(local >> 1), face


def ang2pix(order: int, theta: Any, phi: Any) -> IntArray:
    """Nested pixel containing each direction (HEALPix C++ ``loc2pix``)."""
    nside = _check_order(order)
    th = np.asarray(theta, dtype=np.float64)
    z = np.cos(th)
    za = np.abs(z)
    tt = np.mod(np.asarray(phi, dtype=np.float64) * (2.0 / np.pi), 4.0)
    tt = np.where(tt >= 4.0, 0.0, tt)  # mod can round up to 4.0 for phi just below 0

    # Equatorial belt, |z| <= 2/3.
    temp1 = nside * (0.5 + tt)
    temp2 = nside * (z * 0.75)
    jp = (temp1 - temp2).astype(np.int64)  # ascending edge line
    jm = (temp1 + temp2).astype(np.int64)  # descending edge line
    ifp = jp >> order
    ifm = jm >> order
    face_eq = np.where(ifp == ifm, ifp | 4, np.where(ifp < ifm, ifp, ifm + 8))
    ix_eq = jm & (nside - 1)
    iy_eq = nside - (jp & (nside - 1)) - 1

    # Polar caps, |z| > 2/3.
    ntt = np.minimum(tt.astype(np.int64), 3)
    tp = tt - ntt
    tmp = nside * np.sqrt(np.maximum(3.0 * (1.0 - za), 0.0))
    # Near the poles 1 - |z| loses precision; use sin(theta) there (as the C++ library does).
    sth = np.sin(th)
    near_pole = za >= 0.99
    tmp = np.where(near_pole, nside * np.abs(sth) / np.sqrt((1.0 + za) / 3.0), tmp)
    jp_p = np.minimum((tp * tmp).astype(np.int64), nside - 1)
    jm_p = np.minimum(((1.0 - tp) * tmp).astype(np.int64), nside - 1)
    north = z >= 0
    face_p = np.where(north, ntt, ntt + 8)
    ix_p = np.where(north, nside - jm_p - 1, jp_p)
    iy_p = np.where(north, nside - jp_p - 1, jm_p)

    eq = za <= 2.0 / 3.0
    face = np.where(eq, face_eq, face_p)
    ix = np.where(eq, ix_eq, ix_p)
    iy = np.where(eq, iy_eq, iy_p)
    return xyf2nest(order, ix, iy, face)


def pix2ang(order: int, pix: Any) -> tuple[FloatArray, FloatArray]:
    """Centre (theta, phi) of each nested pixel (HEALPix C++ ``pix2loc``)."""
    nside = _check_order(order)
    ix, iy, face = nest2xyf(order, pix)
    if np.any((face < 0) | (face > 11)):
        raise ValueError("pixel index out of range for this order")
    npix = 12 * nside * nside
    fact2 = 4.0 / npix
    fact1 = (nside << 1) * fact2
    nl4 = 4 * nside

    jr = (_JRLL[face] << order) - ix - iy - 1
    north = jr < nside
    south = jr > 3 * nside
    nr = np.where(north, jr, np.where(south, nl4 - jr, nside))
    nrf = nr.astype(np.float64)
    z = np.where(
        north,
        1.0 - nrf * nrf * fact2,
        np.where(south, nrf * nrf * fact2 - 1.0, (2 * nside - jr) * fact1),
    )
    t = _JPLL[face] * nr + ix - iy
    t = np.where(t < 0, t + 8 * nr, t)
    phi = (np.pi / 4.0) * t.astype(np.float64) / nrf
    theta = np.arccos(np.clip(z, -1.0, 1.0))
    return theta, np.mod(phi, 2.0 * np.pi)


def pixel_area_sr(order: int) -> float:
    return float(4.0 * np.pi / (12 << (2 * order)))


def pixel_size_deg(order: int) -> float:
    """Square root of the pixel area, in degrees."""
    return float(np.degrees(np.sqrt(pixel_area_sr(order))))
