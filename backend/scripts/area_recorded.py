"""The recorded-fixture Eros area: the area pipeline's inputs built from PR #53's recorded data.

Deterministic and offline, so P4 to P7 build on real frames and dots before a live area run
exists (Q-400 (13), Q-402 (3)), and ``scripts/area_discovery.py --recorded`` precomputes the
served Eros area from it (issue #108). What it is, and is not:

- **Frames:** the two recorded Eros path cones (``tests/fixtures/cache/v1/irsa_sia``) through
  ``select_frames`` and ``group_frames`` with the Eros ``[[area]]`` box. A live grid of 15 cones
  can add frames these two cones never saw, so its 18 frames are a subset of the live answer.
- **Cutouts:** the 16 recorded 0.1 degree cutouts centred on Eros, standing in for the area-sized
  cutouts (their keys differ, so they are served through ``recorded_fetch``). The frame without a
  recorded cutout (``2026W12_2A_0340_1``) gets ``cutout:<frame_id>``, and coverage is limited to
  the cutouts, as A17.1 asks.
- **Star cones:** Track's two recorded visit cones (Gaia DR3 G < 20 and CatWISE2020 W1 < 16.5,
  A19.6) stand in for the area cone, which is not recorded; each covers its visit's cutouts.
- No star is seen in both visits (the cutouts of the two visits do not overlap), so the fixed
  test has nothing to find here.

Reads the fixture files directly (they are plain D-25 cache entries, never hand-edited).
"""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.adapters import irsa_sia
from app.adapters.irsa_sia import SiaRow
from app.cache.keys import CacheKey
from app.cache.store import CacheMissOffline
from app.core.area.config import DEFAULT_AREA_CONFIG, AreaConfig, AreaSpec
from app.core.area.dots import run_dots
from app.core.area.frames import CutoutPlan, assemble
from app.core.area.records import AreaFrames, FrameDots
from app.core.find.stars import TRACK_CONE_FORMULA, StarCone
from app.timefmt import iso_utc_z, parse_utc

FIXTURE_CACHE = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "cache"

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
# Track's recorded visit star cones (A19.6): visit -> (ra, dec, radius_deg) of the cache key.
EROS_STAR_CONES = {1: (90.75032, 13.55949, 0.08361), 2: (91.71059, 13.29626, 0.08361)}


def entries(source: str, root: Path = FIXTURE_CACHE) -> list[tuple[dict[str, Any], bytes]]:
    out = []
    for meta_path in sorted((root / "v1" / source).glob("*/*/*.json")):
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        out.append((meta, meta_path.with_suffix(".body").read_bytes()))
    return out


@lru_cache(maxsize=1)
def _eros_cone_entries() -> tuple[tuple[dict[str, Any], bytes], ...]:
    """The recorded SIA entries of the two Eros cones, in ``EROS_CONES`` order: the one matching
    rule shared by ``recorded_sia`` and ``recorded_sia_fetched``. Cached, so the fixtures are
    read once per process; callers must not change the returned metadata."""
    sia = entries("irsa_sia")
    return tuple(
        (meta, body)
        for ra, dec in EROS_CONES
        for meta, body in sia
        if (meta["key"]["query"]["ra"], meta["key"]["query"]["dec"]) == (ra, dec)
    )


def recorded_sia() -> tuple[list[SiaRow], list[str]]:
    """Rows of the two Eros cones, merged by frame id (first kept), and their body SHA-256."""
    rows: dict[str, SiaRow] = {}
    digests: list[str] = []
    for _, body in _eros_cone_entries():
        digests.append(hashlib.sha256(body).hexdigest())
        for r in irsa_sia.parse_rows(body):
            rows.setdefault(r.frame_id, r)
    return list(rows.values()), digests


def recorded_sia_fetched() -> list[str]:
    """The ISO-Z ``fetched_at`` of the two Eros cones (``AreaFrames.sia_fetched``)."""
    return [iso_utc_z(parse_utc(str(meta["fetched_at"]))) for meta, _ in _eros_cone_entries()]


@lru_cache(maxsize=1)
def recorded_cutouts() -> dict[str, tuple[str, bytes]]:
    """Frame id -> (cache key digest, body) of every recorded cutout (memoised; do not mutate)."""
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
    return assemble(
        EROS_AREA, rows, recorded_fetch, cfg, workers=1, sia_digests=digests,
        sia_fetched=recorded_sia_fetched(), n_cones=2,
    )  # fmt: skip


def recorded_frames(
    cfg: AreaConfig = DEFAULT_AREA_CONFIG,
) -> tuple[AreaFrames, dict[str, bytes]]:
    """The Eros area's frames and the cutout bodies by frame id (memoised; do not mutate)."""
    return _built(cfg)


@lru_cache(maxsize=2)
def recorded_dots(cfg: AreaConfig = DEFAULT_AREA_CONFIG, workers: int = 0) -> tuple[FrameDots, ...]:
    frames, bodies = recorded_frames(cfg)
    return tuple(run_dots(frames, bodies, cfg, workers=workers))


def recorded_star_cones() -> dict[int, StarCone]:
    """Track's recorded visit cones, read through the cache like any star cone (A19.6)."""
    return {
        v: StarCone(v, "track", ra, dec, r, TRACK_CONE_FORMULA)
        for v, (ra, dec, r) in EROS_STAR_CONES.items()
    }


# What the recorded area's replies say about their inputs (method.settings.inputs, provenance).
INPUTS = "recorded_eros_fixture"
SOURCES = {
    "frames": (
        "IRSA SIA, SPHEREx QR2 frame list: PR #53's two recorded Eros path cones stand in for the "
        "area's cone grid (Q-400 (13))"
    ),
    "cutouts": (
        "IRSA SPHEREx QR2 cutouts: PR #53's recorded 0.1 deg cutouts centred on Eros stand in for "
        "the area's own, so coverage is limited to them (Q-402 (3))"
    ),
    "stars": (
        "Gaia DR3 and CatWISE2020: Track's two recorded visit cones (A19.6) stand in for the area "
        "cone"
    ),
}
