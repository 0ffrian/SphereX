"""Demo preflight (issue #103): against a running backend, check every demo row answers.

    uv run python -m scripts.preflight [--base http://localhost:8000] [--wait-warm 600]

This is the go/no-go check before going on stage (A10.2 step 5). ``scripts.smoke_offline`` is
the in-process check that the cache holds every target's frames and cutouts.

Rows: every row of the demo search list (``SEARCH_LIST`` in ``scripts.bake_demo_pack``, the same
list the search bar shows), every other ``group = "demo"`` target in ``targets.toml``, and 433
Eros (the Track object, group ``fixture``). For each it calls ``/v1/resolve``, ``/card`` and
``/render-params``, one texture the params point at, then ``/frames``, ``/spectrum`` and the
first cutout PNG, and prints the time of each call. ``/frames`` gives the cutout URL.

A ``frames = false`` target in ``targets.toml`` (a catalogue-only exoplanet: TRAPPIST-1 e,
K2-18 b) has no frame list in the cache by design, so its frames, spectrum and cutout are
skipped, not called (the warm start and the pre-fetch skip them too).

Exit code 1 on any non-200 answer (a 503 ``offline_cache_miss`` is the usual one), a connection
error, a reply that is not the JSON it should be, or a cutout that is not a PNG. Reported but not
failed: a card or params answer still ``measuring``, a row whose frame list is empty (a moving
object outside SPHEREx's windows), and render params with no textures (drawn in the browser).

``--wait-warm`` polls ``/v1/health`` until the start-up warm cache reports ``finished`` (or the
time runs out, which fails) before the rows are checked. Health's ``warm.total`` counts the warm
list (the ``SX_PREFETCH_GROUPS`` targets that want frames), not the rows checked here. The script
talks HTTP only, so it never reads the cache itself: what it sees is what the browser will see.
"""

from __future__ import annotations

import argparse
import time
import tomllib
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from app.core.warm import frames_wanted
from app.settings import Settings

# The Track object (A10.2 step 1, Q-197): in group "fixture", not "demo", but shown on stage.
EXTRA_TARGETS = ("433 Eros",)
SKIPPED_NO_FRAMES = "skipped: frames = false"


@dataclass(frozen=True)
class Row:
    name: str
    query: str
    frames: bool = True  # targets.toml ``frames``; False: catalogue only, no frame list


def demo_rows(targets_file: Path, search_list: list[tuple[str, str]] | None = None) -> list[Row]:
    """The search list in its own order, then demo-group targets it lacks, then Eros. Names and
    queries come from ``SEARCH_LIST`` and ``targets.toml``; nothing is typed here twice."""
    if search_list is None:
        from scripts.bake_demo_pack import SEARCH_LIST

        search_list = [(r.name, r.query) for r in SEARCH_LIST]
    doc = tomllib.loads(targets_file.read_text(encoding="utf-8"))
    targets = [t for t in doc.get("target", []) if isinstance(t, dict) and "query" in t]
    by_query = {str(t["query"]): t for t in targets}

    def wants(query: str) -> bool:
        t = by_query.get(query)
        return frames_wanted(t) if t is not None else True

    rows = [Row(n, q, wants(q)) for n, q in search_list]
    seen = {r.query for r in rows}
    for t in targets:
        q = str(t["query"])
        if (t.get("group") == "demo" or t.get("name") in EXTRA_TARGETS) and q not in seen:
            rows.append(Row(str(t.get("name", q)), q, frames_wanted(t)))
            seen.add(q)
    return rows


@dataclass
class Call:
    label: str
    status: int | None  # None: no answer (connection error, timeout)
    ms: float
    note: str = ""
    bad_body: bool = False  # a 200 whose body is not what the route promises

    @property
    def ok(self) -> bool:
        return self.status == 200 and not self.bad_body


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
        except (ValueError, AttributeError):
            note = r.text[:60]
    return Call(label, r.status_code, ms, note), r


def _json(call: Call, resp: httpx.Response | None) -> dict[str, Any] | None:
    """The body of a 200 as a dict, or None. A 200 that is not a JSON object fails the call."""
    if resp is None or resp.status_code != 200:
        return None
    try:
        body = resp.json()
    except ValueError:
        body = None
    if not isinstance(body, dict):
        call.bad_body, call.note = True, "200 but not a JSON object"
        return None
    return body


def _texture_url(params: dict[str, Any]) -> str | None:
    """One texture the render params point at (albedo first); None when there are none."""
    textures = params.get("textures")
    if not isinstance(textures, dict):
        return None
    urls = [textures.get("albedo"), *textures.values()]
    return next((u for u in urls if isinstance(u, str) and u.startswith("/")), None)


def check_row(client: httpx.Client, row: Row) -> list[Call]:
    calls: list[Call] = []
    call, r = _get(client, "resolve", "/v1/resolve", q=row.query)
    calls.append(call)
    resolved = _json(call, r)
    if resolved is None:
        return calls
    if not isinstance(resolved.get("id"), str):
        call.bad_body, call.note = True, "200 without an id"
        return calls
    base = f"/v1/objects/{resolved['id']}"
    params: dict[str, Any] | None = None
    for label in ("card", "render-params"):
        call, resp = _get(client, label, f"{base}/{label}")
        body = _json(call, resp)
        # Issue #41: a 200 that is not the final answer yet (warm start not done for this
        # object). Reported, not failed: the app shows it and improves it when the job ends.
        if body is not None and resp is not None and "X-SX-Measuring" in resp.headers:
            call.note = f"warning: still measuring ({resp.headers['X-SX-Measuring']})"
        calls.append(call)
        if label == "render-params":
            params = body
    if params is not None:
        url = _texture_url(params)
        if url is None:
            calls.append(Call("texture", 200, 0.0, "skipped: no baked textures"))
        else:
            calls.append(_get(client, "texture", url)[0])
    if not row.frames:
        calls += [Call(label, 200, 0.0, SKIPPED_NO_FRAMES) for label in ("frames", "spectrum")]
        calls.append(Call("cutout", 200, 0.0, SKIPPED_NO_FRAMES))
        return calls
    call, fr = _get(client, "frames", f"{base}/frames")
    calls.append(call)
    frames_body = _json(call, fr)
    sp_call, sp = _get(client, "spectrum", f"{base}/spectrum")
    _json(sp_call, sp)
    calls.append(sp_call)
    if frames_body is None:
        return calls
    frames = frames_body.get("frames")
    if not isinstance(frames, list):
        call.bad_body, call.note = True, "200 without a frames list"
        return calls
    if not frames:
        calls.append(Call("cutout", 200, 0.0, "skipped: no frames"))
        return calls
    first = frames[0] if isinstance(frames[0], dict) else {}
    cutout_url = first.get("cutout_url")
    if not isinstance(cutout_url, str):
        call.bad_body, call.note = True, "frame without a cutout_url"
        return calls
    call, png = _get(client, "cutout", cutout_url)
    if png is not None and png.status_code == 200 and not png.content.startswith(b"\x89PNG"):
        call.bad_body, call.note = True, "not a PNG"
    calls.append(call)
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
