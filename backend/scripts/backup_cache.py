"""Zip the cache directory (D-25: the cache lives on the A15, outside git, with a zipped backup).

    uv run python -m scripts.backup_cache [--out PATH]

Files are added in sorted order with fixed timestamps, so the same cache gives the same zip.
"""

from __future__ import annotations

import argparse
import zipfile
from datetime import UTC, datetime
from pathlib import Path

from app.settings import Settings

FIXED_TIME = (2026, 1, 1, 0, 0, 0)


def backup(cache_dir: Path, out: Path) -> int:
    files = sorted(p for p in cache_dir.rglob("*") if p.is_file() and not p.name.endswith(".tmp"))
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for p in files:
            info = zipfile.ZipInfo(p.relative_to(cache_dir).as_posix(), date_time=FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, p.read_bytes())
    return len(files)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out", type=Path, default=None)
    args = p.parse_args(argv)
    cache_dir = Settings().cache_dir
    stamp = datetime.now(UTC).strftime("%Y%m%d")
    out = args.out or cache_dir.parent / f"shift-spectrum-cache-{stamp}.zip"
    n = backup(cache_dir, out)
    print(f"{n} files from {cache_dir} -> {out} ({out.stat().st_size / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
