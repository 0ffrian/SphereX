"""Record the test fixtures: a small live pre-fetch into backend/tests/fixtures/cache.

    uv run python -m scripts.record_fixtures                     # every target
    uv run python -m scripts.record_fixtures --only "433 Eros"   # one target (repeatable)

Uses SX_SIA_MAXREC=3 (3 frames per target, so the SIA answer is marked truncated) and the
default cutout size. The moving target (433 Eros, issue #26) is searched along its path over the
short ``FIXTURE_MOVING`` window (two tiny cones, full MAXREC per cone), so its frames, cutouts and
spectrum are recorded too. The tests import the same settings from ``scripts/fixture_settings.py``.
Derived entries (``derived.*``) are removed afterwards so the tests run the real
SIA -> cutout -> WCS path. Nothing is hand-written: the fixtures are cache entries (D-25).
"""

from __future__ import annotations

import argparse
import os
import shutil
from pathlib import Path

from scripts.fixture_settings import FIXTURE_MOVING

FIXTURE_CACHE = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "cache"
FIXTURE_MAXREC = "3"
# Groups recorded when no --only is given: group "moving" (long path searches) is left out.
FIXTURE_GROUPS = ("test", "fixture", "demo")


def purge_derived(root: Path) -> None:
    for d in sorted((root / "v1").glob("derived.*")):
        shutil.rmtree(d)


def size_bytes(root: Path) -> int:
    return sum(p.stat().st_size for p in root.rglob("*") if p.is_file())


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--only", action="append", help="target name or query; repeatable")
    args = p.parse_args(argv)
    os.environ["SX_CACHE_DIR"] = str(FIXTURE_CACHE)
    os.environ["SX_SIA_MAXREC"] = FIXTURE_MAXREC
    for name, value in FIXTURE_MOVING.items():
        os.environ[f"SX_{name.upper()}"] = value
    os.environ.pop("SX_OFFLINE", None)
    from scripts import prefetch

    only = [a for name in args.only or [] for a in ("--only", name)]
    groups = [] if only else [a for g in FIXTURE_GROUPS for a in ("--group", g)]
    code = prefetch.main(["--concurrency", "3", *only, *groups])
    purge_derived(FIXTURE_CACHE)
    print(f"fixture cache: {FIXTURE_CACHE} ({size_bytes(FIXTURE_CACHE) / 1e6:.2f} MB)")
    # Exit code 1 is expected: MAXREC=3 marks every SIA answer as truncated.
    return 0 if code in (0, 1) else code


if __name__ == "__main__":
    raise SystemExit(main())
