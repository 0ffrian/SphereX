"""Small SPHEREx cutouts through the IRSA IBE cutout service (A3.1). Never whole frames.

The cached value is the IBE response with the ``PSF`` HDU cut out at its byte boundaries
(Q-20; A3.1 lists PSF as skipped and it is about 99% of the bytes). The original SHA-256 and
size are kept in the entry's meta.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from app.adapters.http import UpstreamError
from app.adapters.irsa_sia import SiaRow
from app.cache.keys import CacheKey, norm_dec, norm_float, norm_ra
from app.cache.store import LiveResponse, Served
from app.context import Context

SOURCE = "irsa_cutout"
BLOCK = 2880
CARD = 80
DROPPED_HDUS = ("PSF",)


@dataclass(frozen=True)
class HduSpan:
    name: str
    start: int
    end: int  # exclusive, block-aligned


def _card_value(card: str) -> str:
    v = card[10:]
    if v.lstrip().startswith("'"):
        m = re.match(r"\s*'((?:[^']|'')*)'", v)
        return m.group(1).replace("''", "'").strip() if m else ""
    return v.split("/", 1)[0].strip()


def hdu_spans(raw: bytes) -> list[HduSpan]:
    """Walk FITS headers to find each HDU's byte range (FITS standard 4.0, sections 3-4)."""
    spans: list[HduSpan] = []
    pos = 0
    index = 0
    while pos < len(raw):
        start = pos
        cards: dict[str, str] = {}
        ended = False
        while not ended:
            block = raw[pos : pos + BLOCK]
            if len(block) < BLOCK:
                raise ValueError("truncated FITS header")
            pos += BLOCK
            for i in range(0, BLOCK, CARD):
                card = block[i : i + CARD].decode("ascii", errors="replace")
                kw = card[:8].strip()
                if kw == "END":
                    ended = True
                    break
                if card[8:10] == "= " and kw not in cards:
                    cards[kw] = _card_value(card)
        naxis = int(cards.get("NAXIS", "0"))
        bitpix = abs(int(cards.get("BITPIX", "8")))
        size = 0
        if naxis > 0:
            n = 1
            for k in range(1, naxis + 1):
                n *= int(cards.get(f"NAXIS{k}", "0"))
            pcount = int(cards.get("PCOUNT", "0"))
            gcount = int(cards.get("GCOUNT", "1"))
            size = bitpix // 8 * gcount * (pcount + n)
        pos += -(-size // BLOCK) * BLOCK
        if pos > len(raw):
            raise ValueError("truncated FITS data")
        name = cards.get("EXTNAME", "PRIMARY" if index == 0 else f"HDU{index}").upper()
        spans.append(HduSpan(name, start, pos))
        index += 1
    return spans


def strip_hdus(raw: bytes, drop: tuple[str, ...] = DROPPED_HDUS) -> bytes:
    """Remove extensions by name, keeping every other byte as served (never the primary)."""
    spans = hdu_spans(raw)
    return b"".join(
        raw[s.start : s.end] for i, s in enumerate(spans) if i == 0 or s.name not in drop
    )


def cutout_key(
    release: str,
    frame_id: str,
    ra: float,
    dec: float,
    size_arcsec: float,
    *,
    keep_psf: bool = False,
) -> CacheKey:
    """A cutout with the PSF kept is a different value, so it gets a different key. The default
    (PSF dropped, Q-20) adds nothing to the key, so existing entries keep their keys."""
    extra = {"keep_psf": "1"} if keep_psf else {}
    return CacheKey.make(
        SOURCE,
        release,
        frame_id=frame_id,
        ra=norm_ra(ra),
        dec=norm_dec(dec),
        size_arcsec=norm_float(size_arcsec, 1),
        **extra,
    )


def key_for(ctx: Context, row: SiaRow, ra: float, dec: float) -> CacheKey:
    s = ctx.settings
    return cutout_key(
        s.data_release, row.frame_id, ra, dec, s.cutout_size_arcsec, keep_psf=s.cutout_keep_psf
    )


def fetch_cutout(
    ctx: Context,
    row: SiaRow,
    ra: float,
    dec: float,
    *,
    refresh: bool = False,
    read_timeout_s: float | None = None,
) -> Served:
    s = ctx.settings
    key = key_for(ctx, row, ra, dec)
    q = dict(key.query)

    def live() -> LiveResponse:
        if not row.access_url.startswith("https://irsa.ipac.caltech.edu/"):
            raise UpstreamError(f"unexpected access_url host: {row.access_url}")
        size_deg = norm_float(s.cutout_size_arcsec / 3600.0, 6)
        params = {"center": f"{q['ra']},{q['dec']}", "size": size_deg}
        resp = ctx.http.get(row.access_url, params, read_timeout_s=read_timeout_s)
        if not resp.body.startswith(b"SIMPLE  ="):
            raise UpstreamError("cutout response is not FITS")
        try:
            body = resp.body if s.cutout_keep_psf else strip_hdus(resp.body)
        except ValueError as exc:
            raise UpstreamError(f"bad FITS from cutout service: {exc}") from exc
        extra = {
            "original_sha256": hashlib.sha256(resp.body).hexdigest(),
            "original_size": len(resp.body),
            "dropped_hdus": [] if s.cutout_keep_psf else list(DROPPED_HDUS),
        }
        return LiveResponse(body, resp.url, resp.status, resp.content_type, extra)

    return ctx.cache.fetch(key, live, refresh=refresh)
