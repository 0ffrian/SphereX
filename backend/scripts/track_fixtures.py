"""Write the shared Track fixtures from the recorded Eros answers (issue #74, A19.13, D-18).

    uv run python -m scripts.track_fixtures           # rewrite shared/fixtures/track/eros-2026-03/
    uv run python -m scripts.track_fixtures --check   # exit 1 if a committed file differs

``path.json`` is the real ``GET /v1/objects/sbdb-20000433/path`` reply, built offline by the
backend from the test fixture cache (PR #53's recorded Horizons answers for 433 Eros, 20 to
21 Mar 2026, with the fixture path-search settings of ``scripts/fixture_settings.py``: a 60 min
step). Real data, so no Fixture badge. Nothing is hand-written: rerun this after a change to the
reply or to the recorded answers. The cache is copied first, so the committed fixtures are only
read. The output is byte-stable (no clock in the reply: ``cached_at`` is the recorded fetch time).
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import BACKEND_DIR
from tests.conftest import FIXTURE_CACHE, make_settings, purge_derived

OUT_DIR = BACKEND_DIR.parent / "shared" / "fixtures" / "track" / "eros-2026-03"
EROS_QUERY = "433 Eros"


def build() -> dict[str, bytes]:
    """File name -> bytes, from a scratch copy of the fixture cache."""
    with tempfile.TemporaryDirectory() as tmp:
        cache = Path(tmp) / "cache"
        shutil.copytree(FIXTURE_CACHE, cache)
        purge_derived(cache)
        with TestClient(create_app(make_settings(cache))) as c:
            oid = c.get("/v1/resolve", params={"q": EROS_QUERY}).json()["id"]
            r = c.get(f"/v1/objects/{oid}/path")
            if r.status_code != 200:
                raise SystemExit(f"/path answered {r.status_code}: {r.text}")
            body: dict[str, Any] = r.json()
    return {"path.json": (json.dumps(body, indent=2, ensure_ascii=False) + "\n").encode("utf-8")}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--check", action="store_true", help="compare, do not write")
    args = p.parse_args(argv)
    files = build()
    if args.check:
        stale = [
            n
            for n, data in files.items()
            if not (OUT_DIR / n).is_file() or (OUT_DIR / n).read_bytes() != data
        ]
        for n in stale:
            print(f"stale: {OUT_DIR / n}. Run: uv run python -m scripts.track_fixtures")
        return 1 if stale else 0
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for n, data in files.items():
        (OUT_DIR / n).write_bytes(data)
        print(f"wrote {OUT_DIR / n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
