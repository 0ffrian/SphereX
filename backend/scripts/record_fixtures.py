"""Record the test fixtures: a small live pre-fetch into backend/tests/fixtures/cache.

    uv run python -m scripts.record_fixtures

Uses SX_SIA_MAXREC=3 (3 frames per target, so the SIA answer is marked truncated) and the
default cutout size. Derived entries (``derived.*``) are removed afterwards so the tests run the
real SIA -> cutout -> WCS path. Nothing is hand-written: the fixtures are cache entries (D-25).
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

FIXTURE_CACHE = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "cache"
FIXTURE_MAXREC = "3"


def purge_derived(root: Path) -> None:
    for d in sorted((root / "v1").glob("derived.*")):
        shutil.rmtree(d)


def size_bytes(root: Path) -> int:
    return sum(p.stat().st_size for p in root.rglob("*") if p.is_file())


def main() -> int:
    os.environ["SX_CACHE_DIR"] = str(FIXTURE_CACHE)
    os.environ["SX_SIA_MAXREC"] = FIXTURE_MAXREC
    os.environ.pop("SX_OFFLINE", None)
    from scripts import prefetch

    code = prefetch.main(["--concurrency", "3"])
    purge_derived(FIXTURE_CACHE)
    print(f"fixture cache: {FIXTURE_CACHE} ({size_bytes(FIXTURE_CACHE) / 1e6:.2f} MB)")
    # Exit code 1 is expected: MAXREC=3 marks every SIA answer as truncated.
    return 0 if code in (0, 1) else code


if __name__ == "__main__":
    raise SystemExit(main())
