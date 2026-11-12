"""Demo preflight (issue #103): against a running backend, check every demo row answers.

    uv run python -m scripts.preflight [--base http://localhost:8000] [--wait-warm 600]

For every row of the demo search list (``SEARCH_LIST`` in ``scripts.bake_demo_pack``, the same
list the search bar shows), every other ``group = "demo"`` target in ``targets.toml``, and 433
Eros (the Track object, group ``fixture``), it calls ``/v1/resolve``, ``/card``,
``/render-params``, ``/frames``, ``/spectrum`` and the first cutout PNG, and prints the time of
each call. ``/frames`` is called because it gives the cutout URL (and the app calls it too).

Exit code 1 on any non-200 answer (a 503 ``offline_cache_miss`` is the usual one), a connection
error, or a cutout that is not a PNG. A card or params answer still ``measuring`` is a warning.
A row with no frames (a moving object outside SPHEREx's windows, a catalogue-only exoplanet) is
not a failure; its cutout is reported as skipped.

``--wait-warm`` polls ``/v1/health`` until the start-up warm cache reports ``finished`` (or the
time runs out, which fails) before the rows are checked. It talks HTTP only, so it never reads
the cache itself: what it sees is what the browser will see.
"""

from __future__ import annotations

import argparse
import time
import tomllib
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import httpx

from app.settings import Settings

# The Track object (A10.2 step 1, Q-197): in group "fixture", not "demo", but shown on stage.
EXTRA_TARGETS = ("433 Eros",)


@dataclass(frozen=True)
class Row:
    name: str
    query: str


def demo_rows(targets_file: Path, search_list: list[tuple[str, str]] | None = None) -> list[Row]:
    """The search list in its own order, then demo-group targets it lacks, then Eros. Names and
    queries come from ``SEARCH_LIST`` and ``targets.toml``; nothing is typed here twice."""
    if search_list is None:
        from scripts.bake_demo_pack import SEARCH_LIST

        search_list = [(r.name, r.query) for r in SEARCH_LIST]
    doc = tomllib.loads(targets_file.read_text(encoding="utf-8"))
    targets = [t for t in doc.get("target", []) if isinstance(t, dict) and "query" in t]
    rows = [Row(n, q) for n, q in search_list]
    seen = {r.query for r in rows}
    for t in targets:
        if (t.get("group") == "demo" or t.get("name") in EXTRA_TARGETS) and t["query"] not in seen:
            rows.append(Row(str(t.get("name", t["query"])), str(t["query"])))
            seen.add(t["query"])
    return rows


@dataclass
class Call:
    label: str
    status: int | None  # None: no answer (connection error, timeout)
    ms: float
    note: str = ""

    @property
    def ok(self) -> bool:
        return self.status == 200 and not self.note.startswith("not a PNG")


def _get(
    client: httpx.Client, label: str, url: str, **params: str
) -> tuple[Call, httpx.Response | None]:
    t0 = time.perf_counter()
    try:
        r = client.get(url, params=params or None)
    except httpx.HTTPError as exc:
        return Call(label, None, (time.perf_counter() - t0) * 1000, type(exc).__name__), None
    ms = (time.perf_counter() - t0) * 1000
    note = ""
    if r.status_code != 200:
        try:
            note = str(r.json().get("error", ""))
        except ValueError:
            note = r.text[:60]
    return Call(label, r.status_code, ms, note), r


def check_row(client: httpx.Client, row: Row) -> list[Call]:
    calls: list[Call] = []
    call, r = _get(client, "resolve", "/v1/resolve", q=row.query)
    calls.append(call)
    if r is None or r.status_code != 200:
        return calls
    base = f"/v1/objects/{r.json()['id']}"
    for label in ("card", "render-params"):
        call, resp = _get(client, label, f"{base}/{label}")
        # Issue #41: a 200 that is not the final answer yet (warm start not done for this
        # object). Reported, not failed: the app shows it and improves it when the job ends.
        if resp is not None and resp.status_code == 200 and "X-SX-Measuring" in resp.headers:
            call.note = f"warning: still measuring ({resp.headers['X-SX-Measuring']})"
        calls.append(call)
    call, fr = _get(client, "frames", f"{base}/frames")
    calls.append(call)
    calls.append(_get(client, "spectrum", f"{base}/spectrum")[0])
    frames = fr.json().get("frames", []) if fr is not None and fr.status_code == 200 else None
    if frames:
        call, png = _get(client, "cutout", frames[0]["cutout_url"])
        if png is not None and png.status_code == 200 and not png.content.startswith(b"\x89PNG"):
            call.note = "not a PNG"
        calls.append(call)
    elif frames is not None:
        calls.append(Call("cutout", 200, 0.0, "skipped: no frames"))
    return calls


def wait_warm(
    client: httpx.Client,
    timeout_s: float,
    poll_s: float = 2.0,
    sleep: Callable[[float], None] = time.sleep,
) -> bool:
    """Poll ``/v1/health`` until the warm start is ``finished``. False on timeout, on ``off`` or
    ``stopped`` (it will never finish), or when health does not answer."""
    end = time.monotonic() + timeout_s
    while True:
        try:
            warm = client.get("/v1/health").json().get("warm", {})
        except (httpx.HTTPError, ValueError) as exc:
            print(f"health: no answer ({type(exc).__name__})")
            return False
        state = warm.get("state")
        print(
            f"warm start: {state}  {warm.get('done')}/{warm.get('total')} done, "
            f"{warm.get('failed')} failed"
        )
        if state == "finished":
            return True
        if state in ("off", "stopped") or time.monotonic() >= end:
            return False
        sleep(poll_s)


def run(client: httpx.Client, rows: list[Row], warm_timeout_s: float | None = None) -> int:
    ok = True
    try:
        health = client.get("/v1/health").json()
        print(
            f"backend: {client.base_url}  offline={health.get('offline')}  "
            f"data_release={health.get('data_release')}  warm={health.get('warm')}"
        )
    except (httpx.HTTPError, ValueError) as exc:
        print(f"FAIL backend {client.base_url} does not answer /v1/health: {exc}")
        return 1
    if warm_timeout_s is not None and not wait_warm(client, warm_timeout_s):
        print("FAIL warm start did not finish")
        ok = False
    for row in rows:
        calls = check_row(client, row)
        good = all(c.ok for c in calls)
        ok = ok and good
        print(f"{'OK  ' if good else 'FAIL'} {row.name:<18} {row.query}")
        for c in calls:
            mark = "  " if c.ok else "!!"
            code = c.status if c.status is not None else "---"
            print(f"   {mark} {c.label:<14} {code}  {c.ms:8.0f} ms  {c.note}")
    print("preflight: PASS" if ok else "preflight: FAIL")
    return 0 if ok else 1


def main(argv: list[str] | None = None, client: httpx.Client | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--base", default="http://localhost:8000", help="backend base URL")
    p.add_argument("--timeout", type=float, default=120.0, help="seconds per call")
    p.add_argument(
        "--wait-warm",
        type=float,
        default=None,
        metavar="SECONDS",
        help="wait for /v1/health to report the warm start finished",
    )
    p.add_argument(
        "--only",
        action="append",
        default=None,
        metavar="NAME",
        help="check only this row (name or query); repeatable",
    )
    args = p.parse_args(argv)
    rows = demo_rows(Settings().targets_file)
    if args.only:
        rows = [r for r in rows if r.name in args.only or r.query in args.only]
    if client is not None:
        return run(client, rows, args.wait_warm)
    with httpx.Client(base_url=args.base, timeout=args.timeout) as c:
        return run(c, rows, args.wait_warm)


if __name__ == "__main__":
    raise SystemExit(main())
