"""The recorded-fixture Eros area: P3's records built from PR #53's recorded data, offline.

Deterministic and cheap, so P4 and P5 can build on real frames and dots before a live area run
exists (Q-400). What it is, and is not:

- **Frames:** the two recorded Eros path cones (``tests/fixtures/cache/v1/irsa_sia``) through
  ``select_frames`` and ``group_frames`` with the Eros ``[[area]]`` box. A live grid of 15 cones
  can add frames these two cones never saw (other detectors), so its 18 frames are a subset of
  the live answer (Q-402).
- **Cutouts:** the 16 recorded 0.1 degree cutouts centred on Eros, standing in for the area-sized
  cutouts (their keys differ, so they are served through ``recorded_fetch``). The frame without a
  recorded cutout (``2026W12_2A_0340_1``, Eros is not on it) gets ``cutout:<frame_id>``, and
  coverage is limited to the cutouts, as A17.1 asks.
- No star is seen in both visits (the cutouts of the two visits do not overlap), so P4's fixed
  test has nothing to find here.
"""

from __future__ import annotations

import hashlib
from functools import lru_cache

from app.adapters import irsa_sia
from app.adapters.irsa_sia import SiaRow
from app.cache.store import CacheMissOffline
from app.core.area.config import DEFAULT_AREA_CONFIG, AreaConfig, AreaSpec
from app.core.area.dots import run_dots
from app.core.area.frames import CutoutPlan, assemble
from app.core.area.records import AreaFrames, FrameDots
from app.timefmt import parse_utc
from tests.helpers import entries

# The `[[area]]` entry of backend/targets.toml (a test checks they agree).
EROS_AREA = AreaSpec(
    id="eros-2026-03",
    ra=91.23046,
    dec=13.42786,
    width_deg=1.05,
    height_deg=0.63,
    data_release="spherex_qr2",
    windows=((parse_utc("2026-03-20T00:00:00Z"), parse_utc("2026-03-21T12:00:00Z")),),
)
# The two path cones PR #53 recorded for Eros (key ra, dec).
EROS_CONES = (("90.40961", "13.64619"), ("91.35516", "13.39326"))


def recorded_sia() -> tuple[list[SiaRow], list[str]]:
    """Rows of the two Eros cones, merged by frame id (first kept), and their body SHA-256."""
    rows: dict[str, SiaRow] = {}
    digests: list[str] = []
    for ra, dec in EROS_CONES:
        for meta, body in entries("irsa_sia"):
            q = meta["key"]["query"]
            if (q["ra"], q["dec"]) == (ra, dec):
                digests.append(hashlib.sha256(body).hexdigest())
                for r in irsa_sia.parse_rows(body):
                    rows.setdefault(r.frame_id, r)
    return list(rows.values()), digests


def recorded_cutouts() -> dict[str, tuple[str, bytes]]:
    """Frame id -> (cache key digest, body) of every recorded cutout."""
    from app.cache.keys import CacheKey

    out: dict[str, tuple[str, bytes]] = {}
    for meta, body in entries("irsa_cutout"):
        k = meta["key"]
        fid = k["query"].get("frame_id")
        if fid:
            key = CacheKey.make(k["source"], k["release"], **k["query"])
            out.setdefault(fid, (key.digest, body))
    return out


def recorded_fetch(row: SiaRow, plan: CutoutPlan) -> tuple[str, bytes]:
    del plan  # the recorded cutouts stand in for the planned ones
    found = recorded_cutouts().get(row.frame_id)
    if found is None:
        raise CacheMissOffline(f"no recorded cutout for {row.frame_id}")
    return found


@lru_cache(maxsize=2)
def _built(cfg: AreaConfig) -> tuple[AreaFrames, dict[str, bytes]]:
    rows, digests = recorded_sia()
    return assemble(EROS_AREA, rows, recorded_fetch, cfg, workers=1, sia_digests=digests, n_cones=2)


def recorded_frames(
    cfg: AreaConfig = DEFAULT_AREA_CONFIG,
) -> tuple[AreaFrames, dict[str, bytes]]:
    """The Eros area's frames and the cutout bodies by frame id (memoised; do not mutate)."""
    return _built(cfg)


@lru_cache(maxsize=2)
def recorded_dots(cfg: AreaConfig = DEFAULT_AREA_CONFIG) -> tuple[FrameDots, ...]:
    frames, bodies = recorded_frames(cfg)
    return tuple(run_dots(frames, bodies, cfg, workers=0))
