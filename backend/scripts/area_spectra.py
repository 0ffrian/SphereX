"""Backfill the spectrum check (A17.13, Q-474): write each stored area's ``spectra`` stage.

    uv run python -m scripts.area_spectra                 # the committed pack (assets/areas)
    uv run python -m scripts.area_spectra --root <dir>    # every area in a D-25 cache root
    uv run python -m scripts.area_spectra --cache         # the app's cache (SX_CACHE_DIR)
    uv run python -m scripts.area_spectra --check         # exit 1 if one is missing or stale

Exits 1 when an area's check fails; the other areas are still written.

Walks every ``derived.area`` head whose settings match the running area code (``AreaStore``
serves no other), reads its stored ``summary``, ``dots`` and ``tracks``, and writes the
``spectra`` stage keyed by the area's ``params_hash`` and the spectrum settings sha. The area
head and stages are never touched. Idempotent: an entry with the same bytes is left alone. Reads
the stored entries and the solar table only; nothing is fetched (seconds per area).
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from app.cache.store import ReadThroughCache
from app.core.area import spectrum
from app.core.area.config import (
    AREA_SOURCE,
    AREA_VERSION,
    DEFAULT_AREA_CONFIG,
    area_key,
    method_settings,
    spectra_key,
    spectra_settings_sha,
)
from app.core.area.store import HEAD, canonical, head_key, settings_sha
from app.settings import BACKEND_DIR, Settings

PACK = BACKEND_DIR / "assets" / "areas"


def backfill(root: Path, *, check_only: bool = False) -> tuple[int, int, int, int]:
    """(written, unchanged, skipped, failed) over every current area head in ``root``. An area
    whose check raises is reported and counted as failed; the others still run."""
    cache = ReadThroughCache(root, offline=True)
    sha = settings_sha(method_settings(DEFAULT_AREA_CONFIG))
    s_sha = spectra_settings_sha()
    written = unchanged = skipped = failed = 0
    for _, meta in cache.iter_meta(AREA_SOURCE):
        q = meta["key"]["query"]
        if q.get("stage") != HEAD or q.get("v") != AREA_VERSION:
            continue
        release, area_id = str(meta["key"]["release"]), str(q["id"])
        entry = cache.get(head_key(release, area_id))
        if entry is None:
            print(f"[skip] {release}/{area_id}: the head is unreadable")
            skipped += 1
            continue
        head = json.loads(entry.body)
        if head.get("settings_sha") != sha:
            print(f"[skip] {release}/{area_id}: stored with other area settings (not served)")
            skipped += 1
            continue
        p = str(head["params_hash"])
        bodies = {}
        for stage in ("summary", "dots", "tracks"):
            got = cache.get(area_key(release, area_id, stage, p))
            if got is None:
                break
            bodies[stage] = got.body
        if len(bodies) != 3:
            print(f"[skip] {release}/{area_id}: a stage is missing")
            skipped += 1
            continue
        try:
            reply = spectrum.spectra_from_bodies(
                bodies["summary"], bodies["dots"], bodies["tracks"]
            )
        except Exception as exc:  # one bad area must not stop the backfill
            print(f"[fail] {release}/{area_id}: {type(exc).__name__}: {exc}")
            failed += 1
            continue
        verdicts = dict(sorted(Counter(t["verdict"] for t in reply["tracks"]).items()))
        if check_only:
            have = cache.get(spectra_key(release, area_id, p, s_sha))
            fresh = have is not None and have.body == canonical(reply)
            print(f"[{'ok' if fresh else 'outdated'}] {release}/{area_id}: {verdicts}")
            unchanged += fresh
            written += not fresh
            continue
        if spectrum.store_spectra(cache, release, p, reply):
            print(f"[write] {release}/{area_id}: {verdicts}")
            written += 1
        else:
            print(f"[same] {release}/{area_id}: {verdicts}")
            unchanged += 1
    return written, unchanged, skipped, failed


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    where = ap.add_mutually_exclusive_group()
    where.add_argument("--root", type=Path, help="a D-25 cache root")
    where.add_argument("--cache", action="store_true", help="the running app's cache root")
    ap.add_argument("--check", action="store_true", help="report only; exit 1 if any is stale")
    args = ap.parse_args(argv)
    root = args.root or (Settings().cache_dir if args.cache else PACK)
    written, unchanged, skipped, failed = backfill(root, check_only=args.check)
    label = "stale" if args.check else "written"
    print(
        f"DONE {root}: {written} {label}, {unchanged} unchanged, {skipped} skipped, {failed} failed"
    )
    return 1 if failed or (args.check and written) else 0


if __name__ == "__main__":
    sys.exit(main())
