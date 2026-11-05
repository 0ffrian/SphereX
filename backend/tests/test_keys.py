from __future__ import annotations

from app.cache.keys import CacheKey, norm_dec, norm_name, norm_ra
from app.core.find.ids import coord_id, parse_coord_id, parse_coords


def test_coordinates_round_to_1e5_deg() -> None:
    assert norm_ra(269.452076958) == "269.45208"
    assert norm_dec(4.693364966) == "4.69336"


def test_ra_wraps_after_rounding_and_negative_zero_is_zero() -> None:
    assert norm_ra(359.999999) == "0.00000"
    assert norm_ra(-0.5) == "359.50000"
    assert norm_dec(-0.000001) == "0.00000"
    assert norm_dec(-0.0) == "0.00000"


def test_same_query_same_key_and_release_matters() -> None:
    a = CacheKey.make("irsa_sia", "spherex_qr2", ra="1.00000", dec="2.00000")
    b = CacheKey.make("irsa_sia", "spherex_qr2", dec="2.00000", ra="1.00000")
    c = CacheKey.make("irsa_sia", "spherex_qr3", ra="1.00000", dec="2.00000")
    assert a.digest == b.digest
    assert a.digest != c.digest
    assert len(a.digest) == 64


def test_name_whitespace_collapsed_case_kept() -> None:
    assert norm_name("  R   Dra ") == "R Dra"
    assert norm_name("r dra") == "r dra"


def test_coordinate_ids_round_trip() -> None:
    oid = coord_id(269.452, 4.6933)
    assert oid == "radec-269.45200+4.69330"
    assert parse_coord_id(oid) == (269.452, 4.6933)
    assert coord_id(10.0, -0.0) == "radec-10.00000+0.00000"
    assert coord_id(359.999999, -56.7) == "radec-0.00000-56.70000"
    assert parse_coord_id("simbad-v-r-dra") is None


def test_parse_coords() -> None:
    assert parse_coords("269.45, 4.69") == (269.45, 4.69)
    assert parse_coords("Barnard's star") is None
