"""Mirror the low orders of a colour HiPS from IRSA into the local cache (sky background).

    uv run python -m scripts.sky_mirror                                  # 2mass_color, orders 0-4
    uv run python -m scripts.sky_mirror --max-order 6 --max-mb 45000     # e.g. on the A15
    uv run python -m scripts.sky_mirror --survey allwise_color --bake

Writes ``{SX_CACHE_DIR}/sky/{survey}/hips/`` in IRSA's layout (``properties``,
``Norder3/Allsky.jpg``, ``Norder{k}/Dir{d}/Npix{n}.jpg``) and ``mirror.json``.

- **Budget:** ``--max-mb`` (10**6 bytes) is a hard cap on everything under ``{cache}/sky/``,
  files already there included. A file that would cross it is not written; the run stops
  cleanly and exit code is 1.
- **Resumable:** a file is written to a temp name and renamed, so a final name is complete and
  is skipped next time. Orders are fetched lowest first, so a stopped run leaves whole orders.
- **Polite:** at most 4 parallel requests, retries with backoff (``SX_HTTP_*``), generic
  User-Agent.
- **Offline:** refuses to run with ``SX_OFFLINE=1`` (D-25).
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import httpx

from app.adapters.http import Http, NetworkDisabled, UpstreamError
from app.core.sky.surveys import (
    ALLSKY_RELPATH,
    MANIFEST_NAME,
    PROPERTIES_NAME,
    SURVEYS,
    Survey,
    check_properties,
    count_complete,
    dir_bytes,
    hips_dir,
    parse_properties,
    sky_root,
    survey_dir,
    tile_relpath,
    tiles_in_order,
    write_atomic,
)
from app.settings import Settings

MAX_CONCURRENCY = 4
CHUNK = 500
MB = 1_000_000


class BudgetExhausted(RuntimeError):
    pass


@dataclass
class Budget:
    """Hard cap on bytes under the sky directory. Thread-safe."""

    limit: int
    used: int
    largest_seen: int = 0
    exhausted: bool = False
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def room_for_next(self) -> bool:
        with self._lock:
            if self.used + self.largest_seen > self.limit:
                self.exhausted = True
            return not self.exhausted

    def commit(self, path: Path, data: bytes) -> None:
        """Write ``data`` atomically if it fits; otherwise mark the budget exhausted."""
        n = len(data)
        with self._lock:
            self.largest_seen = max(self.largest_seen, n)
            if self.used + n > self.limit:
                self.exhausted = True
                raise BudgetExhausted(f"{path.name}: {n} bytes would exceed the budget")
            self.used += n
        try:
            write_atomic(path, data)
        except BaseException:
            with self._lock:
                self.used -= n
            raise


@dataclass
class Stats:
    downloaded: int = 0
    bytes: int = 0
    skipped: int = 0
    failed: list[str] = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def add(self, n: int) -> None:
        with self._lock:
            self.downloaded += 1
            self.bytes += n

    def fail(self, what: str) -> None:
        with self._lock:
            self.failed.append(what)


def remove_stale_parts(root: Path) -> int:
    n = 0
    if root.exists():
        for p in root.rglob("*.part"):
            p.unlink(missing_ok=True)
            n += 1
    return n


def fetch_file(
    http: Http, survey: Survey, rel: str, dest: Path, budget: Budget, stats: Stats
) -> bool:
    """Download one file unless it exists. False when it was not written."""
    if dest.exists():
        return True
    if not budget.room_for_next():
        return False
    try:
        resp = http.get(f"{survey.base_url}/{rel}")
    except UpstreamError as exc:
        stats.fail(f"{rel}: {exc}")
        return False
    try:
        budget.commit(dest, resp.body)
    except BudgetExhausted:
        return False
    stats.add(len(resp.body))
    return True


def write_manifest(
    cache_dir: Path, survey: Survey, props: dict[str, str], max_order: int
) -> dict[str, object]:
    hdir = hips_dir(cache_dir, survey.id)
    upstream_max = int(props.get("hips_order", max_order))
    tiles: dict[int, int] = {}
    for k in range(upstream_max + 1):
        n = count_complete(hdir, k)
        if n == 0 and k > max_order:
            break  # keep orders an earlier, deeper run left, stop at the first empty one
        tiles[k] = n
    complete = [k for k, n in tiles.items() if n == tiles_in_order(k)]
    manifest: dict[str, object] = {
        "survey": survey.id,
        "base_url": survey.base_url,
        "complete_orders": complete,
        "tiles": {str(k): n for k, n in tiles.items()},
        "allsky": (hdir / ALLSKY_RELPATH).is_file(),
        "hips_order": props.get("hips_order"),
        "hips_status": props.get("hips_status"),
        "hips_release_date": props.get("hips_release_date"),
        "bytes": dir_bytes(hdir),
        "updated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    write_atomic(
        survey_dir(cache_dir, survey.id) / MANIFEST_NAME,
        (json.dumps(manifest, indent=2) + "\n").encode("utf-8"),
    )
    return manifest


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--survey", default="2mass_color", choices=sorted(SURVEYS))
    p.add_argument("--max-order", type=int, default=4)
    p.add_argument("--max-mb", type=float, default=900.0, help="hard cap on {cache}/sky/ in MB")
    p.add_argument("--concurrency", type=int, default=MAX_CONCURRENCY, help="1-4")
    p.add_argument(
        "--allow-unclonable",
        action="store_true",
        help="mirror even when properties say hips_status ... unclonable (see the report)",
    )
    p.add_argument("--bake", action="store_true", help="run scripts.sky_bake afterwards")
    return p.parse_args(argv)


def main(
    argv: list[str] | None = None,
    *,
    settings: Settings | None = None,
    transport: httpx.BaseTransport | None = None,
) -> int:
    args = parse_args(argv)
    s = settings or Settings()
    if s.offline:
        print("SX_OFFLINE=1: the sky mirror needs the network; refusing to run.", file=sys.stderr)
        return 2
    if args.max_order < 0:
        print("--max-order must be >= 0", file=sys.stderr)
        return 2
    survey = SURVEYS[args.survey]
    concurrency = max(1, min(MAX_CONCURRENCY, args.concurrency))
    root = sky_root(s.cache_dir)
    hdir = hips_dir(s.cache_dir, survey.id)
    stale = remove_stale_parts(root)
    budget = Budget(limit=int(args.max_mb * MB), used=dir_bytes(root))
    stats = Stats()
    print(
        f"sky mirror {survey.id} -> {hdir}\n"
        f"  budget {budget.limit / MB:.0f} MB, already used {budget.used / MB:.1f} MB"
        + (f", removed {stale} stale temp files" if stale else ""),
        flush=True,
    )
    t0 = time.monotonic()
    http = Http(s, transport=transport)
    try:
        if (
            not fetch_file(http, survey, PROPERTIES_NAME, hdir / PROPERTIES_NAME, budget, stats)
            and not (hdir / PROPERTIES_NAME).exists()
        ):
            print(f"  could not fetch properties: {stats.failed or 'budget'}", file=sys.stderr)
            return 1
        props = parse_properties((hdir / PROPERTIES_NAME).read_text(encoding="utf-8"))
        problems = check_properties(props, survey)
        if problems:
            print("  properties do not match the registry: " + "; ".join(problems), file=sys.stderr)
            return 1
        status = props.get("hips_status", "")
        print(
            f"  hips_status={status!r} hips_license={props.get('hips_license')!r} "
            f"copyright={props.get('obs_copyright')!r}",
            flush=True,
        )
        if "unclonable" in status.split() and not args.allow_unclonable:
            print(
                "  properties mark this HiPS 'unclonable' (IVOA HiPS 1.0 hips_status). "
                "Re-run with --allow-unclonable only if the team accepts that for a local, "
                "non-redistributed cache.",
                file=sys.stderr,
            )
            return 1
        upstream_max = int(props.get("hips_order", args.max_order))
        max_order = min(args.max_order, upstream_max)
        fetch_file(http, survey, ALLSKY_RELPATH, hdir / ALLSKY_RELPATH, budget, stats)

        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            for k in range(max_order + 1):
                if budget.exhausted:
                    break
                rels = [tile_relpath(k, n) for n in range(tiles_in_order(k))]
                todo = [r for r in rels if not (hdir / r).exists()]
                stats.skipped += len(rels) - len(todo)
                t_order = time.monotonic()
                # Chunks keep the number of pending futures small at deep orders.
                for i in range(0, len(todo), CHUNK):
                    if budget.exhausted:
                        break
                    chunk = todo[i : i + CHUNK]
                    list(
                        pool.map(
                            lambda r: fetch_file(http, survey, r, hdir / r, budget, stats), chunk
                        )
                    )
                    rate = stats.bytes / MB / max(1e-6, time.monotonic() - t0)
                    print(
                        f"    order {k}: {i + len(chunk)}/{len(todo)} "
                        f"({budget.used / MB:.1f} MB used, {rate:.2f} MB/s)",
                        flush=True,
                    )
                print(
                    f"  order {k}: {len(rels) - len(todo)} present, {len(todo)} fetched or tried "
                    f"in {time.monotonic() - t_order:.1f} s",
                    flush=True,
                )
    except NetworkDisabled as exc:
        print(f"  {exc}", file=sys.stderr)
        return 2
    finally:
        http.close()

    manifest = write_manifest(s.cache_dir, survey, props, max_order)
    elapsed = time.monotonic() - t0
    print(
        f"done in {elapsed:.1f} s: {stats.downloaded} files ({stats.bytes / MB:.1f} MB) "
        f"downloaded, {stats.skipped} already present, {len(stats.failed)} failed\n"
        f"  complete orders {manifest['complete_orders']}, sky dir {budget.used / MB:.1f} MB",
        flush=True,
    )
    for f in stats.failed[:20]:
        print(f"  failed: {f}", file=sys.stderr)
    if budget.exhausted:
        print(f"  stopped: the {args.max_mb:.0f} MB budget is reached", file=sys.stderr)
    complete = manifest["complete_orders"]
    incomplete = (
        budget.exhausted
        or bool(stats.failed)
        or not isinstance(complete, list)
        or max_order not in complete
    )
    if args.bake:
        from scripts import sky_bake

        rc = sky_bake.main(["--survey", survey.id], settings=s)
        if rc:
            return rc
    return 1 if incomplete else 0


if __name__ == "__main__":
    sys.exit(main())
