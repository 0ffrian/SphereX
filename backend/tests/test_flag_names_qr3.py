"""``wcs.flag_names`` reads both FLAGS conventions: QR2's ``MP_<NAME> = bit`` and the mask
planes of QR3 and DR1 (``MSKNnnnn = name``, ``MSKMnnnn = 1 << n``), as seen on a QR3 cutout of
13 Nov 2026 (same names and bit numbers as QR2; PHANTOM and REFERENCE absent)."""

from __future__ import annotations

from astropy.io import fits

from app.core.find import wcs
from app.core.measure import flags

QR3_PLANES = [
    ("TRANSIENT", 0), ("OVERFLOW", 1), ("SUR_ERROR", 2), ("NONFUNC", 6), ("DICHROIC", 7),
    ("MISSING_DATA", 9), ("HOT", 10), ("COLD", 11), ("FULLSAMPLE", 12), ("PHANMISS", 14),
    ("NONLINEAR", 15), ("PERSIST", 17), ("OUTLIER", 19), ("CROSSTALK", 20), ("SOURCE", 21),
    ("GHOST", 22), ("GHOST_FPA", 23), ("GHOST_EXT", 24), ("STREAK", 25), ("BLOOM", 26),
    ("SNOWBALL", 27), ("HALO", 28),
]  # fmt: skip


def _qr3_header() -> fits.Header:
    h = fits.Header()
    h["EXTNAME"] = "FLAGS"
    for name, bit in QR3_PLANES:
        h[f"MSKN{bit:04d}"] = name
        h[f"MSKM{bit:04d}"] = 1 << bit
        h[f"MSKD{bit:04d}"] = "description"
    return h


def test_mask_planes_give_the_same_bits_as_qr2() -> None:
    assert wcs.flag_names(_qr3_header()) == {bit: name for name, bit in QR3_PLANES}
    bits = flags.bits_by_name(_qr3_header())
    assert bits["OVERFLOW"] == 1 and bits["SUR_ERROR"] == 2 and bits["HOT"] == 10


def test_mp_keywords_win_and_bad_masks_are_ignored() -> None:
    h = _qr3_header()
    h["MP_HOT"] = 10
    assert wcs.flag_names(h) == {10: "HOT"}  # QR2 convention present: used alone
    bad = fits.Header()
    bad["MSKN0003"] = "TWOBITS"
    bad["MSKM0003"] = 0b1100
    bad["MSKN0004"] = "NOMASK"
    bad["MSKN0005"] = " PADDED  "
    bad["MSKM0005"] = 1 << 5
    assert wcs.flag_names(bad) == {5: "PADDED"}
